IF OBJECT_ID('care.data_exports', 'U') IS NULL
BEGIN
    CREATE TABLE care.data_exports (
        id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        agency_id INT NOT NULL REFERENCES care.agencies(id),
        kind VARCHAR(10) NOT NULL CHECK (kind IN ('billing', 'payroll')),
        request_id VARCHAR(36) NOT NULL,
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        created_by INT NOT NULL,
        created_by_name NVARCHAR(200) NOT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        provider VARCHAR(20) NOT NULL,
        visit_count INT NOT NULL,
        total_units DECIMAL(18,4) NOT NULL,
        total_hours DECIMAL(18,4) NOT NULL,
        total_amount DECIMAL(18,2) NOT NULL,
        csv_data NVARCHAR(MAX) NOT NULL,
        CONSTRAINT UQ_data_exports_request UNIQUE (agency_id, request_id)
    );
END;
IF OBJECT_ID('care.data_export_items', 'U') IS NULL
BEGIN
    CREATE TABLE care.data_export_items (
        id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        export_id BIGINT NOT NULL REFERENCES care.data_exports(id),
        agency_id INT NOT NULL REFERENCES care.agencies(id),
        kind VARCHAR(10) NOT NULL CHECK (kind IN ('billing', 'payroll')),
        visit_id INT NOT NULL REFERENCES care.visits(id),
        snapshot_json NVARCHAR(MAX) NOT NULL,
        CONSTRAINT UQ_data_export_visit UNIQUE (agency_id, kind, visit_id)
    );
    CREATE INDEX IX_data_export_items_batch ON care.data_export_items(export_id);
END;
