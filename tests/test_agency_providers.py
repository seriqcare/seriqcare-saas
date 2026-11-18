import unittest
from types import SimpleNamespace

from fastapi import HTTPException
from backend.services.agency_providers import provision_agency_provider, agency_sandata_provider


class DB:
    def __init__(self, provider=None, configured_id='9012456278'):
        self.provider = provider
        self.queries = []
        self.agency = SimpleNamespace(id=4, name='Udo Care', sandata_provider_id=configured_id,
            address1=None, city=None, state='PA', zip=None, phone=None)

    def execute(self, query, params):
        sql = str(query)
        self.queries.append((sql, params))
        result = self.agency if 'FROM care.agencies WHERE' in sql else self.provider
        if 'INSERT INTO care.providers' in sql:
            result = SimpleNamespace(id=2)
        return SimpleNamespace(fetchone=lambda: result)


class AgencyProviderTests(unittest.TestCase):
    def test_provisioning_creates_own_provider_from_saved_agency(self):
        db = DB()
        self.assertEqual(provision_agency_provider(db, 4), 2)
        sql, values = db.queries[-1]
        self.assertIn('INSERT INTO care.providers', sql)
        self.assertEqual(values['agency_id'], 4)
        self.assertEqual(values['name'], 'Udo Care')
        self.assertEqual(values['provider_id'], '9012456278')

    def test_existing_provider_is_reused_without_duplicate_insert(self):
        db = DB(SimpleNamespace(id=2, agency_id=4, is_active=True))
        self.assertEqual(provision_agency_provider(db, 4), 2)
        self.assertFalse(any('INSERT' in sql for sql, _ in db.queries))

    def test_foreign_agency_provider_is_never_adopted(self):
        db = DB(SimpleNamespace(id=2, agency_id=99, is_active=True))
        with self.assertRaises(HTTPException) as caught:
            provision_agency_provider(db, 4)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertFalse(any('INSERT' in sql or 'UPDATE' in sql for sql, _ in db.queries))

    def test_inactive_own_provider_is_reactivated_with_scoped_update(self):
        db = DB(SimpleNamespace(id=2, agency_id=4, is_active=False))
        self.assertEqual(provision_agency_provider(db, 4), 2)
        self.assertIn('id=:id AND agency_id=:agency_id', db.queries[-1][0])
        self.assertEqual(db.queries[-1][1], {'id': 2, 'agency_id': 4})

    def test_no_external_identifier_is_invented(self):
        db = DB(configured_id=None)
        self.assertIsNone(provision_agency_provider(db, 4))
        self.assertFalse(any('INSERT' in sql for sql, _ in db.queries))

    def test_registration_provider_lookup_is_scoped_and_matches_saved_id(self):
        db = DB()
        agency_sandata_provider(db, 4)
        sql, values = db.queries[-1]
        self.assertIn('p.agency_id=:agency_id', sql)
        self.assertIn('a.sandata_provider_id=p.provider_id_sandata', sql)
        self.assertEqual(values['agency_id'], 4)


if __name__ == '__main__':
    unittest.main()
