-- =============================================================================
-- Phase 5 Fix 3: Drop final 2 columns from care.visits
--
-- Blocker: CK_visits_approval_status CHECK constraint on approval_status.
-- Remaining: approval_status, reason_code_id
-- =============================================================================

PRINT '================================================================';
PRINT 'Phase 5 Fix 3: Drop final 2 columns from care.visits';
PRINT CONCAT('Timestamp: ', CONVERT(VARCHAR, GETDATE(), 120));
PRINT '================================================================';
GO

-- Step 1: Drop CK_visits_approval_status CHECK constraint
IF EXISTS (
    SELECT 1
    FROM   sys.check_constraints cc
    JOIN   sys.tables  t ON cc.parent_object_id = t.object_id
    JOIN   sys.schemas s ON t.schema_id         = s.schema_id
    WHERE  cc.name = 'CK_visits_approval_status'
      AND  s.name  = 'care'
      AND  t.name  = 'visits'
)
BEGIN
    ALTER TABLE care.visits DROP CONSTRAINT CK_visits_approval_status;
    PRINT 'Dropped constraint: CK_visits_approval_status';
END
ELSE
    PRINT 'CK_visits_approval_status not found — skipped';
GO

-- Step 2: Defensively drop any remaining CHECK constraints on these two columns
DECLARE @cc  NVARCHAR(200);
DECLARE @sql NVARCHAR(500);

DECLARE cc_cursor CURSOR LOCAL FAST_FORWARD FOR
SELECT cc.name
FROM   sys.check_constraints  cc
JOIN   sys.columns            c  ON cc.parent_object_id = c.object_id
                                AND cc.parent_column_id = c.column_id
WHERE  c.object_id = OBJECT_ID('care.visits')
  AND  c.name IN ('approval_status', 'reason_code_id');

OPEN cc_cursor;
FETCH NEXT FROM cc_cursor INTO @cc;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'ALTER TABLE care.visits DROP CONSTRAINT ' + QUOTENAME(@cc);
    EXEC sp_executesql @sql;
    PRINT CONCAT('Dropped check constraint: ', @cc);
    FETCH NEXT FROM cc_cursor INTO @cc;
END
CLOSE cc_cursor;
DEALLOCATE cc_cursor;
GO

-- Step 3: Drop approval_status and reason_code_id
DECLARE @col NVARCHAR(128);
DECLARE @df  NVARCHAR(200);
DECLARE @sql NVARCHAR(500);

DECLARE cols CURSOR LOCAL FAST_FORWARD FOR
SELECT col FROM (VALUES ('approval_status'), ('reason_code_id')) AS t(col);

OPEN cols;
FETCH NEXT FROM cols INTO @col;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF EXISTS (
        SELECT 1 FROM sys.columns
        WHERE  object_id = OBJECT_ID('care.visits') AND name = @col
    )
    BEGIN
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
-- FINAL VERIFICATION
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
    SELECT c.name AS remaining_column
    FROM   sys.columns c
    WHERE  c.object_id = OBJECT_ID('care.visits')
      AND  c.name IN (
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

-- Final column list
PRINT '';
PRINT 'Final columns in care.visits:';
SELECT c.column_id,
       c.name,
       TYPE_NAME(c.user_type_id) AS data_type,
       c.is_nullable,
       ISNULL(dc.definition, '') AS default_value
FROM   sys.columns              c
LEFT   JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
WHERE  c.object_id = OBJECT_ID('care.visits')
ORDER  BY c.column_id;
GO

-- Row count summary
SELECT tbl, rows FROM (
    SELECT 'care.visits'                    AS tbl, COUNT(*) AS rows FROM care.visits
    UNION ALL SELECT 'care.visit_evv',               COUNT(*) FROM care.visit_evv
    UNION ALL SELECT 'care.visit_billing',            COUNT(*) FROM care.visit_billing
    UNION ALL SELECT 'care.visit_integration_status', COUNT(*) FROM care.visit_integration_status
) x ORDER BY tbl;
GO

PRINT '';
PRINT '================================================================';
PRINT 'Phase 5 Fix 3 COMPLETE.';
PRINT 'If all checks show OK — Phase 1 (DB schema) is fully done.';
PRINT 'Proceed to Session 2: update db/models.py';
PRINT '================================================================';
GO
