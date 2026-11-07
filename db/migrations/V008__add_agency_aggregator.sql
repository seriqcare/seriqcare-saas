-- V008: Add aggregator column to care.agencies
-- Values: NULL (core — no EVV), 'sandata', 'hhax'
-- Run once before restarting the backend.

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE  object_id = OBJECT_ID('care.agencies')
      AND  name      = 'aggregator'
)
    ALTER TABLE care.agencies
        ADD aggregator VARCHAR(10) NULL
        CONSTRAINT CK_agencies_aggregator CHECK (aggregator IN ('sandata', 'hhax'));

-- Verify
SELECT id, agency_code, tier, aggregator FROM care.agencies;
