from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.services.timezone import SQLSERVER_EASTERN_NOW_EXPR


def ensure_payroll_tables(db: Session) -> None:
    db.execute(
        text(
            f"""
            IF OBJECT_ID('care.pay_groups', 'U') IS NULL
            BEGIN
                CREATE TABLE care.pay_groups (
                    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                    name VARCHAR(120) NOT NULL,
                    description VARCHAR(500) NULL,
                    created_at DATETIME2 NOT NULL DEFAULT {SQLSERVER_EASTERN_NOW_EXPR},
                    updated_at DATETIME2 NOT NULL DEFAULT {SQLSERVER_EASTERN_NOW_EXPR}
                );
                CREATE UNIQUE INDEX UX_pay_groups_name ON care.pay_groups(name);
            END

            IF OBJECT_ID('care.pay_group_rates', 'U') IS NULL
            BEGIN
                CREATE TABLE care.pay_group_rates (
                    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                    pay_group_id INT NOT NULL,
                    name VARCHAR(120) NOT NULL,
                    pay_type VARCHAR(20) NOT NULL DEFAULT 'Hourly',
                    rate DECIMAL(8,2) NOT NULL DEFAULT 0,
                    applies_on VARCHAR(120) NULL,
                    start_time VARCHAR(20) NULL,
                    end_time VARCHAR(20) NULL,
                    effective_date DATE NULL,
                    sort_order INT NOT NULL DEFAULT 0,
                    is_base_rate BIT NOT NULL DEFAULT 0,
                    created_at DATETIME2 NOT NULL DEFAULT {SQLSERVER_EASTERN_NOW_EXPR},
                    updated_at DATETIME2 NOT NULL DEFAULT {SQLSERVER_EASTERN_NOW_EXPR},
                    CONSTRAINT FK_pay_group_rates_group FOREIGN KEY (pay_group_id) REFERENCES care.pay_groups(id)
                );
                CREATE INDEX IX_pay_group_rates_group ON care.pay_group_rates(pay_group_id, sort_order, id);
            END

            IF OBJECT_ID('care.employee_payroll_settings', 'U') IS NULL
            BEGIN
                CREATE TABLE care.employee_payroll_settings (
                    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                    employee_id INT NOT NULL,
                    pay_group_id INT NULL,
                    pay_group_rate_id INT NULL,
                    created_at DATETIME2 NOT NULL DEFAULT {SQLSERVER_EASTERN_NOW_EXPR},
                    updated_at DATETIME2 NOT NULL DEFAULT {SQLSERVER_EASTERN_NOW_EXPR},
                    CONSTRAINT FK_employee_payroll_employee FOREIGN KEY (employee_id) REFERENCES care.employees(id),
                    CONSTRAINT FK_employee_payroll_group FOREIGN KEY (pay_group_id) REFERENCES care.pay_groups(id),
                    CONSTRAINT FK_employee_payroll_rate FOREIGN KEY (pay_group_rate_id) REFERENCES care.pay_group_rates(id)
                );
                CREATE UNIQUE INDEX UX_employee_payroll_employee ON care.employee_payroll_settings(employee_id);
            END
            """
        )
    )


def ensure_default_pay_group(db: Session) -> None:
    ensure_payroll_tables(db)

    existing = db.execute(text("SELECT COUNT(*) AS total FROM care.pay_groups")).fetchone()
    if existing and int(existing.total or 0) > 0:
        return

    group_row = db.execute(
        text(
            """
            INSERT INTO care.pay_groups (name, description)
            OUTPUT INSERTED.id
            VALUES ('Default Casual', 'Default caregiver pay group')
            """
        )
    ).fetchone()
    group_id = int(group_row.id)

    db.execute(
        text(
            f"""
            INSERT INTO care.pay_group_rates
                (pay_group_id, name, pay_type, rate, applies_on, start_time, end_time, effective_date, sort_order, is_base_rate)
            VALUES
                (:pay_group_id, 'Base rate', 'Hourly', 25.00, NULL, NULL, NULL, CAST({SQLSERVER_EASTERN_NOW_EXPR} AS DATE), 0, 1)
            """
        ),
        {"pay_group_id": group_id},
    )


def sync_timesheet_payroll_for_employee(employee_id: int, db: Session) -> None:
    ensure_payroll_tables(db)
    db.execute(
        text(
            f"""
            UPDATE t
            SET t.pay_rate = ISNULL(pgr.rate, 0),
                t.gross_pay = CASE
                    WHEN ISNULL(pgr.pay_type, 'Hourly') = 'Per Visit' THEN ISNULL(pgr.rate, 0)
                    ELSE ISNULL(pgr.rate, 0) * ISNULL(t.total_hours, 0)
                END,
                t.updated_at = {SQLSERVER_EASTERN_NOW_EXPR}
            FROM care.timesheet t
            LEFT JOIN care.employee_payroll_settings eps ON eps.employee_id = t.employee_id
            LEFT JOIN care.pay_group_rates pgr ON pgr.id = eps.pay_group_rate_id
            WHERE t.employee_id = :employee_id
            """
        ),
        {"employee_id": employee_id},
    )