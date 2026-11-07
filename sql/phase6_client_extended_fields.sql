-- =============================================================================
-- Phase 6: Extended client profile columns
-- Run once on your SQL Server database.
-- Safe to re-run — each statement checks before altering.
-- =============================================================================

-- care.clients extended demographics
IF COL_LENGTH('care.clients', 'primary_language') IS NULL
    ALTER TABLE care.clients ADD primary_language VARCHAR(50) NULL;

IF COL_LENGTH('care.clients', 'secondary_language') IS NULL
    ALTER TABLE care.clients ADD secondary_language VARCHAR(50) NULL;

IF COL_LENGTH('care.clients', 'race_ethnicity') IS NULL
    ALTER TABLE care.clients ADD race_ethnicity VARCHAR(50) NULL;

IF COL_LENGTH('care.clients', 'marital_status') IS NULL
    ALTER TABLE care.clients ADD marital_status VARCHAR(30) NULL;

IF COL_LENGTH('care.clients', 'communication_needs') IS NULL
    ALTER TABLE care.clients ADD communication_needs VARCHAR(200) NULL;

-- Emergency contact
IF COL_LENGTH('care.clients', 'emergency_contact_name') IS NULL
    ALTER TABLE care.clients ADD emergency_contact_name VARCHAR(200) NULL;

IF COL_LENGTH('care.clients', 'emergency_contact_phone') IS NULL
    ALTER TABLE care.clients ADD emergency_contact_phone VARCHAR(20) NULL;

IF COL_LENGTH('care.clients', 'emergency_contact_relationship') IS NULL
    ALTER TABLE care.clients ADD emergency_contact_relationship VARCHAR(50) NULL;

-- Guardian / legal representative
IF COL_LENGTH('care.clients', 'legal_guardian') IS NULL
    ALTER TABLE care.clients ADD legal_guardian VARCHAR(200) NULL;

IF COL_LENGTH('care.clients', 'guardian_phone') IS NULL
    ALTER TABLE care.clients ADD guardian_phone VARCHAR(20) NULL;

IF COL_LENGTH('care.clients', 'power_of_attorney') IS NULL
    ALTER TABLE care.clients ADD power_of_attorney VARCHAR(200) NULL;

IF COL_LENGTH('care.clients', 'representative_payee') IS NULL
    ALTER TABLE care.clients ADD representative_payee VARCHAR(200) NULL;

-- Care plan detail
IF COL_LENGTH('care.clients', 'care_coordinator') IS NULL
    ALTER TABLE care.clients ADD care_coordinator VARCHAR(200) NULL;

IF COL_LENGTH('care.clients', 'physician') IS NULL
    ALTER TABLE care.clients ADD physician VARCHAR(200) NULL;

IF COL_LENGTH('care.clients', 'level_of_care') IS NULL
    ALTER TABLE care.clients ADD level_of_care VARCHAR(50) NULL;

-- care.client_addresses county
IF COL_LENGTH('care.client_addresses', 'county') IS NULL
    ALTER TABLE care.client_addresses ADD county VARCHAR(50) NULL;

PRINT 'Phase 6 migration complete.';
GO
