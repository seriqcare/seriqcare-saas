/*
  Run against the application database after the multi-agency schema migration.
  Employee codes can repeat across agencies; (agency_id, employee_code) stays unique.
  Existing NULL-agency records are preserved and treated as one legacy group.
  No employee rows or foreign keys are changed. Safe to re-run.
*/
SET XACT_ABORT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID(N'care.employees', N'U') IS NULL
        THROW 50001, 'care.employees does not exist in this database.', 1;
    IF COL_LENGTH(N'care.employees', N'agency_id') IS NULL
        THROW 50002, 'Apply the multi-agency schema migration first (employees.agency_id is missing).', 1;

    IF EXISTS (
        SELECT agency_id, employee_code
        FROM care.employees
        GROUP BY agency_id, employee_code
        HAVING COUNT(*) > 1
    )
        THROW 50003, 'Duplicate employee codes exist within an agency. Resolve them before retrying.', 1;

    IF EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'care.employees')
          AND name = N'UQ_employees_agency_code'
    )
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM sys.indexes i
            WHERE i.object_id = OBJECT_ID(N'care.employees')
              AND i.name = N'UQ_employees_agency_code'
              AND i.is_unique = 1 AND i.is_disabled = 0 AND i.has_filter = 0
              AND (SELECT COUNT(*) FROM sys.index_columns ic
                   WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
                     AND ic.key_ordinal > 0) = 2
              AND EXISTS (SELECT 1 FROM sys.index_columns ic
                          WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
                            AND ic.key_ordinal = 1
                            AND COL_NAME(ic.object_id, ic.column_id) = N'agency_id')
              AND EXISTS (SELECT 1 FROM sys.index_columns ic
                          WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
                            AND ic.key_ordinal = 2
                            AND COL_NAME(ic.object_id, ic.column_id) = N'employee_code')
        )
            THROW 50004, 'UQ_employees_agency_code exists with an unexpected definition.', 1;
    END
    ELSE
        ALTER TABLE care.employees ADD CONSTRAINT UQ_employees_agency_code
            UNIQUE NONCLUSTERED (agency_id, employee_code);

    -- Establish the replacement before removing global uniqueness.
    IF EXISTS (
        SELECT 1 FROM sys.key_constraints
        WHERE parent_object_id = OBJECT_ID(N'care.employees')
          AND name = N'UQ_employees_code' AND type = 'UQ'
    )
        ALTER TABLE care.employees DROP CONSTRAINT UQ_employees_code;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
