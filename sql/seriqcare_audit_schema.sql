-- =============================================================================
-- SeriqCare Audit Schema
-- Target DB : SeriqCareDB
-- Run on    : SQL Server
--
-- Creates the dedicated  audit  schema and two tables:
--   audit.audit_log        - entity changes + activity events
--                            (LOGIN / LOGOUT / FAILED_LOGIN /
--                             CLOCK_IN / CLOCK_OUT / PASSWORD_RESET /
--                             INSERT / UPDATE / DELETE)
--   audit.api_access_log   - every inbound HTTP request (method, path,
--                            status, duration, caller identity)
--
-- Safe to re-run: all DDL is guarded with IF NOT EXISTS checks.
-- =============================================================================

PRINT '================================================================';
PRINT 'SeriqCare Audit Schema - setup script';
PRINT CONCAT('Timestamp: ', CONVERT(VARCHAR, GETDATE(), 120));
PRINT '================================================================';
GO


-- =============================================================================
-- SCHEMA
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'audit')
    EXEC('CREATE SCHEMA audit');
GO

PRINT '  [audit] schema OK';
GO


-- =============================================================================
-- audit.audit_log
--
-- Dual-purpose table:
--   â€¢ Entity changes  (action IN ('INSERT','UPDATE','DELETE'))
--       table_name  = DB table being changed
--       record_id   = PK of the affected row
--       field_name  = column that changed
--       old_value   = previous value (NULL for INSERT)
--       new_value   = new value      (NULL for DELETE)
--
--   â€¢ Activity events (action IN ('LOGIN','LOGOUT','FAILED_LOGIN',
--                                  'CLOCK_IN','CLOCK_OUT','PASSWORD_RESET'))
--       table_name  = 'auth' | 'visits'
--       record_id   = user_id | visit_id
--       field_name / old_value / new_value  = NULL
--       detail      = free-text context string
-- =============================================================================

IF NOT EXISTS (
    SELECT 1
    FROM   sys.tables  t
    JOIN   sys.schemas s ON t.schema_id = s.schema_id
    WHERE  s.name = 'audit' AND t.name = 'audit_log'
)
BEGIN
    CREATE TABLE audit.audit_log (
        id              BIGINT          IDENTITY(1,1)  NOT NULL,
        agency_id       INT             NULL,
        table_name      NVARCHAR(100)   NOT NULL,
        record_id       INT             NULL,
        action          NVARCHAR(30)    NOT NULL,
        field_name      NVARCHAR(100)   NULL,
        old_value       NVARCHAR(MAX)   NULL,
        new_value       NVARCHAR(MAX)   NULL,
        changed_by      INT             NULL,
        changed_by_name NVARCHAR(200)   NULL,
        client_type     NVARCHAR(20)    NULL,
        ip_address      NVARCHAR(45)    NULL,
        detail          NVARCHAR(500)   NULL,
        session_id      NVARCHAR(100)   NULL,
        created_at      DATETIME2       NOT NULL  DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),

        CONSTRAINT PK_audit_log PRIMARY KEY (id)
    );

    -- Lookup by table + row (history of a specific record)
    CREATE INDEX IX_audit_log_table_record
        ON audit.audit_log (table_name, record_id, created_at DESC);

    -- Agency-level timeline
    CREATE INDEX IX_audit_log_agency_time
        ON audit.audit_log (agency_id, created_at DESC)
        WHERE agency_id IS NOT NULL;

    -- Per-user activity
    CREATE INDEX IX_audit_log_user
        ON audit.audit_log (changed_by, created_at DESC)
        WHERE changed_by IS NOT NULL;

    PRINT '  [audit.audit_log] created';
END
ELSE
    PRINT '  [audit.audit_log] already exists - skipped';
GO


-- =============================================================================
-- audit.api_access_log
--
-- One row per inbound HTTP request captured by the backend middleware.
-- Populated automatically - no manual writes needed.
--
-- Columns:
--   method        HTTP verb (GET, POST, PUT, DELETE, PATCH)
--   path          URL path  (/api/visits/clock-in)
--   query_string  Raw query string (may contain filter params; never passwords)
--   status_code   HTTP response status (200, 401, 404, 500 â€¦)
--   duration_ms   Wall-clock time from request receipt to response send
--   user_id       Parsed from the Bearer JWT (NULL for unauthenticated calls)
--   username      Parsed from the Bearer JWT sub claim
--   agency_id     Parsed from the Bearer JWT
--   ip_address    Remote IP (proxy-forwarded if behind load balancer)
--   user_agent    Browser / SDK identifier
-- =============================================================================

IF NOT EXISTS (
    SELECT 1
    FROM   sys.tables  t
    JOIN   sys.schemas s ON t.schema_id = s.schema_id
    WHERE  s.name = 'audit' AND t.name = 'api_access_log'
)
BEGIN
    CREATE TABLE audit.api_access_log (
        id              BIGINT          IDENTITY(1,1)  NOT NULL,
        method          NVARCHAR(10)    NOT NULL,
        path            NVARCHAR(500)   NOT NULL,
        query_string    NVARCHAR(1000)  NULL,
        status_code     INT             NOT NULL,
        duration_ms     INT             NULL,
        user_id         INT             NULL,
        username        NVARCHAR(100)   NULL,
        agency_id       INT             NULL,
        ip_address      NVARCHAR(45)    NULL,
        user_agent      NVARCHAR(500)   NULL,
        created_at      DATETIME2       NOT NULL  DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),

        CONSTRAINT PK_api_access_log PRIMARY KEY (id)
    );

    -- Most common query: recent activity for an agency or user
    CREATE INDEX IX_api_access_log_user_time
        ON audit.api_access_log (user_id, created_at DESC)
        WHERE user_id IS NOT NULL;

    CREATE INDEX IX_api_access_log_agency_time
        ON audit.api_access_log (agency_id, created_at DESC)
        WHERE agency_id IS NOT NULL;

    -- Slow-request analysis and error triage
    CREATE INDEX IX_api_access_log_status_time
        ON audit.api_access_log (status_code, created_at DESC);

    PRINT '  [audit.api_access_log] created';
END
ELSE
    PRINT '  [audit.api_access_log] already exists - skipped';
GO


PRINT '================================================================';
PRINT 'Audit schema setup complete.';
PRINT '================================================================';
GO

