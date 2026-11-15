import asyncio
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault("SECRET_KEY", "test-only-caregiver-account-secret")

from fastapi import FastAPI, HTTPException

from backend.auth.dependencies import AgencyScope, get_current_user
from backend.routers import caregivers
from backend.schemas import CaregiverMobileAccountUpdate
from db.database import get_db
from test_client_tenant_access import Result, request, user


class AccountDB:
    def __init__(self, account=True):
        self.account = account
        self.queries = []

    def execute(self, query, params=None):
        sql, params = str(query), dict(params or {})
        self.queries.append((sql, params))
        if "SELECT tier FROM care.agencies" in sql:
            return Result(SimpleNamespace(tier="core"))
        if "FROM care.employees e" in sql:
            agency_id = {1: 10, 2: 20}.get(params["id"])
            if agency_id is None or params.get("_agy_id", agency_id) != agency_id:
                return Result()
            return Result(SimpleNamespace(id=params["id"], agency_id=agency_id,
                phone="5551234567", sandata_employee_id="SD-1", hhax_employee_id=None, npi="1234567890"))
        if "FROM care.users u" in sql:
            assert "u.agency_id = :agency_id" in sql
            assert "u.role = 'caregiver'" in sql
            if not self.account:
                return Result()
            return Result(SimpleNamespace(username="caregiver.mobile", display_name="Test Employee",
                email="staff@example.com", is_active=True, has_password=True))
        raise AssertionError(f"Unexpected SQL: {sql}")


class AccountDetailsTests(unittest.TestCase):
    def test_owned_employee_details_include_mobile_account_but_no_password(self):
        db = AccountDB()
        details = caregivers.get_caregiver_account_details(1, db, AgencyScope(user(agency_id=10)))
        result = details.model_dump()
        self.assertEqual(result["mobile_account"]["username"], "caregiver.mobile")
        self.assertEqual(result["sandata_employee_id"], "SD-1")
        self.assertEqual(set(result["mobile_account"]), {"username", "display_name", "email", "is_active", "has_password"})
        self.assertTrue(result["mobile_account"]["has_password"])
        self.assertEqual(db.queries[-1][1], {"employee_id": 1, "agency_id": 10})

    def test_foreign_employee_returns_not_found_before_reading_account(self):
        db = AccountDB()
        with self.assertRaises(HTTPException) as error:
            caregivers.get_caregiver_account_details(2, db, AgencyScope(user(agency_id=10)))
        self.assertEqual(error.exception.status_code, 404)
        self.assertFalse(any("FROM care.users" in sql for sql, _ in db.queries))

    def test_missing_mobile_account_is_null(self):
        details = caregivers.get_caregiver_account_details(1, AccountDB(account=False), AgencyScope(user(agency_id=10)))
        self.assertIsNone(details.mobile_account)

    def test_global_admin_reads_account_in_employees_own_agency(self):
        db = AccountDB()
        caregivers.get_caregiver_account_details(2, db, AgencyScope(user("super_admin", None)))
        self.assertEqual(db.queries[-1][1]["agency_id"], 20)

    def test_route_requires_authenticated_coordinator_or_admin(self):
        app = FastAPI()
        app.include_router(caregivers.router, prefix="/api/caregivers")
        app.dependency_overrides[get_db] = lambda: AccountDB()
        status = asyncio.run(request(app, "GET", "/api/caregivers/1/account-details"))
        self.assertIn(status, (401, 403))
        app.dependency_overrides[get_current_user] = lambda: user("caregiver", 10, 1)
        self.assertEqual(asyncio.run(request(app, "GET", "/api/caregivers/1/account-details")), 403)
        app.dependency_overrides[get_current_user] = lambda: user("coordinator", 10)
        self.assertEqual(asyncio.run(request(app, "GET", "/api/caregivers/1/account-details")), 200)


class MobileAccountDB(AccountDB):
    def __init__(self, account=True, duplicate=False):
        super().__init__(account)
        self.duplicate = duplicate
        self.commits = 0
        self.rollbacks = 0

    def execute(self, query, params=None):
        sql, params = str(query), dict(params or {})
        if "FROM care.users u" in sql:
            self.queries.append((sql, params))
            self.assert_account_scope(sql)
            return Result(SimpleNamespace(id=100, username="caregiver.mobile", is_active=True, has_password=True)) if self.account else Result()
        if "SELECT id FROM care.users" in sql:
            self.queries.append((sql, params))
            return Result(SimpleNamespace(id=200)) if self.duplicate else Result()
        if "INSERT INTO care.users" in sql or "UPDATE care." in sql:
            self.queries.append((sql, params))
            return Result()
        return super().execute(query, params)

    def assert_account_scope(self, sql):
        assert "u.agency_id = :agency_id" in sql and "u.role = 'caregiver'" in sql

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


class MobileAccountSaveTests(unittest.TestCase):
    def save(self, db, **values):
        payload = {"username": "caregiver.mobile", "display_name": "Test Employee", "email": "staff@example.com", **values}
        return caregivers.save_caregiver_mobile_account(1, CaregiverMobileAccountUpdate(**payload), db, AgencyScope(user(agency_id=10)))

    def test_create_account_hashes_password_and_uses_employee_agency(self):
        db = MobileAccountDB(account=False)
        with patch('backend.routers.auth._hash_password', return_value='secure-hash') as hasher:
            result = self.save(db, username=" new.mobile ", new_password="new-password")
        hasher.assert_called_once_with('new-password')
        sql, values = next((sql, values) for sql, values in db.queries if "INSERT INTO care.users" in sql)
        self.assertEqual(values["agency_id"], 10)
        self.assertEqual(values["employee_id"], 1)
        self.assertEqual(values["username"], 'new.mobile')
        self.assertEqual(values["password_hash"], 'secure-hash')
        self.assertNotIn('new-password', str(values))
        self.assertIn("'caregiver'", sql)
        self.assertTrue(result.has_password)
        self.assertEqual(db.commits, 1)

    def test_edit_without_password_preserves_hash_and_sessions(self):
        db = MobileAccountDB()
        result = self.save(db, display_name="Updated Name")
        sql, values = next((sql, values) for sql, values in db.queries if "UPDATE care.users SET" in sql)
        self.assertNotIn('password_hash', sql)
        self.assertNotIn('password_hash', values)
        self.assertFalse(any('revoked_at' in sql for sql, _ in db.queries))
        self.assertEqual(result.display_name, 'Updated Name')
        self.assertTrue(result.has_password)

    def test_password_change_revokes_both_session_types(self):
        db = MobileAccountDB()
        with patch('backend.routers.auth._hash_password', return_value='new-hash'):
            self.save(db, new_password='new-password')
        self.assertTrue(any('UPDATE care.user_sessions' in sql for sql, _ in db.queries))
        self.assertTrue(any('UPDATE care.device_sessions' in sql for sql, _ in db.queries))

    def test_disabling_or_renaming_account_revokes_sessions(self):
        for values in ({'is_active': False}, {'username': 'new.username'}):
            db = MobileAccountDB()
            self.save(db, **values)
            self.assertEqual(sum('revoked_at' in sql for sql, _ in db.queries), 2)

    def test_new_account_can_await_password_setup_in_settings(self):
        db = MobileAccountDB(account=False)
        result = self.save(db)
        self.assertFalse(result.has_password)
        self.assertEqual(db.commits, 1)
        values = next(values for sql, values in db.queries if 'INSERT INTO care.users' in sql)
        self.assertIsNone(values['password_hash'])

    def test_duplicate_username_returns_conflict_without_writes(self):
        db = MobileAccountDB(duplicate=True)
        with self.assertRaises(HTTPException) as error:
            self.save(db)
        self.assertEqual(error.exception.status_code, 409)
        self.assertFalse(any('UPDATE care.users' in sql for sql, _ in db.queries))
        self.assertEqual(db.rollbacks, 1)

    def test_foreign_employee_cannot_be_modified(self):
        db = MobileAccountDB()
        with self.assertRaises(HTTPException) as error:
            caregivers.save_caregiver_mobile_account(2, CaregiverMobileAccountUpdate(username='another'), db, AgencyScope(user(agency_id=10)))
        self.assertEqual(error.exception.status_code, 404)
        self.assertEqual(db.commits, 0)
        self.assertFalse(any('FROM care.users' in sql for sql, _ in db.queries))

    def test_save_requires_coordinator_or_admin(self):
        app = FastAPI()
        db = MobileAccountDB()
        app.include_router(caregivers.router, prefix='/api/caregivers')
        app.dependency_overrides[get_db] = lambda: db
        payload = {'username': 'caregiver.mobile'}
        status = asyncio.run(request(app, 'PUT', '/api/caregivers/1/mobile-account', payload))
        self.assertIn(status, (401, 403))
        app.dependency_overrides[get_current_user] = lambda: user('caregiver', 10, 1)
        self.assertEqual(asyncio.run(request(app, 'PUT', '/api/caregivers/1/mobile-account', payload)), 403)
        app.dependency_overrides[get_current_user] = lambda: user('coordinator', 10)
        self.assertEqual(asyncio.run(request(app, 'PUT', '/api/caregivers/1/mobile-account', payload)), 200)


class MobileUserOptionsDB:
    def __init__(self):
        self.queries = []

    def execute(self, query, params=None):
        sql, params = str(query), dict(params or {})
        self.queries.append((sql, params))
        if 'SELECT tier FROM care.agencies' in sql:
            return Result(SimpleNamespace(tier='core'))
        assert 'u.agency_id = e.agency_id' in sql
        assert "u.role = 'caregiver'" in sql and 'u.is_active = 1' in sql
        records = [
            SimpleNamespace(employee_id=1, name='Sarah Mills', employee_code='EMP1', username='sarah.mobile', agency_id=10),
            SimpleNamespace(employee_id=2, name='No Account', employee_code='EMP2', username=None, agency_id=10),
            SimpleNamespace(employee_id=3, name='Other Agency', employee_code='EMP1', username='other.mobile', agency_id=20),
        ]
        return Result(rows=[row for row in records if params.get('_agy_id', row.agency_id) == row.agency_id])


class MobileUserOptionTests(unittest.TestCase):
    def test_dropdown_includes_owned_caregivers_with_and_without_accounts(self):
        options = caregivers.get_caregiver_mobile_users(MobileUserOptionsDB(), AgencyScope(user(agency_id=10)))
        self.assertEqual([row.employee_id for row in options], [1, 2])
        self.assertEqual(options[0].username, 'sarah.mobile')
        self.assertIsNone(options[1].username)
        self.assertEqual(set(options[0].model_dump()), {'employee_id', 'name', 'employee_code', 'username'})

    def test_dropdown_requires_coordinator_or_admin(self):
        app = FastAPI()
        app.include_router(caregivers.router, prefix='/api/caregivers')
        app.dependency_overrides[get_db] = lambda: MobileUserOptionsDB()
        self.assertIn(asyncio.run(request(app, 'GET', '/api/caregivers/mobile-users')), (401, 403))
        app.dependency_overrides[get_current_user] = lambda: user('caregiver', 10, 1)
        self.assertEqual(asyncio.run(request(app, 'GET', '/api/caregivers/mobile-users')), 403)
        app.dependency_overrides[get_current_user] = lambda: user('coordinator', 10)
        self.assertEqual(asyncio.run(request(app, 'GET', '/api/caregivers/mobile-users')), 200)

    def test_coordinator_cannot_reset_password_in_another_agency(self):
        from backend.routers.auth import admin_reset_password, AdminPasswordResetRequest
        target = SimpleNamespace(id=30, role='caregiver', agency_id=20)
        query = SimpleNamespace()
        query.filter = lambda *args: query
        query.first = lambda: target
        db = SimpleNamespace(query=lambda *args: query)
        with self.assertRaises(HTTPException) as error:
            admin_reset_password(AdminPasswordResetRequest(username='other.mobile', new_password='test-password', user_type='mobile'),
                                 None, user('coordinator', 10), db)
        self.assertEqual(error.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
