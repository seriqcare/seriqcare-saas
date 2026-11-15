import os
import unittest
from types import SimpleNamespace

os.environ.setdefault("SECRET_KEY", "test-only-caregiver-code-secret")

from fastapi import HTTPException
from sqlalchemy import UniqueConstraint, create_engine, text
from sqlalchemy.exc import IntegrityError

from backend.routers.caregivers import create_caregiver
from backend.schemas import CaregiverCreateRequest
from db.models import Employee


class Result:
    def __init__(self, row=None):
        self.row = row

    def fetchone(self):
        return self.row


class EmployeeDB:
    def __init__(self, race=False):
        self.rows = {(1, "EMP3"): 101}
        self.race = race
        self.queries = []
        self.rollbacks = 0

    def execute(self, query, params=None):
        sql, params = str(query), params or {}
        self.queries.append((sql, params))
        if "SELECT id FROM care.employees" in sql:
            assert "agency_id = :agency_id" in sql
            employee_id = self.rows.get((params["agency_id"], params["code"]))
            return Result(SimpleNamespace(id=employee_id) if employee_id else None)
        if "INFORMATION_SCHEMA.COLUMNS" in sql:
            return Result(SimpleNamespace(found=1))
        if "INSERT INTO care.employees" in sql:
            if self.race:
                raise IntegrityError(sql, params, Exception("2627 UQ_employees_agency_code duplicate key"))
            key = (params["agency_id"], params["employee_code"])
            assert key not in self.rows
            self.rows[key] = 102
            return Result(SimpleNamespace(id=102))
        raise AssertionError(f"Unexpected SQL: {sql}")

    def commit(self):
        pass

    def rollback(self):
        self.rollbacks += 1


class EmployeeCodeTests(unittest.TestCase):
    def body(self, code="EMP3"):
        return CaregiverCreateRequest(employee_code=code, first_name="Sarah", last_name="Mills")

    def scope(self, agency_id):
        return SimpleNamespace(agency_id=agency_id, agency_tier="core")

    def test_same_code_can_be_created_for_another_agency(self):
        db = EmployeeDB()
        response = create_caregiver(self.body(), db, self.scope(2))
        self.assertTrue(response.success)
        self.assertIn((1, "EMP3"), db.rows)
        self.assertIn((2, "EMP3"), db.rows)

    def test_duplicate_in_same_agency_is_rejected_after_trimming(self):
        db = EmployeeDB()
        with self.assertRaises(HTTPException) as error:
            create_caregiver(self.body(" EMP3 "), db, self.scope(1))
        self.assertEqual(error.exception.status_code, 409)
        self.assertFalse(any("INSERT" in sql for sql, _ in db.queries))

    def test_concurrent_duplicate_returns_conflict_and_rolls_back(self):
        db = EmployeeDB(race=True)
        with self.assertRaises(HTTPException) as error:
            create_caregiver(self.body(), db, self.scope(2))
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(db.rollbacks, 1)

    def test_agency_required_even_for_global_scope(self):
        db = EmployeeDB()
        with self.assertRaises(HTTPException) as error:
            create_caregiver(self.body(), db, self.scope(None))
        self.assertEqual(error.exception.status_code, 403)
        self.assertEqual(db.queries, [])

    def test_model_constraint_allows_cross_agency_code_and_blocks_local_duplicates(self):
        constraints = [constraint for constraint in Employee.__table__.constraints
                       if isinstance(constraint, UniqueConstraint)]
        self.assertEqual([list(constraint.columns.keys()) for constraint in constraints],
                         [["agency_id", "employee_code"]])
        engine = create_engine("sqlite://")
        try:
            with engine.begin() as connection:
                connection.execute(text("ATTACH DATABASE ':memory:' AS care"))
                Employee.__table__.create(connection)
                for agency_id in (1, 2):
                    connection.execute(Employee.__table__.insert().values(
                        agency_id=agency_id, employee_code="EMP3", first_name="Test", last_name="Person"))
                with self.assertRaises(IntegrityError):
                    connection.execute(Employee.__table__.insert().values(
                        agency_id=1, employee_code="EMP3", first_name="Another", last_name="Person"))
        finally:
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
