"""
Idempotent startup schema migrations.

Ported from dev_mobile/seriqcare_backend/main.py Phase 1–3 migrations.
Called once at server startup via the FastAPI lifespan.

All SQL statements use IF NOT EXISTS / IF EXISTS guards so they are safe
to re-run on every restart without side-effects.
"""
from __future__ import annotations

import logging
import os

from passlib.context import CryptContext
from sqlalchemy import text

from backend.services.timezone import SQLSERVER_EASTERN_NOW_EXPR

log = logging.getLogger("seriqcare.migrations")

_pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
_DEFAULT_PASSWORD = os.getenv("DEFAULT_USER_PASSWORD", "").strip()


def run_migrations(engine) -> None:
    """
    Run all schema migration phases.  Swallows errors gracefully if the
    database is not yet initialised (first-boot before DDL has been applied).
    """
    log.info("Running startup migrations …")
    try:
        _phase1(engine)
        _phase2(engine)
        _phase3(engine)
        _phase4(engine)
        _phase5(engine)
        _phase6(engine)
        _seed_default_passwords(engine)
        log.info("Startup migrations completed.")
    except Exception as exc:
        log.warning(
            "Startup migrations skipped — database may not be initialised yet. "
            "Run seriqcare_evv_ddl.sql first, then restart. "
            f"Detail: {exc}"
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _add_column_if_missing(engine, table: str, column: str, definition: str) -> None:
    """Idempotently add a column to a SQL Server table."""
    with engine.begin() as conn:
        conn.execute(text(f"""
            IF NOT EXISTS (
                SELECT 1 FROM sys.columns
                WHERE  object_id = OBJECT_ID('{table}')
                  AND  name      = '{column}'
            )
            ALTER TABLE {table} ADD {column} {definition}
        """))


# ---------------------------------------------------------------------------
# Phase 1 — password_hash, employee_id columns; sandata index fix
# ---------------------------------------------------------------------------

def _phase1(engine) -> None:
    _add_column_if_missing(engine, "care.users", "password_hash", "VARCHAR(200) NULL")
    _add_column_if_missing(engine, "care.users", "employee_id",   "INT NULL")
    _add_column_if_missing(engine, "care.client_care_tasks_history", "schedule_id", "INT NULL")
    _fix_sandata_unique_index(engine)
    log.info("Phase 1 migrations completed.")


def _fix_sandata_unique_index(engine) -> None:
    """
    SQL Server UNIQUE constraints treat NULL as a value.  Replace the plain
    UNIQUE constraint with a filtered index (WHERE visit_id_sandata IS NOT NULL)
    so multiple open visits can coexist without a visit_id_sandata.
    """
    with engine.begin() as conn:
        conn.execute(text("""
            IF EXISTS (
                SELECT 1 FROM sys.key_constraints
                WHERE  name      = 'UQ_visits_sandata_id'
                  AND  parent_object_id = OBJECT_ID('care.visits')
            )
            ALTER TABLE care.visits DROP CONSTRAINT UQ_visits_sandata_id
        """))
        conn.execute(text("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE  name      = 'UX_visits_sandata_id_notnull'
                  AND  object_id = OBJECT_ID('care.visits')
            )
            CREATE UNIQUE INDEX UX_visits_sandata_id_notnull
                ON care.visits (visit_id_sandata)
                WHERE visit_id_sandata IS NOT NULL
        """))


# ---------------------------------------------------------------------------
# Phase 2 — Multi-Agency SaaS schema
# ---------------------------------------------------------------------------

def _phase2(engine) -> None:
    with engine.begin() as conn:

        # care.agencies
        conn.execute(text(f"""
            IF NOT EXISTS (
                SELECT 1 FROM sys.tables t
                JOIN sys.schemas s ON t.schema_id = s.schema_id
                WHERE s.name = 'care' AND t.name = 'agencies'
            )
            CREATE TABLE care.agencies (
                id                    INT IDENTITY(1,1)  NOT NULL,
                agency_code           VARCHAR(20)        NOT NULL,
                name                  VARCHAR(200)       NOT NULL,
                state_provider_id     VARCHAR(50)        NULL,
                sandata_provider_id   VARCHAR(30)        NULL,
                tier                  VARCHAR(20)        NOT NULL DEFAULT 'standard',
                address1              VARCHAR(200)       NULL,
                city                  VARCHAR(100)       NULL,
                state                 CHAR(2)            NOT NULL DEFAULT 'PA',
                zip                   VARCHAR(10)        NULL,
                phone                 VARCHAR(20)        NULL,
                primary_contact_name  VARCHAR(200)       NULL,
                primary_contact_email VARCHAR(200)       NULL,
                is_active             BIT                NOT NULL DEFAULT 1,
                created_at            DATETIME2          NOT NULL DEFAULT {SQLSERVER_EASTERN_NOW_EXPR},
                CONSTRAINT PK_agencies      PRIMARY KEY (id),
                CONSTRAINT UQ_agencies_code UNIQUE      (agency_code),
                CONSTRAINT CK_agencies_tier
                    CHECK (tier IN ('basic','standard','enterprise'))
            )
        """))

        # care.user_sessions
        conn.execute(text(f"""
            IF NOT EXISTS (
                SELECT 1 FROM sys.tables t
                JOIN sys.schemas s ON t.schema_id = s.schema_id
                WHERE s.name = 'care' AND t.name = 'user_sessions'
            )
            BEGIN
                CREATE TABLE care.user_sessions (
                    id            INT IDENTITY(1,1)  NOT NULL,
                    user_id       INT                NOT NULL,
                    jti           VARCHAR(36)        NOT NULL,
                    issued_at     DATETIME2          NOT NULL DEFAULT {SQLSERVER_EASTERN_NOW_EXPR},
                    expires_at    DATETIME2          NOT NULL,
                    revoked_at    DATETIME2          NULL,
                    revoke_reason VARCHAR(50)        NULL,
                    CONSTRAINT PK_user_sessions     PRIMARY KEY (id),
                    CONSTRAINT UQ_user_sessions_jti UNIQUE      (jti),
                    CONSTRAINT FK_user_sessions_user
                        FOREIGN KEY (user_id) REFERENCES care.users(id)
                );
                CREATE INDEX IX_user_sessions_jti     ON care.user_sessions (jti);
                CREATE INDEX IX_user_sessions_user_id ON care.user_sessions (user_id);
            END
        """))

    # New columns on care.users
    _add_column_if_missing(engine, "care.users", "agency_id",       "INT NULL")
    _add_column_if_missing(engine, "care.users", "entra_object_id", "VARCHAR(36) NULL")
    _add_column_if_missing(engine, "care.users", "last_login_at",   "DATETIME2 NULL")

    with engine.begin() as conn:
        conn.execute(text("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE name = 'UX_users_entra_object_id'
                  AND object_id = OBJECT_ID('care.users')
            )
            CREATE UNIQUE INDEX UX_users_entra_object_id
                ON care.users (entra_object_id)
                WHERE entra_object_id IS NOT NULL
        """))

    # agency_id column on all data tables
    for tbl in (
        "care.employees",
        "care.clients",
        "care.schedules",
        "care.visits",
        "care.providers",
        "care.service_authorizations",
    ):
        _add_column_if_missing(engine, tbl, "agency_id", "INT NULL")

    # Role CHECK constraint migration (old → new role names)
    with engine.begin() as conn:
        conn.execute(text(
            "UPDATE care.users SET role = 'super_admin'  WHERE role = 'admin'"
        ))
        conn.execute(text(
            "UPDATE care.users SET role = 'agency_admin' WHERE role = 'supervisor'"
        ))
        conn.execute(text(
            "UPDATE care.users SET role = 'caregiver' "
            "WHERE role = 'coordinator' AND employee_id IS NOT NULL"
        ))
        conn.execute(text("""
            IF EXISTS (
                SELECT 1 FROM sys.check_constraints
                WHERE name = 'CK_users_role'
                  AND parent_object_id = OBJECT_ID('care.users')
            )
            ALTER TABLE care.users DROP CONSTRAINT CK_users_role
        """))
        conn.execute(text("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.check_constraints
                WHERE name = 'CK_users_role_v2'
                  AND parent_object_id = OBJECT_ID('care.users')
            )
            ALTER TABLE care.users ADD CONSTRAINT CK_users_role_v2
                CHECK (role IN ('super_admin','agency_admin','coordinator','caregiver'))
        """))

    # Seed default agency if none exists
    with engine.begin() as conn:
        count = conn.execute(text("SELECT COUNT(*) FROM care.agencies")).scalar()
        if not count:
            conn.execute(text("""
                INSERT INTO care.agencies
                    (agency_code, name, state_provider_id, sandata_provider_id,
                     tier, address1, city, state, zip, phone,
                     primary_contact_name, primary_contact_email, is_active)
                VALUES
                    ('AGY-001', 'SeriqCare Demo Agency', 'PA-ODP-DEMO-001',
                     'PROV-SQ-001', 'standard', '100 Care Lane', 'Harrisburg',
                     'PA', '17101', '(717) 555-0100',
                     'Admin User', 'admin@seriqcare.com', 1)
            """))
            log.info("Seeded default agency AGY-001.")

    # Link existing un-assigned rows to the default agency
    with engine.begin() as conn:
        agy_id = conn.execute(
            text("SELECT id FROM care.agencies WHERE agency_code = 'AGY-001'")
        ).scalar()
        if agy_id:
            for tbl in (
                "care.employees", "care.clients", "care.schedules",
                "care.visits", "care.providers", "care.service_authorizations",
            ):
                conn.execute(
                    text(f"UPDATE {tbl} SET agency_id = :a WHERE agency_id IS NULL"),
                    {"a": agy_id},
                )
            conn.execute(
                text(
                    "UPDATE care.users SET agency_id = :a "
                    "WHERE  agency_id IS NULL AND role <> 'super_admin'"
                ),
                {"a": agy_id},
            )

    log.info("Phase 2 migrations completed.")


# ---------------------------------------------------------------------------
# Phase 3 — Notifications table + performance indexes
# ---------------------------------------------------------------------------

def _phase3(engine) -> None:
    with engine.begin() as conn:

        # care.notifications
        conn.execute(text(f"""
            IF NOT EXISTS (
                SELECT 1 FROM sys.tables t
                JOIN sys.schemas s ON t.schema_id = s.schema_id
                WHERE s.name = 'care' AND t.name = 'notifications'
            )
            BEGIN
                CREATE TABLE care.notifications (
                    id           INT IDENTITY(1,1)  NOT NULL,
                    agency_id    INT                NULL,
                    user_id      INT                NULL,
                    role_target  VARCHAR(20)        NULL,
                    notif_type   VARCHAR(30)        NOT NULL,
                    title        VARCHAR(200)       NOT NULL,
                    body         VARCHAR(1000)      NULL,
                    ref_type     VARCHAR(30)        NULL,
                    ref_id       INT                NULL,
                    is_read      BIT                NOT NULL DEFAULT 0,
                    created_at   DATETIME2          NOT NULL DEFAULT {SQLSERVER_EASTERN_NOW_EXPR},
                    read_at      DATETIME2          NULL,
                    CONSTRAINT PK_notifications PRIMARY KEY (id),
                    CONSTRAINT FK_notifications_user
                        FOREIGN KEY (user_id)   REFERENCES care.users(id),
                    CONSTRAINT FK_notifications_agency
                        FOREIGN KEY (agency_id) REFERENCES care.agencies(id),
                    CONSTRAINT CK_notifications_type
                        CHECK (notif_type IN (
                            'visit_exception','visit_approval',
                            'schedule_change','system'
                        ))
                );
                CREATE INDEX IX_notifications_user_unread
                    ON care.notifications (user_id, is_read)
                    WHERE is_read = 0;
                CREATE INDEX IX_notifications_agency_role
                    ON care.notifications (agency_id, role_target, is_read);
            END
        """))

        # Performance indexes
        for idx_name, tbl, create_sql in [
            (
                "IX_visits_agency_date",
                "care.visits",
                "CREATE INDEX IX_visits_agency_date "
                "ON care.visits (agency_id, service_date DESC)",
            ),
            (
                "IX_visits_employee_date",
                "care.visits",
                "CREATE INDEX IX_visits_employee_date "
                "ON care.visits (employee_id, service_date DESC)",
            ),
            (
                "IX_visits_approval",
                "care.visits",
                "CREATE INDEX IX_visits_approval "
                "ON care.visits (approval_status, evv_status) "
                "INCLUDE (agency_id, service_date)",
            ),
            (
                "IX_schedules_employee_start",
                "care.schedules",
                "CREATE INDEX IX_schedules_employee_start "
                "ON care.schedules (employee_id, scheduled_start)",
            ),
            (
                "IX_visit_exceptions_unacked",
                "care.visit_exceptions",
                "CREATE INDEX IX_visit_exceptions_unacked "
                "ON care.visit_exceptions (acknowledged, requires_ack) "
                "WHERE acknowledged = 0",
            ),
        ]:
            conn.execute(text(f"""
                IF NOT EXISTS (
                    SELECT 1 FROM sys.indexes
                    WHERE  name      = '{idx_name}'
                      AND  object_id = OBJECT_ID('{tbl}')
                )
                {create_sql}
            """))

        conn.execute(text("""
            IF COL_LENGTH('care.client_care_tasks_history', 'schedule_id') IS NOT NULL
               AND NOT EXISTS (
                    SELECT 1 FROM sys.indexes
                    WHERE  name      = 'IX_task_history_schedule_day'
                      AND  object_id = OBJECT_ID('care.client_care_tasks_history')
               )
            CREATE INDEX IX_task_history_schedule_day
                ON care.client_care_tasks_history (
                    client_care_task_id,
                    schedule_id,
                    completed_on
                )
                INCLUDE (completed_at)
        """))

    log.info("Phase 3 migrations completed.")


# ---------------------------------------------------------------------------
# Phase 4 — Device sessions + auth audit log
# ---------------------------------------------------------------------------

def _phase4(engine) -> None:
    with engine.begin() as conn:

        # care.device_sessions
        conn.execute(text(f"""
            IF NOT EXISTS (
                SELECT 1 FROM sys.tables t
                JOIN sys.schemas s ON t.schema_id = s.schema_id
                WHERE s.name = 'care' AND t.name = 'device_sessions'
            )
            BEGIN
                CREATE TABLE care.device_sessions (
                    id            INT IDENTITY(1,1) NOT NULL,
                    user_id       INT               NOT NULL,
                    device_id     VARCHAR(100)      NOT NULL,
                    device_name   VARCHAR(200)      NULL,
                    client_type   VARCHAR(10)       NOT NULL,
                    token_hash    VARCHAR(64)       NOT NULL,
                    previous_hash VARCHAR(64)       NULL,
                    issued_at     DATETIME2         NOT NULL DEFAULT {SQLSERVER_EASTERN_NOW_EXPR},
                    expires_at    DATETIME2         NOT NULL,
                    last_used_at  DATETIME2         NULL,
                    revoked_at    DATETIME2         NULL,
                    revoke_reason VARCHAR(50)       NULL,
                    CONSTRAINT PK_device_sessions      PRIMARY KEY (id),
                    CONSTRAINT UQ_device_sessions_hash UNIQUE (token_hash),
                    CONSTRAINT FK_device_sessions_user
                        FOREIGN KEY (user_id) REFERENCES care.users(id)
                );
                CREATE INDEX IX_device_sessions_user_device
                    ON care.device_sessions (user_id, device_id);
                CREATE INDEX IX_device_sessions_prev_hash
                    ON care.device_sessions (previous_hash)
                    WHERE previous_hash IS NOT NULL;
            END
        """))

        # care.auth_log
        conn.execute(text(f"""
            IF NOT EXISTS (
                SELECT 1 FROM sys.tables t
                JOIN sys.schemas s ON t.schema_id = s.schema_id
                WHERE s.name = 'care' AND t.name = 'auth_log'
            )
            BEGIN
                CREATE TABLE care.auth_log (
                    id          INT IDENTITY(1,1) NOT NULL,
                    user_id     INT               NULL,
                    username    VARCHAR(100)      NULL,
                    event       VARCHAR(30)       NOT NULL,
                    client_type VARCHAR(10)       NULL,
                    device_id   VARCHAR(100)      NULL,
                    ip_address  VARCHAR(45)       NULL,
                    user_agent  VARCHAR(500)      NULL,
                    detail      VARCHAR(500)      NULL,
                    created_at  DATETIME2         NOT NULL DEFAULT {SQLSERVER_EASTERN_NOW_EXPR},
                    CONSTRAINT PK_auth_log PRIMARY KEY (id)
                );
                CREATE INDEX IX_auth_log_user_event
                    ON care.auth_log (user_id, event, created_at DESC);
            END
        """))

    log.info("Phase 4 migrations completed.")


# ---------------------------------------------------------------------------
# Phase 5 — Password reset tokens table
# ---------------------------------------------------------------------------

def _phase5(engine) -> None:
    with engine.begin() as conn:
        conn.execute(text(f"""
            IF NOT EXISTS (
                SELECT 1 FROM sys.tables t
                JOIN sys.schemas s ON t.schema_id = s.schema_id
                WHERE s.name = 'care' AND t.name = 'password_reset_tokens'
            )
            BEGIN
                CREATE TABLE care.password_reset_tokens (
                    id          INT IDENTITY(1,1) NOT NULL,
                    user_id     INT               NOT NULL,
                    token_hash  VARCHAR(64)       NOT NULL,
                    expires_at  DATETIME2         NOT NULL,
                    used_at     DATETIME2         NULL,
                    created_at  DATETIME2         NOT NULL DEFAULT {SQLSERVER_EASTERN_NOW_EXPR},
                    CONSTRAINT PK_password_reset_tokens      PRIMARY KEY (id),
                    CONSTRAINT UQ_password_reset_tokens_hash UNIQUE (token_hash),
                    CONSTRAINT FK_password_reset_tokens_user
                        FOREIGN KEY (user_id) REFERENCES care.users(id)
                );
                CREATE INDEX IX_password_reset_tokens_hash
                    ON care.password_reset_tokens (token_hash)
                    WHERE used_at IS NULL;
            END
        """))
    log.info("Phase 5 migrations completed.")


# ---------------------------------------------------------------------------
# Phase 6 — Extended client profile columns
# ---------------------------------------------------------------------------

def _phase6(engine) -> None:
    # Extended demographic / contact columns on care.clients
    for col, defn in [
        ("primary_language",               "VARCHAR(50)  NULL"),
        ("secondary_language",             "VARCHAR(50)  NULL"),
        ("race_ethnicity",                 "VARCHAR(50)  NULL"),
        ("marital_status",                 "VARCHAR(30)  NULL"),
        ("communication_needs",            "VARCHAR(200) NULL"),
        ("emergency_contact_name",         "VARCHAR(200) NULL"),
        ("emergency_contact_phone",        "VARCHAR(20)  NULL"),
        ("emergency_contact_relationship", "VARCHAR(50)  NULL"),
        ("legal_guardian",                 "VARCHAR(200) NULL"),
        ("guardian_phone",                 "VARCHAR(20)  NULL"),
        ("power_of_attorney",              "VARCHAR(200) NULL"),
        ("representative_payee",           "VARCHAR(200) NULL"),
        ("care_coordinator",               "VARCHAR(200) NULL"),
        ("physician",                      "VARCHAR(200) NULL"),
        ("level_of_care",                  "VARCHAR(50)  NULL"),
    ]:
        _add_column_if_missing(engine, "care.clients", col, defn)

    # county column on care.client_addresses
    _add_column_if_missing(engine, "care.client_addresses", "county", "VARCHAR(50) NULL")

    log.info("Phase 6 migrations completed.")


# ---------------------------------------------------------------------------
# Seed default passwords for SQL-auth users that have NULL password_hash
# ---------------------------------------------------------------------------

def _seed_default_passwords(engine) -> None:
    if not _DEFAULT_PASSWORD:
        log.info("Skipping default password seed: DEFAULT_USER_PASSWORD not set.")
        return
    default_hash = _pwd_ctx.hash(_DEFAULT_PASSWORD)
    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE care.users "
                "SET    password_hash = :h "
                "WHERE  password_hash IS NULL "
                "  AND  role <> 'super_admin'"
            ),
            {"h": default_hash},
        )
