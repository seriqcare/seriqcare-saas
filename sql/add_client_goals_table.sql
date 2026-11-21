/*
  Goals & Progress: standalone SQL Server migration.
  Select the application's production database in SSMS before running.
  Prerequisite: care.clients must already exist.

  Matches backend/services/migrations.py::_phase7.
  Safe to rerun: existing goals are preserved; no demo records are inserted.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID(N'care.clients', N'U') IS NULL
        THROW 50001, 'care.clients is missing. Select the application database and apply its base schema first.', 1;

    IF OBJECT_ID(N'care.client_goals', N'U') IS NULL
    BEGIN
        CREATE TABLE care.client_goals (
            id INT IDENTITY(1,1) NOT NULL
                CONSTRAINT PK_client_goals PRIMARY KEY,
            client_id INT NOT NULL
                CONSTRAINT FK_client_goals_client REFERENCES care.clients(id),
            title NVARCHAR(200) NOT NULL,
            description NVARCHAR(4000) NOT NULL
                CONSTRAINT DF_client_goals_description DEFAULT N'',
            target_date DATE NULL,
            progress INT NOT NULL
                CONSTRAINT DF_client_goals_progress DEFAULT 0
                CONSTRAINT CK_client_goals_progress CHECK (progress BETWEEN 0 AND 100),
            status VARCHAR(20) NOT NULL
                CONSTRAINT DF_client_goals_status DEFAULT 'Not Started'
                CONSTRAINT CK_client_goals_status CHECK (status IN ('Not Started', 'In Progress', 'Completed', 'On Hold')),
            notes NVARCHAR(4000) NOT NULL
                CONSTRAINT DF_client_goals_notes DEFAULT N'',
            updated_at DATETIME2 NOT NULL
                CONSTRAINT DF_client_goals_updated_at DEFAULT GETUTCDATE()
        );
    END;

    IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'care.client_goals', N'U')
          AND name = N'IX_client_goals_client'
    )
        CREATE INDEX IX_client_goals_client ON care.client_goals(client_id);

    COMMIT TRANSACTION;

    SELECT DB_NAME() AS database_name,
           OBJECT_ID(N'care.client_goals', N'U') AS client_goals_table_id;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
