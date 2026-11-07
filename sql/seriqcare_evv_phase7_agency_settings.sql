-- =============================================================================
-- SeriqCare EVV - Phase 7 Migration: Agency Settings Storage
-- =============================================================================
-- Run this ONCE after the multi-agency schema exists.
-- Safe to re-run - all blocks are guarded with IF NOT EXISTS.
--
-- What this script does:
--   1. Creates care.agency_settings
--   2. Seeds one blank settings row for every existing agency
--
-- Notes:
--   - settings_json stores agency-level settings such as timezone, currency,
--     integration mode, and payroll pay period.
--   - Existing JSON files can be backfilled by the application on first read.
-- =============================================================================

USE SeriqCareDB;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'agency_settings'
)
BEGIN
    CREATE TABLE care.agency_settings (
        agency_id      INT             NOT NULL,
        settings_json  NVARCHAR(MAX)   NOT NULL CONSTRAINT DF_agency_settings_json DEFAULT N'{}',
        created_at     DATETIME2       NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        updated_at     DATETIME2       NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        CONSTRAINT PK_agency_settings PRIMARY KEY (agency_id),
        CONSTRAINT FK_agency_settings_agency FOREIGN KEY (agency_id) REFERENCES care.agencies(id),
        CONSTRAINT CK_agency_settings_json CHECK (ISJSON(settings_json) = 1)
    );

    PRINT 'STEP 1: Table care.agency_settings created.';
END
ELSE
    PRINT 'STEP 1: care.agency_settings already exists - skipped.';
GO

INSERT INTO care.agency_settings (agency_id, settings_json)
SELECT a.id, N'{}'
FROM care.agencies a
LEFT JOIN care.agency_settings s ON s.agency_id = a.id
WHERE s.agency_id IS NULL;
GO