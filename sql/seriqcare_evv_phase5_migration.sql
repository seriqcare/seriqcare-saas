-- =============================================================================
-- Phase 5 Migration: Visits Table Split
-- Target DB : SeriqCareDB  (schema: care)
-- Run on    : SQL Server
--
-- Splits care.visits into:
--   care.visit_evv                  EVV clock data + validation status
--   care.visit_billing              Billing units + approval
--   care.visit_integration_status   Aggregator submission tracking (Sandata + HHAeXchange)
--
-- Also:
--   care.employees          + hhax_employee_id
--   care.clients            + hhax_member_id, hhax_branch_id
--   care.aggregator_submissions + aggregator
--   care.visits             + agency_id
--
-- STOP THE BACKEND SERVICE BEFORE RUNNING THIS SCRIPT.
-- Run seriqcare_evv_phase5_revert.sql to undo all changes.
-- =============================================================================

PRINT '================================================================';
PRINT 'Phase 5 Migration: Visits Table Split';
PRINT CONCAT('Timestamp: ', CONVERT(VARCHAR, GETDATE(), 120));
PRINT '================================================================';
GO


-- =============================================================================
-- PART 0 : TABLE BACKUPS
-- Point-in-time snapshot of every table being modified.
-- Backup tables are intentionally left in place after migration;
-- drop them manually once the new schema is confirmed stable.
-- =============================================================================

PRINT '';
PRINT '--- PART 0: Backing up tables ---';
GO

-- 0A. care.visits
IF OBJECT_ID('care.visits_bak_20260320', 'U') IS NULL
BEGIN
    SELECT * INTO care.visits_bak_20260320 FROM care.visits;
    PRINT CONCAT('Backup created : care.visits_bak_20260320  (', @@ROWCOUNT, ' rows)');
END
ELSE
    PRINT 'Backup already exists: care.visits_bak_20260320 — skipped';
GO

-- 0B. care.employees
IF OBJECT_ID('care.employees_bak_20260320', 'U') IS NULL
BEGIN
    SELECT * INTO care.employees_bak_20260320 FROM care.employees;
    PRINT CONCAT('Backup created : care.employees_bak_20260320  (', @@ROWCOUNT, ' rows)');
END
ELSE
    PRINT 'Backup already exists: care.employees_bak_20260320 — skipped';
GO

-- 0C. care.clients
IF OBJECT_ID('care.clients_bak_20260320', 'U') IS NULL
BEGIN
    SELECT * INTO care.clients_bak_20260320 FROM care.clients;
    PRINT CONCAT('Backup created : care.clients_bak_20260320  (', @@ROWCOUNT, ' rows)');
END
ELSE
    PRINT 'Backup already exists: care.clients_bak_20260320 — skipped';
GO

-- 0D. care.aggregator_submissions
IF OBJECT_ID('care.aggregator_submissions_bak_20260320', 'U') IS NULL
BEGIN
    SELECT * INTO care.aggregator_submissions_bak_20260320
    FROM care.aggregator_submissions;
    PRINT CONCAT('Backup created : care.aggregator_submissions_bak_20260320  (', @@ROWCOUNT, ' rows)');
END
ELSE
    PRINT 'Backup already exists: care.aggregator_submissions_bak_20260320 — skipped';
GO


-- =============================================================================
-- PART 1 : CREATE NEW CHILD TABLES
-- All three tables use visit_id as PK + FK to care.visits (1:1).
-- Idempotent: each CREATE is guarded by IF OBJECT_ID(...) IS NULL.
-- =============================================================================

PRINT '';
PRINT '--- PART 1: Creating new child tables ---';
GO

-- --------------------------------------------------------------------------
-- 1A. care.visit_evv
--     Owns: clock in/out, GPS, adjustment times, EVV validity status.
--
--     evv_status vocabulary (replaces old care.visits.evv_status):
--       Pending   Visit not complete or not yet validated
--       Verified  Passes all EVV checks
--       Failed    Has issues, blocked from submission
--       Adjusted  Manually corrected, now valid
--       Exempt    EVV not required for this service type
-- --------------------------------------------------------------------------
IF OBJECT_ID('care.visit_evv', 'U') IS NULL
BEGIN
    CREATE TABLE care.visit_evv (
        visit_id            INT             NOT NULL,
        call_in_datetime    DATETIME2       NULL,
        call_in_latitude    DECIMAL(10,7)   NULL,
        call_in_longitude   DECIMAL(10,7)   NULL,
        call_in_method      VARCHAR(30)     NULL,
        call_out_datetime   DATETIME2       NULL,
        call_out_latitude   DECIMAL(10,7)   NULL,
        call_out_longitude  DECIMAL(10,7)   NULL,
        call_out_method     VARCHAR(30)     NULL,
        adj_in_datetime     DATETIME2       NULL,
        adj_out_datetime    DATETIME2       NULL,
        evv_status          VARCHAR(30)     NOT NULL CONSTRAINT DF_visit_evv_status DEFAULT 'Pending',
        hard_copy_required  BIT             NOT NULL CONSTRAINT DF_visit_evv_hcr    DEFAULT 0,
        created_at          DATETIME2       NOT NULL CONSTRAINT DF_visit_evv_ca     DEFAULT GETDATE(),
        updated_at          DATETIME2       NOT NULL CONSTRAINT DF_visit_evv_ua     DEFAULT GETDATE(),

        CONSTRAINT PK_visit_evv
            PRIMARY KEY (visit_id),
        CONSTRAINT FK_visit_evv_visit
            FOREIGN KEY (visit_id) REFERENCES care.visits (id),
        CONSTRAINT CK_visit_evv_status
            CHECK (evv_status IN ('Pending','Verified','Failed','Adjusted','Exempt'))
    );
    PRINT 'Created: care.visit_evv';
END
ELSE
    PRINT 'Already exists: care.visit_evv — skipped';
GO

-- --------------------------------------------------------------------------
-- 1B. care.visit_billing
--     Owns: billed units, approved units, billing approval status.
--
--     approval_status vocabulary:
--       Pending   Not yet reviewed
--       Approved  Units approved for payment
--       Denied    Units denied
-- --------------------------------------------------------------------------
IF OBJECT_ID('care.visit_billing', 'U') IS NULL
BEGIN
    CREATE TABLE care.visit_billing (
        visit_id        INT             NOT NULL,
        billed_units    DECIMAL(10,2)   NULL,
        approved_units  DECIMAL(10,2)   NULL,
        approval_status VARCHAR(30)     NOT NULL CONSTRAINT DF_visit_billing_status DEFAULT 'Pending',
        reason_code_id  INT             NULL,
        created_at      DATETIME2       NOT NULL CONSTRAINT DF_visit_billing_ca     DEFAULT GETDATE(),
        updated_at      DATETIME2       NOT NULL CONSTRAINT DF_visit_billing_ua     DEFAULT GETDATE(),

        CONSTRAINT PK_visit_billing
            PRIMARY KEY (visit_id),
        CONSTRAINT FK_visit_billing_visit
            FOREIGN KEY (visit_id) REFERENCES care.visits (id),
        CONSTRAINT FK_visit_billing_reason
            FOREIGN KEY (reason_code_id) REFERENCES care.reason_codes (id),
        CONSTRAINT CK_visit_billing_approval
            CHECK (approval_status IN ('Pending','Approved','Denied'))
    );
    PRINT 'Created: care.visit_billing';
END
ELSE
    PRINT 'Already exists: care.visit_billing — skipped';
GO

-- --------------------------------------------------------------------------
-- 1C. care.visit_integration_status
--     Owns: external aggregator IDs and per-aggregator submission status.
--     One row per visit; covers both Sandata and HHAeXchange independently.
--
--     sandata_status / hhax_status vocabulary:
--       Draft      Not ready to send
--       Ready      Passes EVV, queued for submission
--       Submitted  Sent to external system
--       Accepted   Successfully processed by external system
--       Rejected   External system rejected it (see last_response_message)
-- --------------------------------------------------------------------------
IF OBJECT_ID('care.visit_integration_status', 'U') IS NULL
BEGIN
    CREATE TABLE care.visit_integration_status (
        visit_id              INT             NOT NULL,
        -- Sandata
        visit_id_sandata      VARCHAR(50)     NULL,
        sandata_status        VARCHAR(30)     NULL,
        sandata_last_at       DATETIME2       NULL,
        -- HHAeXchange
        hhax_visit_id         VARCHAR(50)     NULL,
        hhax_status           VARCHAR(30)     NULL,
        hhax_last_at          DATETIME2       NULL,
        -- Shared
        last_response_message VARCHAR(1000)   NULL,
        created_at            DATETIME2       NOT NULL CONSTRAINT DF_vis_ca DEFAULT GETDATE(),
        updated_at            DATETIME2       NOT NULL CONSTRAINT DF_vis_ua DEFAULT GETDATE(),

        CONSTRAINT PK_visit_integration_status
            PRIMARY KEY (visit_id),
        CONSTRAINT FK_visit_integration_status_visit
            FOREIGN KEY (visit_id) REFERENCES care.visits (id),
        CONSTRAINT CK_vis_sandata_status CHECK (
            sandata_status IS NULL OR
            sandata_status IN ('Draft','Ready','Submitted','Accepted','Rejected')
        ),
        CONSTRAINT CK_vis_hhax_status CHECK (
            hhax_status IS NULL OR
            hhax_status IN ('Draft','Ready','Submitted','Accepted','Rejected')
        )
    );
    PRINT 'Created: care.visit_integration_status';
END
ELSE
    PRINT 'Already exists: care.visit_integration_status — skipped';
GO


-- =============================================================================
-- PART 2 : MIGRATE DATA INTO CHILD TABLES
-- Each INSERT is guarded by NOT EXISTS so it is safe to re-run.
-- =============================================================================

PRINT '';
PRINT '--- PART 2: Migrating data into child tables ---';
GO

-- --------------------------------------------------------------------------
-- 2A. Populate care.visit_evv
--
--     evv_status mapping from old care.visits.evv_status:
--       'Incomplete' → 'Pending'   (in-progress, not validated)
--       'Ready'      → 'Verified'  (EVV data was validated, ready to submit)
--       'Submitted'  → 'Verified'  (already submitted, EVV data was valid)
--       'Omit'       → 'Exempt'    (EVV not required for this service)
--       anything else → 'Pending'  (safe fallback)
-- --------------------------------------------------------------------------
INSERT INTO care.visit_evv (
    visit_id,
    call_in_datetime,  call_in_latitude,  call_in_longitude,  call_in_method,
    call_out_datetime, call_out_latitude, call_out_longitude, call_out_method,
    adj_in_datetime,   adj_out_datetime,
    evv_status,        hard_copy_required,
    created_at,        updated_at
)
SELECT
    v.id,
    v.call_in_datetime,  v.call_in_latitude,  v.call_in_longitude,  v.call_in_method,
    v.call_out_datetime, v.call_out_latitude, v.call_out_longitude, v.call_out_method,
    v.adj_in_datetime,   v.adj_out_datetime,
    CASE v.evv_status
        WHEN 'Incomplete' THEN 'Pending'
        WHEN 'Ready'      THEN 'Verified'
        WHEN 'Submitted'  THEN 'Verified'
        WHEN 'Omit'       THEN 'Exempt'
        ELSE                   'Pending'
    END,
    v.hard_copy_required,
    ISNULL(v.created_at, GETDATE()),
    ISNULL(v.updated_at, GETDATE())
FROM care.visits v
WHERE NOT EXISTS (
    SELECT 1 FROM care.visit_evv e WHERE e.visit_id = v.id
);
PRINT CONCAT('Inserted into care.visit_evv: ', @@ROWCOUNT, ' rows');
GO

-- --------------------------------------------------------------------------
-- 2B. Populate care.visit_billing
--
--     approval_status guard: only carry over valid values; default to 'Pending'.
-- --------------------------------------------------------------------------
INSERT INTO care.visit_billing (
    visit_id,
    billed_units, approved_units,
    approval_status, reason_code_id,
    created_at,   updated_at
)
SELECT
    v.id,
    v.billed_units,
    v.approved_units,
    CASE
        WHEN v.approval_status IN ('Pending','Approved','Denied') THEN v.approval_status
        ELSE 'Pending'
    END,
    v.reason_code_id,
    ISNULL(v.created_at, GETDATE()),
    ISNULL(v.updated_at, GETDATE())
FROM care.visits v
WHERE NOT EXISTS (
    SELECT 1 FROM care.visit_billing b WHERE b.visit_id = v.id
);
PRINT CONCAT('Inserted into care.visit_billing: ', @@ROWCOUNT, ' rows');
GO

-- --------------------------------------------------------------------------
-- 2C. Populate care.visit_integration_status
--
--     sandata_status mapping from old care.visits.evv_status:
--       'Incomplete' → 'Draft'      (not yet validated or queued)
--       'Ready'      → 'Ready'      (queued for submission)
--       'Submitted'  → 'Submitted'  (already sent to Sandata)
--       'Omit'       → NULL         (exempt, no aggregator submission)
--       anything else → 'Draft'
--
--     hhax columns start NULL for all existing rows (no prior HHAeXchange data).
-- --------------------------------------------------------------------------
INSERT INTO care.visit_integration_status (
    visit_id,
    visit_id_sandata,
    sandata_status,  sandata_last_at,
    hhax_visit_id,   hhax_status,  hhax_last_at,
    last_response_message,
    created_at,      updated_at
)
SELECT
    v.id,
    v.visit_id_sandata,
    CASE v.evv_status
        WHEN 'Incomplete' THEN 'Draft'
        WHEN 'Ready'      THEN 'Ready'
        WHEN 'Submitted'  THEN 'Submitted'
        WHEN 'Omit'       THEN NULL
        ELSE                   'Draft'
    END,
    NULL,   -- sandata_last_at  (no prior timestamp available)
    NULL,   -- hhax_visit_id
    NULL,   -- hhax_status
    NULL,   -- hhax_last_at
    NULL,   -- last_response_message
    ISNULL(v.created_at, GETDATE()),
    ISNULL(v.updated_at, GETDATE())
FROM care.visits v
WHERE NOT EXISTS (
    SELECT 1 FROM care.visit_integration_status i WHERE i.visit_id = v.id
);
PRINT CONCAT('Inserted into care.visit_integration_status: ', @@ROWCOUNT, ' rows');
GO


-- =============================================================================
-- PART 3 : ADD NEW COLUMNS TO EXISTING TABLES
-- =============================================================================

PRINT '';
PRINT '--- PART 3: Adding new columns to existing tables ---';
GO

-- 3A. care.visits — agency_id (nullable; backfill per agency after migration)
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('care.visits') AND name = 'agency_id'
)
BEGIN
    ALTER TABLE care.visits ADD agency_id INT NULL;
    PRINT 'Added: care.visits.agency_id';
END
ELSE
    PRINT 'Already exists: care.visits.agency_id — skipped';
GO

-- 3B. care.employees — HHAeXchange caregiver identifier
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('care.employees') AND name = 'hhax_employee_id'
)
BEGIN
    ALTER TABLE care.employees ADD hhax_employee_id VARCHAR(50) NULL;
    PRINT 'Added: care.employees.hhax_employee_id';
END
ELSE
    PRINT 'Already exists: care.employees.hhax_employee_id — skipped';
GO

-- 3C. care.clients — HHAeXchange member and branch identifiers
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('care.clients') AND name = 'hhax_member_id'
)
BEGIN
    ALTER TABLE care.clients ADD hhax_member_id VARCHAR(50) NULL;
    PRINT 'Added: care.clients.hhax_member_id';
END
ELSE
    PRINT 'Already exists: care.clients.hhax_member_id — skipped';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('care.clients') AND name = 'hhax_branch_id'
)
BEGIN
    ALTER TABLE care.clients ADD hhax_branch_id VARCHAR(50) NULL;
    PRINT 'Added: care.clients.hhax_branch_id';
END
ELSE
    PRINT 'Already exists: care.clients.hhax_branch_id — skipped';
GO

-- 3D. care.aggregator_submissions — which aggregator this row belongs to
--     Backfill existing rows as 'sandata' (all prior submissions were Sandata only).
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('care.aggregator_submissions') AND name = 'aggregator'
)
BEGIN
    ALTER TABLE care.aggregator_submissions ADD aggregator VARCHAR(20) NULL;
    UPDATE care.aggregator_submissions
    SET    aggregator = 'sandata'
    WHERE  aggregator IS NULL;
    PRINT CONCAT('Added and backfilled: care.aggregator_submissions.aggregator  (', @@ROWCOUNT, ' rows)');
END
ELSE
    PRINT 'Already exists: care.aggregator_submissions.aggregator — skipped';
GO


-- =============================================================================
-- PART 4 : DROP MOVED COLUMNS FROM care.visits
-- Must remove constraints that reference those columns first.
-- =============================================================================

PRINT '';
PRINT '--- PART 4: Removing moved columns from care.visits ---';
GO

-- 4A. Drop CHECK constraint on evv_status (created in Phase 4 migration)
IF EXISTS (
    SELECT 1
    FROM   sys.check_constraints cc
    JOIN   sys.tables  t ON cc.parent_object_id = t.object_id
    JOIN   sys.schemas s ON t.schema_id         = s.schema_id
    WHERE  cc.name = 'CK_visits_evv_status'
      AND  s.name  = 'care'
      AND  t.name  = 'visits'
)
BEGIN
    ALTER TABLE care.visits DROP CONSTRAINT CK_visits_evv_status;
    PRINT 'Dropped constraint: CK_visits_evv_status';
END
ELSE
    PRINT 'Constraint CK_visits_evv_status not found — skipped';
GO

-- 4B. Drop filtered unique index on visit_id_sandata (created in Phase 1 migration)
IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE  name      = 'UX_visits_sandata_id_notnull'
      AND  object_id = OBJECT_ID('care.visits')
)
BEGIN
    DROP INDEX UX_visits_sandata_id_notnull ON care.visits;
    PRINT 'Dropped index: UX_visits_sandata_id_notnull';
END
ELSE
    PRINT 'Index UX_visits_sandata_id_notnull not found — skipped';
GO

-- 4C. Drop the FK on reason_code_id (it moves to visit_billing)
--     SQL Server names auto-generated FKs; check by column reference.
DECLARE @fk_name NVARCHAR(200);
SELECT TOP 1 @fk_name = fk.name
FROM   sys.foreign_keys             fk
JOIN   sys.foreign_key_columns      fkc ON fkc.constraint_object_id = fk.object_id
JOIN   sys.columns                  c   ON c.object_id = fkc.parent_object_id
                                       AND c.column_id = fkc.parent_column_id
WHERE  fk.parent_object_id = OBJECT_ID('care.visits')
  AND  c.name = 'reason_code_id';

IF @fk_name IS NOT NULL
BEGIN
    EXEC ('ALTER TABLE care.visits DROP CONSTRAINT ' + @fk_name);
    PRINT CONCAT('Dropped FK on reason_code_id: ', @fk_name);
END
ELSE
    PRINT 'FK on care.visits.reason_code_id not found — skipped';
GO

-- 4D. Drop the moved columns from care.visits
--     Using dynamic SQL so each DROP is individually guarded.
DECLARE @col  NVARCHAR(128);
DECLARE @sql  NVARCHAR(500);

DECLARE moved_cols CURSOR LOCAL FAST_FORWARD FOR
SELECT col FROM (VALUES
    ('visit_id_sandata'),
    ('call_in_datetime'),
    ('call_in_latitude'),
    ('call_in_longitude'),
    ('call_in_method'),
    ('call_out_datetime'),
    ('call_out_latitude'),
    ('call_out_longitude'),
    ('call_out_method'),
    ('adj_in_datetime'),
    ('adj_out_datetime'),
    ('evv_status'),
    ('hard_copy_required'),
    ('billed_units'),
    ('approved_units'),
    ('approval_status'),
    ('reason_code_id')
) AS cols(col);

OPEN moved_cols;
FETCH NEXT FROM moved_cols INTO @col;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF EXISTS (
        SELECT 1 FROM sys.columns
        WHERE  object_id = OBJECT_ID('care.visits')
          AND  name      = @col
    )
    BEGIN
        -- Drop any default constraint on this column first
        DECLARE @df NVARCHAR(200);
        SELECT TOP 1 @df = dc.name
        FROM   sys.default_constraints dc
        JOIN   sys.columns             c  ON c.default_object_id = dc.object_id
        WHERE  c.object_id = OBJECT_ID('care.visits')
          AND  c.name      = @col;

        IF @df IS NOT NULL
        BEGIN
            SET @sql = N'ALTER TABLE care.visits DROP CONSTRAINT ' + QUOTENAME(@df);
            EXEC sp_executesql @sql;
        END

        SET @sql = N'ALTER TABLE care.visits DROP COLUMN ' + QUOTENAME(@col);
        EXEC sp_executesql @sql;
        PRINT CONCAT('Dropped column: care.visits.', @col);
    END
    ELSE
        PRINT CONCAT('Column already absent: care.visits.', @col, ' — skipped');

    FETCH NEXT FROM moved_cols INTO @col;
END
CLOSE moved_cols;
DEALLOCATE moved_cols;
GO


-- =============================================================================
-- PART 5 : VERIFICATION
-- Row count checks and structural confirmation.
-- =============================================================================

PRINT '';
PRINT '--- PART 5: Verification ---';
GO

-- 5A. Row counts
SELECT tbl, rows FROM (
    SELECT 'care.visits'                          AS tbl, COUNT(*) AS rows FROM care.visits
    UNION ALL
    SELECT 'care.visits_bak_20260320',                    COUNT(*) FROM care.visits_bak_20260320
    UNION ALL
    SELECT 'care.visit_evv',                              COUNT(*) FROM care.visit_evv
    UNION ALL
    SELECT 'care.visit_billing',                          COUNT(*) FROM care.visit_billing
    UNION ALL
    SELECT 'care.visit_integration_status',               COUNT(*) FROM care.visit_integration_status
    UNION ALL
    SELECT 'care.employees',                              COUNT(*) FROM care.employees
    UNION ALL
    SELECT 'care.clients',                                COUNT(*) FROM care.clients
    UNION ALL
    SELECT 'care.aggregator_submissions',                 COUNT(*) FROM care.aggregator_submissions
) x
ORDER BY tbl;
GO

-- 5B. Child table counts must match care.visits
IF (SELECT COUNT(*) FROM care.visit_evv) <> (SELECT COUNT(*) FROM care.visits)
    PRINT 'WARNING: visit_evv row count does not match visits!';
ELSE
    PRINT 'OK: visit_evv row count matches visits.';

IF (SELECT COUNT(*) FROM care.visit_billing) <> (SELECT COUNT(*) FROM care.visits)
    PRINT 'WARNING: visit_billing row count does not match visits!';
ELSE
    PRINT 'OK: visit_billing row count matches visits.';

IF (SELECT COUNT(*) FROM care.visit_integration_status) <> (SELECT COUNT(*) FROM care.visits)
    PRINT 'WARNING: visit_integration_status row count does not match visits!';
ELSE
    PRINT 'OK: visit_integration_status row count matches visits.';
GO

-- 5C. Confirm moved columns are gone from care.visits
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE  object_id = OBJECT_ID('care.visits')
      AND  name IN (
            'visit_id_sandata','call_in_datetime','call_out_datetime',
            'evv_status','billed_units','approval_status','reason_code_id'
          )
)
    PRINT 'WARNING: Some moved columns still exist in care.visits!';
ELSE
    PRINT 'OK: All moved columns removed from care.visits.';
GO

-- 5D. Confirm new columns exist
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.visits')     AND name = 'agency_id')
    PRINT 'OK: care.visits.agency_id exists.';
ELSE
    PRINT 'WARNING: care.visits.agency_id missing!';

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.employees')  AND name = 'hhax_employee_id')
    PRINT 'OK: care.employees.hhax_employee_id exists.';
ELSE
    PRINT 'WARNING: care.employees.hhax_employee_id missing!';

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.clients')    AND name = 'hhax_member_id')
    PRINT 'OK: care.clients.hhax_member_id exists.';
ELSE
    PRINT 'WARNING: care.clients.hhax_member_id missing!';

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.clients')    AND name = 'hhax_branch_id')
    PRINT 'OK: care.clients.hhax_branch_id exists.';
ELSE
    PRINT 'WARNING: care.clients.hhax_branch_id missing!';

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.aggregator_submissions') AND name = 'aggregator')
    PRINT 'OK: care.aggregator_submissions.aggregator exists.';
ELSE
    PRINT 'WARNING: care.aggregator_submissions.aggregator missing!';
GO

PRINT '';
PRINT '================================================================';
PRINT 'Phase 5 Migration COMPLETE.';
PRINT 'Next step : Session 2 — update db/models.py';
PRINT 'To undo   : run seriqcare_evv_phase5_revert.sql';
PRINT 'Backups   : care.*_bak_20260320  (drop manually when stable)';
PRINT '================================================================';
GO
