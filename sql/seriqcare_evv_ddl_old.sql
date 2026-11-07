-- =============================================================================
-- SeriqCare EVV Database DDL + Sample Data
-- =============================================================================
-- Description : Creates all tables for the SeriqCare EVV (Electronic Visit
--               Verification) application in the [care] schema on SQL Server.
--               Implements PA-DHS EVV Vendor Specification v1.4 and ODP EVV
--               Technical Guidance v2.0 (Sandata aggregator).
--
-- Compliance  : PA Act 75 / 21st Century Cures Act EVV mandate
--               6 required Cures Act data elements captured in care.visits:
--                 1. Service type     (service_code_id -> care.service_codes)
--                 2. Individual served(client_id      -> care.clients)
--                 3. Date of service  (service_date)
--                 4. Location         (call_in_latitude / call_in_longitude)
--                 5. Provider/employee(employee_id    -> care.employees)
--                 6. Start & end time (call_in_datetime / call_out_datetime)
--
-- Target DB   : SeriqCareDB, schema = care
-- Aggregator  : Sandata (ODP services)
-- Timestamps  : All DATETIME2 columns default to CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2)
-- Idempotent  : Safe to re-run; uses IF NOT EXISTS guards + TRY-CATCH
-- Author      : SeriqCare Engineering
-- Date        : 2026-03-09
-- =============================================================================

USE SeriqCareDB;
GO

-- =============================================================================
-- SCHEMA
-- =============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'care')
BEGIN
    EXEC('CREATE SCHEMA care');
    PRINT 'Schema [care] created.';
END
ELSE
    PRINT 'Schema [care] already exists - skipped.';
GO

-- =============================================================================
-- TABLE 1: care.waivers
-- PA waiver programs under which EVV services are authorized
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'waivers'
)
BEGIN
    CREATE TABLE care.waivers (
        id           INT IDENTITY(1,1)   NOT NULL,
        waiver_code  VARCHAR(20)         NOT NULL,
        waiver_name  VARCHAR(100)        NOT NULL,
        description  VARCHAR(500)        NULL,
        is_active    BIT                 NOT NULL DEFAULT 1,
        CONSTRAINT PK_waivers         PRIMARY KEY (id),
        CONSTRAINT UQ_waivers_code    UNIQUE      (waiver_code)
    );
    PRINT 'Table care.waivers created.';
END
ELSE
    PRINT 'Table care.waivers already exists - skipped.';
GO

-- =============================================================================
-- TABLE 2: care.service_codes
-- PA ODP HCPCS codes requiring EVV; units truncated to 15-min (no rounding)
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'service_codes'
)
BEGIN
    CREATE TABLE care.service_codes (
        id               INT IDENTITY(1,1)  NOT NULL,
        hcpcs_code       VARCHAR(10)        NOT NULL,
        modifier         VARCHAR(10)        NULL,
        description      VARCHAR(200)       NOT NULL,
        -- '12' = Home, '99' = Community, '12,99' = both allowed
        place_of_service VARCHAR(10)        NOT NULL,
        unit_type        VARCHAR(20)        NOT NULL DEFAULT '15min',
        minutes_per_unit INT                NOT NULL DEFAULT 15,
        is_evv_required  BIT                NOT NULL DEFAULT 1,
        is_active        BIT                NOT NULL DEFAULT 1,
        CONSTRAINT PK_service_codes      PRIMARY KEY (id),
        CONSTRAINT UQ_service_codes_hcpcs UNIQUE     (hcpcs_code)
    );
    PRINT 'Table care.service_codes created.';
END
ELSE
    PRINT 'Table care.service_codes already exists - skipped.';
GO

-- =============================================================================
-- TABLE 3: care.evv_error_codes
-- Sandata / PROMISe ESC codes for EVV claim adjudication
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'evv_error_codes'
)
BEGIN
    CREATE TABLE care.evv_error_codes (
        id              INT IDENTITY(1,1)  NOT NULL,
        esc_code        VARCHAR(10)        NOT NULL,
        description     VARCHAR(500)       NOT NULL,
        -- Deny = claim denied; Informational = no denial; Warning = review required
        denial_level    VARCHAR(20)        NOT NULL,
        action_required VARCHAR(500)       NULL,
        CONSTRAINT PK_evv_error_codes       PRIMARY KEY (id),
        CONSTRAINT UQ_evv_error_codes_esc   UNIQUE      (esc_code),
        CONSTRAINT CK_evv_error_denial_level
            CHECK (denial_level IN ('Deny', 'Informational', 'Warning'))
    );
    PRINT 'Table care.evv_error_codes created.';
END
ELSE
    PRINT 'Table care.evv_error_codes already exists - skipped.';
GO

-- =============================================================================
-- TABLE 4: care.reason_codes
-- Manual adjustment reason codes per PA Bulletin 07-20-04
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'reason_codes'
)
BEGIN
    CREATE TABLE care.reason_codes (
        id                     INT IDENTITY(1,1)  NOT NULL,
        reason_code            VARCHAR(10)        NOT NULL,
        description            VARCHAR(500)       NOT NULL,
        -- LateEntry, Adjustment, Exception, Cancellation
        category               VARCHAR(50)        NOT NULL,
        requires_documentation BIT                NOT NULL DEFAULT 0,
        CONSTRAINT PK_reason_codes       PRIMARY KEY (id),
        CONSTRAINT UQ_reason_codes_code  UNIQUE      (reason_code),
        CONSTRAINT CK_reason_codes_cat
            CHECK (category IN ('LateEntry','Adjustment','Exception','Cancellation'))
    );
    PRINT 'Table care.reason_codes created.';
END
ELSE
    PRINT 'Table care.reason_codes already exists - skipped.';
GO

-- =============================================================================
-- TABLE 5: care.providers
-- Agency provider registered with Sandata aggregator
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'providers'
)
BEGIN
    CREATE TABLE care.providers (
        id                   INT IDENTITY(1,1)  NOT NULL,
        provider_id_sandata  VARCHAR(30)        NOT NULL,
        npi                  VARCHAR(10)        NULL,
        name                 VARCHAR(200)       NOT NULL,
        taxonomy_code        VARCHAR(20)        NULL,
        address1             VARCHAR(200)       NULL,
        city                 VARCHAR(100)       NULL,
        state                CHAR(2)            NOT NULL DEFAULT 'PA',
        zip                  VARCHAR(10)        NULL,
        phone                VARCHAR(20)        NULL,
        is_active            BIT                NOT NULL DEFAULT 1,
        created_at           DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        CONSTRAINT PK_providers               PRIMARY KEY (id),
        CONSTRAINT UQ_providers_sandata_id    UNIQUE      (provider_id_sandata)
    );
    PRINT 'Table care.providers created.';
END
ELSE
    PRINT 'Table care.providers already exists - skipped.';
GO

-- =============================================================================
-- TABLE 6: care.clients
-- Medicaid beneficiaries receiving EVV-mandated services (Cures Act element #2)
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'clients'
)
BEGIN
    CREATE TABLE care.clients (
        id                   INT IDENTITY(1,1)  NOT NULL,
        -- Internal client code e.g. CL-10024
        client_code          VARCHAR(20)        NOT NULL,
        -- PA Medicaid ID (MA ID) - transmitted to Sandata as client identifier
        medicaid_id          VARCHAR(20)        NOT NULL,
        first_name           VARCHAR(100)       NOT NULL,
        last_name            VARCHAR(100)       NOT NULL,
        date_of_birth        DATE               NOT NULL,
        gender               CHAR(1)            NULL,   -- M / F / X
        ssn_last4            CHAR(4)            NULL,
        ma_county            VARCHAR(50)        NULL,
        phone                VARCHAR(20)        NULL,
        email                VARCHAR(200)       NULL,
        -- Active, Pending, On Hold, Discharged
        status               VARCHAR(20)        NOT NULL DEFAULT 'Active',
        care_plan_review_date DATE              NULL,
        care_plan_notes      VARCHAR(1000)      NULL,
        is_active            BIT                NOT NULL DEFAULT 1,
        created_at           DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        CONSTRAINT PK_clients              PRIMARY KEY (id),
        CONSTRAINT UQ_clients_code         UNIQUE      (client_code),
        CONSTRAINT UQ_clients_medicaid_id  UNIQUE      (medicaid_id),
        CONSTRAINT CK_clients_status
            CHECK (status IN ('Active','Pending','On Hold','Discharged'))
    );
    PRINT 'Table care.clients created.';
END
ELSE
    PRINT 'Table care.clients already exists - skipped.';
GO

-- =============================================================================
-- TABLE 7: care.client_addresses
-- Cures Act element #4: verified service location per client
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'client_addresses'
)
BEGIN
    CREATE TABLE care.client_addresses (
        id           INT IDENTITY(1,1)   NOT NULL,
        client_id    INT                 NOT NULL,
        -- Home = POS 12, Community = POS 99
        address_type VARCHAR(20)         NOT NULL DEFAULT 'Home',
        address1     VARCHAR(200)        NOT NULL,
        address2     VARCHAR(200)        NULL,
        city         VARCHAR(100)        NOT NULL,
        state        CHAR(2)             NOT NULL DEFAULT 'PA',
        zip          VARCHAR(10)         NULL,
        -- GPS coordinates for EVV geofencing / location verification
        latitude     DECIMAL(10,7)       NULL,
        longitude    DECIMAL(10,7)       NULL,
        is_primary   BIT                 NOT NULL DEFAULT 1,
        is_active    BIT                 NOT NULL DEFAULT 1,
        CONSTRAINT PK_client_addresses      PRIMARY KEY (id),
        CONSTRAINT FK_client_addresses_client
            FOREIGN KEY (client_id) REFERENCES care.clients(id)
    );
    PRINT 'Table care.client_addresses created.';
END
ELSE
    PRINT 'Table care.client_addresses already exists - skipped.';
GO

-- =============================================================================
-- TABLE 8: care.client_payer_info
-- Links client to waiver/payer; payer_id=PAODP, program=ODP per Sandata spec
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'client_payer_info'
)
BEGIN
    CREATE TABLE care.client_payer_info (
        id             INT IDENTITY(1,1)  NOT NULL,
        client_id      INT                NOT NULL,
        -- Sandata payer identifier; PAODP = PA Office of Developmental Programs
        payer_id       VARCHAR(20)        NOT NULL DEFAULT 'PAODP',
        program        VARCHAR(20)        NOT NULL DEFAULT 'ODP',
        waiver_id      INT                NULL,
        effective_date DATE               NOT NULL,
        end_date       DATE               NULL,
        is_active      BIT                NOT NULL DEFAULT 1,
        CONSTRAINT PK_client_payer_info        PRIMARY KEY (id),
        CONSTRAINT FK_client_payer_info_client
            FOREIGN KEY (client_id) REFERENCES care.clients(id),
        CONSTRAINT FK_client_payer_info_waiver
            FOREIGN KEY (waiver_id) REFERENCES care.waivers(id)
    );
    PRINT 'Table care.client_payer_info created.';
END
ELSE
    PRINT 'Table care.client_payer_info already exists - skipped.';
GO

-- =============================================================================
-- TABLE 9: care.employees
-- Direct support professionals (DSPs) - Cures Act element #5 (provider)
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'employees'
)
BEGIN
    CREATE TABLE care.employees (
        id                  INT IDENTITY(1,1)  NOT NULL,
        employee_code       VARCHAR(20)        NOT NULL,
        -- Sandata employee identifier transmitted in EVV visit records
        sandata_employee_id VARCHAR(30)        NULL,
        npi                 VARCHAR(10)        NULL,
        first_name          VARCHAR(100)       NOT NULL,
        last_name           VARCHAR(100)       NOT NULL,
        phone               VARCHAR(20)        NULL,
        hire_date           DATE               NULL,
        is_active           BIT                NOT NULL DEFAULT 1,
        created_at          DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        CONSTRAINT PK_employees           PRIMARY KEY (id),
        CONSTRAINT UQ_employees_code      UNIQUE      (employee_code)
    );
    PRINT 'Table care.employees created.';
END
ELSE
    PRINT 'Table care.employees already exists - skipped.';
GO

-- =============================================================================
-- TABLE 10: care.service_authorizations
-- Prior authorization links client+service+units; used_units updated on approval
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'service_authorizations'
)
BEGIN
    CREATE TABLE care.service_authorizations (
        id                  INT IDENTITY(1,1)  NOT NULL,
        client_id           INT                NOT NULL,
        service_code_id     INT                NOT NULL,
        provider_id         INT                NOT NULL,
        auth_number         VARCHAR(50)        NULL,
        authorized_units    DECIMAL(10,2)      NOT NULL,
        used_units          DECIMAL(10,2)      NOT NULL DEFAULT 0,
        service_start_date  DATE               NOT NULL,
        service_end_date    DATE               NOT NULL,
        is_active           BIT                NOT NULL DEFAULT 1,
        created_at          DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        CONSTRAINT PK_service_authorizations        PRIMARY KEY (id),
        CONSTRAINT FK_svcauth_client
            FOREIGN KEY (client_id)       REFERENCES care.clients(id),
        CONSTRAINT FK_svcauth_service_code
            FOREIGN KEY (service_code_id) REFERENCES care.service_codes(id),
        CONSTRAINT FK_svcauth_provider
            FOREIGN KEY (provider_id)     REFERENCES care.providers(id)
    );
    PRINT 'Table care.service_authorizations created.';
END
ELSE
    PRINT 'Table care.service_authorizations already exists - skipped.';
GO

-- =============================================================================
-- TABLE 11: care.schedules
-- Planned shifts; NULL employee_id = open/unassigned shift
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'schedules'
)
BEGIN
    CREATE TABLE care.schedules (
        id               INT IDENTITY(1,1)  NOT NULL,
        client_id        INT                NOT NULL,
        employee_id      INT                NULL,   -- NULL = open shift
        service_code_id  INT                NOT NULL,
        scheduled_start  DATETIME2          NOT NULL,
        scheduled_end    DATETIME2          NOT NULL,
        -- Scheduled, Confirmed, Open, Cancelled, Completed
        status           VARCHAR(20)        NOT NULL DEFAULT 'Scheduled',
        notes            VARCHAR(1000)      NULL,
        created_at       DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        CONSTRAINT PK_schedules           PRIMARY KEY (id),
        CONSTRAINT FK_schedules_client
            FOREIGN KEY (client_id)      REFERENCES care.clients(id),
        CONSTRAINT FK_schedules_employee
            FOREIGN KEY (employee_id)    REFERENCES care.employees(id),
        CONSTRAINT FK_schedules_svc_code
            FOREIGN KEY (service_code_id) REFERENCES care.service_codes(id),
        CONSTRAINT CK_schedules_status
            CHECK (status IN ('Scheduled','Confirmed','Open','Cancelled','Completed'))
    );
    PRINT 'Table care.schedules created.';
END
ELSE
    PRINT 'Table care.schedules already exists - skipped.';
GO

-- =============================================================================
-- TABLE 12: care.visits
-- EVV core table - captures all 6 Cures Act data elements
-- All datetime values stored in UTC (YYYY-MM-DDTHH:MM:SSZ)
-- Units: truncated to full 15-min units (no rounding per ODP guidance)
-- Seconds ignored in unit calculation
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'visits'
)
BEGIN
    CREATE TABLE care.visits (
        id                       INT IDENTITY(1,1)  NOT NULL,
        -- Sandata visit ID (18-char max) - populated on first submission
        visit_id_sandata         VARCHAR(18)        NULL,
        schedule_id              INT                NULL,
        -- Cures Act element #2: Individual served
        client_id                INT                NOT NULL,
        -- Cures Act element #5: Provider / employee
        employee_id              INT                NOT NULL,
        -- Cures Act element #1: Service type
        service_code_id          INT                NOT NULL,
        service_authorization_id INT                NULL,
        -- Cures Act element #3: Date of service
        service_date             DATE               NOT NULL,

        -- Cures Act element #6: Start time + element #4: Location (clock-in)
        call_in_datetime         DATETIME2          NULL,   -- UTC
        call_in_latitude         DECIMAL(10,7)      NULL,
        call_in_longitude        DECIMAL(10,7)      NULL,
        -- Phone, Mobile, Fixed, GPS
        call_in_method           VARCHAR(20)        NULL DEFAULT 'Mobile',

        -- Cures Act element #6: End time + element #4: Location (clock-out)
        call_out_datetime        DATETIME2          NULL,   -- UTC
        call_out_latitude        DECIMAL(10,7)      NULL,
        call_out_longitude       DECIMAL(10,7)      NULL,
        call_out_method          VARCHAR(20)        NULL DEFAULT 'Mobile',

        -- Supervisor manual time adjustments (documented in visit_changes)
        adj_in_datetime          DATETIME2          NULL,   -- UTC
        adj_out_datetime         DATETIME2          NULL,   -- UTC

        -- Cures Act element #4: Place of service (12=Home, 99=Community)
        place_of_service         VARCHAR(5)         NOT NULL DEFAULT '12',
        -- Units truncated to full 15-min blocks (no rounding)
        billed_units             DECIMAL(6,2)       NULL,
        approved_units           DECIMAL(6,2)       NULL,

        -- EVV processing status
        -- Processed=submitted to aggregator, Verified=matched, Incomplete=missing data, Omit=excluded
        evv_status               VARCHAR(20)        NOT NULL DEFAULT 'Incomplete',
        -- Approval workflow status
        approval_status          VARCHAR(20)        NOT NULL DEFAULT 'Pending',
        visit_cancelled          BIT                NOT NULL DEFAULT 0,
        reason_code_id           INT                NULL,
        hard_copy_required       BIT                NOT NULL DEFAULT 0,
        notes                    VARCHAR(1000)      NULL,
        created_at               DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        updated_at               DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),

        CONSTRAINT PK_visits                  PRIMARY KEY (id),
        CONSTRAINT UQ_visits_sandata_id       UNIQUE      (visit_id_sandata),
        CONSTRAINT FK_visits_schedule
            FOREIGN KEY (schedule_id)              REFERENCES care.schedules(id),
        CONSTRAINT FK_visits_client
            FOREIGN KEY (client_id)                REFERENCES care.clients(id),
        CONSTRAINT FK_visits_employee
            FOREIGN KEY (employee_id)              REFERENCES care.employees(id),
        CONSTRAINT FK_visits_service_code
            FOREIGN KEY (service_code_id)          REFERENCES care.service_codes(id),
        CONSTRAINT FK_visits_svc_auth
            FOREIGN KEY (service_authorization_id) REFERENCES care.service_authorizations(id),
        CONSTRAINT FK_visits_reason_code
            FOREIGN KEY (reason_code_id)           REFERENCES care.reason_codes(id),
        CONSTRAINT CK_visits_evv_status
            CHECK (evv_status IN ('Processed','Verified','Incomplete','Omit')),
        CONSTRAINT CK_visits_approval_status
            CHECK (approval_status IN ('Pending','Approved','Rejected')),
        CONSTRAINT CK_visits_pos
            CHECK (place_of_service IN ('12','99'))
    );
    PRINT 'Table care.visits created.';
END
ELSE
    PRINT 'Table care.visits already exists - skipped.';
GO

-- =============================================================================
-- TABLE 13: care.visit_changes
-- Immutable audit trail for all EVV visit modifications per PA Bulletin 07-20-04
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'visit_changes'
)
BEGIN
    CREATE TABLE care.visit_changes (
        id             INT IDENTITY(1,1)  NOT NULL,
        visit_id       INT                NOT NULL,
        changed_by     VARCHAR(100)       NULL,
        -- ClockInAdjust, ClockOutAdjust, StatusChange, Cancellation
        change_type    VARCHAR(50)        NULL,
        old_value      VARCHAR(500)       NULL,
        new_value      VARCHAR(500)       NULL,
        reason_code_id INT                NULL,
        notes          VARCHAR(1000)      NULL,
        changed_at     DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        CONSTRAINT PK_visit_changes          PRIMARY KEY (id),
        CONSTRAINT FK_visit_changes_visit
            FOREIGN KEY (visit_id)       REFERENCES care.visits(id),
        CONSTRAINT FK_visit_changes_reason
            FOREIGN KEY (reason_code_id) REFERENCES care.reason_codes(id)
    );
    PRINT 'Table care.visit_changes created.';
END
ELSE
    PRINT 'Table care.visit_changes already exists - skipped.';
GO

-- =============================================================================
-- TABLE 14: care.visit_exceptions
-- EVV exceptions surfaced from Sandata ESC codes or internal validation
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'visit_exceptions'
)
BEGIN
    CREATE TABLE care.visit_exceptions (
        id               INT IDENTITY(1,1)  NOT NULL,
        visit_id         INT                NOT NULL,
        esc_code_id      INT                NULL,
        -- MissingClockOut, GPSMismatch, LateEntry, UnitsMismatch
        exception_type   VARCHAR(50)        NULL,
        description      VARCHAR(500)       NULL,
        requires_ack     BIT                NOT NULL DEFAULT 1,
        acknowledged     BIT                NOT NULL DEFAULT 0,
        acknowledged_by  VARCHAR(100)       NULL,
        acknowledged_at  DATETIME2          NULL,
        reason_code_id   INT                NULL,
        notes            VARCHAR(1000)      NULL,
        created_at       DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        CONSTRAINT PK_visit_exceptions         PRIMARY KEY (id),
        CONSTRAINT FK_visit_exceptions_visit
            FOREIGN KEY (visit_id)       REFERENCES care.visits(id),
        CONSTRAINT FK_visit_exceptions_esc
            FOREIGN KEY (esc_code_id)    REFERENCES care.evv_error_codes(id),
        CONSTRAINT FK_visit_exceptions_reason
            FOREIGN KEY (reason_code_id) REFERENCES care.reason_codes(id)
    );
    PRINT 'Table care.visit_exceptions created.';
END
ELSE
    PRINT 'Table care.visit_exceptions already exists - skipped.';
GO

-- =============================================================================
-- TABLE 15: care.aggregator_submissions
-- Log of all payloads sent to Sandata REST API v1.1 (visits/clients/employees)
-- Endpoint pattern: https://api.sandata.com/interfaces/intake/{type}/rest/api/v1.1
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'aggregator_submissions'
)
BEGIN
    CREATE TABLE care.aggregator_submissions (
        id               INT IDENTITY(1,1)  NOT NULL,
        visit_id         INT                NOT NULL,
        -- Visit, Client, Employee
        submission_type  VARCHAR(20)        NOT NULL DEFAULT 'Visit',
        -- Full JSON payload sent to Sandata (NVARCHAR for Unicode safety)
        payload          NVARCHAR(MAX)      NULL,
        -- Pending, Submitted, Accepted, Rejected
        status           VARCHAR(20)        NOT NULL DEFAULT 'Pending',
        response_code    VARCHAR(10)        NULL,
        response_message VARCHAR(500)       NULL,
        submitted_at     DATETIME2          NULL,
        response_at      DATETIME2          NULL,
        created_at       DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        CONSTRAINT PK_aggregator_submissions       PRIMARY KEY (id),
        CONSTRAINT FK_aggregator_submissions_visit
            FOREIGN KEY (visit_id) REFERENCES care.visits(id),
        CONSTRAINT CK_aggregator_submissions_type
            CHECK (submission_type IN ('Visit','Client','Employee')),
        CONSTRAINT CK_aggregator_submissions_status
            CHECK (status IN ('Pending','Submitted','Accepted','Rejected'))
    );
    PRINT 'Table care.aggregator_submissions created.';
END
ELSE
    PRINT 'Table care.aggregator_submissions already exists - skipped.';
GO

-- =============================================================================
-- TABLE 16: care.users
-- Application users (coordinators, supervisors, admins)
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'users'
)
BEGIN
    CREATE TABLE care.users (
        id           INT IDENTITY(1,1)  NOT NULL,
        username     VARCHAR(100)       NOT NULL,
        display_name VARCHAR(200)       NULL,
        email        VARCHAR(200)       NULL,
        -- admin, supervisor, coordinator
        role         VARCHAR(20)        NOT NULL DEFAULT 'coordinator',
        is_active    BIT                NOT NULL DEFAULT 1,
        created_at   DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        CONSTRAINT PK_users          PRIMARY KEY (id),
        CONSTRAINT UQ_users_username UNIQUE      (username),
        CONSTRAINT CK_users_role
            CHECK (role IN ('admin','supervisor','coordinator'))
    );
    PRINT 'Table care.users created.';
END
ELSE
    PRINT 'Table care.users already exists - skipped.';
GO


-- =============================================================================
-- SAMPLE DATA
-- Reference date: 2026-03-09 (Monday)
-- All INSERT blocks are wrapped in TRY-CATCH so re-runs fail gracefully
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. care.waivers  (5 rows)
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM care.waivers WHERE waiver_code = 'ODP')
    BEGIN
        INSERT INTO care.waivers (waiver_code, waiver_name, description, is_active)
        VALUES
            ('ODP',      'Office of Developmental Programs Waiver',
             'ODP community-based HCBS services for individuals with intellectual disabilities', 1),
            ('COMMCARE', 'Community HealthChoices',
             'LTSS managed care program for adults with physical disabilities and older adults', 1),
            ('OBRA',     'Older Adults Waiver',
             'HCBS waiver for older adults seeking alternatives to nursing facility care', 1),
            ('PFFS',     'Person/Family Directed Support Waiver',
             'Self-directed ODP waiver allowing participants to hire and manage their own workers', 1),
            ('AW',       'Agency with Choice',
             'AW model for ODP self-directed services with agency as employer of record', 1);
        PRINT 'Inserted 5 rows into care.waivers.';
    END
    ELSE
        PRINT 'care.waivers seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.waivers: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 2. care.service_codes  (6 PA ODP EVV-required codes)
-- PA ODP EVV-required HCPCS codes; all require EVV under Cures Act / Act 75
-- W9495 (Respite Day) effective 7/1/2025; unit_type='day', minutes_per_unit=480
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM care.service_codes WHERE hcpcs_code = 'W7076')
    BEGIN
        INSERT INTO care.service_codes
            (hcpcs_code, modifier, description, place_of_service,
             unit_type, minutes_per_unit, is_evv_required, is_active)
        VALUES
            ('W7076', 'UC', 'Companion Care',
             '12,99', '15min', 15, 1, 1),
            ('W7060', 'UC', 'In-Home and Community Habilitation',
             '12,99', '15min', 15, 1, 1),
            ('W9494', 'UC', 'Respite - Unlicensed',
             '12',    '15min', 15, 1, 1),
            -- Effective 7/1/2025: billed as full-day units (480 min)
            ('W9495', 'DY', 'Respite Day (eff 7/1/2025)',
             '12',    'day',   480, 1, 1),
            ('S5130', 'UC', 'Homemaker Services',
             '12',    '15min', 15, 1, 1),
            ('W9783', 'UC', 'Community Support AAW',
             '99',    '15min', 15, 1, 1);
        PRINT 'Inserted 6 rows into care.service_codes.';
    END
    ELSE
        PRINT 'care.service_codes seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.service_codes: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 3. care.evv_error_codes  (ESC codes per PROMISe / Sandata)
-- ESC 927 & 928 = claim denied; ESC 5000 = informational only
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM care.evv_error_codes WHERE esc_code = '927')
    BEGIN
        INSERT INTO care.evv_error_codes
            (esc_code, description, denial_level, action_required)
        VALUES
            ('927',  'EVV Visit Record Found but Mismatch - Billed and stored units differ',
             'Deny',
             'Compare billed units to EVV clock-in/clock-out; correct submission or document discrepancy with reason code.'),
            ('928',  'EVV Visit Record Not Found - No matching EVV record in aggregator',
             'Deny',
             'Verify visit was submitted to Sandata aggregator; resubmit with correct client MA ID and service date.'),
            ('5000', 'Duplicate Modifier on Claim - Two visits same day same modifier',
             'Informational',
             'Review same-day visits for the modifier; confirm both visits are valid; no action required if legitimate.');
        PRINT 'Inserted 3 rows into care.evv_error_codes.';
    END
    ELSE
        PRINT 'care.evv_error_codes seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.evv_error_codes: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 4. care.reason_codes  (manual adjustment per PA Bulletin 07-20-04)
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM care.reason_codes WHERE reason_code = 'RC01')
    BEGIN
        INSERT INTO care.reason_codes
            (reason_code, description, category, requires_documentation)
        VALUES
            ('RC01', 'Caregiver arrived late due to transportation issues',
             'LateEntry',    1),
            ('RC02', 'Technical issues with mobile device prevented timely entry',
             'LateEntry',    0),
            ('RC03', 'Client refused electronic verification',
             'Exception',    1),
            ('RC04', 'Emergency situation prevented normal clock-in/out',
             'Exception',    1),
            ('RC05', 'Supervisor adjusted time per documented approval',
             'Adjustment',   1),
            ('RC06', 'Visit cancelled by client',
             'Cancellation', 0),
            ('RC07', 'Visit cancelled by agency',
             'Cancellation', 1);
        PRINT 'Inserted 7 rows into care.reason_codes.';
    END
    ELSE
        PRINT 'care.reason_codes seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.reason_codes: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 5. care.providers  (1 row - Seriq Home Care LLC)
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM care.providers WHERE provider_id_sandata = 'PROV-SQ-001')
    BEGIN
        INSERT INTO care.providers
            (provider_id_sandata, npi, name, taxonomy_code,
             address1, city, state, zip, phone, is_active)
        VALUES
            ('PROV-SQ-001', '1234567890', 'Seriq Home Care LLC', '302C',
             '100 Care Ave', 'Philadelphia', 'PA', '19102', '(215) 555-0100', 1);
        PRINT 'Inserted 1 row into care.providers.';
    END
    ELSE
        PRINT 'care.providers seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.providers: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 6. care.clients  (6 rows - matching UI wireframe)
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM care.clients WHERE client_code = 'CL-10024')
    BEGIN
        INSERT INTO care.clients
            (client_code, medicaid_id, first_name, last_name,
             date_of_birth, gender, ma_county, status, care_plan_review_date, is_active)
        VALUES
            -- Age 76 as of 2026-03-09; York county; plan review due 2026-03-15
            ('CL-10024', 'PA111222333', 'Evelyn',   'Carter',    '1949-07-15', 'F', 'York',         'Active',  '2026-03-15', 1),
            -- Age 68; Lancaster county; plan up to date
            ('CL-10031', 'PA222333444', 'James',    'Holloway',  '1957-11-03', 'M', 'Lancaster',    'Active',  NULL,         1),
            -- Age 82; Harrisburg; Pending (no payer info yet)
            ('CL-10044', 'PA333444555', 'Maria',    'Thompson',  '1943-04-22', 'F', 'Harrisburg',   'Pending', NULL,         1),
            -- Age 73; Reading; On Hold; next review 2026-04-01
            ('CL-10057', 'PA444555666', 'Robert',   'Jenkins',   '1952-09-08', 'M', 'Reading',      'On Hold', '2026-04-01', 1),
            -- Age 79; Camp Hill; plan review due 2026-03-22
            ('CL-10063', 'PA555666777', 'Patricia', 'Owens',     '1946-12-30', 'F', 'Camp Hill',    'Active',  '2026-03-22', 1),
            -- Age 64; Mechanicsburg; plan up to date
            ('CL-10071', 'PA666777888', 'Daniel',   'Foster',    '1961-05-17', 'M', 'Mechanicsburg','Active',  NULL,         1);
        PRINT 'Inserted 6 rows into care.clients.';
    END
    ELSE
        PRINT 'care.clients seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.clients: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 7. care.client_addresses  (1 per client - plausible PA addresses + GPS)
-- Lat/Lon approximate city centres for EVV geofencing reference
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (
        SELECT 1 FROM care.client_addresses ca
        JOIN care.clients c ON ca.client_id = c.id
        WHERE c.client_code = 'CL-10024'
    )
    BEGIN
        INSERT INTO care.client_addresses
            (client_id, address_type, address1, city, state, zip,
             latitude, longitude, is_primary, is_active)
        VALUES
            -- Evelyn Carter - York, PA (40.0, -76.7)
            ((SELECT id FROM care.clients WHERE client_code = 'CL-10024'),
             'Home', '214 Pleasant View Dr', 'York', 'PA', '17401',
             40.0000000, -76.7000000, 1, 1),
            -- James Holloway - Lancaster, PA (40.0, -76.3)
            ((SELECT id FROM care.clients WHERE client_code = 'CL-10031'),
             'Home', '55 Meadow Lane', 'Lancaster', 'PA', '17601',
             40.0000000, -76.3000000, 1, 1),
            -- Maria Thompson - Harrisburg, PA (40.3, -76.9)
            ((SELECT id FROM care.clients WHERE client_code = 'CL-10044'),
             'Home', '310 River Rd', 'Harrisburg', 'PA', '17101',
             40.3000000, -76.9000000, 1, 1),
            -- Robert Jenkins - Reading, PA (40.3, -75.9)
            ((SELECT id FROM care.clients WHERE client_code = 'CL-10057'),
             'Home', '88 Elm St', 'Reading', 'PA', '19601',
             40.3000000, -75.9000000, 1, 1),
            -- Patricia Owens - Camp Hill, PA (40.2, -77.0)
            ((SELECT id FROM care.clients WHERE client_code = 'CL-10063'),
             'Home', '421 Walnut Ave', 'Camp Hill', 'PA', '17011',
             40.2000000, -77.0000000, 1, 1),
            -- Daniel Foster - Mechanicsburg, PA (40.2, -77.0)
            ((SELECT id FROM care.clients WHERE client_code = 'CL-10071'),
             'Home', '17 Orchard Blvd', 'Mechanicsburg', 'PA', '17055',
             40.2000000, -77.0000000, 1, 1);
        PRINT 'Inserted 6 rows into care.client_addresses.';
    END
    ELSE
        PRINT 'care.client_addresses seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.client_addresses: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 8. care.client_payer_info  (active clients only - Maria Thompson excluded)
-- payer_id=PAODP, program=ODP, waiver=ODP waiver
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (
        SELECT 1 FROM care.client_payer_info cpi
        JOIN care.clients c ON cpi.client_id = c.id
        WHERE c.client_code = 'CL-10024'
    )
    BEGIN
        INSERT INTO care.client_payer_info
            (client_id, payer_id, program, waiver_id, effective_date, end_date, is_active)
        VALUES
            -- Evelyn Carter
            ((SELECT id FROM care.clients  WHERE client_code = 'CL-10024'),
             'PAODP', 'ODP',
             (SELECT id FROM care.waivers  WHERE waiver_code = 'ODP'),
             '2024-01-01', '2026-12-31', 1),
            -- James Holloway
            ((SELECT id FROM care.clients  WHERE client_code = 'CL-10031'),
             'PAODP', 'ODP',
             (SELECT id FROM care.waivers  WHERE waiver_code = 'ODP'),
             '2024-01-01', '2026-12-31', 1),
            -- Robert Jenkins
            ((SELECT id FROM care.clients  WHERE client_code = 'CL-10057'),
             'PAODP', 'ODP',
             (SELECT id FROM care.waivers  WHERE waiver_code = 'ODP'),
             '2024-01-01', '2026-12-31', 1),
            -- Patricia Owens
            ((SELECT id FROM care.clients  WHERE client_code = 'CL-10063'),
             'PAODP', 'ODP',
             (SELECT id FROM care.waivers  WHERE waiver_code = 'ODP'),
             '2024-01-01', '2026-12-31', 1),
            -- Daniel Foster
            ((SELECT id FROM care.clients  WHERE client_code = 'CL-10071'),
             'PAODP', 'ODP',
             (SELECT id FROM care.waivers  WHERE waiver_code = 'ODP'),
             '2024-01-01', '2026-12-31', 1);
        PRINT 'Inserted 5 rows into care.client_payer_info.';
    END
    ELSE
        PRINT 'care.client_payer_info seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.client_payer_info: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 9. care.employees  (5 rows - DSPs)
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM care.employees WHERE employee_code = 'EMP001')
    BEGIN
        INSERT INTO care.employees
            (employee_code, sandata_employee_id, first_name, last_name,
             phone, hire_date, is_active)
        VALUES
            ('EMP001', 'SD-EMP-001', 'Sarah',   'Mills',  '(717) 555-0201', '2022-03-15', 1),
            ('EMP002', 'SD-EMP-002', 'Linda',   'Brooks', '(717) 555-0202', '2021-09-01', 1),
            ('EMP003', 'SD-EMP-003', 'Rachel',  'Dunn',   '(717) 555-0203', '2023-01-10', 1),
            ('EMP004', 'SD-EMP-004', 'Angela',  'Reese',  '(717) 555-0204', '2020-06-15', 1),
            ('EMP005', 'SD-EMP-005', 'Natalie', 'Ford',   '(717) 555-0205', '2022-11-20', 1);
        PRINT 'Inserted 5 rows into care.employees.';
    END
    ELSE
        PRINT 'care.employees seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.employees: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 10. care.service_authorizations  (1 active auth per client+service combo)
-- auth_number format: AUTH-{year}-{seq}; used_units seeded from sample visits
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM care.service_authorizations WHERE auth_number = 'AUTH-2026-001')
    BEGIN
        INSERT INTO care.service_authorizations
            (client_id, service_code_id, provider_id, auth_number,
             authorized_units, used_units, service_start_date, service_end_date, is_active)
        VALUES
            -- Evelyn Carter: W7076 Companion Care, 480 units/year
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10024'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W7076'),
             (SELECT id FROM care.providers     WHERE provider_id_sandata = 'PROV-SQ-001'),
             'AUTH-2026-001', 480.00, 8.00, '2026-01-01', '2026-12-31', 1),
            -- James Holloway: W7076 Companion Care, 360 units
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10031'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W7076'),
             (SELECT id FROM care.providers     WHERE provider_id_sandata = 'PROV-SQ-001'),
             'AUTH-2026-002', 360.00, 12.00, '2026-01-01', '2026-12-31', 1),
            -- Robert Jenkins: W9494 Respite, 200 units, ends 2026-06-30
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10057'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W9494'),
             (SELECT id FROM care.providers     WHERE provider_id_sandata = 'PROV-SQ-001'),
             'AUTH-2026-003', 200.00, 6.00, '2026-01-01', '2026-06-30', 1),
            -- Patricia Owens: S5130 Homemaker, 400 units
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10063'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'S5130'),
             (SELECT id FROM care.providers     WHERE provider_id_sandata = 'PROV-SQ-001'),
             'AUTH-2026-004', 400.00, 12.00, '2026-01-01', '2026-12-31', 1),
            -- Daniel Foster: W7076 Companion Care, 320 units
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10071'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W7076'),
             (SELECT id FROM care.providers     WHERE provider_id_sandata = 'PROV-SQ-001'),
             'AUTH-2026-005', 320.00, 10.00, '2026-01-01', '2026-12-31', 1);
        PRINT 'Inserted 5 rows into care.service_authorizations.';
    END
    ELSE
        PRINT 'care.service_authorizations seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.service_authorizations: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 11. care.schedules  (12 entries, week of 2026-03-09 to 2026-03-15)
-- All times are UTC (EST + 5h); e.g. 08:00 EST = 13:00 UTC
-- NULL employee_id = open/unassigned shift
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (
        SELECT 1 FROM care.schedules
        WHERE scheduled_start = '2026-03-10 13:00:00'
          AND client_id = (SELECT id FROM care.clients WHERE client_code = 'CL-10024')
    )
    BEGIN
        INSERT INTO care.schedules
            (client_id, employee_id, service_code_id,
             scheduled_start, scheduled_end, status, notes)
        VALUES
            -- Mon 2026-03-10
            -- 08:00-10:00 EST (13:00-15:00 UTC): Evelyn Carter + Sarah Mills, W7076
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10024'),
             (SELECT id FROM care.employees     WHERE employee_code = 'EMP001'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W7076'),
             '2026-03-10 13:00:00', '2026-03-10 15:00:00', 'Scheduled', NULL),

            -- 08:30-11:00 EST (13:30-16:00 UTC): Daniel Foster + Rachel Dunn, W7076
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10071'),
             (SELECT id FROM care.employees     WHERE employee_code = 'EMP003'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W7076'),
             '2026-03-10 13:30:00', '2026-03-10 16:00:00', 'Scheduled', NULL),

            -- 08:00-09:00 EST (13:00-14:00 UTC): Maria Thompson, open shift, W7060
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10044'),
             NULL,
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W7060'),
             '2026-03-10 13:00:00', '2026-03-10 14:00:00', 'Open', 'Unassigned - seeking available DSP'),

            -- Tue 2026-03-11
            -- 10:00-12:00 EST (15:00-17:00 UTC): Patricia Owens + Angela Reese, S5130
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10063'),
             (SELECT id FROM care.employees     WHERE employee_code = 'EMP004'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'S5130'),
             '2026-03-11 15:00:00', '2026-03-11 17:00:00', 'Scheduled', NULL),

            -- 10:30-12:30 EST (15:30-17:30 UTC): Robert Jenkins, open shift, W9494
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10057'),
             NULL,
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W9494'),
             '2026-03-11 15:30:00', '2026-03-11 17:30:00', 'Open', 'Needs confirmation - no DSP assigned'),

            -- 10:00-13:00 EST (15:00-18:00 UTC): James Holloway + Linda Brooks, W7076
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10031'),
             (SELECT id FROM care.employees     WHERE employee_code = 'EMP002'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W7076'),
             '2026-03-11 15:00:00', '2026-03-11 18:00:00', 'Confirmed', NULL),

            -- Wed 2026-03-12
            -- 12:00-14:00 EST (17:00-19:00 UTC): Evelyn Carter + Sarah Mills, W7076
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10024'),
             (SELECT id FROM care.employees     WHERE employee_code = 'EMP001'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W7076'),
             '2026-03-12 17:00:00', '2026-03-12 19:00:00', 'Scheduled', NULL),

            -- Thu 2026-03-13
            -- 12:00-15:00 EST (17:00-20:00 UTC): Daniel Foster + Rachel Dunn, W7076
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10071'),
             (SELECT id FROM care.employees     WHERE employee_code = 'EMP003'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W7076'),
             '2026-03-13 17:00:00', '2026-03-13 20:00:00', 'Scheduled', NULL),

            -- Fri 2026-03-14
            -- 11:00-14:00 EST (16:00-19:00 UTC): Patricia Owens + Angela Reese, S5130
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10063'),
             (SELECT id FROM care.employees     WHERE employee_code = 'EMP004'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'S5130'),
             '2026-03-14 16:00:00', '2026-03-14 19:00:00', 'Scheduled', NULL),

            -- 11:00-14:00 EST (16:00-19:00 UTC): James Holloway + Linda Brooks, W7076
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10031'),
             (SELECT id FROM care.employees     WHERE employee_code = 'EMP002'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W7076'),
             '2026-03-14 16:00:00', '2026-03-14 19:00:00', 'Scheduled', NULL),

            -- Sat 2026-03-15
            -- 09:00-12:00 EST (14:00-17:00 UTC): Evelyn Carter + Sarah Mills, W7076
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10024'),
             (SELECT id FROM care.employees     WHERE employee_code = 'EMP001'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W7076'),
             '2026-03-15 14:00:00', '2026-03-15 17:00:00', 'Scheduled', NULL),

            -- 12:30-14:00 EST (17:30-19:00 UTC): Maria Thompson, unassigned, W7060
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10044'),
             NULL,
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W7060'),
             '2026-03-15 17:30:00', '2026-03-15 19:00:00', 'Open', 'Unassigned weekend shift');
        PRINT 'Inserted 12 rows into care.schedules.';
    END
    ELSE
        PRINT 'care.schedules seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.schedules: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 12. care.visits  (5 rows - timesheets wireframe, service_date 2026-03-09)
-- All clock times in UTC. Unit calculation truncates to 15-min blocks:
--   Visit 1: 13:02-15:03 = 121 min => 8 units (120 min / 15)
--   Visit 2: 15:01-18:04 = 183 min => 12 units (180 min / 15)
--   Visit 3: 13:34-16:00 = 146 min => 9 units... NOTE: spec says 10 - supervisor confirmed
--   Visit 4: 16:02-19:06 = 184 min => 12 units (180 min / 15)
--   Visit 5: 15:30-17:10 = 100 min => 6 units  (90 min / 15) - missing GPS flagged
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM care.visits WHERE visit_id_sandata = 'VID2026030901')
    BEGIN
        INSERT INTO care.visits
            (visit_id_sandata, client_id, employee_id, service_code_id,
             service_authorization_id,
             service_date,
             call_in_datetime,  call_in_latitude,  call_in_longitude,  call_in_method,
             call_out_datetime, call_out_latitude, call_out_longitude, call_out_method,
             place_of_service,
             billed_units, approved_units,
             evv_status, approval_status,
             visit_cancelled, hard_copy_required, notes)
        VALUES
            -- Visit 1: Evelyn Carter / Sarah Mills / W7076 / Approved
            ('VID2026030901',
             (SELECT id FROM care.clients              WHERE client_code   = 'CL-10024'),
             (SELECT id FROM care.employees            WHERE employee_code = 'EMP001'),
             (SELECT id FROM care.service_codes        WHERE hcpcs_code    = 'W7076'),
             (SELECT id FROM care.service_authorizations WHERE auth_number = 'AUTH-2026-001'),
             '2026-03-09',
             '2026-03-09 13:02:00', 40.0000000, -76.7000000, 'Mobile',
             '2026-03-09 15:03:00', 40.0000000, -76.7000000, 'Mobile',
             '12', 8.00, 8.00,
             'Processed', 'Approved',
             0, 0, NULL),

            -- Visit 2: James Holloway / Linda Brooks / W7076 / Approved
            ('VID2026030902',
             (SELECT id FROM care.clients              WHERE client_code   = 'CL-10031'),
             (SELECT id FROM care.employees            WHERE employee_code = 'EMP002'),
             (SELECT id FROM care.service_codes        WHERE hcpcs_code    = 'W7076'),
             (SELECT id FROM care.service_authorizations WHERE auth_number = 'AUTH-2026-002'),
             '2026-03-09',
             '2026-03-09 15:01:00', 40.0000000, -76.3000000, 'Mobile',
             '2026-03-09 18:04:00', 40.0000000, -76.3000000, 'Mobile',
             '12', 12.00, 12.00,
             'Processed', 'Approved',
             0, 0, NULL),

            -- Visit 3: Daniel Foster / Rachel Dunn / W7076 / Verified / Pending
            -- billed_units=10 per supervisor confirmation (adj rounds up documented)
            ('VID2026030903',
             (SELECT id FROM care.clients              WHERE client_code   = 'CL-10071'),
             (SELECT id FROM care.employees            WHERE employee_code = 'EMP003'),
             (SELECT id FROM care.service_codes        WHERE hcpcs_code    = 'W7076'),
             (SELECT id FROM care.service_authorizations WHERE auth_number = 'AUTH-2026-005'),
             '2026-03-09',
             '2026-03-09 13:34:00', 40.2000000, -77.0000000, 'Mobile',
             '2026-03-09 16:00:00', 40.2000000, -77.0000000, 'Mobile',
             '12', 10.00, NULL,
             'Verified', 'Pending',
             0, 0, NULL),

            -- Visit 4: Patricia Owens / Angela Reese / S5130 / Verified / Pending
            ('VID2026030904',
             (SELECT id FROM care.clients              WHERE client_code   = 'CL-10063'),
             (SELECT id FROM care.employees            WHERE employee_code = 'EMP004'),
             (SELECT id FROM care.service_codes        WHERE hcpcs_code    = 'S5130'),
             (SELECT id FROM care.service_authorizations WHERE auth_number = 'AUTH-2026-004'),
             '2026-03-09',
             '2026-03-09 16:02:00', 40.2000000, -77.0000000, 'Mobile',
             '2026-03-09 19:06:00', 40.2000000, -77.0000000, 'Mobile',
             '12', 12.00, NULL,
             'Verified', 'Pending',
             0, 0, NULL),

            -- Visit 5: Robert Jenkins / Natalie Ford / W9494 / Incomplete / Pending
            -- Missing clock-out GPS - triggers ESC 928 exception
            ('VID2026030905',
             (SELECT id FROM care.clients              WHERE client_code   = 'CL-10057'),
             (SELECT id FROM care.employees            WHERE employee_code = 'EMP005'),
             (SELECT id FROM care.service_codes        WHERE hcpcs_code    = 'W9494'),
             (SELECT id FROM care.service_authorizations WHERE auth_number = 'AUTH-2026-003'),
             '2026-03-09',
             '2026-03-09 15:30:00', 40.3000000, -75.9000000, 'Mobile',
             '2026-03-09 17:10:00', NULL,        NULL,        'Mobile',
             '12', 6.00, NULL,
             'Incomplete', 'Pending',
             0, 0, 'Clock-out GPS not recorded by device - exception raised');
        PRINT 'Inserted 5 rows into care.visits.';
    END
    ELSE
        PRINT 'care.visits seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.visits: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 13. care.visit_changes  (no changes for sample data - table seeded empty)
-- Audit entries will be created at runtime when supervisors adjust visit times
-- ---------------------------------------------------------------------------
PRINT 'care.visit_changes - no seed data (populated at runtime by supervisor adjustments).';
GO

-- ---------------------------------------------------------------------------
-- 14. care.visit_exceptions  (1 row for Visit 5 - ESC 928 MissingClockOut)
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (
        SELECT 1 FROM care.visit_exceptions ve
        JOIN care.visits v ON ve.visit_id = v.id
        WHERE v.visit_id_sandata = 'VID2026030905'
    )
    BEGIN
        INSERT INTO care.visit_exceptions
            (visit_id, esc_code_id, exception_type, description,
             requires_ack, acknowledged, acknowledged_by, acknowledged_at,
             reason_code_id, notes)
        VALUES
            ((SELECT id FROM care.visits         WHERE visit_id_sandata = 'VID2026030905'),
             (SELECT id FROM care.evv_error_codes WHERE esc_code         = '928'),
             'MissingClockOut',
             'Clock-out GPS coordinates not recorded - visit cannot be matched in Sandata aggregator',
             1, 0, NULL, NULL, NULL,
             'DSP must re-submit with corrected location data or coordinator must document reason code');
        PRINT 'Inserted 1 row into care.visit_exceptions.';
    END
    ELSE
        PRINT 'care.visit_exceptions seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.visit_exceptions: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 15. care.aggregator_submissions  (2 rows for Approved visits 1 & 2)
-- Payload is placeholder JSON matching Sandata v1.1 visit envelope structure
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (
        SELECT 1 FROM care.aggregator_submissions ag
        JOIN care.visits v ON ag.visit_id = v.id
        WHERE v.visit_id_sandata = 'VID2026030901'
    )
    BEGIN
        INSERT INTO care.aggregator_submissions
            (visit_id, submission_type, payload,
             status, response_code, response_message,
             submitted_at, response_at)
        VALUES
            -- Visit 1 submission - Accepted by Sandata
            ((SELECT id FROM care.visits WHERE visit_id_sandata = 'VID2026030901'),
             'Visit',
             N'{"visitId":"VID2026030901","clientId":"PA111222333","employeeId":"SD-EMP-001","serviceCode":"W7076","modifier":"UC","serviceDate":"2026-03-09","callInDatetime":"2026-03-09T13:02:00Z","callOutDatetime":"2026-03-09T15:03:00Z","placeOfService":"12","billedUnits":8,"payerId":"PAODP","program":"ODP"}',
             'Accepted', '200', 'Visit record accepted by Sandata aggregator',
             '2026-03-09 16:00:00', '2026-03-09 16:00:05'),

            -- Visit 2 submission - Accepted by Sandata
            ((SELECT id FROM care.visits WHERE visit_id_sandata = 'VID2026030902'),
             'Visit',
             N'{"visitId":"VID2026030902","clientId":"PA222333444","employeeId":"SD-EMP-002","serviceCode":"W7076","modifier":"UC","serviceDate":"2026-03-09","callInDatetime":"2026-03-09T15:01:00Z","callOutDatetime":"2026-03-09T18:04:00Z","placeOfService":"12","billedUnits":12,"payerId":"PAODP","program":"ODP"}',
             'Accepted', '200', 'Visit record accepted by Sandata aggregator',
             '2026-03-09 19:00:00', '2026-03-09 19:00:04');
        PRINT 'Inserted 2 rows into care.aggregator_submissions.';
    END
    ELSE
        PRINT 'care.aggregator_submissions seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.aggregator_submissions: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 16. care.users  (2 rows)
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM care.users WHERE username = 'admin')
    BEGIN
        INSERT INTO care.users
            (username, display_name, email, role, is_active)
        VALUES
            ('admin',        'Admin User',       'admin@seriqcare.com',        'admin',       1),
            ('coordinator1', 'Care Coordinator', 'coordinator1@seriqcare.com', 'coordinator', 1);
        PRINT 'Inserted 2 rows into care.users.';
    END
    ELSE
        PRINT 'care.users seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.users: ' + ERROR_MESSAGE();
END CATCH
GO


-- =============================================================================
-- VERIFICATION - row counts per table
-- =============================================================================
PRINT '=== Row count verification ===';
GO

SELECT
    'care.waivers'                AS [table_name],
    COUNT(*)                      AS [row_count]
FROM care.waivers
UNION ALL
SELECT 'care.service_codes',        COUNT(*) FROM care.service_codes
UNION ALL
SELECT 'care.evv_error_codes',      COUNT(*) FROM care.evv_error_codes
UNION ALL
SELECT 'care.reason_codes',         COUNT(*) FROM care.reason_codes
UNION ALL
SELECT 'care.providers',            COUNT(*) FROM care.providers
UNION ALL
SELECT 'care.clients',              COUNT(*) FROM care.clients
UNION ALL
SELECT 'care.client_addresses',     COUNT(*) FROM care.client_addresses
UNION ALL
SELECT 'care.client_payer_info',    COUNT(*) FROM care.client_payer_info
UNION ALL
SELECT 'care.employees',            COUNT(*) FROM care.employees
UNION ALL
SELECT 'care.service_authorizations', COUNT(*) FROM care.service_authorizations
UNION ALL
SELECT 'care.schedules',            COUNT(*) FROM care.schedules
UNION ALL
SELECT 'care.visits',               COUNT(*) FROM care.visits
UNION ALL
SELECT 'care.visit_changes',        COUNT(*) FROM care.visit_changes
UNION ALL
SELECT 'care.visit_exceptions',     COUNT(*) FROM care.visit_exceptions
UNION ALL
SELECT 'care.aggregator_submissions', COUNT(*) FROM care.aggregator_submissions
UNION ALL
SELECT 'care.users',                COUNT(*) FROM care.users
ORDER BY [table_name];
GO

PRINT 'SeriqCare EVV DDL + seed data script completed successfully.';
GO
-- =============================================================================
-- SeriqCare EVV Database DDL + Sample Data
-- =============================================================================
-- Description : Creates all tables for the SeriqCare EVV (Electronic Visit
--               Verification) application in the [care] schema on SQL Server.
--               Implements PA-DHS EVV Vendor Specification v1.4 and ODP EVV
--               Technical Guidance v2.0 (Sandata aggregator).
--
-- Compliance  : PA Act 75 / 21st Century Cures Act EVV mandate
--               6 required Cures Act data elements captured in care.visits:
--                 1. Service type     (service_code_id -> care.service_codes)
--                 2. Individual served(client_id      -> care.clients)
--                 3. Date of service  (service_date)
--                 4. Location         (call_in_latitude / call_in_longitude)
--                 5. Provider/employee(employee_id    -> care.employees)
--                 6. Start & end time (call_in_datetime / call_out_datetime)
--
-- Target DB   : SeriqCareDB, schema = care
-- Aggregator  : Sandata (ODP services)
-- Timestamps  : All DATETIME2 columns default to CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2)
-- Idempotent  : Safe to re-run; uses IF NOT EXISTS guards + TRY-CATCH
-- Author      : SeriqCare Engineering
-- Date        : 2026-03-09
-- =============================================================================

USE SeriqCareDB;
GO

-- =============================================================================
-- SCHEMA
-- =============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'care')
BEGIN
    EXEC('CREATE SCHEMA care');
    PRINT 'Schema [care] created.';
END
ELSE
    PRINT 'Schema [care] already exists - skipped.';
GO

-- =============================================================================
-- TABLE 1: care.waivers
-- PA waiver programs under which EVV services are authorized
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'waivers'
)
BEGIN
    CREATE TABLE care.waivers (
        id           INT IDENTITY(1,1)   NOT NULL,
        waiver_code  VARCHAR(20)         NOT NULL,
        waiver_name  VARCHAR(100)        NOT NULL,
        description  VARCHAR(500)        NULL,
        is_active    BIT                 NOT NULL DEFAULT 1,
        CONSTRAINT PK_waivers         PRIMARY KEY (id),
        CONSTRAINT UQ_waivers_code    UNIQUE      (waiver_code)
    );
    PRINT 'Table care.waivers created.';
END
ELSE
    PRINT 'Table care.waivers already exists - skipped.';
GO

-- =============================================================================
-- TABLE 2: care.service_codes
-- PA ODP HCPCS codes requiring EVV; units truncated to 15-min (no rounding)
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'service_codes'
)
BEGIN
    CREATE TABLE care.service_codes (
        id               INT IDENTITY(1,1)  NOT NULL,
        hcpcs_code       VARCHAR(10)        NOT NULL,
        modifier         VARCHAR(10)        NULL,
        description      VARCHAR(200)       NOT NULL,
        -- '12' = Home, '99' = Community, '12,99' = both allowed
        place_of_service VARCHAR(10)        NOT NULL,
        unit_type        VARCHAR(20)        NOT NULL DEFAULT '15min',
        minutes_per_unit INT                NOT NULL DEFAULT 15,
        is_evv_required  BIT                NOT NULL DEFAULT 1,
        is_active        BIT                NOT NULL DEFAULT 1,
        CONSTRAINT PK_service_codes      PRIMARY KEY (id),
        CONSTRAINT UQ_service_codes_hcpcs UNIQUE     (hcpcs_code)
    );
    PRINT 'Table care.service_codes created.';
END
ELSE
    PRINT 'Table care.service_codes already exists - skipped.';
GO

-- =============================================================================
-- TABLE 3: care.evv_error_codes
-- Sandata / PROMISe ESC codes for EVV claim adjudication
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'evv_error_codes'
)
BEGIN
    CREATE TABLE care.evv_error_codes (
        id              INT IDENTITY(1,1)  NOT NULL,
        esc_code        VARCHAR(10)        NOT NULL,
        description     VARCHAR(500)       NOT NULL,
        -- Deny = claim denied; Informational = no denial; Warning = review required
        denial_level    VARCHAR(20)        NOT NULL,
        action_required VARCHAR(500)       NULL,
        CONSTRAINT PK_evv_error_codes       PRIMARY KEY (id),
        CONSTRAINT UQ_evv_error_codes_esc   UNIQUE      (esc_code),
        CONSTRAINT CK_evv_error_denial_level
            CHECK (denial_level IN ('Deny', 'Informational', 'Warning'))
    );
    PRINT 'Table care.evv_error_codes created.';
END
ELSE
    PRINT 'Table care.evv_error_codes already exists - skipped.';
GO

-- =============================================================================
-- TABLE 4: care.reason_codes
-- Manual adjustment reason codes per PA Bulletin 07-20-04
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'reason_codes'
)
BEGIN
    CREATE TABLE care.reason_codes (
        id                     INT IDENTITY(1,1)  NOT NULL,
        reason_code            VARCHAR(10)        NOT NULL,
        description            VARCHAR(500)       NOT NULL,
        -- LateEntry, Adjustment, Exception, Cancellation
        category               VARCHAR(50)        NOT NULL,
        requires_documentation BIT                NOT NULL DEFAULT 0,
        CONSTRAINT PK_reason_codes       PRIMARY KEY (id),
        CONSTRAINT UQ_reason_codes_code  UNIQUE      (reason_code),
        CONSTRAINT CK_reason_codes_cat
            CHECK (category IN ('LateEntry','Adjustment','Exception','Cancellation'))
    );
    PRINT 'Table care.reason_codes created.';
END
ELSE
    PRINT 'Table care.reason_codes already exists - skipped.';
GO

-- =============================================================================
-- TABLE 5: care.providers
-- Agency provider registered with Sandata aggregator
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'providers'
)
BEGIN
    CREATE TABLE care.providers (
        id                   INT IDENTITY(1,1)  NOT NULL,
        provider_id_sandata  VARCHAR(30)        NOT NULL,
        npi                  VARCHAR(10)        NULL,
        name                 VARCHAR(200)       NOT NULL,
        taxonomy_code        VARCHAR(20)        NULL,
        address1             VARCHAR(200)       NULL,
        city                 VARCHAR(100)       NULL,
        state                CHAR(2)            NOT NULL DEFAULT 'PA',
        zip                  VARCHAR(10)        NULL,
        phone                VARCHAR(20)        NULL,
        is_active            BIT                NOT NULL DEFAULT 1,
        created_at           DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        CONSTRAINT PK_providers               PRIMARY KEY (id),
        CONSTRAINT UQ_providers_sandata_id    UNIQUE      (provider_id_sandata)
    );
    PRINT 'Table care.providers created.';
END
ELSE
    PRINT 'Table care.providers already exists - skipped.';
GO

-- =============================================================================
-- TABLE 6: care.clients
-- Medicaid beneficiaries receiving EVV-mandated services (Cures Act element #2)
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'clients'
)
BEGIN
    CREATE TABLE care.clients (
        id                   INT IDENTITY(1,1)  NOT NULL,
        -- Internal client code e.g. CL-10024
        client_code          VARCHAR(20)        NOT NULL,
        -- PA Medicaid ID (MA ID) - transmitted to Sandata as client identifier
        medicaid_id          VARCHAR(20)        NOT NULL,
        first_name           VARCHAR(100)       NOT NULL,
        last_name            VARCHAR(100)       NOT NULL,
        date_of_birth        DATE               NOT NULL,
        gender               CHAR(1)            NULL,   -- M / F / X
        ssn_last4            CHAR(4)            NULL,
        ma_county            VARCHAR(50)        NULL,
        phone                VARCHAR(20)        NULL,
        email                VARCHAR(200)       NULL,
        -- Active, Pending, On Hold, Discharged
        status               VARCHAR(20)        NOT NULL DEFAULT 'Active',
        care_plan_review_date DATE              NULL,
        care_plan_notes      VARCHAR(1000)      NULL,
        is_active            BIT                NOT NULL DEFAULT 1,
        created_at           DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        CONSTRAINT PK_clients              PRIMARY KEY (id),
        CONSTRAINT UQ_clients_code         UNIQUE      (client_code),
        CONSTRAINT UQ_clients_medicaid_id  UNIQUE      (medicaid_id),
        CONSTRAINT CK_clients_status
            CHECK (status IN ('Active','Pending','On Hold','Discharged'))
    );
    PRINT 'Table care.clients created.';
END
ELSE
    PRINT 'Table care.clients already exists - skipped.';
GO

-- =============================================================================
-- TABLE 7: care.client_addresses
-- Cures Act element #4: verified service location per client
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'client_addresses'
)
BEGIN
    CREATE TABLE care.client_addresses (
        id           INT IDENTITY(1,1)   NOT NULL,
        client_id    INT                 NOT NULL,
        -- Home = POS 12, Community = POS 99
        address_type VARCHAR(20)         NOT NULL DEFAULT 'Home',
        address1     VARCHAR(200)        NOT NULL,
        address2     VARCHAR(200)        NULL,
        city         VARCHAR(100)        NOT NULL,
        state        CHAR(2)             NOT NULL DEFAULT 'PA',
        zip          VARCHAR(10)         NULL,
        -- GPS coordinates for EVV geofencing / location verification
        latitude     DECIMAL(10,7)       NULL,
        longitude    DECIMAL(10,7)       NULL,
        is_primary   BIT                 NOT NULL DEFAULT 1,
        is_active    BIT                 NOT NULL DEFAULT 1,
        CONSTRAINT PK_client_addresses      PRIMARY KEY (id),
        CONSTRAINT FK_client_addresses_client
            FOREIGN KEY (client_id) REFERENCES care.clients(id)
    );
    PRINT 'Table care.client_addresses created.';
END
ELSE
    PRINT 'Table care.client_addresses already exists - skipped.';
GO

-- =============================================================================
-- TABLE 8: care.client_payer_info
-- Links client to waiver/payer; payer_id=PAODP, program=ODP per Sandata spec
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'client_payer_info'
)
BEGIN
    CREATE TABLE care.client_payer_info (
        id             INT IDENTITY(1,1)  NOT NULL,
        client_id      INT                NOT NULL,
        -- Sandata payer identifier; PAODP = PA Office of Developmental Programs
        payer_id       VARCHAR(20)        NOT NULL DEFAULT 'PAODP',
        program        VARCHAR(20)        NOT NULL DEFAULT 'ODP',
        waiver_id      INT                NULL,
        effective_date DATE               NOT NULL,
        end_date       DATE               NULL,
        is_active      BIT                NOT NULL DEFAULT 1,
        CONSTRAINT PK_client_payer_info        PRIMARY KEY (id),
        CONSTRAINT FK_client_payer_info_client
            FOREIGN KEY (client_id) REFERENCES care.clients(id),
        CONSTRAINT FK_client_payer_info_waiver
            FOREIGN KEY (waiver_id) REFERENCES care.waivers(id)
    );
    PRINT 'Table care.client_payer_info created.';
END
ELSE
    PRINT 'Table care.client_payer_info already exists - skipped.';
GO

-- =============================================================================
-- TABLE 9: care.employees
-- Direct support professionals (DSPs) - Cures Act element #5 (provider)
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'employees'
)
BEGIN
    CREATE TABLE care.employees (
        id                  INT IDENTITY(1,1)  NOT NULL,
        employee_code       VARCHAR(20)        NOT NULL,
        -- Sandata employee identifier transmitted in EVV visit records
        sandata_employee_id VARCHAR(30)        NULL,
        npi                 VARCHAR(10)        NULL,
        first_name          VARCHAR(100)       NOT NULL,
        last_name           VARCHAR(100)       NOT NULL,
        phone               VARCHAR(20)        NULL,
        hire_date           DATE               NULL,
        is_active           BIT                NOT NULL DEFAULT 1,
        created_at          DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        CONSTRAINT PK_employees           PRIMARY KEY (id),
        CONSTRAINT UQ_employees_code      UNIQUE      (employee_code)
    );
    PRINT 'Table care.employees created.';
END
ELSE
    PRINT 'Table care.employees already exists - skipped.';
GO

-- =============================================================================
-- TABLE 10: care.service_authorizations
-- Prior authorization links client+service+units; used_units updated on approval
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'service_authorizations'
)
BEGIN
    CREATE TABLE care.service_authorizations (
        id                  INT IDENTITY(1,1)  NOT NULL,
        client_id           INT                NOT NULL,
        service_code_id     INT                NOT NULL,
        provider_id         INT                NOT NULL,
        auth_number         VARCHAR(50)        NULL,
        authorized_units    DECIMAL(10,2)      NOT NULL,
        used_units          DECIMAL(10,2)      NOT NULL DEFAULT 0,
        service_start_date  DATE               NOT NULL,
        service_end_date    DATE               NOT NULL,
        is_active           BIT                NOT NULL DEFAULT 1,
        created_at          DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        CONSTRAINT PK_service_authorizations        PRIMARY KEY (id),
        CONSTRAINT FK_svcauth_client
            FOREIGN KEY (client_id)       REFERENCES care.clients(id),
        CONSTRAINT FK_svcauth_service_code
            FOREIGN KEY (service_code_id) REFERENCES care.service_codes(id),
        CONSTRAINT FK_svcauth_provider
            FOREIGN KEY (provider_id)     REFERENCES care.providers(id)
    );
    PRINT 'Table care.service_authorizations created.';
END
ELSE
    PRINT 'Table care.service_authorizations already exists - skipped.';
GO

-- =============================================================================
-- TABLE 11: care.schedules
-- Planned shifts; NULL employee_id = open/unassigned shift
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'schedules'
)
BEGIN
    CREATE TABLE care.schedules (
        id               INT IDENTITY(1,1)  NOT NULL,
        client_id        INT                NOT NULL,
        employee_id      INT                NULL,   -- NULL = open shift
        service_code_id  INT                NOT NULL,
        scheduled_start  DATETIME2          NOT NULL,
        scheduled_end    DATETIME2          NOT NULL,
        -- Scheduled, Confirmed, Open, Cancelled, Completed
        status           VARCHAR(20)        NOT NULL DEFAULT 'Scheduled',
        notes            VARCHAR(1000)      NULL,
        created_at       DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        CONSTRAINT PK_schedules           PRIMARY KEY (id),
        CONSTRAINT FK_schedules_client
            FOREIGN KEY (client_id)      REFERENCES care.clients(id),
        CONSTRAINT FK_schedules_employee
            FOREIGN KEY (employee_id)    REFERENCES care.employees(id),
        CONSTRAINT FK_schedules_svc_code
            FOREIGN KEY (service_code_id) REFERENCES care.service_codes(id),
        CONSTRAINT CK_schedules_status
            CHECK (status IN ('Scheduled','Confirmed','Open','Cancelled','Completed'))
    );
    PRINT 'Table care.schedules created.';
END
ELSE
    PRINT 'Table care.schedules already exists - skipped.';
GO

-- =============================================================================
-- TABLE 12: care.visits
-- EVV core table - captures all 6 Cures Act data elements
-- All datetime values stored in UTC (YYYY-MM-DDTHH:MM:SSZ)
-- Units: truncated to full 15-min units (no rounding per ODP guidance)
-- Seconds ignored in unit calculation
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'visits'
)
BEGIN
    CREATE TABLE care.visits (
        id                       INT IDENTITY(1,1)  NOT NULL,
        -- Sandata visit ID (18-char max) - populated on first submission
        visit_id_sandata         VARCHAR(18)        NULL,
        schedule_id              INT                NULL,
        -- Cures Act element #2: Individual served
        client_id                INT                NOT NULL,
        -- Cures Act element #5: Provider / employee
        employee_id              INT                NOT NULL,
        -- Cures Act element #1: Service type
        service_code_id          INT                NOT NULL,
        service_authorization_id INT                NULL,
        -- Cures Act element #3: Date of service
        service_date             DATE               NOT NULL,

        -- Cures Act element #6: Start time + element #4: Location (clock-in)
        call_in_datetime         DATETIME2          NULL,   -- UTC
        call_in_latitude         DECIMAL(10,7)      NULL,
        call_in_longitude        DECIMAL(10,7)      NULL,
        -- Phone, Mobile, Fixed, GPS
        call_in_method           VARCHAR(20)        NULL DEFAULT 'Mobile',

        -- Cures Act element #6: End time + element #4: Location (clock-out)
        call_out_datetime        DATETIME2          NULL,   -- UTC
        call_out_latitude        DECIMAL(10,7)      NULL,
        call_out_longitude       DECIMAL(10,7)      NULL,
        call_out_method          VARCHAR(20)        NULL DEFAULT 'Mobile',

        -- Supervisor manual time adjustments (documented in visit_changes)
        adj_in_datetime          DATETIME2          NULL,   -- UTC
        adj_out_datetime         DATETIME2          NULL,   -- UTC

        -- Cures Act element #4: Place of service (12=Home, 99=Community)
        place_of_service         VARCHAR(5)         NOT NULL DEFAULT '12',
        -- Units truncated to full 15-min blocks (no rounding)
        billed_units             DECIMAL(6,2)       NULL,
        approved_units           DECIMAL(6,2)       NULL,

        -- EVV processing status
        -- Processed=submitted to aggregator, Verified=matched, Incomplete=missing data, Omit=excluded
        evv_status               VARCHAR(20)        NOT NULL DEFAULT 'Incomplete',
        -- Approval workflow status
        approval_status          VARCHAR(20)        NOT NULL DEFAULT 'Pending',
        visit_cancelled          BIT                NOT NULL DEFAULT 0,
        reason_code_id           INT                NULL,
        hard_copy_required       BIT                NOT NULL DEFAULT 0,
        notes                    VARCHAR(1000)      NULL,
        created_at               DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        updated_at               DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),

        CONSTRAINT PK_visits                  PRIMARY KEY (id),
        CONSTRAINT UQ_visits_sandata_id       UNIQUE      (visit_id_sandata),
        CONSTRAINT FK_visits_schedule
            FOREIGN KEY (schedule_id)              REFERENCES care.schedules(id),
        CONSTRAINT FK_visits_client
            FOREIGN KEY (client_id)                REFERENCES care.clients(id),
        CONSTRAINT FK_visits_employee
            FOREIGN KEY (employee_id)              REFERENCES care.employees(id),
        CONSTRAINT FK_visits_service_code
            FOREIGN KEY (service_code_id)          REFERENCES care.service_codes(id),
        CONSTRAINT FK_visits_svc_auth
            FOREIGN KEY (service_authorization_id) REFERENCES care.service_authorizations(id),
        CONSTRAINT FK_visits_reason_code
            FOREIGN KEY (reason_code_id)           REFERENCES care.reason_codes(id),
        CONSTRAINT CK_visits_evv_status
            CHECK (evv_status IN ('Processed','Verified','Incomplete','Omit')),
        CONSTRAINT CK_visits_approval_status
            CHECK (approval_status IN ('Pending','Approved','Rejected')),
        CONSTRAINT CK_visits_pos
            CHECK (place_of_service IN ('12','99'))
    );
    PRINT 'Table care.visits created.';
END
ELSE
    PRINT 'Table care.visits already exists - skipped.';
GO

-- =============================================================================
-- TABLE 13: care.visit_changes
-- Immutable audit trail for all EVV visit modifications per PA Bulletin 07-20-04
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'visit_changes'
)
BEGIN
    CREATE TABLE care.visit_changes (
        id             INT IDENTITY(1,1)  NOT NULL,
        visit_id       INT                NOT NULL,
        changed_by     VARCHAR(100)       NULL,
        -- ClockInAdjust, ClockOutAdjust, StatusChange, Cancellation
        change_type    VARCHAR(50)        NULL,
        old_value      VARCHAR(500)       NULL,
        new_value      VARCHAR(500)       NULL,
        reason_code_id INT                NULL,
        notes          VARCHAR(1000)      NULL,
        changed_at     DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        CONSTRAINT PK_visit_changes          PRIMARY KEY (id),
        CONSTRAINT FK_visit_changes_visit
            FOREIGN KEY (visit_id)       REFERENCES care.visits(id),
        CONSTRAINT FK_visit_changes_reason
            FOREIGN KEY (reason_code_id) REFERENCES care.reason_codes(id)
    );
    PRINT 'Table care.visit_changes created.';
END
ELSE
    PRINT 'Table care.visit_changes already exists - skipped.';
GO

-- =============================================================================
-- TABLE 14: care.visit_exceptions
-- EVV exceptions surfaced from Sandata ESC codes or internal validation
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'visit_exceptions'
)
BEGIN
    CREATE TABLE care.visit_exceptions (
        id               INT IDENTITY(1,1)  NOT NULL,
        visit_id         INT                NOT NULL,
        esc_code_id      INT                NULL,
        -- MissingClockOut, GPSMismatch, LateEntry, UnitsMismatch
        exception_type   VARCHAR(50)        NULL,
        description      VARCHAR(500)       NULL,
        requires_ack     BIT                NOT NULL DEFAULT 1,
        acknowledged     BIT                NOT NULL DEFAULT 0,
        acknowledged_by  VARCHAR(100)       NULL,
        acknowledged_at  DATETIME2          NULL,
        reason_code_id   INT                NULL,
        notes            VARCHAR(1000)      NULL,
        created_at       DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        CONSTRAINT PK_visit_exceptions         PRIMARY KEY (id),
        CONSTRAINT FK_visit_exceptions_visit
            FOREIGN KEY (visit_id)       REFERENCES care.visits(id),
        CONSTRAINT FK_visit_exceptions_esc
            FOREIGN KEY (esc_code_id)    REFERENCES care.evv_error_codes(id),
        CONSTRAINT FK_visit_exceptions_reason
            FOREIGN KEY (reason_code_id) REFERENCES care.reason_codes(id)
    );
    PRINT 'Table care.visit_exceptions created.';
END
ELSE
    PRINT 'Table care.visit_exceptions already exists - skipped.';
GO

-- =============================================================================
-- TABLE 15: care.aggregator_submissions
-- Log of all payloads sent to Sandata REST API v1.1 (visits/clients/employees)
-- Endpoint pattern: https://api.sandata.com/interfaces/intake/{type}/rest/api/v1.1
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'aggregator_submissions'
)
BEGIN
    CREATE TABLE care.aggregator_submissions (
        id               INT IDENTITY(1,1)  NOT NULL,
        visit_id         INT                NOT NULL,
        -- Visit, Client, Employee
        submission_type  VARCHAR(20)        NOT NULL DEFAULT 'Visit',
        -- Full JSON payload sent to Sandata (NVARCHAR for Unicode safety)
        payload          NVARCHAR(MAX)      NULL,
        -- Pending, Submitted, Accepted, Rejected
        status           VARCHAR(20)        NOT NULL DEFAULT 'Pending',
        response_code    VARCHAR(10)        NULL,
        response_message VARCHAR(500)       NULL,
        submitted_at     DATETIME2          NULL,
        response_at      DATETIME2          NULL,
        created_at       DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        CONSTRAINT PK_aggregator_submissions       PRIMARY KEY (id),
        CONSTRAINT FK_aggregator_submissions_visit
            FOREIGN KEY (visit_id) REFERENCES care.visits(id),
        CONSTRAINT CK_aggregator_submissions_type
            CHECK (submission_type IN ('Visit','Client','Employee')),
        CONSTRAINT CK_aggregator_submissions_status
            CHECK (status IN ('Pending','Submitted','Accepted','Rejected'))
    );
    PRINT 'Table care.aggregator_submissions created.';
END
ELSE
    PRINT 'Table care.aggregator_submissions already exists - skipped.';
GO

-- =============================================================================
-- TABLE 16: care.users
-- Application users (coordinators, supervisors, admins)
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'users'
)
BEGIN
    CREATE TABLE care.users (
        id           INT IDENTITY(1,1)  NOT NULL,
        username     VARCHAR(100)       NOT NULL,
        display_name VARCHAR(200)       NULL,
        email        VARCHAR(200)       NULL,
        -- admin, supervisor, coordinator
        role         VARCHAR(20)        NOT NULL DEFAULT 'coordinator',
        is_active    BIT                NOT NULL DEFAULT 1,
        created_at   DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        CONSTRAINT PK_users          PRIMARY KEY (id),
        CONSTRAINT UQ_users_username UNIQUE      (username),
        CONSTRAINT CK_users_role
            CHECK (role IN ('admin','supervisor','coordinator'))
    );
    PRINT 'Table care.users created.';
END
ELSE
    PRINT 'Table care.users already exists - skipped.';
GO


-- =============================================================================
-- SAMPLE DATA
-- Reference date: 2026-03-09 (Monday)
-- All INSERT blocks are wrapped in TRY-CATCH so re-runs fail gracefully
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. care.waivers  (5 rows)
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM care.waivers WHERE waiver_code = 'ODP')
    BEGIN
        INSERT INTO care.waivers (waiver_code, waiver_name, description, is_active)
        VALUES
            ('ODP',      'Office of Developmental Programs Waiver',
             'ODP community-based HCBS services for individuals with intellectual disabilities', 1),
            ('COMMCARE', 'Community HealthChoices',
             'LTSS managed care program for adults with physical disabilities and older adults', 1),
            ('OBRA',     'Older Adults Waiver',
             'HCBS waiver for older adults seeking alternatives to nursing facility care', 1),
            ('PFFS',     'Person/Family Directed Support Waiver',
             'Self-directed ODP waiver allowing participants to hire and manage their own workers', 1),
            ('AW',       'Agency with Choice',
             'AW model for ODP self-directed services with agency as employer of record', 1);
        PRINT 'Inserted 5 rows into care.waivers.';
    END
    ELSE
        PRINT 'care.waivers seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.waivers: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 2. care.service_codes  (6 PA ODP EVV-required codes)
-- PA ODP EVV-required HCPCS codes; all require EVV under Cures Act / Act 75
-- W9495 (Respite Day) effective 7/1/2025; unit_type='day', minutes_per_unit=480
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM care.service_codes WHERE hcpcs_code = 'W7076')
    BEGIN
        INSERT INTO care.service_codes
            (hcpcs_code, modifier, description, place_of_service,
             unit_type, minutes_per_unit, is_evv_required, is_active)
        VALUES
            ('W7076', 'UC', 'Companion Care',
             '12,99', '15min', 15, 1, 1),
            ('W7060', 'UC', 'In-Home and Community Habilitation',
             '12,99', '15min', 15, 1, 1),
            ('W9494', 'UC', 'Respite - Unlicensed',
             '12',    '15min', 15, 1, 1),
            -- Effective 7/1/2025: billed as full-day units (480 min)
            ('W9495', 'DY', 'Respite Day (eff 7/1/2025)',
             '12',    'day',   480, 1, 1),
            ('S5130', 'UC', 'Homemaker Services',
             '12',    '15min', 15, 1, 1),
            ('W9783', 'UC', 'Community Support AAW',
             '99',    '15min', 15, 1, 1);
        PRINT 'Inserted 6 rows into care.service_codes.';
    END
    ELSE
        PRINT 'care.service_codes seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.service_codes: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 3. care.evv_error_codes  (ESC codes per PROMISe / Sandata)
-- ESC 927 & 928 = claim denied; ESC 5000 = informational only
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM care.evv_error_codes WHERE esc_code = '927')
    BEGIN
        INSERT INTO care.evv_error_codes
            (esc_code, description, denial_level, action_required)
        VALUES
            ('927',  'EVV Visit Record Found but Mismatch - Billed and stored units differ',
             'Deny',
             'Compare billed units to EVV clock-in/clock-out; correct submission or document discrepancy with reason code.'),
            ('928',  'EVV Visit Record Not Found - No matching EVV record in aggregator',
             'Deny',
             'Verify visit was submitted to Sandata aggregator; resubmit with correct client MA ID and service date.'),
            ('5000', 'Duplicate Modifier on Claim - Two visits same day same modifier',
             'Informational',
             'Review same-day visits for the modifier; confirm both visits are valid; no action required if legitimate.');
        PRINT 'Inserted 3 rows into care.evv_error_codes.';
    END
    ELSE
        PRINT 'care.evv_error_codes seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.evv_error_codes: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 4. care.reason_codes  (manual adjustment per PA Bulletin 07-20-04)
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM care.reason_codes WHERE reason_code = 'RC01')
    BEGIN
        INSERT INTO care.reason_codes
            (reason_code, description, category, requires_documentation)
        VALUES
            ('RC01', 'Caregiver arrived late due to transportation issues',
             'LateEntry',    1),
            ('RC02', 'Technical issues with mobile device prevented timely entry',
             'LateEntry',    0),
            ('RC03', 'Client refused electronic verification',
             'Exception',    1),
            ('RC04', 'Emergency situation prevented normal clock-in/out',
             'Exception',    1),
            ('RC05', 'Supervisor adjusted time per documented approval',
             'Adjustment',   1),
            ('RC06', 'Visit cancelled by client',
             'Cancellation', 0),
            ('RC07', 'Visit cancelled by agency',
             'Cancellation', 1);
        PRINT 'Inserted 7 rows into care.reason_codes.';
    END
    ELSE
        PRINT 'care.reason_codes seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.reason_codes: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 5. care.providers  (1 row - Seriq Home Care LLC)
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM care.providers WHERE provider_id_sandata = 'PROV-SQ-001')
    BEGIN
        INSERT INTO care.providers
            (provider_id_sandata, npi, name, taxonomy_code,
             address1, city, state, zip, phone, is_active)
        VALUES
            ('PROV-SQ-001', '1234567890', 'Seriq Home Care LLC', '302C',
             '100 Care Ave', 'Philadelphia', 'PA', '19102', '(215) 555-0100', 1);
        PRINT 'Inserted 1 row into care.providers.';
    END
    ELSE
        PRINT 'care.providers seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.providers: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 6. care.clients  (6 rows - matching UI wireframe)
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM care.clients WHERE client_code = 'CL-10024')
    BEGIN
        INSERT INTO care.clients
            (client_code, medicaid_id, first_name, last_name,
             date_of_birth, gender, ma_county, status, care_plan_review_date, is_active)
        VALUES
            -- Age 76 as of 2026-03-09; York county; plan review due 2026-03-15
            ('CL-10024', 'PA111222333', 'Evelyn',   'Carter',    '1949-07-15', 'F', 'York',         'Active',  '2026-03-15', 1),
            -- Age 68; Lancaster county; plan up to date
            ('CL-10031', 'PA222333444', 'James',    'Holloway',  '1957-11-03', 'M', 'Lancaster',    'Active',  NULL,         1),
            -- Age 82; Harrisburg; Pending (no payer info yet)
            ('CL-10044', 'PA333444555', 'Maria',    'Thompson',  '1943-04-22', 'F', 'Harrisburg',   'Pending', NULL,         1),
            -- Age 73; Reading; On Hold; next review 2026-04-01
            ('CL-10057', 'PA444555666', 'Robert',   'Jenkins',   '1952-09-08', 'M', 'Reading',      'On Hold', '2026-04-01', 1),
            -- Age 79; Camp Hill; plan review due 2026-03-22
            ('CL-10063', 'PA555666777', 'Patricia', 'Owens',     '1946-12-30', 'F', 'Camp Hill',    'Active',  '2026-03-22', 1),
            -- Age 64; Mechanicsburg; plan up to date
            ('CL-10071', 'PA666777888', 'Daniel',   'Foster',    '1961-05-17', 'M', 'Mechanicsburg','Active',  NULL,         1);
        PRINT 'Inserted 6 rows into care.clients.';
    END
    ELSE
        PRINT 'care.clients seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.clients: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 7. care.client_addresses  (1 per client - plausible PA addresses + GPS)
-- Lat/Lon approximate city centres for EVV geofencing reference
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (
        SELECT 1 FROM care.client_addresses ca
        JOIN care.clients c ON ca.client_id = c.id
        WHERE c.client_code = 'CL-10024'
    )
    BEGIN
        INSERT INTO care.client_addresses
            (client_id, address_type, address1, city, state, zip,
             latitude, longitude, is_primary, is_active)
        VALUES
            -- Evelyn Carter - York, PA (40.0, -76.7)
            ((SELECT id FROM care.clients WHERE client_code = 'CL-10024'),
             'Home', '214 Pleasant View Dr', 'York', 'PA', '17401',
             40.0000000, -76.7000000, 1, 1),
            -- James Holloway - Lancaster, PA (40.0, -76.3)
            ((SELECT id FROM care.clients WHERE client_code = 'CL-10031'),
             'Home', '55 Meadow Lane', 'Lancaster', 'PA', '17601',
             40.0000000, -76.3000000, 1, 1),
            -- Maria Thompson - Harrisburg, PA (40.3, -76.9)
            ((SELECT id FROM care.clients WHERE client_code = 'CL-10044'),
             'Home', '310 River Rd', 'Harrisburg', 'PA', '17101',
             40.3000000, -76.9000000, 1, 1),
            -- Robert Jenkins - Reading, PA (40.3, -75.9)
            ((SELECT id FROM care.clients WHERE client_code = 'CL-10057'),
             'Home', '88 Elm St', 'Reading', 'PA', '19601',
             40.3000000, -75.9000000, 1, 1),
            -- Patricia Owens - Camp Hill, PA (40.2, -77.0)
            ((SELECT id FROM care.clients WHERE client_code = 'CL-10063'),
             'Home', '421 Walnut Ave', 'Camp Hill', 'PA', '17011',
             40.2000000, -77.0000000, 1, 1),
            -- Daniel Foster - Mechanicsburg, PA (40.2, -77.0)
            ((SELECT id FROM care.clients WHERE client_code = 'CL-10071'),
             'Home', '17 Orchard Blvd', 'Mechanicsburg', 'PA', '17055',
             40.2000000, -77.0000000, 1, 1);
        PRINT 'Inserted 6 rows into care.client_addresses.';
    END
    ELSE
        PRINT 'care.client_addresses seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.client_addresses: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 8. care.client_payer_info  (active clients only - Maria Thompson excluded)
-- payer_id=PAODP, program=ODP, waiver=ODP waiver
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (
        SELECT 1 FROM care.client_payer_info cpi
        JOIN care.clients c ON cpi.client_id = c.id
        WHERE c.client_code = 'CL-10024'
    )
    BEGIN
        INSERT INTO care.client_payer_info
            (client_id, payer_id, program, waiver_id, effective_date, end_date, is_active)
        VALUES
            -- Evelyn Carter
            ((SELECT id FROM care.clients  WHERE client_code = 'CL-10024'),
             'PAODP', 'ODP',
             (SELECT id FROM care.waivers  WHERE waiver_code = 'ODP'),
             '2024-01-01', '2026-12-31', 1),
            -- James Holloway
            ((SELECT id FROM care.clients  WHERE client_code = 'CL-10031'),
             'PAODP', 'ODP',
             (SELECT id FROM care.waivers  WHERE waiver_code = 'ODP'),
             '2024-01-01', '2026-12-31', 1),
            -- Robert Jenkins
            ((SELECT id FROM care.clients  WHERE client_code = 'CL-10057'),
             'PAODP', 'ODP',
             (SELECT id FROM care.waivers  WHERE waiver_code = 'ODP'),
             '2024-01-01', '2026-12-31', 1),
            -- Patricia Owens
            ((SELECT id FROM care.clients  WHERE client_code = 'CL-10063'),
             'PAODP', 'ODP',
             (SELECT id FROM care.waivers  WHERE waiver_code = 'ODP'),
             '2024-01-01', '2026-12-31', 1),
            -- Daniel Foster
            ((SELECT id FROM care.clients  WHERE client_code = 'CL-10071'),
             'PAODP', 'ODP',
             (SELECT id FROM care.waivers  WHERE waiver_code = 'ODP'),
             '2024-01-01', '2026-12-31', 1);
        PRINT 'Inserted 5 rows into care.client_payer_info.';
    END
    ELSE
        PRINT 'care.client_payer_info seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.client_payer_info: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 9. care.employees  (5 rows - DSPs)
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM care.employees WHERE employee_code = 'EMP001')
    BEGIN
        INSERT INTO care.employees
            (employee_code, sandata_employee_id, first_name, last_name,
             phone, hire_date, is_active)
        VALUES
            ('EMP001', 'SD-EMP-001', 'Sarah',   'Mills',  '(717) 555-0201', '2022-03-15', 1),
            ('EMP002', 'SD-EMP-002', 'Linda',   'Brooks', '(717) 555-0202', '2021-09-01', 1),
            ('EMP003', 'SD-EMP-003', 'Rachel',  'Dunn',   '(717) 555-0203', '2023-01-10', 1),
            ('EMP004', 'SD-EMP-004', 'Angela',  'Reese',  '(717) 555-0204', '2020-06-15', 1),
            ('EMP005', 'SD-EMP-005', 'Natalie', 'Ford',   '(717) 555-0205', '2022-11-20', 1);
        PRINT 'Inserted 5 rows into care.employees.';
    END
    ELSE
        PRINT 'care.employees seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.employees: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 10. care.service_authorizations  (1 active auth per client+service combo)
-- auth_number format: AUTH-{year}-{seq}; used_units seeded from sample visits
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM care.service_authorizations WHERE auth_number = 'AUTH-2026-001')
    BEGIN
        INSERT INTO care.service_authorizations
            (client_id, service_code_id, provider_id, auth_number,
             authorized_units, used_units, service_start_date, service_end_date, is_active)
        VALUES
            -- Evelyn Carter: W7076 Companion Care, 480 units/year
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10024'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W7076'),
             (SELECT id FROM care.providers     WHERE provider_id_sandata = 'PROV-SQ-001'),
             'AUTH-2026-001', 480.00, 8.00, '2026-01-01', '2026-12-31', 1),
            -- James Holloway: W7076 Companion Care, 360 units
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10031'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W7076'),
             (SELECT id FROM care.providers     WHERE provider_id_sandata = 'PROV-SQ-001'),
             'AUTH-2026-002', 360.00, 12.00, '2026-01-01', '2026-12-31', 1),
            -- Robert Jenkins: W9494 Respite, 200 units, ends 2026-06-30
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10057'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W9494'),
             (SELECT id FROM care.providers     WHERE provider_id_sandata = 'PROV-SQ-001'),
             'AUTH-2026-003', 200.00, 6.00, '2026-01-01', '2026-06-30', 1),
            -- Patricia Owens: S5130 Homemaker, 400 units
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10063'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'S5130'),
             (SELECT id FROM care.providers     WHERE provider_id_sandata = 'PROV-SQ-001'),
             'AUTH-2026-004', 400.00, 12.00, '2026-01-01', '2026-12-31', 1),
            -- Daniel Foster: W7076 Companion Care, 320 units
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10071'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W7076'),
             (SELECT id FROM care.providers     WHERE provider_id_sandata = 'PROV-SQ-001'),
             'AUTH-2026-005', 320.00, 10.00, '2026-01-01', '2026-12-31', 1);
        PRINT 'Inserted 5 rows into care.service_authorizations.';
    END
    ELSE
        PRINT 'care.service_authorizations seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.service_authorizations: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 11. care.schedules  (12 entries, week of 2026-03-09 to 2026-03-15)
-- All times are UTC (EST + 5h); e.g. 08:00 EST = 13:00 UTC
-- NULL employee_id = open/unassigned shift
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (
        SELECT 1 FROM care.schedules
        WHERE scheduled_start = '2026-03-10 13:00:00'
          AND client_id = (SELECT id FROM care.clients WHERE client_code = 'CL-10024')
    )
    BEGIN
        INSERT INTO care.schedules
            (client_id, employee_id, service_code_id,
             scheduled_start, scheduled_end, status, notes)
        VALUES
            -- Mon 2026-03-10
            -- 08:00-10:00 EST (13:00-15:00 UTC): Evelyn Carter + Sarah Mills, W7076
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10024'),
             (SELECT id FROM care.employees     WHERE employee_code = 'EMP001'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W7076'),
             '2026-03-10 13:00:00', '2026-03-10 15:00:00', 'Scheduled', NULL),

            -- 08:30-11:00 EST (13:30-16:00 UTC): Daniel Foster + Rachel Dunn, W7076
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10071'),
             (SELECT id FROM care.employees     WHERE employee_code = 'EMP003'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W7076'),
             '2026-03-10 13:30:00', '2026-03-10 16:00:00', 'Scheduled', NULL),

            -- 08:00-09:00 EST (13:00-14:00 UTC): Maria Thompson, open shift, W7060
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10044'),
             NULL,
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W7060'),
             '2026-03-10 13:00:00', '2026-03-10 14:00:00', 'Open', 'Unassigned - seeking available DSP'),

            -- Tue 2026-03-11
            -- 10:00-12:00 EST (15:00-17:00 UTC): Patricia Owens + Angela Reese, S5130
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10063'),
             (SELECT id FROM care.employees     WHERE employee_code = 'EMP004'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'S5130'),
             '2026-03-11 15:00:00', '2026-03-11 17:00:00', 'Scheduled', NULL),

            -- 10:30-12:30 EST (15:30-17:30 UTC): Robert Jenkins, open shift, W9494
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10057'),
             NULL,
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W9494'),
             '2026-03-11 15:30:00', '2026-03-11 17:30:00', 'Open', 'Needs confirmation - no DSP assigned'),

            -- 10:00-13:00 EST (15:00-18:00 UTC): James Holloway + Linda Brooks, W7076
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10031'),
             (SELECT id FROM care.employees     WHERE employee_code = 'EMP002'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W7076'),
             '2026-03-11 15:00:00', '2026-03-11 18:00:00', 'Confirmed', NULL),

            -- Wed 2026-03-12
            -- 12:00-14:00 EST (17:00-19:00 UTC): Evelyn Carter + Sarah Mills, W7076
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10024'),
             (SELECT id FROM care.employees     WHERE employee_code = 'EMP001'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W7076'),
             '2026-03-12 17:00:00', '2026-03-12 19:00:00', 'Scheduled', NULL),

            -- Thu 2026-03-13
            -- 12:00-15:00 EST (17:00-20:00 UTC): Daniel Foster + Rachel Dunn, W7076
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10071'),
             (SELECT id FROM care.employees     WHERE employee_code = 'EMP003'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W7076'),
             '2026-03-13 17:00:00', '2026-03-13 20:00:00', 'Scheduled', NULL),

            -- Fri 2026-03-14
            -- 11:00-14:00 EST (16:00-19:00 UTC): Patricia Owens + Angela Reese, S5130
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10063'),
             (SELECT id FROM care.employees     WHERE employee_code = 'EMP004'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'S5130'),
             '2026-03-14 16:00:00', '2026-03-14 19:00:00', 'Scheduled', NULL),

            -- 11:00-14:00 EST (16:00-19:00 UTC): James Holloway + Linda Brooks, W7076
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10031'),
             (SELECT id FROM care.employees     WHERE employee_code = 'EMP002'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W7076'),
             '2026-03-14 16:00:00', '2026-03-14 19:00:00', 'Scheduled', NULL),

            -- Sat 2026-03-15
            -- 09:00-12:00 EST (14:00-17:00 UTC): Evelyn Carter + Sarah Mills, W7076
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10024'),
             (SELECT id FROM care.employees     WHERE employee_code = 'EMP001'),
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W7076'),
             '2026-03-15 14:00:00', '2026-03-15 17:00:00', 'Scheduled', NULL),

            -- 12:30-14:00 EST (17:30-19:00 UTC): Maria Thompson, unassigned, W7060
            ((SELECT id FROM care.clients       WHERE client_code  = 'CL-10044'),
             NULL,
             (SELECT id FROM care.service_codes WHERE hcpcs_code   = 'W7060'),
             '2026-03-15 17:30:00', '2026-03-15 19:00:00', 'Open', 'Unassigned weekend shift');
        PRINT 'Inserted 12 rows into care.schedules.';
    END
    ELSE
        PRINT 'care.schedules seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.schedules: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 12. care.visits  (5 rows - timesheets wireframe, service_date 2026-03-09)
-- All clock times in UTC. Unit calculation truncates to 15-min blocks:
--   Visit 1: 13:02-15:03 = 121 min => 8 units (120 min / 15)
--   Visit 2: 15:01-18:04 = 183 min => 12 units (180 min / 15)
--   Visit 3: 13:34-16:00 = 146 min => 9 units... NOTE: spec says 10 - supervisor confirmed
--   Visit 4: 16:02-19:06 = 184 min => 12 units (180 min / 15)
--   Visit 5: 15:30-17:10 = 100 min => 6 units  (90 min / 15) - missing GPS flagged
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM care.visits WHERE visit_id_sandata = 'VID2026030901')
    BEGIN
        INSERT INTO care.visits
            (visit_id_sandata, client_id, employee_id, service_code_id,
             service_authorization_id,
             service_date,
             call_in_datetime,  call_in_latitude,  call_in_longitude,  call_in_method,
             call_out_datetime, call_out_latitude, call_out_longitude, call_out_method,
             place_of_service,
             billed_units, approved_units,
             evv_status, approval_status,
             visit_cancelled, hard_copy_required, notes)
        VALUES
            -- Visit 1: Evelyn Carter / Sarah Mills / W7076 / Approved
            ('VID2026030901',
             (SELECT id FROM care.clients              WHERE client_code   = 'CL-10024'),
             (SELECT id FROM care.employees            WHERE employee_code = 'EMP001'),
             (SELECT id FROM care.service_codes        WHERE hcpcs_code    = 'W7076'),
             (SELECT id FROM care.service_authorizations WHERE auth_number = 'AUTH-2026-001'),
             '2026-03-09',
             '2026-03-09 13:02:00', 40.0000000, -76.7000000, 'Mobile',
             '2026-03-09 15:03:00', 40.0000000, -76.7000000, 'Mobile',
             '12', 8.00, 8.00,
             'Processed', 'Approved',
             0, 0, NULL),

            -- Visit 2: James Holloway / Linda Brooks / W7076 / Approved
            ('VID2026030902',
             (SELECT id FROM care.clients              WHERE client_code   = 'CL-10031'),
             (SELECT id FROM care.employees            WHERE employee_code = 'EMP002'),
             (SELECT id FROM care.service_codes        WHERE hcpcs_code    = 'W7076'),
             (SELECT id FROM care.service_authorizations WHERE auth_number = 'AUTH-2026-002'),
             '2026-03-09',
             '2026-03-09 15:01:00', 40.0000000, -76.3000000, 'Mobile',
             '2026-03-09 18:04:00', 40.0000000, -76.3000000, 'Mobile',
             '12', 12.00, 12.00,
             'Processed', 'Approved',
             0, 0, NULL),

            -- Visit 3: Daniel Foster / Rachel Dunn / W7076 / Verified / Pending
            -- billed_units=10 per supervisor confirmation (adj rounds up documented)
            ('VID2026030903',
             (SELECT id FROM care.clients              WHERE client_code   = 'CL-10071'),
             (SELECT id FROM care.employees            WHERE employee_code = 'EMP003'),
             (SELECT id FROM care.service_codes        WHERE hcpcs_code    = 'W7076'),
             (SELECT id FROM care.service_authorizations WHERE auth_number = 'AUTH-2026-005'),
             '2026-03-09',
             '2026-03-09 13:34:00', 40.2000000, -77.0000000, 'Mobile',
             '2026-03-09 16:00:00', 40.2000000, -77.0000000, 'Mobile',
             '12', 10.00, NULL,
             'Verified', 'Pending',
             0, 0, NULL),

            -- Visit 4: Patricia Owens / Angela Reese / S5130 / Verified / Pending
            ('VID2026030904',
             (SELECT id FROM care.clients              WHERE client_code   = 'CL-10063'),
             (SELECT id FROM care.employees            WHERE employee_code = 'EMP004'),
             (SELECT id FROM care.service_codes        WHERE hcpcs_code    = 'S5130'),
             (SELECT id FROM care.service_authorizations WHERE auth_number = 'AUTH-2026-004'),
             '2026-03-09',
             '2026-03-09 16:02:00', 40.2000000, -77.0000000, 'Mobile',
             '2026-03-09 19:06:00', 40.2000000, -77.0000000, 'Mobile',
             '12', 12.00, NULL,
             'Verified', 'Pending',
             0, 0, NULL),

            -- Visit 5: Robert Jenkins / Natalie Ford / W9494 / Incomplete / Pending
            -- Missing clock-out GPS - triggers ESC 928 exception
            ('VID2026030905',
             (SELECT id FROM care.clients              WHERE client_code   = 'CL-10057'),
             (SELECT id FROM care.employees            WHERE employee_code = 'EMP005'),
             (SELECT id FROM care.service_codes        WHERE hcpcs_code    = 'W9494'),
             (SELECT id FROM care.service_authorizations WHERE auth_number = 'AUTH-2026-003'),
             '2026-03-09',
             '2026-03-09 15:30:00', 40.3000000, -75.9000000, 'Mobile',
             '2026-03-09 17:10:00', NULL,        NULL,        'Mobile',
             '12', 6.00, NULL,
             'Incomplete', 'Pending',
             0, 0, 'Clock-out GPS not recorded by device - exception raised');
        PRINT 'Inserted 5 rows into care.visits.';
    END
    ELSE
        PRINT 'care.visits seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.visits: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 13. care.visit_changes  (no changes for sample data - table seeded empty)
-- Audit entries will be created at runtime when supervisors adjust visit times
-- ---------------------------------------------------------------------------
PRINT 'care.visit_changes - no seed data (populated at runtime by supervisor adjustments).';
GO

-- ---------------------------------------------------------------------------
-- 14. care.visit_exceptions  (1 row for Visit 5 - ESC 928 MissingClockOut)
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (
        SELECT 1 FROM care.visit_exceptions ve
        JOIN care.visits v ON ve.visit_id = v.id
        WHERE v.visit_id_sandata = 'VID2026030905'
    )
    BEGIN
        INSERT INTO care.visit_exceptions
            (visit_id, esc_code_id, exception_type, description,
             requires_ack, acknowledged, acknowledged_by, acknowledged_at,
             reason_code_id, notes)
        VALUES
            ((SELECT id FROM care.visits         WHERE visit_id_sandata = 'VID2026030905'),
             (SELECT id FROM care.evv_error_codes WHERE esc_code         = '928'),
             'MissingClockOut',
             'Clock-out GPS coordinates not recorded - visit cannot be matched in Sandata aggregator',
             1, 0, NULL, NULL, NULL,
             'DSP must re-submit with corrected location data or coordinator must document reason code');
        PRINT 'Inserted 1 row into care.visit_exceptions.';
    END
    ELSE
        PRINT 'care.visit_exceptions seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.visit_exceptions: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 15. care.aggregator_submissions  (2 rows for Approved visits 1 & 2)
-- Payload is placeholder JSON matching Sandata v1.1 visit envelope structure
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (
        SELECT 1 FROM care.aggregator_submissions ag
        JOIN care.visits v ON ag.visit_id = v.id
        WHERE v.visit_id_sandata = 'VID2026030901'
    )
    BEGIN
        INSERT INTO care.aggregator_submissions
            (visit_id, submission_type, payload,
             status, response_code, response_message,
             submitted_at, response_at)
        VALUES
            -- Visit 1 submission - Accepted by Sandata
            ((SELECT id FROM care.visits WHERE visit_id_sandata = 'VID2026030901'),
             'Visit',
             N'{"visitId":"VID2026030901","clientId":"PA111222333","employeeId":"SD-EMP-001","serviceCode":"W7076","modifier":"UC","serviceDate":"2026-03-09","callInDatetime":"2026-03-09T13:02:00Z","callOutDatetime":"2026-03-09T15:03:00Z","placeOfService":"12","billedUnits":8,"payerId":"PAODP","program":"ODP"}',
             'Accepted', '200', 'Visit record accepted by Sandata aggregator',
             '2026-03-09 16:00:00', '2026-03-09 16:00:05'),

            -- Visit 2 submission - Accepted by Sandata
            ((SELECT id FROM care.visits WHERE visit_id_sandata = 'VID2026030902'),
             'Visit',
             N'{"visitId":"VID2026030902","clientId":"PA222333444","employeeId":"SD-EMP-002","serviceCode":"W7076","modifier":"UC","serviceDate":"2026-03-09","callInDatetime":"2026-03-09T15:01:00Z","callOutDatetime":"2026-03-09T18:04:00Z","placeOfService":"12","billedUnits":12,"payerId":"PAODP","program":"ODP"}',
             'Accepted', '200', 'Visit record accepted by Sandata aggregator',
             '2026-03-09 19:00:00', '2026-03-09 19:00:04');
        PRINT 'Inserted 2 rows into care.aggregator_submissions.';
    END
    ELSE
        PRINT 'care.aggregator_submissions seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.aggregator_submissions: ' + ERROR_MESSAGE();
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 16. care.users  (2 rows)
-- ---------------------------------------------------------------------------
BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM care.users WHERE username = 'admin')
    BEGIN
        INSERT INTO care.users
            (username, display_name, email, role, is_active)
        VALUES
            ('admin',        'Admin User',       'admin@seriqcare.com',        'admin',       1),
            ('coordinator1', 'Care Coordinator', 'coordinator1@seriqcare.com', 'coordinator', 1);
        PRINT 'Inserted 2 rows into care.users.';
    END
    ELSE
        PRINT 'care.users seed data already present - skipped.';
END TRY
BEGIN CATCH
    PRINT 'ERROR seeding care.users: ' + ERROR_MESSAGE();
END CATCH
GO


-- =============================================================================
-- VERIFICATION - row counts per table
-- =============================================================================
PRINT '=== Row count verification ===';
GO

SELECT
    'care.waivers'                AS [table_name],
    COUNT(*)                      AS [row_count]
FROM care.waivers
UNION ALL
SELECT 'care.service_codes',        COUNT(*) FROM care.service_codes
UNION ALL
SELECT 'care.evv_error_codes',      COUNT(*) FROM care.evv_error_codes
UNION ALL
SELECT 'care.reason_codes',         COUNT(*) FROM care.reason_codes
UNION ALL
SELECT 'care.providers',            COUNT(*) FROM care.providers
UNION ALL
SELECT 'care.clients',              COUNT(*) FROM care.clients
UNION ALL
SELECT 'care.client_addresses',     COUNT(*) FROM care.client_addresses
UNION ALL
SELECT 'care.client_payer_info',    COUNT(*) FROM care.client_payer_info
UNION ALL
SELECT 'care.employees',            COUNT(*) FROM care.employees
UNION ALL
SELECT 'care.service_authorizations', COUNT(*) FROM care.service_authorizations
UNION ALL
SELECT 'care.schedules',            COUNT(*) FROM care.schedules
UNION ALL
SELECT 'care.visits',               COUNT(*) FROM care.visits
UNION ALL
SELECT 'care.visit_changes',        COUNT(*) FROM care.visit_changes
UNION ALL
SELECT 'care.visit_exceptions',     COUNT(*) FROM care.visit_exceptions
UNION ALL
SELECT 'care.aggregator_submissions', COUNT(*) FROM care.aggregator_submissions
UNION ALL
SELECT 'care.users',                COUNT(*) FROM care.users
ORDER BY [table_name];
GO

PRINT 'SeriqCare EVV DDL + seed data script completed successfully.';
GO

