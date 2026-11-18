IF OBJECT_ID('care.agency_service_rates', 'U') IS NULL
BEGIN
    CREATE TABLE care.agency_service_rates (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        agency_id INT NOT NULL REFERENCES care.agencies(id),
        service_code_id INT NOT NULL REFERENCES care.service_codes(id),
        rate_per_unit DECIMAL(10,2) NOT NULL CHECK (rate_per_unit >= 0),
        effective_from DATE NOT NULL,
        effective_to DATE NULL,
        updated_by INT NULL,
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_agency_service_rate_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
    );
    CREATE INDEX IX_agency_service_rates_lookup
        ON care.agency_service_rates(agency_id, service_code_id, effective_from, effective_to);
END
