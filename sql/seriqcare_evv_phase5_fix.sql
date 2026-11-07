-- =============================================================================
-- Phase 5 Fix: Remediation for two issues from phase5_migration.sql
--
-- Issue 1: care.aggregator_submissions.aggregator column not added
--          Cause: SQL Server compiled BEGIN..END block before ALTER TABLE ran,
--          so the UPDATE referencing the new column failed at compile time,
--          blocking the entire block including the ALTER TABLE.
--          Fix: Separate ADD and UPDATE into distinct GO batches.
--
-- Issue 2: Moved columns still exist in care.visits from call_out_datetime onward
--          Cause: Cursor variable @df was not reset to NULL between iterations.
--          It retained the previous value and tried to drop an already-dropped
--          constraint, causing Msg 3728 which blocked the column drop.
--          Fix: Explicitly SET @df = NULL on each iteration before the lookup.
--
-- Safe to run: all steps are idempotent.
-- =============================================================================

PRINT '================================================================';
PRINT 'Phase 5 Fix: Remediation Script';
PRINT CONCAT('Timestamp: ', CONVERT(VARCHAR, GETDATE(), 120));
PRINT '================================================================';
GO


-- =============================================================================
-- FIX 1: Add aggregator column to care.aggregator_submissions
--         ADD and UPDATE must be in separate GO batches.
-- =============================================================================

PRINT '';
PRINT '--- FIX 1: Adding care.aggregator_submissions.aggregator ---';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE  object_id = OBJECT_ID('care.aggregator_submissions')
      AND  name      = 'aggregator'
)
BEGIN
    ALTER TABLE care.aggregator_submissions ADD aggregator VARCHAR(20) NULL;
    PRINT 'Added: care.aggregator_submissions.aggregator';
END
ELSE
    PRINT 'Already exists: care.aggregator_submissions.aggregator — skipped';
GO

-- Backfill in a separate batch so SQL Server sees the column at compile time
UPDATE care.aggregator_submissions
SET    aggregator = 'sandata'
WHERE  aggregator IS NULL;

PRINT CONCAT('Backfilled aggregator_submissions.aggregator: ', @@ROWCOUNT, ' rows set to ''sandata''');
GO


-- =============================================================================
-- FIX 2: Drop remaining moved columns from care.visits
--         Columns successfully dropped in migration:
--           visit_id_sandata, call_in_datetime, call_in_latitude,
--           call_in_longitude, call_in_method
--         Columns that failed and still need dropping:
--           call_out_datetime, call_out_latitude, call_out_longitude,
--           call_out_method, adj_in_datetime, adj_out_datetime,
--           evv_status, hard_copy_required, billed_units,
--           approved_units, approval_status, reason_code_id
--
--         Fix: SET @df = NULL before each constraint lookup so stale
--         values from the previous iteration do not carry over.
-- =============================================================================

PRINT '';
PRINT '--- FIX 2: Dropping remaining moved columns from care.visits ---';
GO

DECLARE @col  NVARCHAR(128);
DECLARE @df   NVARCHAR(200);
DECLARE @sql  NVARCHAR(500);

DECLARE remaining_cols CURSOR LOCAL FAST_FORWARD FOR
SELECT col FROM (VALUES
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

OPEN remaining_cols;
FETCH NEXT FROM remaining_cols INTO @col;

WHILE @@FETCH_STATUS = 0
BEGIN
    IF EXISTS (
        SELECT 1 FROM sys.columns
        WHERE  object_id = OBJECT_ID('care.visits')
          AND  name      = @col
    )
    BEGIN
        -- Reset @df on EVERY iteration to prevent stale value carry-over
        SET @df = NULL;

        -- Look up default constraint for this column (if any)
        SELECT TOP 1 @df = dc.name
        FROM   sys.default_constraints dc
        JOIN   sys.columns             c ON c.default_object_id = dc.object_id
        WHERE  c.object_id = OBJECT_ID('care.visits')
          AND  c.name      = @col;

        -- Drop default constraint before dropping the column
        IF @df IS NOT NULL
        BEGIN
            SET @sql = N'ALTER TABLE care.visits DROP CONSTRAINT ' + QUOTENAME(@df);
            EXEC sp_executesql @sql;
            PRINT CONCAT('  Dropped default constraint: ', @df);
        END

        -- Drop the column
        SET @sql = N'ALTER TABLE care.visits DROP COLUMN ' + QUOTENAME(@col);
        EXEC sp_executesql @sql;
        PRINT CONCAT('Dropped column: care.visits.', @col);
    END
    ELSE
        PRINT CONCAT('Already absent: care.visits.', @col, ' — skipped');

    FETCH NEXT FROM remaining_cols INTO @col;
END

CLOSE remaining_cols;
DEALLOCATE remaining_cols;
GO


-- =============================================================================
-- VERIFICATION
-- =============================================================================

PRINT '';
PRINT '--- Verification ---';
GO

-- 1. aggregator column must exist and be backfilled
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE  object_id = OBJECT_ID('care.aggregator_submissions')
      AND  name      = 'aggregator'
)
    PRINT 'OK: care.aggregator_submissions.aggregator exists.';
ELSE
    PRINT 'WARNING: care.aggregator_submissions.aggregator still missing!';

SELECT COUNT(*) AS total_submissions,
       SUM(CASE WHEN aggregator = 'sandata' THEN 1 ELSE 0 END) AS backfilled_sandata,
       SUM(CASE WHEN aggregator IS NULL      THEN 1 ELSE 0 END) AS still_null
FROM care.aggregator_submissions;
GO

-- 2. All moved columns must be gone from care.visits
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE  object_id = OBJECT_ID('care.visits')
      AND  name IN (
            'visit_id_sandata',
            'call_in_datetime',  'call_in_latitude',  'call_in_longitude',  'call_in_method',
            'call_out_datetime', 'call_out_latitude', 'call_out_longitude', 'call_out_method',
            'adj_in_datetime',   'adj_out_datetime',
            'evv_status',        'hard_copy_required',
            'billed_units',      'approved_units',    'approval_status',    'reason_code_id'
          )
)
BEGIN
    PRINT 'WARNING: Some moved columns still exist in care.visits!';
    -- List which ones remain
    SELECT name AS remaining_column
    FROM   sys.columns
    WHERE  object_id = OBJECT_ID('care.visits')
      AND  name IN (
            'visit_id_sandata',
            'call_in_datetime',  'call_in_latitude',  'call_in_longitude',  'call_in_method',
            'call_out_datetime', 'call_out_latitude', 'call_out_longitude', 'call_out_method',
            'adj_in_datetime',   'adj_out_datetime',
            'evv_status',        'hard_copy_required',
            'billed_units',      'approved_units',    'approval_status',    'reason_code_id'
          );
END
ELSE
    PRINT 'OK: All moved columns removed from care.visits.';
GO

-- 3. Current columns in care.visits (confirm clean state)
PRINT '';
PRINT 'Current columns in care.visits:';
SELECT name, TYPE_NAME(user_type_id) AS data_type, is_nullable
FROM   sys.columns
WHERE  object_id = OBJECT_ID('care.visits')
ORDER  BY column_id;
GO

PRINT '';
PRINT '================================================================';
PRINT 'Phase 5 Fix COMPLETE.';
PRINT 'If all checks show OK, proceed to Session 2 — db/models.py.';
PRINT '================================================================';
GO
