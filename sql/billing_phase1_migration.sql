-- =============================================================================
-- SeriqCare Billing -- Phase 1 Migration
-- Target DB : SeriqCareDB, schema = care
-- Run as   : sql/billing_phase1_migration.sql
-- Idempotent: safe to re-run; all blocks guarded with IF NOT EXISTS / IF OBJECT_ID
--
-- Steps:
--   1. Add default_rate to care.service_codes
--   2. Create care.billing_claims (header table)
--   3. Create care.billing_claim_visits (line items)
--   4. Manual seed reminder for default_rate values
-- =============================================================================


GO

PRINT '================================================================';
PRINT 'SeriqCare Billing Phase 1 Migration';
PRINT CONCAT('Timestamp: ', CONVERT(VARCHAR, GETDATE(), 120));
PRINT '================================================================';
GO

-- =============================================================================
-- STEP 1: Add default_rate to care.service_codes
-- Pilot billing rate per unit. Dollars = COALESCE(approved_units, billed_units) * default_rate.
-- Long-term: replace with care.fee_schedule + auth-level overrides.
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('care.service_codes')
      AND name = 'default_rate'
)
BEGIN
    ALTER TABLE care.service_codes
        ADD default_rate DECIMAL(10,2) NULL;
    PRINT 'STEP 1: Column default_rate added to care.service_codes.';
END
ELSE
    PRINT 'STEP 1: Column default_rate already exists on care.service_codes - skipped.';
GO

-- =============================================================================
-- STEP 2: Create care.billing_claims (claim header table)
-- One row per generated claim batch. Line items live in billing_claim_visits.
-- Status vocabulary: Draft | Ready | Submitted | Paid | Denied | Voided
-- Payer vocabulary:  sandata | hhax | private
-- =============================================================================
IF OBJECT_ID('care.billing_claims', 'U') IS NULL
BEGIN
    CREATE TABLE care.billing_claims (
        id            INT IDENTITY(1,1)  NOT NULL,
        agency_id     INT                NULL,
        claim_date    DATE               NOT NULL CONSTRAINT DF_billing_claims_date    DEFAULT CAST(CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2) AS DATE),
        -- sandata | hhax | private
        payer         VARCHAR(50)        NOT NULL,
        -- Draft | Ready | Submitted | Paid | Denied | Voided
        status        VARCHAR(30)        NOT NULL CONSTRAINT DF_billing_claims_status  DEFAULT 'Draft',
        total_units   DECIMAL(10,2)      NULL,
        total_amount  DECIMAL(10,2)      NULL,
        created_at    DATETIME2          NOT NULL CONSTRAINT DF_billing_claims_ca      DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        updated_at    DATETIME2          NOT NULL CONSTRAINT DF_billing_claims_ua      DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),

        CONSTRAINT PK_billing_claims         PRIMARY KEY (id),
        CONSTRAINT FK_billing_claims_agency
            FOREIGN KEY (agency_id) REFERENCES care.agencies(id),
        CONSTRAINT CK_billing_claims_status
            CHECK (status IN ('Draft','Ready','Submitted','Paid','Denied','Voided')),
        CONSTRAINT CK_billing_claims_payer
            CHECK (payer IN ('sandata','hhax','private'))
    );
    CREATE INDEX IX_billing_claims_agency_date
        ON care.billing_claims (agency_id, claim_date DESC);
    PRINT 'STEP 2: Table care.billing_claims created.';
END
ELSE
    PRINT 'STEP 2: Table care.billing_claims already exists - skipped.';
GO

-- =============================================================================
-- STEP 3: Create care.billing_claim_visits (line items)
-- Links each visit to a claim. Stores the units and estimated amount at claim time.
-- UQ_billing_claim_visit ensures a visit can only appear once per claim.
-- =============================================================================
IF OBJECT_ID('care.billing_claim_visits', 'U') IS NULL
BEGIN
    CREATE TABLE care.billing_claim_visits (
        id         INT IDENTITY(1,1)  NOT NULL,
        claim_id   INT                NOT NULL,
        visit_id   INT                NOT NULL,
        units      DECIMAL(10,2)      NULL,
        amount     DECIMAL(10,2)      NULL,
        created_at DATETIME2          NOT NULL CONSTRAINT DF_billing_claim_visits_ca DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),

        CONSTRAINT PK_billing_claim_visits  PRIMARY KEY (id),
        CONSTRAINT UQ_billing_claim_visit   UNIQUE (claim_id, visit_id),
        CONSTRAINT FK_bcv_claim
            FOREIGN KEY (claim_id) REFERENCES care.billing_claims(id),
        CONSTRAINT FK_bcv_visit
            FOREIGN KEY (visit_id) REFERENCES care.visits(id)
    );
    CREATE INDEX IX_billing_claim_visits_visit
        ON care.billing_claim_visits (visit_id);
    PRINT 'STEP 3: Table care.billing_claim_visits created.';
END
ELSE
    PRINT 'STEP 3: Table care.billing_claim_visits already exists - skipped.';
GO

-- =============================================================================
-- STEP 4: Seed default_rate values (manual - update per agency rate schedule)
-- Uncomment and edit the lines below with actual rates for your HCPCS codes.
-- Example ODP Consolidated Waiver rates (PA FY2026 - verify with your MA rep):
-- =============================================================================
-- UPDATE care.service_codes SET default_rate = 18.50 WHERE hcpcs_code = 'W7273';
-- UPDATE care.service_codes SET default_rate = 12.00 WHERE hcpcs_code = 'W7274';
-- UPDATE care.service_codes SET default_rate = 22.75 WHERE hcpcs_code = 'W7275';

PRINT 'STEP 4: Manual seed required - UPDATE care.service_codes SET default_rate = <value>';
PRINT '        Edit the seed lines at the bottom of this script for your HCPCS codes.';
PRINT '';
PRINT '================================================================';
PRINT 'Billing Phase 1 Migration complete.';
PRINT '================================================================';
GO

