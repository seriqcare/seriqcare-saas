import asyncio
import os
import unittest
from unittest.mock import patch

os.environ.setdefault('SECRET_KEY', 'test-only-super-admin-connections-secret')
from fastapi import FastAPI
from backend.auth.dependencies import get_current_user
from backend.routers import super_admin
from backend.services import sandata, hhax
from test_client_tenant_access import request, user


class SuperAdminConnectionsTests(unittest.TestCase):
    def test_connections_require_super_admin(self):
        app = FastAPI()
        app.include_router(super_admin.router, prefix='/api/super-admin')
        self.assertIn(asyncio.run(request(app, 'GET', '/api/super-admin/connections')), (401, 403))
        for role in ('agency_admin', 'coordinator', 'caregiver'):
            app.dependency_overrides[get_current_user] = lambda role=role: user(role)
            self.assertEqual(asyncio.run(request(app, 'GET', '/api/super-admin/connections')), 403)
        app.dependency_overrides[get_current_user] = lambda: user('super_admin', None)
        self.assertEqual(asyncio.run(request(app, 'GET', '/api/super-admin/connections')), 200)

    def test_live_configuration_is_redacted_and_does_not_claim_connection_health(self):
        with patch.multiple(sandata, _MODE='live', _API_URL='https://username:password@example.invalid/intake?api_key=secret#token', _API_KEY='private-key'), \
             patch.multiple(hhax, _MODE='live', _BASE_URL='https://hhax.example.invalid', _CLIENT_ID='client-id', _CLIENT_SECRET='private-secret'):
            rows = super_admin.get_connections(user('super_admin', None))
        self.assertEqual(rows[0]['endpoint'], 'https://example.invalid/intake')
        self.assertTrue(all(row['credentials_configured'] for row in rows))
        for secret in ('password', 'secret', 'private-key', 'client-id', 'connected'):
            self.assertNotIn(secret, str(rows).lower())

    def test_simulation_describes_the_actual_transport(self):
        with patch.multiple(sandata, _MODE='simulate', _SIMULATOR_URL='http://localhost:3002'), \
             patch.multiple(hhax, _MODE='simulate', _BASE_URL='http://unused.example.invalid'):
            rows = super_admin.get_connections(user('super_admin', None))
        self.assertEqual(rows[0]['endpoint'], 'http://localhost:3002')
        self.assertIsNone(rows[1]['endpoint'])  # HHAeXchange simulation makes no HTTP requests.
        self.assertTrue(all(row['mode'] == 'simulate' and row['credentials_configured'] is None for row in rows))

    def test_missing_live_credentials_are_not_marked_configured(self):
        with patch.multiple(sandata, _MODE='live', _API_KEY='', _API_URL='not-an-endpoint'), \
             patch.multiple(hhax, _MODE='live', _CLIENT_ID='client', _CLIENT_SECRET=''):
            rows = super_admin.get_connections(user('super_admin', None))
        self.assertFalse(any(row['credentials_configured'] for row in rows))
        self.assertIsNone(rows[0]['endpoint'])
