import asyncio
import os
import unittest
from types import SimpleNamespace

os.environ.setdefault('SECRET_KEY', 'test-only-plan-secret')

from fastapi import FastAPI
from backend.auth.dependencies import get_current_user
from backend.routers import super_admin
from db.database import get_db
from test_client_tenant_access import request


class FakeDB:
    def __init__(self, tier='evv', aggregator='sandata', exists=True):
        self.agency = SimpleNamespace(id=101, tier=tier, aggregator=aggregator) if exists else None
        self.writes = []
        self.commits = 0

    def execute(self, statement, params=None):
        sql = str(statement)
        if sql.startswith('UPDATE care.agencies'):
            self.writes.append((sql, params.copy()))
        return SimpleNamespace(fetchone=lambda: self.agency, fetchall=lambda: [])

    def commit(self):
        self.commits += 1


class PlanManagementTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.app = FastAPI()
        self.app.include_router(super_admin.router, prefix='/api/super-admin')
        self.app.dependency_overrides[get_db] = lambda: self.db
        self.authenticate('super_admin')

    def authenticate(self, role):
        self.app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(role=role)

    def update(self, body):
        return asyncio.run(request(self.app, 'PATCH', '/api/super-admin/agencies/101', body))

    def test_only_super_admin_can_read_and_assign_plans(self):
        for role in ('agency_admin', 'coordinator', 'caregiver'):
            self.authenticate(role)
            self.assertEqual(asyncio.run(request(self.app, 'GET', '/api/super-admin/agencies')), 403)
            self.assertEqual(self.update({'tier': 'core'}), 403)
        self.assertEqual(self.db.writes, [])

    def test_core_assignment_clears_aggregator_in_database(self):
        self.assertEqual(self.update({'tier': 'core', 'aggregator': None}), 200)
        sql, values = self.db.writes[0]
        self.assertIn('aggregator = :aggregator', sql)
        self.assertIsNone(values['aggregator'])
        self.assertEqual(values['tier'], 'core')
        self.assertEqual(values['_id'], 101)
        self.assertEqual(self.db.commits, 1)

    def test_evv_assignment_saves_selected_aggregator(self):
        self.db = FakeDB('core', None)
        self.assertEqual(self.update({'tier': 'evv', 'aggregator': 'hhax'}), 200)
        self.assertEqual(self.db.writes[0][1]['aggregator'], 'hhax')

    def test_invalid_and_planned_assignments_do_not_write(self):
        for payload in (
            {'tier': 'evvplus', 'aggregator': 'sandata'},
            {'tier': 'invalid'},
            {'tier': 'evv', 'aggregator': 'unknown'},
            {'tier': 'evv', 'aggregator': None},
        ):
            with self.subTest(payload=payload):
                self.assertEqual(self.update(payload), 422)
        self.assertEqual(self.db.writes, [])
        self.assertEqual(self.db.commits, 0)

    def test_upgrade_requires_aggregator(self):
        self.db = FakeDB('core', None)
        self.assertEqual(self.update({'tier': 'evv'}), 422)
        self.assertEqual(self.db.writes, [])

    def test_existing_evvplus_can_be_maintained_or_moved_to_active_plan(self):
        self.db = FakeDB('evvplus', 'sandata')
        self.assertEqual(self.update({'name': 'Updated agency'}), 200)
        self.assertEqual(self.update({'tier': 'evvplus', 'aggregator': 'hhax'}), 200)
        self.assertEqual(self.update({'tier': 'core'}), 200)
        self.assertIsNone(self.db.writes[-1][1]['aggregator'])

    def test_missing_agency_returns_404(self):
        self.db = FakeDB(exists=False)
        self.assertEqual(self.update({'tier': 'core'}), 404)
        self.assertEqual(self.db.writes, [])

    def test_creation_rejects_planned_plan_before_any_insert(self):
        result = asyncio.run(request(self.app, 'POST', '/api/super-admin/agencies', {
            'agency_code': 'ACME', 'name': 'Acme', 'tier': 'evvplus',
            'aggregator': 'sandata', 'primary_contact_name': 'Admin',
            'primary_contact_email': 'admin@example.com', 'admin_username': 'admin',
        }))
        self.assertEqual(result, 422)
        self.assertEqual(self.db.commits, 0)


if __name__ == '__main__':
    unittest.main()
