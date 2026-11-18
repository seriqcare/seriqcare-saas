import os
import unittest
from datetime import datetime, timedelta
from email import message_from_string
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault('SECRET_KEY', 'test-password-setup-secret')

from fastapi import HTTPException, Request
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from backend.routers import auth, super_admin
from backend.services.auth_tokens import hash_token
from db.models import Agency, Employee, PasswordResetToken, User


class PasswordSetupTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://')
        with self.engine.begin() as conn:
            conn.execute(text("ATTACH DATABASE ':memory:' AS care"))
            for model in (Agency, Employee, User, PasswordResetToken):
                model.__table__.create(conn)
        self.db = Session(self.engine)
        self.db.add_all([
            Agency(id=1, agency_code='ACME', name='First Agency', tier='core', is_active=True),
            Agency(id=2, agency_code='OTHER', name='Other Agency', tier='core', is_active=True),
            User(id=10, agency_id=1, username='first.admin', email='shared@example.com', role='agency_admin', is_active=True, password_hash='original'),
            User(id=20, agency_id=2, username='other.admin', email='shared@example.com', role='agency_admin', is_active=True, password_hash='original'),
            User(id=30, agency_id=None, username='platform.admin', email='platform@example.com', role='super_admin', is_active=True, password_hash='original'),
        ])
        self.db.commit()
        self.request = Request({'type': 'http', 'headers': [], 'client': ('127.0.0.1', 1234)})
        self.audit = patch.object(auth, 'write_audit').start()
        self.hasher = patch.object(auth, '_hash_password', side_effect=lambda value: 'hashed:' + value).start()
        self.email = patch.object(auth, '_send_reset_email').start()

    def tearDown(self):
        patch.stopall()
        self.db.close()
        self.engine.dispose()

    def token(self, user_id=10, raw='setup-token'):
        self.db.add(PasswordResetToken(user_id=user_id, token_hash=hash_token(raw),
            expires_at=datetime.utcnow() + timedelta(hours=24), created_at=datetime.utcnow()))
        self.db.commit()
        return raw

    def context(self, token):
        return auth.password_reset_context(auth.PasswordResetContextRequest(token=token), self.db)

    def reset(self, token, **changes):
        payload = {'token': token, 'new_password': 'new-password', 'agency_id': 1, 'agency_code': 'ACME', 'email': 'shared@example.com'}
        return auth.reset_password(auth.ResetPasswordRequest(**{**payload, **changes}), self.request, self.db)

    def test_context_resolves_agency_and_email_from_existing_token(self):
        self.assertEqual(self.context(self.token()), {
            'agency_id': 1, 'agency_code': 'ACME', 'agency_name': 'First Agency', 'email': 'shared@example.com',
        })

    def test_reset_changes_only_token_owner_despite_shared_email(self):
        token = self.token()
        self.reset(token)
        self.db.expire_all()
        self.assertEqual(self.db.get(User, 10).password_hash, 'hashed:new-password')
        self.assertEqual(self.db.get(User, 20).password_hash, 'original')
        self.assertIsNotNone(self.db.query(PasswordResetToken).one().used_at)
        with self.assertRaises(HTTPException): self.reset(token)
        with self.assertRaises(HTTPException): self.context(token)

    def test_wrong_agency_id_code_or_email_does_not_consume_token(self):
        token = self.token()
        for changes in ({'agency_id': 2}, {'agency_code': 'OTHER'}, {'email': 'another@example.com'}):
            with self.subTest(changes=changes), self.assertRaises(HTTPException) as error:
                self.reset(token, **changes)
            self.assertEqual(error.exception.status_code, 400)
            self.assertIsNone(self.db.query(PasswordResetToken).one().used_at)
            self.assertEqual(self.db.get(User, 10).password_hash, 'original')
        self.reset(token, agency_code=' acme ', email=' SHARED@example.com ')

    def test_invalid_expired_or_disabled_identity_is_rejected(self):
        with self.assertRaises(HTTPException): self.context('invalid')
        token = self.token()
        row = self.db.query(PasswordResetToken).one()
        row.expires_at = datetime.utcnow() - timedelta(seconds=1)
        self.db.commit()
        with self.assertRaises(HTTPException): self.context(token)
        row.expires_at = datetime.utcnow() + timedelta(hours=1)
        self.db.get(Agency, 1).is_active = False
        self.db.commit()
        with self.assertRaises(HTTPException): self.context(token)
        self.db.get(Agency, 1).is_active = True
        self.db.get(User, 10).is_active = False
        self.db.commit()
        with self.assertRaises(HTTPException): self.context(token)

    def test_platform_context_and_reset_use_reserved_code(self):
        token = self.token(30)
        context = self.context(token)
        self.assertIsNone(context['agency_id'])
        self.assertEqual(context['agency_code'], '999')
        self.reset(token, agency_id=None, agency_code='999', email='platform@example.com')
        self.assertEqual(self.db.get(User, 30).password_hash, 'hashed:new-password')

    def test_forgot_password_selects_shared_email_within_the_requested_agency(self):
        for code, expected_user in [(' acme ', 10), ('OTHER', 20)]:
            auth.forgot_password(auth.ForgotPasswordRequest(agency_code=code, email='SHARED@example.com'), self.db)
            newest = self.db.query(PasswordResetToken).order_by(PasswordResetToken.id.desc()).first()
            self.assertEqual(newest.user_id, expected_user)
        self.assertEqual(self.email.call_args.args[2:], (2, 'OTHER'))

    def test_unknown_agency_email_and_wrong_platform_identity_return_same_result(self):
        for code, email in [('UNKNOWN', 'shared@example.com'), ('ACME', 'unknown@example.com'), ('999', 'shared@example.com')]:
            self.assertIsNone(auth.forgot_password(auth.ForgotPasswordRequest(agency_code=code, email=email), self.db))
        self.assertEqual(self.db.query(PasswordResetToken).count(), 0)
        self.email.assert_not_called()


class OnboardingDetailsTests(unittest.TestCase):
    def test_creation_returns_code_and_passes_agency_identity_to_email(self):
        class DB:
            def __init__(self): self.results = iter([None, None, (4,), (70,)])
            def execute(self, *args):
                result = next(self.results)
                return SimpleNamespace(fetchone=lambda: result)
            def add(self, value): self.token = value
            def commit(self): pass
        with patch.object(auth, '_send_onboarding_email') as send:
            result = super_admin.create_agency(super_admin.AgencyCreate(
                agency_code=' new ', name='New Agency', primary_contact_name='Admin',
                primary_contact_email='ADMIN@example.com', admin_username='new.admin',
            ), SimpleNamespace(role='super_admin'), DB())
        self.assertEqual(result['id'], 4)
        self.assertEqual(result['agency_code'], 'NEW')
        self.assertEqual(result['admin_user']['email'], 'admin@example.com')
        self.assertEqual(send.call_args.kwargs['agency_id'], 4)
        self.assertEqual(send.call_args.kwargs['agency_code'], 'NEW')

    def test_onboarding_email_contains_agency_id_code_and_email(self):
        with patch('smtplib.SMTP') as smtp:
            auth._send_onboarding_email('admin@example.com', 'test-token', 'Admin', 'New Agency', 4, 'NEW')
        message = message_from_string(smtp.return_value.__enter__.return_value.sendmail.call_args.args[2])
        bodies = [part.get_payload(decode=True).decode() for part in message.walk() if part.get_content_type() in ('text/plain', 'text/html')]
        for body in bodies:
            self.assertIn('Agency ID: 4', body)
            self.assertIn('Agency Code: NEW', body)
            self.assertIn('Email: admin@example.com', body)
            self.assertIn('/reset-password?token=test-token', body)


if __name__ == '__main__':
    unittest.main()
