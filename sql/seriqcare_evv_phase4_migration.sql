-- =============================================================================
-- Migration: EVV Status Rename + response_code column fix
-- Run once against SeriqCareDB
-- =============================================================================

-- 1. Widen response_code to hold full transaction IDs (was VARCHAR(10))
ALTER TABLE care.aggregator_submissions
    ALTER COLUMN response_code VARCHAR(60) NULL;
GO

-- 2. Drop old CHECK constraint FIRST (only if it exists)
IF EXISTS (
    SELECT 1 FROM sys.check_constraints cc
    JOIN sys.tables t ON cc.parent_object_id = t.object_id
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE cc.name = 'CK_visits_evv_status'
      AND s.name = 'care' AND t.name = 'visits'
)
    ALTER TABLE care.visits DROP CONSTRAINT CK_visits_evv_status;
GO

-- 3. Rename visit EVV statuses now that the constraint is gone
UPDATE care.visits SET evv_status = 'Ready'     WHERE evv_status = 'Verified';
UPDATE care.visits SET evv_status = 'Submitted'  WHERE evv_status = 'Processed';
GO

-- 4. Add new CHECK constraint (skip if already exists)
IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints cc
    JOIN sys.tables t ON cc.parent_object_id = t.object_id
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE cc.name = 'CK_visits_evv_status'
      AND s.name = 'care' AND t.name = 'visits'
)
    ALTER TABLE care.visits ADD CONSTRAINT CK_visits_evv_status
        CHECK (evv_status IN ('Ready','Submitted','Incomplete','Omit'));
GO

PRINT 'Migration complete: evv_status renamed, response_code widened.';
