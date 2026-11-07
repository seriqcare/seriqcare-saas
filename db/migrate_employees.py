"""
Migration: Add Designation, role, status columns to care.employees.
Run once:  python db/migrate_employees.py
"""
from __future__ import annotations
from db.database import engine
from sqlalchemy import text

MIGRATIONS = [
    # role — e.g. 'Direct Support Professional'
    """
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA='care' AND TABLE_NAME='employees' AND COLUMN_NAME='role'
    )
    ALTER TABLE care.employees ADD role NVARCHAR(100) NULL
    """,
    # status — 'Active', 'On Leave', 'Inactive'
    """
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA='care' AND TABLE_NAME='employees' AND COLUMN_NAME='status'
    )
    ALTER TABLE care.employees ADD status NVARCHAR(50) NULL
    """,
    # Designation — 'Care Giver', 'Admin', etc.
    """
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA='care' AND TABLE_NAME='employees' AND COLUMN_NAME='Designation'
    )
    ALTER TABLE care.employees ADD Designation NVARCHAR(100) NULL
    """,
]

if __name__ == "__main__":
    with engine.begin() as conn:
        for sql in MIGRATIONS:
            conn.execute(text(sql.strip()))
            print("OK:", sql.strip().splitlines()[0])
    print("\nDone. All migrations applied.")
    print("\nTo mark existing employees as Care Givers, run:")
    print("  UPDATE care.employees SET Designation = 'Care Giver' WHERE Designation IS NULL")
