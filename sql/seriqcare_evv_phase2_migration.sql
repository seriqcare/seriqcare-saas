-- =============================================================================
-- SeriqCare EVV - Phase 2 Migration: Multi-Agency SaaS Schema
-- =============================================================================
-- Run this ONCE on an existing SeriqCareDB database.
-- Safe to re-run - all blocks are guarded with IF NOT EXISTS / TRY-CATCH.
--
-- What this script does:
--   1. Creates care.agencies            (SaaS tenant master)
--   2. Creates care.user_sessions       (backend JWT revocation tracking)
--   3. Adds agency_id to care.users
--   4. Adds entra_object_id to care.users
--   5. Migrates role values and updates role CHECK constraint
--   6. Adds agency_id to care.employees, care.clients, care.schedules,
--      care.visits, care.providers, care.service_authorizations
--   7. Seeds the default demo agency
--   8. Links all existing rows to the demo agency (agency_id = 1)
--
-- Run order: must be run AFTER seriqcare_evv_ddl.sql
-- Target DB : SeriqCareDB, schema = care
-- =============================================================================

USE SeriqCareDB;
GO

-- =============================================================================
-- STEP 1 - Create care.agencies
-- SaaS tenant master table. One row per home care agency using the platform.
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'agencies'
)
BEGIN
    CREATE TABLE care.agencies (
        id                   INT IDENTITY(1,1)  NOT NULL,
        -- Internal short code e.g. AGY-001
        agency_code          VARCHAR(20)        NOT NULL,
        name                 VARCHAR(200)       NOT NULL,
        -- PA Medicaid provider number (links to care.providers)
        state_provider_id    VARCHAR(50)        NULL,
        -- Sandata provider ID (links to care.providers.provider_id_sandata)
        sandata_provider_id  VARCHAR(30)        NULL,
        -- Platform subscription tier
        tier                 VARCHAR(20)        NOT NULL DEFAULT 'standard',
        address1             VARCHAR(200)       NULL,
        city                 VARCHAR(100)       NULL,
        state                CHAR(2)            NOT NULL DEFAULT 'PA',
        zip                  VARCHAR(10)        NULL,
        phone                VARCHAR(20)        NULL,
        primary_contact_name VARCHAR(200)       NULL,
        primary_contact_email VARCHAR(200)      NULL,
        is_active            BIT                NOT NULL DEFAULT 1,
        created_at           DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        CONSTRAINT PK_agencies           PRIMARY KEY (id),
        CONSTRAINT UQ_agencies_code      UNIQUE      (agency_code),
        CONSTRAINT CK_agencies_tier
            CHECK (tier IN ('basic','standard','enterprise'))
    );
    PRINT 'STEP 1: Table care.agencies created.';
END
ELSE
    PRINT 'STEP 1: care.agencies already exists - skipped.';
GO

-- =============================================================================
-- STEP 2 - Create care.user_sessions
-- Tracks issued backend JWTs for revocation support (logout / deactivation).
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'user_sessions'
)
BEGIN
    CREATE TABLE care.user_sessions (
        id          INT IDENTITY(1,1)  NOT NULL,
        user_id     INT                NOT NULL,
        -- JWT ID claim - unique per issued token
        jti         VARCHAR(36)        NOT NULL,
        issued_at   DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        expires_at  DATETIME2          NOT NULL,
        -- NULL = active session; populated on logout or force-revoke
        revoked_at  DATETIME2          NULL,
        -- 'logout' | 'admin_revoke' | 'password_change' | 'entra_link'
        revoke_reason VARCHAR(50)      NULL,
        CONSTRAINT PK_user_sessions      PRIMARY KEY (id),
        CONSTRAINT UQ_user_sessions_jti  UNIQUE      (jti),
        CONSTRAINT FK_user_sessions_user
            FOREIGN KEY (user_id) REFERENCES care.users(id)
    );

    -- Index for fast JWT lookup on every API request
    CREATE INDEX IX_user_sessions_jti       ON care.user_sessions (jti);
    CREATE INDEX IX_user_sessions_user_id   ON care.user_sessions (user_id);

    PRINT 'STEP 2: Table care.user_sessions created.';
END
ELSE
    PRINT 'STEP 2: care.user_sessions already exists - skipped.';
GO

-- =============================================================================
-- STEP 3 - Add agency_id to care.users
-- NULL = super_admin (SeriqCare internal staff, crosses all agencies).
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('care.users') AND name = 'agency_id'
)
BEGIN
    ALTER TABLE care.users ADD agency_id INT NULL;
    PRINT 'STEP 3a: care.users.agency_id column added.';
END
ELSE
    PRINT 'STEP 3a: care.users.agency_id already exists - skipped.';
GO

-- Add FK after column exists
IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE name = 'FK_users_agency' AND parent_object_id = OBJECT_ID('care.users')
)
BEGIN
    ALTER TABLE care.users
        ADD CONSTRAINT FK_users_agency
        FOREIGN KEY (agency_id) REFERENCES care.agencies(id);
    PRINT 'STEP 3b: FK_users_agency constraint added.';
END
ELSE
    PRINT 'STEP 3b: FK_users_agency already exists - skipped.';
GO

-- =============================================================================
-- STEP 4 - Add entra_object_id to care.users
-- Populated only for Entra ID-authenticated internal admins.
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('care.users') AND name = 'entra_object_id'
)
BEGIN
    ALTER TABLE care.users ADD entra_object_id VARCHAR(36) NULL;

    -- Filtered unique index: allows many NULLs, blocks duplicate Entra GUIDs
    CREATE UNIQUE INDEX UX_users_entra_object_id
        ON care.users (entra_object_id)
        WHERE entra_object_id IS NOT NULL;

    PRINT 'STEP 4: care.users.entra_object_id added with filtered unique index.';
END
ELSE
    PRINT 'STEP 4: care.users.entra_object_id already exists - skipped.';
GO

-- =============================================================================
-- STEP 5 - Migrate role values and update role CHECK constraint
--
-- Old roles â†’ New roles:
--   admin       â†’ super_admin     (SeriqCare internal staff)
--   supervisor  â†’ agency_admin    (agency-level admin)
--   coordinator â†’ coordinator     (unchanged)
--   (new)       â†’ caregiver       (DSP workers - was using 'coordinator' before)
--
-- DSP employees (those with a non-NULL employee_id) become 'caregiver'.
-- =============================================================================

-- 5a: Migrate existing role values BEFORE updating the constraint
BEGIN TRY
    UPDATE care.users SET role = 'super_admin'  WHERE role = 'admin';
    UPDATE care.users SET role = 'agency_admin' WHERE role = 'supervisor';
    -- DSP users (have employee_id) get caregiver role
    UPDATE care.users SET role = 'caregiver'    WHERE role = 'coordinator' AND employee_id IS NOT NULL;
    PRINT 'STEP 5a: Role values migrated.';
END TRY
BEGIN CATCH
    PRINT 'STEP 5a ERROR: ' + ERROR_MESSAGE();
END CATCH
GO

-- 5b: Drop old role CHECK constraint and add new one
IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = 'CK_users_role' AND parent_object_id = OBJECT_ID('care.users')
)
BEGIN
    ALTER TABLE care.users DROP CONSTRAINT CK_users_role;
    PRINT 'STEP 5b: CK_users_role dropped.';
END
ELSE
    PRINT 'STEP 5b: CK_users_role not found - skipped drop.';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = 'CK_users_role_v2' AND parent_object_id = OBJECT_ID('care.users')
)
BEGIN
    ALTER TABLE care.users ADD CONSTRAINT CK_users_role_v2
        CHECK (role IN ('super_admin','agency_admin','coordinator','caregiver'));
    PRINT 'STEP 5c: CK_users_role_v2 added.';
END
ELSE
    PRINT 'STEP 5c: CK_users_role_v2 already exists - skipped.';
GO

-- =============================================================================
-- STEP 6 - Add agency_id to data tables
-- All EVV data tables get agency_id for row-level isolation.
-- NULL allowed initially; set to default agency in STEP 8.
-- =============================================================================

-- care.employees
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('care.employees') AND name = 'agency_id'
)
BEGIN
    ALTER TABLE care.employees ADD agency_id INT NULL;
    PRINT 'STEP 6a: care.employees.agency_id added.';
END
ELSE
    PRINT 'STEP 6a: care.employees.agency_id already exists - skipped.';
GO

-- care.clients
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('care.clients') AND name = 'agency_id'
)
BEGIN
    ALTER TABLE care.clients ADD agency_id INT NULL;
    PRINT 'STEP 6b: care.clients.agency_id added.';
END
ELSE
    PRINT 'STEP 6b: care.clients.agency_id already exists - skipped.';
GO

-- care.schedules
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('care.schedules') AND name = 'agency_id'
)
BEGIN
    ALTER TABLE care.schedules ADD agency_id INT NULL;
    PRINT 'STEP 6c: care.schedules.agency_id added.';
END
ELSE
    PRINT 'STEP 6c: care.schedules.agency_id already exists - skipped.';
GO

-- care.visits
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('care.visits') AND name = 'agency_id'
)
BEGIN
    ALTER TABLE care.visits ADD agency_id INT NULL;
    PRINT 'STEP 6d: care.visits.agency_id added.';
END
ELSE
    PRINT 'STEP 6d: care.visits.agency_id already exists - skipped.';
GO

-- care.providers
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('care.providers') AND name = 'agency_id'
)
BEGIN
    ALTER TABLE care.providers ADD agency_id INT NULL;
    PRINT 'STEP 6e: care.providers.agency_id added.';
END
ELSE
    PRINT 'STEP 6e: care.providers.agency_id already exists - skipped.';
GO

-- care.service_authorizations
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('care.service_authorizations') AND name = 'agency_id'
)
BEGIN
    ALTER TABLE care.service_authorizations ADD agency_id INT NULL;
    PRINT 'STEP 6f: care.service_authorizations.agency_id added.';
END
ELSE
    PRINT 'STEP 6f: care.service_authorizations.agency_id already exists - skipped.';
GO

-- =============================================================================
-- STEP 7 - Seed the default demo agency
-- All existing data will be linked to this agency in STEP 8.
-- =============================================================================
BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM care.agencies WHERE agency_code = 'AGY-001')
    BEGIN
        INSERT INTO care.agencies
            (agency_code, name, state_provider_id, sandata_provider_id,
             tier, address1, city, state, zip, phone,
             primary_contact_name, primary_contact_email, is_active)
        VALUES
            ('AGY-001', 'SeriqCare Demo Agency', 'PA-ODP-DEMO-001', 'PROV-SQ-001',
             'standard', '100 Care Lane', 'Harrisburg', 'PA', '17101', '(717) 555-0100',
             'Admin User', 'admin@seriqcare.com', 1);

        PRINT 'STEP 7: Default agency AGY-001 seeded (id=1).';
    END
    ELSE
        PRINT 'STEP 7: Default agency already exists - skipped.';
END TRY
BEGIN CATCH
    PRINT 'STEP 7 ERROR: ' + ERROR_MESSAGE();
END CATCH
GO

-- =============================================================================
-- STEP 8 - Link all existing rows to the default agency (agency_id = 1)
-- Safe to run multiple times (only updates NULL rows).
-- =============================================================================
BEGIN TRY
    DECLARE @agy_id INT = (SELECT id FROM care.agencies WHERE agency_code = 'AGY-001');

    UPDATE care.users                   SET agency_id = NULL   WHERE role = 'super_admin'; -- super_admins stay NULL
    UPDATE care.users                   SET agency_id = @agy_id WHERE agency_id IS NULL AND role <> 'super_admin';
    UPDATE care.employees               SET agency_id = @agy_id WHERE agency_id IS NULL;
    UPDATE care.clients                 SET agency_id = @agy_id WHERE agency_id IS NULL;
    UPDATE care.schedules               SET agency_id = @agy_id WHERE agency_id IS NULL;
    UPDATE care.visits                  SET agency_id = @agy_id WHERE agency_id IS NULL;
    UPDATE care.providers               SET agency_id = @agy_id WHERE agency_id IS NULL;
    UPDATE care.service_authorizations  SET agency_id = @agy_id WHERE agency_id IS NULL;

    PRINT 'STEP 8: All existing rows linked to agency_id=' + CAST(@agy_id AS VARCHAR);
END TRY
BEGIN CATCH
    PRINT 'STEP 8 ERROR: ' + ERROR_MESSAGE();
END CATCH
GO

-- =============================================================================
-- STEP 9 - Add FK constraints on agency_id columns (after data is populated)
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_employees_agency'
)
BEGIN
    ALTER TABLE care.employees ADD CONSTRAINT FK_employees_agency
        FOREIGN KEY (agency_id) REFERENCES care.agencies(id);
    PRINT 'STEP 9a: FK_employees_agency added.';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_clients_agency'
)
BEGIN
    ALTER TABLE care.clients ADD CONSTRAINT FK_clients_agency
        FOREIGN KEY (agency_id) REFERENCES care.agencies(id);
    PRINT 'STEP 9b: FK_clients_agency added.';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_schedules_agency'
)
BEGIN
    ALTER TABLE care.schedules ADD CONSTRAINT FK_schedules_agency
        FOREIGN KEY (agency_id) REFERENCES care.agencies(id);
    PRINT 'STEP 9c: FK_schedules_agency added.';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_visits_agency'
)
BEGIN
    ALTER TABLE care.visits ADD CONSTRAINT FK_visits_agency
        FOREIGN KEY (agency_id) REFERENCES care.agencies(id);
    PRINT 'STEP 9d: FK_visits_agency added.';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_providers_agency'
)
BEGIN
    ALTER TABLE care.providers ADD CONSTRAINT FK_providers_agency
        FOREIGN KEY (agency_id) REFERENCES care.agencies(id);
    PRINT 'STEP 9e: FK_providers_agency added.';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_svcauth_agency'
)
BEGIN
    ALTER TABLE care.service_authorizations ADD CONSTRAINT FK_svcauth_agency
        FOREIGN KEY (agency_id) REFERENCES care.agencies(id);
    PRINT 'STEP 9f: FK_svcauth_agency added.';
END
GO

-- =============================================================================
-- VERIFICATION
-- =============================================================================
PRINT '=== Phase 2 Migration - Row count verification ===';
GO

SELECT
    'care.agencies'      AS [table_name], COUNT(*) AS [row_count] FROM care.agencies
UNION ALL
SELECT
    'care.user_sessions', COUNT(*) FROM care.user_sessions
UNION ALL
SELECT
    'care.users (super_admin)',   COUNT(*) FROM care.users WHERE role = 'super_admin'
UNION ALL
SELECT
    'care.users (agency_admin)',  COUNT(*) FROM care.users WHERE role = 'agency_admin'
UNION ALL
SELECT
    'care.users (coordinator)',   COUNT(*) FROM care.users WHERE role = 'coordinator'
UNION ALL
SELECT
    'care.users (caregiver)',     COUNT(*) FROM care.users WHERE role = 'caregiver'
UNION ALL
SELECT
    'care.employees with agency', COUNT(*) FROM care.employees WHERE agency_id IS NOT NULL
UNION ALL
SELECT
    'care.clients with agency',   COUNT(*) FROM care.clients   WHERE agency_id IS NOT NULL
UNION ALL
SELECT
    'care.schedules with agency', COUNT(*) FROM care.schedules WHERE agency_id IS NOT NULL
UNION ALL
SELECT
    'care.visits with agency',    COUNT(*) FROM care.visits    WHERE agency_id IS NOT NULL;
GO

PRINT '=== Phase 2 Migration complete ===';
GO

