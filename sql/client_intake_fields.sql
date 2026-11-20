IF COL_LENGTH('care.clients', 'middle_name') IS NULL
    ALTER TABLE care.clients ADD middle_name NVARCHAR(100) NULL;
IF COL_LENGTH('care.clients', 'care_plan_start_date') IS NULL
    ALTER TABLE care.clients ADD care_plan_start_date DATE NULL;
IF COL_LENGTH('care.clients', 'place_of_service') IS NULL
    ALTER TABLE care.clients ADD place_of_service VARCHAR(10) NULL;
IF COL_LENGTH('care.clients', 'intake_service_code_id') IS NULL
    ALTER TABLE care.clients ADD intake_service_code_id INT NULL REFERENCES care.service_codes(id);
IF COL_LENGTH('care.clients', 'care_plan_notes') < 8000
    ALTER TABLE care.clients ALTER COLUMN care_plan_notes NVARCHAR(4000) NULL;
IF COL_LENGTH('care.client_payer_info', 'payer_name') IS NULL
    ALTER TABLE care.client_payer_info ADD payer_name NVARCHAR(100) NULL;
IF COL_LENGTH('care.client_payer_info', 'managed_care_plan') IS NULL
    ALTER TABLE care.client_payer_info ADD managed_care_plan NVARCHAR(100) NULL;
-- Intake can record the payer before an enrollment effective date is known.
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('care.client_payer_info') AND name='effective_date' AND is_nullable=0)
    ALTER TABLE care.client_payer_info ALTER COLUMN effective_date DATE NULL;
IF COL_LENGTH('care.service_authorizations', 'place_of_service') IS NULL
    ALTER TABLE care.service_authorizations ADD place_of_service VARCHAR(10) NULL;
IF COL_LENGTH('care.service_authorizations', 'notes') IS NULL
    ALTER TABLE care.service_authorizations ADD notes NVARCHAR(2000) NULL;
