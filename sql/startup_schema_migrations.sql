/*
  SeriqCare startup schema migrations (manual SQL version)

  Purpose:
  - Replaces backend/services/migrations.py runtime startup migrations.
  - Safe to re-run: all statements use IF EXISTS / IF NOT EXISTS guards.

  Usage:
  1) Ensure base schema has already been applied (for example: seriqcare_evv_ddl.sql).
  2) Run this script once (or re-run safely when needed) in SQL Server.
*/

/* -------------------------------------------------------------------------
   Phase 1 - password_hash, employee_id columns; sandata index fix
   ------------------------------------------------------------------------- */

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('care.users')
      AND name = 'password_hash'
)
    ALTER TABLE care.users ADD password_hash VARCHAR(200) NULL;

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('care.users')
      AND name = 'employee_id'
)
    ALTER TABLE care.users ADD employee_id INT NULL;

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('care.client_care_tasks_history')
      AND name = 'schedule_id'
)
    ALTER TABLE care.client_care_tasks_history ADD schedule_id INT NULL;

IF EXISTS (
    SELECT 1 FROM sys.key_constraints
    WHERE name = 'UQ_visits_sandata_id'
      AND parent_object_id = OBJECT_ID('care.visits')
)
    ALTER TABLE care.visits DROP CONSTRAINT UQ_visits_sandata_id;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'UX_visits_sandata_id_notnull'
      AND object_id = OBJECT_ID('care.visits')
)
    CREATE UNIQUE INDEX UX_visits_sandata_id_notnull
        ON care.visits (visit_id_sandata)
        WHERE visit_id_sandata IS NOT NULL;

/* -------------------------------------------------------------------------
   Phase 2 - Multi-Agency SaaS schema
   ------------------------------------------------------------------------- */

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
        created_at            DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        CONSTRAINT PK_agencies      PRIMARY KEY (id),
        CONSTRAINT UQ_agencies_code UNIQUE      (agency_code),
        CONSTRAINT CK_agencies_tier
            CHECK (tier IN ('basic','standard','enterprise'))
    );

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
        issued_at     DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
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
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('care.users')
      AND name = 'agency_id'
)
    ALTER TABLE care.users ADD agency_id INT NULL;

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('care.users')
      AND name = 'entra_object_id'
)
    ALTER TABLE care.users ADD entra_object_id VARCHAR(36) NULL;

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('care.users')
      AND name = 'last_login_at'
)
    ALTER TABLE care.users ADD last_login_at DATETIME2 NULL;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'UX_users_entra_object_id'
      AND object_id = OBJECT_ID('care.users')
)
    CREATE UNIQUE INDEX UX_users_entra_object_id
        ON care.users (entra_object_id)
        WHERE entra_object_id IS NOT NULL;

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('care.employees')
      AND name = 'agency_id'
)
    ALTER TABLE care.employees ADD agency_id INT NULL;

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('care.clients')
      AND name = 'agency_id'
)
    ALTER TABLE care.clients ADD agency_id INT NULL;

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('care.schedules')
      AND name = 'agency_id'
)
    ALTER TABLE care.schedules ADD agency_id INT NULL;

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('care.visits')
      AND name = 'agency_id'
)
    ALTER TABLE care.visits ADD agency_id INT NULL;

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('care.providers')
      AND name = 'agency_id'
)
    ALTER TABLE care.providers ADD agency_id INT NULL;

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('care.service_authorizations')
      AND name = 'agency_id'
)
    ALTER TABLE care.service_authorizations ADD agency_id INT NULL;

UPDATE care.users SET role = 'super_admin'  WHERE role = 'admin';
UPDATE care.users SET role = 'agency_admin' WHERE role = 'supervisor';
UPDATE care.users SET role = 'caregiver' WHERE role = 'coordinator' AND employee_id IS NOT NULL;

IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = 'CK_users_role'
      AND parent_object_id = OBJECT_ID('care.users')
)
    ALTER TABLE care.users DROP CONSTRAINT CK_users_role;

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = 'CK_users_role_v2'
      AND parent_object_id = OBJECT_ID('care.users')
)
    ALTER TABLE care.users ADD CONSTRAINT CK_users_role_v2
        CHECK (role IN ('super_admin','agency_admin','coordinator','caregiver'));

IF NOT EXISTS (
    SELECT 1
    FROM care.agencies
    WHERE agency_code = 'AGY-001'
)
    INSERT INTO care.agencies
        (agency_code, name, state_provider_id, sandata_provider_id,
         tier, address1, city, state, zip, phone,
         primary_contact_name, primary_contact_email, is_active)
    VALUES
        ('AGY-001', 'SeriqCare Demo Agency', 'PA-ODP-DEMO-001',
         'PROV-SQ-001', 'standard', '100 Care Lane', 'Harrisburg',
         'PA', '17101', '(717) 555-0100',
         'Admin User', 'admin@seriqcare.com', 1);

DECLARE @agency_id INT;
SELECT @agency_id = id FROM care.agencies WHERE agency_code = 'AGY-001';

IF @agency_id IS NOT NULL
BEGIN
    UPDATE care.employees SET agency_id = @agency_id WHERE agency_id IS NULL;
    UPDATE care.clients SET agency_id = @agency_id WHERE agency_id IS NULL;
    UPDATE care.schedules SET agency_id = @agency_id WHERE agency_id IS NULL;
    UPDATE care.visits SET agency_id = @agency_id WHERE agency_id IS NULL;
    UPDATE care.providers SET agency_id = @agency_id WHERE agency_id IS NULL;
    UPDATE care.service_authorizations SET agency_id = @agency_id WHERE agency_id IS NULL;
    UPDATE care.users SET agency_id = @agency_id WHERE agency_id IS NULL AND role <> 'super_admin';
END;

/* -------------------------------------------------------------------------
   Phase 3 - Notifications table + performance indexes
   ------------------------------------------------------------------------- */

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
        created_at   DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
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
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_visits_agency_date'
      AND object_id = OBJECT_ID('care.visits')
)
    CREATE INDEX IX_visits_agency_date
        ON care.visits (agency_id, service_date DESC);

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_visits_employee_date'
      AND object_id = OBJECT_ID('care.visits')
)
    CREATE INDEX IX_visits_employee_date
        ON care.visits (employee_id, service_date DESC);

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_visits_approval'
      AND object_id = OBJECT_ID('care.visits')
)
    CREATE INDEX IX_visits_approval
        ON care.visits (approval_status, evv_status)
        INCLUDE (agency_id, service_date);

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_schedules_employee_start'
      AND object_id = OBJECT_ID('care.schedules')
)
    CREATE INDEX IX_schedules_employee_start
        ON care.schedules (employee_id, scheduled_start);

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_visit_exceptions_unacked'
      AND object_id = OBJECT_ID('care.visit_exceptions')
)
    CREATE INDEX IX_visit_exceptions_unacked
        ON care.visit_exceptions (acknowledged, requires_ack)
        WHERE acknowledged = 0;

IF COL_LENGTH('care.client_care_tasks_history', 'schedule_id') IS NOT NULL
   AND NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_task_history_schedule_day'
          AND object_id = OBJECT_ID('care.client_care_tasks_history')
   )
    CREATE INDEX IX_task_history_schedule_day
        ON care.client_care_tasks_history (
            client_care_task_id,
            schedule_id,
            completed_on
        )
        INCLUDE (completed_at);

/* -------------------------------------------------------------------------
   Phase 4 - Device sessions + auth audit log
   ------------------------------------------------------------------------- */

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
        issued_at     DATETIME2         NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
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
END;

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
        created_at  DATETIME2         NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        CONSTRAINT PK_auth_log PRIMARY KEY (id)
    );

    CREATE INDEX IX_auth_log_user_event
        ON care.auth_log (user_id, event, created_at DESC);
END;

/* -------------------------------------------------------------------------
   Phase 5 - Password reset tokens table
   ------------------------------------------------------------------------- */

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
        created_at  DATETIME2         NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        CONSTRAINT PK_password_reset_tokens      PRIMARY KEY (id),
        CONSTRAINT UQ_password_reset_tokens_hash UNIQUE (token_hash),
        CONSTRAINT FK_password_reset_tokens_user
            FOREIGN KEY (user_id) REFERENCES care.users(id)
    );

    CREATE INDEX IX_password_reset_tokens_hash
        ON care.password_reset_tokens (token_hash)
        WHERE used_at IS NULL;
END;

/* -------------------------------------------------------------------------
   Seed default passwords for SQL-auth users that have NULL password_hash
   default plaintext was: 1234
   ------------------------------------------------------------------------- */

UPDATE care.users
SET password_hash = '$2b$12$cL8OUIUs8HDmNWGShfT15.9FZ0UPJYeO.n9OU.tLn2CLnbHtd482G'
WHERE password_hash IS NULL
  AND role <> 'super_admin';

/* -------------------------------------------------------------------------
   Phase 6 - Fix DEFAULT constraints: GETDATE() → Eastern local time
             care.visit_evv, care.visit_billing, care.visit_integration_status
             and care.timesheet were created with GETDATE() instead of
             CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2).
             Also upgrades care.timesheet.created_at from DATETIME to DATETIME2.
             All guards check the definition text so re-running is a no-op.
   ------------------------------------------------------------------------- */

-- care.visit_evv  created_at
IF EXISTS (
    SELECT 1 FROM sys.default_constraints
    WHERE name = 'DF_visit_evv_ca'
      AND parent_object_id = OBJECT_ID('care.visit_evv')
      AND definition = '(getdate())'
)
BEGIN
    ALTER TABLE care.visit_evv DROP CONSTRAINT DF_visit_evv_ca;
    ALTER TABLE care.visit_evv ADD CONSTRAINT DF_visit_evv_ca
        DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2)
        FOR created_at;
END;

-- care.visit_evv  updated_at
IF EXISTS (
    SELECT 1 FROM sys.default_constraints
    WHERE name = 'DF_visit_evv_ua'
      AND parent_object_id = OBJECT_ID('care.visit_evv')
      AND definition = '(getdate())'
)
BEGIN
    ALTER TABLE care.visit_evv DROP CONSTRAINT DF_visit_evv_ua;
    ALTER TABLE care.visit_evv ADD CONSTRAINT DF_visit_evv_ua
        DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2)
        FOR updated_at;
END;

-- care.visit_billing  created_at
IF EXISTS (
    SELECT 1 FROM sys.default_constraints
    WHERE name = 'DF_visit_billing_ca'
      AND parent_object_id = OBJECT_ID('care.visit_billing')
      AND definition = '(getdate())'
)
BEGIN
    ALTER TABLE care.visit_billing DROP CONSTRAINT DF_visit_billing_ca;
    ALTER TABLE care.visit_billing ADD CONSTRAINT DF_visit_billing_ca
        DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2)
        FOR created_at;
END;

-- care.visit_billing  updated_at
IF EXISTS (
    SELECT 1 FROM sys.default_constraints
    WHERE name = 'DF_visit_billing_ua'
      AND parent_object_id = OBJECT_ID('care.visit_billing')
      AND definition = '(getdate())'
)
BEGIN
    ALTER TABLE care.visit_billing DROP CONSTRAINT DF_visit_billing_ua;
    ALTER TABLE care.visit_billing ADD CONSTRAINT DF_visit_billing_ua
        DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2)
        FOR updated_at;
END;

-- care.visit_integration_status  created_at
IF EXISTS (
    SELECT 1 FROM sys.default_constraints
    WHERE name = 'DF_vis_ca'
      AND parent_object_id = OBJECT_ID('care.visit_integration_status')
      AND definition = '(getdate())'
)
BEGIN
    ALTER TABLE care.visit_integration_status DROP CONSTRAINT DF_vis_ca;
    ALTER TABLE care.visit_integration_status ADD CONSTRAINT DF_vis_ca
        DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2)
        FOR created_at;
END;

-- care.visit_integration_status  updated_at
IF EXISTS (
    SELECT 1 FROM sys.default_constraints
    WHERE name = 'DF_vis_ua'
      AND parent_object_id = OBJECT_ID('care.visit_integration_status')
      AND definition = '(getdate())'
)
BEGIN
    ALTER TABLE care.visit_integration_status DROP CONSTRAINT DF_vis_ua;
    ALTER TABLE care.visit_integration_status ADD CONSTRAINT DF_vis_ua
        DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2)
        FOR updated_at;
END;

-- care.timesheet  created_at
-- Constraint name is auto-generated, so look it up via sys tables.
-- Also upgrade column type from DATETIME → DATETIME2 while the constraint is absent.
DECLARE @ts_df_name SYSNAME;
SELECT @ts_df_name = dc.name
FROM sys.default_constraints dc
JOIN sys.columns c
    ON  dc.parent_object_id = c.object_id
    AND dc.parent_column_id = c.column_id
WHERE dc.parent_object_id = OBJECT_ID('care.timesheet')
  AND c.name              = 'created_at'
  AND dc.definition       = '(getdate())';

IF @ts_df_name IS NOT NULL
    EXEC('ALTER TABLE care.timesheet DROP CONSTRAINT ' + @ts_df_name);

-- Widen column from DATETIME to DATETIME2 (no data loss; only precision gain)
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id      = OBJECT_ID('care.timesheet')
      AND name           = 'created_at'
      AND system_type_id = TYPE_ID('datetime')
)
    ALTER TABLE care.timesheet ALTER COLUMN created_at DATETIME2 NOT NULL;

-- Re-add constraint with correct Eastern-time default (skip if already correct)
IF NOT EXISTS (
    SELECT 1
    FROM  sys.default_constraints dc
    JOIN  sys.columns c
        ON  dc.parent_object_id = c.object_id
        AND dc.parent_column_id = c.column_id
    WHERE dc.parent_object_id = OBJECT_ID('care.timesheet')
      AND c.name              = 'created_at'
)
    ALTER TABLE care.timesheet ADD CONSTRAINT DF_timesheet_created_at
        DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2)
        FOR created_at;

