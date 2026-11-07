-- =============================================================================
-- Phase 5 REVERT: Visits Table Split — ROLLBACK
-- Target DB : SeriqCareDB  (schema: care)
-- Run on    : SQL Server
--
-- Restores care.visits to its original wide-table structure by reading from
-- the backup tables created in Phase 5.
-- Drops care.visit_evv, care.visit_billing, care.visit_integration_status.
-- Removes columns added to employees, clients, aggregator_submissions.
-- Restores the original index and CHECK constraint on care.visits.
--
-- PREREQUISITES (must all exist before running):
--   care.visits_bak_20260320
--   care.employees_bak_20260320
--   care.clients_bak_20260320
--   care.aggregator_submissions_bak_20260320
--
-- STOP THE BACKEND SERVICE BEFORE RUNNING THIS SCRIPT.
-- =============================================================================

PRINT '================================================================';
PRINT 'Phase 5 REVERT: Visits Table Split — Rollback';
PRINT CONCAT('Timestamp: ', CONVERT(VARCHAR, GETDATE(), 120));
PRINT '================================================================';
GO


-- =============================================================================
-- SAFETY CHECK: Abort immediately if backup tables are missing.
-- =============================================================================

IF OBJECT_ID('care.visits_bak_20260320', 'U') IS NULL
BEGIN
    RAISERROR(
        'ABORT: care.visits_bak_20260320 not found. '
        'Run Phase 5 migration first, or restore from a full database backup.',
        16, 1
    );
    RETURN;
END

IF OBJECT_ID('care.employees_bak_20260320', 'U') IS NULL
BEGIN
    RAISERROR('ABORT: care.employees_bak_20260320 not found.', 16, 1);
    RETURN;
END

IF OBJECT_ID('care.clients_bak_20260320', 'U') IS NULL
BEGIN
    RAISERROR('ABORT: care.clients_bak_20260320 not found.', 16, 1);
    RETURN;
END

IF OBJECT_ID('care.aggregator_submissions_bak_20260320', 'U') IS NULL
BEGIN
    RAISERROR('ABORT: care.aggregator_submissions_bak_20260320 not found.', 16, 1);
    RETURN;
END

PRINT 'Safety check passed — all backup tables found.';
GO


-- =============================================================================
-- STEP 1 : Re-add moved columns to care.visits
-- Each ALTER is guarded so the script is safe to re-run.
-- =============================================================================

PRINT '';
PRINT '--- STEP 1: Re-adding columns to care.visits ---';
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.visits') AND name = 'visit_id_sandata')
    ALTER TABLE care.visits ADD visit_id_sandata    VARCHAR(50)   NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.visits') AND name = 'call_in_datetime')
    ALTER TABLE care.visits ADD call_in_datetime    DATETIME2     NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.visits') AND name = 'call_in_latitude')
    ALTER TABLE care.visits ADD call_in_latitude    DECIMAL(10,7) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.visits') AND name = 'call_in_longitude')
    ALTER TABLE care.visits ADD call_in_longitude   DECIMAL(10,7) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.visits') AND name = 'call_in_method')
    ALTER TABLE care.visits ADD call_in_method      VARCHAR(20)   NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.visits') AND name = 'call_out_datetime')
    ALTER TABLE care.visits ADD call_out_datetime   DATETIME2     NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.visits') AND name = 'call_out_latitude')
    ALTER TABLE care.visits ADD call_out_latitude   DECIMAL(10,7) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.visits') AND name = 'call_out_longitude')
    ALTER TABLE care.visits ADD call_out_longitude  DECIMAL(10,7) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.visits') AND name = 'call_out_method')
    ALTER TABLE care.visits ADD call_out_method     VARCHAR(20)   NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.visits') AND name = 'adj_in_datetime')
    ALTER TABLE care.visits ADD adj_in_datetime     DATETIME2     NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.visits') AND name = 'adj_out_datetime')
    ALTER TABLE care.visits ADD adj_out_datetime    DATETIME2     NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.visits') AND name = 'evv_status')
    ALTER TABLE care.visits ADD evv_status          VARCHAR(30)   NOT NULL
        CONSTRAINT DF_visits_evv_status_revert DEFAULT 'Incomplete';
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.visits') AND name = 'hard_copy_required')
    ALTER TABLE care.visits ADD hard_copy_required  BIT           NOT NULL
        CONSTRAINT DF_visits_hcr_revert DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.visits') AND name = 'billed_units')
    ALTER TABLE care.visits ADD billed_units        DECIMAL(10,2) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.visits') AND name = 'approved_units')
    ALTER TABLE care.visits ADD approved_units      DECIMAL(10,2) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.visits') AND name = 'approval_status')
    ALTER TABLE care.visits ADD approval_status     VARCHAR(30)   NOT NULL
        CONSTRAINT DF_visits_approval_revert DEFAULT 'Pending';
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.visits') AND name = 'reason_code_id')
    ALTER TABLE care.visits ADD reason_code_id      INT           NULL;
GO

PRINT 'All columns re-added to care.visits.';
GO


-- =============================================================================
-- STEP 2 : Restore original data into care.visits from backup
-- Joins on id so only existing visits are updated; no phantom rows introduced.
-- =============================================================================

PRINT '';
PRINT '--- STEP 2: Restoring data from backup into care.visits ---';
GO

UPDATE v
SET
    v.visit_id_sandata   = bak.visit_id_sandata,
    v.call_in_datetime   = bak.call_in_datetime,
    v.call_in_latitude   = bak.call_in_latitude,
    v.call_in_longitude  = bak.call_in_longitude,
    v.call_in_method     = bak.call_in_method,
    v.call_out_datetime  = bak.call_out_datetime,
    v.call_out_latitude  = bak.call_out_latitude,
    v.call_out_longitude = bak.call_out_longitude,
    v.call_out_method    = bak.call_out_method,
    v.adj_in_datetime    = bak.adj_in_datetime,
    v.adj_out_datetime   = bak.adj_out_datetime,
    v.evv_status         = bak.evv_status,
    v.hard_copy_required = bak.hard_copy_required,
    v.billed_units       = bak.billed_units,
    v.approved_units     = bak.approved_units,
    v.approval_status    = bak.approval_status,
    v.reason_code_id     = bak.reason_code_id
FROM care.visits v
JOIN care.visits_bak_20260320 bak ON bak.id = v.id;

PRINT CONCAT('Restored: ', @@ROWCOUNT, ' rows updated in care.visits');
GO


-- =============================================================================
-- STEP 3 : Remove columns added by Phase 5 to existing tables
-- =============================================================================

PRINT '';
PRINT '--- STEP 3: Removing Phase 5 columns from existing tables ---';
GO

-- 3A. care.visits.agency_id
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.visits') AND name = 'agency_id')
BEGIN
    -- Drop FK to agencies if it was added
    DECLARE @agy_fk NVARCHAR(200);
    SELECT TOP 1 @agy_fk = fk.name
    FROM   sys.foreign_keys        fk
    JOIN   sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
    JOIN   sys.columns             c   ON c.object_id = fkc.parent_object_id
                                      AND c.column_id = fkc.parent_column_id
    WHERE  fk.parent_object_id = OBJECT_ID('care.visits')
      AND  c.name = 'agency_id';

    IF @agy_fk IS NOT NULL
        EXEC ('ALTER TABLE care.visits DROP CONSTRAINT ' + @agy_fk);

    ALTER TABLE care.visits DROP COLUMN agency_id;
    PRINT 'Dropped: care.visits.agency_id';
END
ELSE
    PRINT 'Not present: care.visits.agency_id — skipped';
GO

-- 3B. care.employees.hhax_employee_id
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.employees') AND name = 'hhax_employee_id')
BEGIN
    ALTER TABLE care.employees DROP COLUMN hhax_employee_id;
    PRINT 'Dropped: care.employees.hhax_employee_id';
END
ELSE
    PRINT 'Not present: care.employees.hhax_employee_id — skipped';
GO

-- 3C. care.clients.hhax_member_id
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.clients') AND name = 'hhax_member_id')
BEGIN
    ALTER TABLE care.clients DROP COLUMN hhax_member_id;
    PRINT 'Dropped: care.clients.hhax_member_id';
END
ELSE
    PRINT 'Not present: care.clients.hhax_member_id — skipped';
GO

-- 3D. care.clients.hhax_branch_id
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.clients') AND name = 'hhax_branch_id')
BEGIN
    ALTER TABLE care.clients DROP COLUMN hhax_branch_id;
    PRINT 'Dropped: care.clients.hhax_branch_id';
END
ELSE
    PRINT 'Not present: care.clients.hhax_branch_id — skipped';
GO

-- 3E. care.aggregator_submissions.aggregator
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.aggregator_submissions') AND name = 'aggregator')
BEGIN
    ALTER TABLE care.aggregator_submissions DROP COLUMN aggregator;
    PRINT 'Dropped: care.aggregator_submissions.aggregator';
END
ELSE
    PRINT 'Not present: care.aggregator_submissions.aggregator — skipped';
GO


-- =============================================================================
-- STEP 4 : Restore original constraints on care.visits
-- =============================================================================

PRINT '';
PRINT '--- STEP 4: Restoring original constraints on care.visits ---';
GO

-- 4A. Restore filtered unique index on visit_id_sandata (from Phase 1 migration)
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE  name      = 'UX_visits_sandata_id_notnull'
      AND  object_id = OBJECT_ID('care.visits')
)
BEGIN
    CREATE UNIQUE INDEX UX_visits_sandata_id_notnull
        ON care.visits (visit_id_sandata)
        WHERE visit_id_sandata IS NOT NULL;
    PRINT 'Restored index: UX_visits_sandata_id_notnull';
END
ELSE
    PRINT 'Already exists: UX_visits_sandata_id_notnull — skipped';
GO

-- 4B. Restore CHECK constraint on evv_status (from Phase 4 migration)
IF NOT EXISTS (
    SELECT 1
    FROM   sys.check_constraints cc
    JOIN   sys.tables  t ON cc.parent_object_id = t.object_id
    JOIN   sys.schemas s ON t.schema_id         = s.schema_id
    WHERE  cc.name = 'CK_visits_evv_status'
      AND  s.name  = 'care'
      AND  t.name  = 'visits'
)
BEGIN
    ALTER TABLE care.visits ADD CONSTRAINT CK_visits_evv_status
        CHECK (evv_status IN ('Ready','Submitted','Incomplete','Omit'));
    PRINT 'Restored constraint: CK_visits_evv_status';
END
ELSE
    PRINT 'Already exists: CK_visits_evv_status — skipped';
GO

-- 4C. Restore IX_visits_approval index (coordinator approval queue)
--     Original: ON care.visits (approval_status, evv_status) INCLUDE (agency_id, service_date)
--     Dropped in Phase 5 Fix 2 to allow evv_status column removal.
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE  name      = 'IX_visits_approval'
      AND  object_id = OBJECT_ID('care.visits')
)
BEGIN
    CREATE INDEX IX_visits_approval
        ON care.visits (approval_status, evv_status)
        INCLUDE (agency_id, service_date);
    PRINT 'Restored index: IX_visits_approval';
END
ELSE
    PRINT 'Already exists: IX_visits_approval — skipped';
GO

-- 4E. Restore FK from care.visits.reason_code_id → care.reason_codes
IF NOT EXISTS (
    SELECT 1
    FROM   sys.foreign_keys        fk
    JOIN   sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
    JOIN   sys.columns             c   ON c.object_id = fkc.parent_object_id
                                      AND c.column_id = fkc.parent_column_id
    WHERE  fk.parent_object_id = OBJECT_ID('care.visits')
      AND  c.name = 'reason_code_id'
)
BEGIN
    ALTER TABLE care.visits
        ADD CONSTRAINT FK_visits_reason_code
            FOREIGN KEY (reason_code_id) REFERENCES care.reason_codes (id);
    PRINT 'Restored FK: care.visits.reason_code_id → care.reason_codes';
END
ELSE
    PRINT 'FK on reason_code_id already exists — skipped';
GO


-- =============================================================================
-- STEP 5 : Drop child tables (FK dependency order: children before parent)
-- =============================================================================

PRINT '';
PRINT '--- STEP 5: Dropping Phase 5 child tables ---';
GO

IF OBJECT_ID('care.visit_integration_status', 'U') IS NOT NULL
BEGIN
    DROP TABLE care.visit_integration_status;
    PRINT 'Dropped: care.visit_integration_status';
END
ELSE
    PRINT 'Not present: care.visit_integration_status — skipped';
GO

IF OBJECT_ID('care.visit_billing', 'U') IS NOT NULL
BEGIN
    DROP TABLE care.visit_billing;
    PRINT 'Dropped: care.visit_billing';
END
ELSE
    PRINT 'Not present: care.visit_billing — skipped';
GO

IF OBJECT_ID('care.visit_evv', 'U') IS NOT NULL
BEGIN
    DROP TABLE care.visit_evv;
    PRINT 'Dropped: care.visit_evv';
END
ELSE
    PRINT 'Not present: care.visit_evv — skipped';
GO


-- =============================================================================
-- STEP 6 : VERIFICATION
-- =============================================================================

PRINT '';
PRINT '--- STEP 6: Verification ---';
GO

-- 6A. Row count: visits must match its backup
DECLARE @visits_count INT     = (SELECT COUNT(*) FROM care.visits);
DECLARE @backup_count INT     = (SELECT COUNT(*) FROM care.visits_bak_20260320);

SELECT
    'care.visits'              AS tbl, @visits_count AS rows
UNION ALL
SELECT 'care.visits_bak_20260320', @backup_count;

IF @visits_count = @backup_count
    PRINT 'OK: care.visits row count matches backup.';
ELSE
    PRINT CONCAT('WARNING: Row count mismatch — visits=', @visits_count,
                 '  backup=', @backup_count, '. Investigate before proceeding.');
GO

-- 6B. Child tables must be gone
IF    OBJECT_ID('care.visit_evv',                'U') IS NULL
  AND OBJECT_ID('care.visit_billing',            'U') IS NULL
  AND OBJECT_ID('care.visit_integration_status', 'U') IS NULL
    PRINT 'OK: All Phase 5 child tables removed.';
ELSE
    PRINT 'WARNING: One or more child tables still exist!';
GO

-- 6C. Moved columns must be back in care.visits
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE  object_id = OBJECT_ID('care.visits')
      AND  name = 'evv_status'
)
    PRINT 'OK: care.visits.evv_status restored.';
ELSE
    PRINT 'WARNING: care.visits.evv_status is missing!';
GO

-- 6D. Phase 5 columns must be gone from existing tables
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.employees')  AND name = 'hhax_employee_id')
   AND NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.clients') AND name = 'hhax_member_id')
   AND NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.clients') AND name = 'hhax_branch_id')
   AND NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('care.aggregator_submissions') AND name = 'aggregator')
    PRINT 'OK: All Phase 5 added columns removed from existing tables.';
ELSE
    PRINT 'WARNING: Some Phase 5 added columns still remain!';
GO

PRINT '';
PRINT '================================================================';
PRINT 'Phase 5 REVERT COMPLETE.';
PRINT '';
PRINT 'Backup tables are retained for safety — drop them manually';
PRINT 'once you confirm the revert is stable:';
PRINT '  DROP TABLE care.visits_bak_20260320;';
PRINT '  DROP TABLE care.employees_bak_20260320;';
PRINT '  DROP TABLE care.clients_bak_20260320;';
PRINT '  DROP TABLE care.aggregator_submissions_bak_20260320;';
PRINT '================================================================';
GO
