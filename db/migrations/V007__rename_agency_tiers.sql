-- V007: Rename agency tier values to core / evv / evvplus
-- Run once against the care database before restarting the backend.

-- Step 1: Remap existing tier values
UPDATE care.agencies SET tier = 'core'    WHERE tier IN ('basic', 'standard');
UPDATE care.agencies SET tier = 'evv'     WHERE tier = 'premium';
UPDATE care.agencies SET tier = 'evvplus' WHERE tier = 'enterprise';
-- Catch-all: any remaining unrecognised value defaults to 'core'
UPDATE care.agencies SET tier = 'core'
WHERE tier NOT IN ('core', 'evv', 'evvplus');

-- Step 2: Drop old CHECK constraint
IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE  name = 'CK_agencies_tier'
      AND  parent_object_id = OBJECT_ID('care.agencies')
)
    ALTER TABLE care.agencies DROP CONSTRAINT CK_agencies_tier;

-- Step 3: Add new CHECK constraint
IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE  name = 'CK_agencies_tier_v2'
      AND  parent_object_id = OBJECT_ID('care.agencies')
)
    ALTER TABLE care.agencies ADD CONSTRAINT CK_agencies_tier_v2
        CHECK (tier IN ('core', 'evv', 'evvplus'));

-- Step 4: Replace column DEFAULT ('standard' -> 'core')
--         SQL Server uses a named default constraint; find and drop the existing one first.
DECLARE @df NVARCHAR(200);
SELECT @df = dc.name
FROM   sys.default_constraints dc
JOIN   sys.columns c
       ON  dc.parent_object_id = c.object_id
       AND dc.parent_column_id = c.column_id
WHERE  dc.parent_object_id = OBJECT_ID('care.agencies')
  AND  c.name = 'tier';
IF @df IS NOT NULL
    EXEC('ALTER TABLE care.agencies DROP CONSTRAINT ' + @df);

ALTER TABLE care.agencies
    ADD CONSTRAINT DF_agencies_tier DEFAULT 'core' FOR tier;

-- Verify
SELECT DISTINCT tier FROM care.agencies;
