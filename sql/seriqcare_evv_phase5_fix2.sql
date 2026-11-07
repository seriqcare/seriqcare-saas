-- =============================================================================
-- Phase 5 Fix 2: Drop remaining 6 columns from care.visits
--
-- Blocker: IX_visits_approval index references evv_status — must be dropped
--          before evv_status column can be removed.
-- Remaining columns: evv_status, hard_copy_required, billed_units,
--                    approved_units, approval_status, reason_code_id
-- =============================================================================

PRINT '================================================================';
PRINT 'Phase 5 Fix 2: Drop remaining columns from care.visits';
PRINT CONCAT('Timestamp: ', CONVERT(VARCHAR, GETDATE(), 120));
PRINT '================================================================';
GO

-- Step 1: Drop IX_visits_approval index (blocks evv_status column drop)
IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE  name      = 'IX_visits_approval'
      AND  object_id = OBJECT_ID('care.visits')
)
BEGIN
    DROP INDEX IX_visits_approval ON care.visits;
    PRINT 'Dropped index: IX_visits_approval';
END
ELSE
    PRINT 'Index IX_visits_approval not found — skipped';
GO

-- Step 2: Drop any other indexes on care.visits that reference the remaining
--         columns (defensive — catches any additional indexes not yet known)
DECLARE @idx  NVARCHAR(200);
DECLARE @sql  NVARCHAR(500);

DECLARE idx_cursor CURSOR LOCAL FAST_FORWARD FOR
SELECT DISTINCT i.name
FROM   sys.indexes            i
JOIN   sys.index_columns      ic ON ic.object_id   = i.object_id
                                AND ic.index_id    = i.index_id
JOIN   sys.columns            c  ON c.object_id    = ic.object_id
                                AND c.column_id    = ic.column_id
WHERE  i.object_id = OBJECT_ID('care.visits')
  AND  i.is_primary_key = 0          -- never drop the PK
  AND  i.is_unique_constraint = 0    -- leave unique constraints (handled separately)
  AND  c.name IN (
        'evv_status', 'hard_copy_required',
        'billed_units', 'approved_units', 'approval_status', 'reason_code_id'
       );

OPEN idx_cursor;
FETCH NEXT FROM idx_cursor INTO @idx;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'DROP INDEX ' + QUOTENAME(@idx) + N' ON care.visits';
    EXEC sp_executesql @sql;
    PRINT CONCAT('Dropped index: ', @idx);
    FETCH NEXT FROM idx_cursor INTO @idx;
END
CLOSE idx_cursor;
DEALLOCATE idx_cursor;
GO

-- Step 3: Drop the 6 remaining columns
DECLARE @col  NVARCHAR(128);
DECLARE @df   NVARCHAR(200);
DECLARE @sql  NVARCHAR(500);

DECLARE cols CURSOR LOCAL FAST_FORWARD FOR
SELECT col FROM (VALUES
    ('evv_status'),
    ('hard_copy_required'),
    ('billed_units'),
    ('approved_units'),
    ('approval_status'),
    ('reason_code_id')
) AS t(col);

OPEN cols;
FETCH NEXT FROM cols INTO @col;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF EXISTS (
        SELECT 1 FROM sys.columns
        WHERE  object_id = OBJECT_ID('care.visits') AND name = @col
    )
    BEGIN
        -- Reset on every iteration (prevents stale value carry-over)
        SET @df = NULL;

        SELECT TOP 1 @df = dc.name
        FROM   sys.default_constraints dc
        JOIN   sys.columns             c ON c.default_object_id = dc.object_id
        WHERE  c.object_id = OBJECT_ID('care.visits') AND c.name = @col;

        IF @df IS NOT NULL
        BEGIN
            SET @sql = N'ALTER TABLE care.visits DROP CONSTRAINT ' + QUOTENAME(@df);
            EXEC sp_executesql @sql;
            PRINT CONCAT('  Dropped default constraint: ', @df);
        END

        SET @sql = N'ALTER TABLE care.visits DROP COLUMN ' + QUOTENAME(@col);
        EXEC sp_executesql @sql;
        PRINT CONCAT('Dropped column: care.visits.', @col);
    END
    ELSE
        PRINT CONCAT('Already absent: care.visits.', @col, ' — skipped');

    FETCH NEXT FROM cols INTO @col;
END
CLOSE cols;
DEALLOCATE cols;
GO

-- =============================================================================
-- VERIFICATION — Final clean state check
-- =============================================================================

PRINT '';
PRINT '--- Final Verification ---';
GO

-- All moved columns must be gone
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

-- Final column list for care.visits
PRINT '';
PRINT 'Final columns in care.visits:';
SELECT column_id, name, TYPE_NAME(user_type_id) AS data_type,
       is_nullable, ISNULL(dc.definition, '') AS default_value
FROM   sys.columns c
LEFT   JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
WHERE  c.object_id = OBJECT_ID('care.visits')
ORDER  BY column_id;
GO

-- Child table row counts
SELECT 'care.visits'                   AS tbl, COUNT(*) AS rows FROM care.visits
UNION ALL
SELECT 'care.visit_evv',                       COUNT(*) FROM care.visit_evv
UNION ALL
SELECT 'care.visit_billing',                   COUNT(*) FROM care.visit_billing
UNION ALL
SELECT 'care.visit_integration_status',        COUNT(*) FROM care.visit_integration_status;
GO

PRINT '';
PRINT '================================================================';
PRINT 'Phase 5 Fix 2 COMPLETE.';
PRINT 'If all checks show OK — Phase 1 is done.';
PRINT 'Proceed to Session 2: update db/models.py';
PRINT '================================================================';
GO
