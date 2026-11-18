import asyncio
import os
import unittest
from http.cookies import SimpleCookie
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault('SECRET_KEY', 'test-only-agency-auth-secret')

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials
from jose import jwt
from pydantic import ValidationError
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from backend.auth.dependencies import get_current_user
from backend.auth.tenant import verified_user_agency
from backend.routers import auth
from backend.services import auth_tokens
from db.database import get_db
from db.models import Agency, DeviceSession, Employee, User, UserSession
from test_client_tenant_access import request


class AgencyAuthTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://')
        with self.engine.begin() as connection:
            connection.execute(text("ATTACH DATABASE ':memory:' AS care"))
            for model in (Agency, Employee, User, UserSession, DeviceSession):
                model.__table__.create(connection)
        self.db = Session(self.engine)
        self.db.add_all([
            Agency(id=1, agency_code='ACME', name='First Agency', tier='core', is_active=True),
            Agency(id=2, agency_code='OTHER', name='Second Agency', tier='evv', is_active=True),
            Employee(id=5, agency_id=1, employee_code='EMP1', first_name='Test', last_name='Caregiver', is_active=True),
            User(id=10, agency_id=1, username='first.admin', email='shared@example.com', display_name='First Admin', role='agency_admin', is_active=True, password_hash='stored-hash'),
            User(id=20, agency_id=2, username='second.admin', email='shared@example.com', display_name='Second Admin', role='agency_admin', is_active=True, password_hash='stored-hash'),
            User(id=30, agency_id=1, employee_id=5, username='first.mobile', display_name='Test Caregiver', role='caregiver', is_active=True, password_hash='stored-hash'),
            User(id=40, agency_id=None, username='platform.admin', role='super_admin', is_active=True, password_hash='stored-hash'),
        ])
        self.db.commit()
        auth._attempt_store.clear()
        self.audit = patch.object(auth, 'write_audit').start()
        self.verify = patch.object(auth, '_verify_password', side_effect=lambda password, stored: password == 'correct-password' and stored == 'stored-hash').start()
        self.request = Request({'type': 'http', 'headers': [], 'client': ('127.0.0.1', 1234), 'scheme': 'http'})

    def tearDown(self):
        patch.stopall()
        self.db.close()
        self.engine.dispose()

    def login(self, code='ACME', username='first.admin', password='correct-password', client_type='mobile'):
        return asyncio.run(auth.login(auth.LoginRequest(agency_code=code, username=username, password=password, client_type=client_type), self.request, Response(), self.db))

    def authenticate(self, token):
        return get_current_user(HTTPAuthorizationCredentials(scheme='Bearer', credentials=token), self.db)

    def test_agency_code_is_required_and_normalized(self):
        for data in ({'username':'first.admin','password':'correct-password'}, {'agency_code':'   ','username':'first.admin','password':'correct-password'}):
            with self.assertRaises(ValidationError):
                auth.LoginRequest(**data)
        response = self.login(' acme ')
        self.assertEqual(response.agency_id, 1)
        self.assertEqual(response.agency_code, 'ACME')

    def test_correct_credentials_work_only_in_their_agency(self):
        for code, username, password in [('OTHER','first.admin','correct-password'), ('UNKNOWN','first.admin','correct-password'), ('ACME','first.admin','incorrect')]:
            with self.assertRaises(HTTPException) as error:
                self.login(code, username, password)
            self.assertEqual(error.exception.status_code, 401)
        self.assertEqual(self.db.query(DeviceSession).count(), 0)

    def test_shared_email_resolves_within_selected_agency(self):
        self.assertEqual(self.login('ACME','shared@example.com').username, 'first.admin')
        self.assertEqual(self.login('OTHER','shared@example.com').username, 'second.admin')

    def test_web_and_mobile_both_require_the_same_agency_binding(self):
        for client_type in ('web', 'mobile'):
            response = self.login(client_type=client_type)
            claims = jwt.decode(response.access_token, auth_tokens._SECRET, algorithms=['HS256'])
            self.assertEqual(claims['agency_code'], 'ACME')
            self.assertEqual(claims['agency_id'], 1)
            self.assertEqual(self.authenticate(response.access_token).id, 10)
        response = self.login(username='first.mobile')
        self.assertEqual(self.authenticate(response.access_token).employee_id, 5)

    def test_disabled_agency_or_mismatched_caregiver_membership_is_rejected(self):
        self.db.get(Agency, 1).is_active = False
        self.db.commit()
        with self.assertRaises(HTTPException): self.login()
        self.db.get(Agency, 1).is_active = True
        self.db.get(Employee, 5).agency_id = 2
        self.db.commit()
        with self.assertRaises(HTTPException): self.login(username='first.mobile')
        self.assertEqual(self.db.query(DeviceSession).count(), 0)

    def test_signed_claims_cannot_override_current_user_agency_role_or_identity(self):
        response = self.login()
        claims = jwt.decode(response.access_token, auth_tokens._SECRET, algorithms=['HS256'])
        for change in ({'agency_id':2}, {'agency_code':'OTHER'}, {'role':'super_admin'}, {'employee_id':5}, {'user_id':20}, {'sub':'second.admin'}):
            token = jwt.encode({**claims, **change}, auth_tokens._SECRET, algorithm='HS256')
            with self.assertRaises(HTTPException) as error: self.authenticate(token)
            self.assertEqual(error.exception.status_code, 401)

    def test_access_session_must_belong_to_same_user(self):
        response = self.login()
        session = self.db.query(UserSession).first()
        session.user_id = 20
        self.db.commit()
        with self.assertRaises(HTTPException): self.authenticate(response.access_token)

    def test_agency_changes_invalidate_access_and_refresh_sessions(self):
        response = self.login()
        self.db.get(User,10).agency_id = 2
        self.db.commit()
        with self.assertRaises(HTTPException): self.authenticate(response.access_token)
        with self.assertRaises(HTTPException) as error:
            asyncio.run(auth.refresh(self.request, Response(), auth.RefreshRequest(refresh_token=response.refresh_token), self.db))
        self.assertEqual(error.exception.status_code, 401)

    def test_refresh_retains_verified_agency_code(self):
        response = self.login()
        refreshed = asyncio.run(auth.refresh(self.request, Response(), auth.RefreshRequest(refresh_token=response.refresh_token), self.db))
        self.assertEqual(refreshed['agency_code'], 'ACME')
        self.assertEqual(refreshed['agency_id'], 1)
        self.assertTrue(auth_tokens.refresh_token_matches_agency(refreshed['refresh_token'],1))
        self.assertEqual(self.authenticate(refreshed['access_token']).id, 10)

    def test_unbound_legacy_refresh_tokens_require_sign_in_again(self):
        response = self.login()
        legacy = auth_tokens.generate_refresh_token()
        session = self.db.query(DeviceSession).first()
        session.token_hash = auth_tokens.hash_token(legacy)
        self.db.commit()
        with self.assertRaises(HTTPException) as error:
            asyncio.run(auth.refresh(self.request, Response(), auth.RefreshRequest(refresh_token=legacy), self.db))
        self.assertEqual(error.exception.status_code,401)

    def test_platform_admin_password_login_cannot_select_a_tenant(self):
        with self.assertRaises(HTTPException): self.login('ACME','platform.admin')

    def platform_web_login(self, password='correct-password'):
        response = Response()
        result = asyncio.run(auth.login(auth.LoginRequest(
            agency_code=' 999 ', username='platform.admin', password=password, client_type='web',
        ), self.request, response, self.db))
        return result, response

    def test_reserved_code_authenticates_super_admin_without_an_agency_record(self):
        result, response = self.platform_web_login()
        self.assertEqual(result.role, 'super_admin')
        self.assertEqual(result.agency_code, '999')
        self.assertIsNone(result.agency_id)
        self.assertIsNone(result.refresh_token)
        self.assertIn('HttpOnly', response.headers['set-cookie'])
        self.assertEqual(self.authenticate(result.access_token).id, 40)
        claims = jwt.decode(result.access_token, auth_tokens._SECRET, algorithms=['HS256'])
        self.assertEqual(claims['agency_code'], '999')
        self.assertIsNone(claims['agency_id'])
        self.assertEqual(self.db.query(Agency).count(), 2)

    def test_platform_refresh_retains_reserved_code_and_null_agency(self):
        result, response = self.platform_web_login()
        cookie = SimpleCookie()
        cookie.load(response.headers['set-cookie'])
        rt = cookie[auth._RT_COOKIE].value
        self.assertTrue(auth_tokens.refresh_token_matches_agency(rt, None))
        req = Request({'type': 'http', 'headers': [(b'cookie', f'{auth._RT_COOKIE}={rt}'.encode())]})
        refreshed = asyncio.run(auth.refresh(req, Response(), auth.RefreshRequest(), self.db))
        self.assertEqual(refreshed['agency_code'], '999')
        self.assertIsNone(refreshed['agency_id'])
        self.assertEqual(self.authenticate(refreshed['access_token']).id, 40)

    def test_reserved_code_cannot_authenticate_regular_agency_users(self):
        for username in ('first.admin', 'first.mobile', 'shared@example.com'):
            with self.assertRaises(HTTPException) as error:
                self.login('999', username, client_type='web')
            self.assertEqual(error.exception.status_code, 401)
        self.assertEqual(self.db.query(DeviceSession).count(), 0)

    def test_reserved_code_does_not_allow_mobile_platform_login(self):
        with self.assertRaises(HTTPException) as error:
            self.login('999', 'platform.admin', client_type='mobile')
        self.assertEqual(error.exception.status_code, 401)
        self.assertEqual(self.db.query(DeviceSession).count(), 0)

    def test_inactive_platform_account_and_wrong_password_are_rejected(self):
        with self.assertRaises(HTTPException): self.platform_web_login('wrong-password')
        self.db.get(User, 40).is_active = False
        self.db.commit()
        with self.assertRaises(HTTPException): self.platform_web_login()
        self.assertEqual(self.db.query(DeviceSession).count(), 0)

    def test_platform_claim_code_cannot_be_changed(self):
        result, _ = self.platform_web_login()
        claims = jwt.decode(result.access_token, auth_tokens._SECRET, algorithms=['HS256'])
        for code in ('ACME', None):
            changed = jwt.encode({**claims, 'agency_code': code}, auth_tokens._SECRET, algorithm='HS256')
            with self.assertRaises(HTTPException): self.authenticate(changed)

    def test_legacy_agency_with_reserved_code_cannot_authenticate_or_refresh(self):
        response = self.login()
        self.db.get(Agency, 1).agency_code = '999'
        self.db.commit()
        with self.assertRaises(HTTPException): self.login('999', 'first.admin', client_type='web')
        with self.assertRaises(HTTPException): self.authenticate(response.access_token)
        with self.assertRaises(HTTPException):
            asyncio.run(auth.refresh(self.request, Response(), auth.RefreshRequest(refresh_token=response.refresh_token), self.db))

    def test_public_signup_cannot_provision_an_agency_account(self):
        app = FastAPI()
        app.include_router(auth.router, prefix='/auth')
        app.dependency_overrides[get_db] = lambda: self.db
        payload = {'agency_code':'ACME','first_name':'Test','last_name':'User','username':'new-user','email':'new@example.com','password':'long-password','confirm_password':'long-password','role':'agency_admin'}
        self.assertIn(asyncio.run(request(app,'POST','/auth/signup',payload)), (401,403))
        with self.assertRaises(HTTPException):
            auth.signup(auth.SignupRequest(**{**payload,'agency_code':'OTHER'}), Response(), self.db, self.db.get(User,10))
        self.assertIsNone(self.db.query(User).filter(User.username == 'new-user').first())


if __name__ == '__main__':
    unittest.main()
