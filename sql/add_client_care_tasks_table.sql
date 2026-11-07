-- =============================================================================
-- care.client_care_tasks - Client-specific recurring care tasks
-- Stores editable task cards shown in the Care Plan tab above Goals & Progress.
-- =============================================================================

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'care' AND TABLE_NAME = 'client_care_tasks'
)
BEGIN
    CREATE TABLE care.client_care_tasks (
        id               INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        client_id        INT               NOT NULL,
        title            VARCHAR(200)      NOT NULL,
        description      VARCHAR(1000)     NULL,
        specific_time    VARCHAR(50)       NULL,
        recurrence_text  VARCHAR(100)      NULL,
        sort_order       INT               NOT NULL DEFAULT 1,
        is_active        BIT               NOT NULL DEFAULT 1,
        created_at       DATETIME2         NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        updated_at       DATETIME2         NULL,
        CONSTRAINT FK_client_care_tasks_client
            FOREIGN KEY (client_id) REFERENCES care.clients(id)
    );

    CREATE INDEX IX_client_care_tasks_client_sort
        ON care.client_care_tasks (client_id, is_active, sort_order);

    PRINT 'care.client_care_tasks created.';
END
ELSE
    PRINT 'care.client_care_tasks already exists - skipping CREATE.';
GO

DECLARE @sample_client_id INT;

SELECT TOP 1 @sample_client_id = id
FROM care.clients
WHERE is_active = 1
ORDER BY id;

IF @sample_client_id IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM care.client_care_tasks WHERE client_id = @sample_client_id
   )
BEGIN
    INSERT INTO care.client_care_tasks (
        client_id,
        title,
        description,
        specific_time,
        recurrence_text,
        sort_order,
        is_active
    )
    VALUES
        (
            @sample_client_id,
            'Daily Metformin and Glucose Tablets',
            'Prompt for Metformin and glucose tablet, support diabetic-friendly diet, and record blood sugar support notes as needed.',
            '5:00 PM',
            '1 time every 1 week',
            1,
            1
        ),
        (
            @sample_client_id,
            'Check Blood Pressure',
            'Assist with checking blood pressure twice weekly, encourage daily exercise, and report unusual readings to the care team.',
            '5:00 PM',
            '1 time every 1 week',
            2,
            1
        ),
        (
            @sample_client_id,
            'Daily Walk',
            'Accompany on gentle walk, supervise use of walking stick, and encourage gardening or light outdoor activity when appropriate.',
            '5:00 PM',
            '1 time every 1 week',
            3,
            1
        );

    PRINT 'Sample client care tasks inserted.';
END
ELSE
    PRINT 'Sample client care tasks skipped.';
GO
