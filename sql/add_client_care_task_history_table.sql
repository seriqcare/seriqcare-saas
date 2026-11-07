IF OBJECT_ID('care.client_care_tasks_history', 'U') IS NULL
BEGIN
    CREATE TABLE care.client_care_tasks_history (
        id INT IDENTITY(1,1) PRIMARY KEY,
        client_care_task_id INT NOT NULL,
        client_id INT NOT NULL,
        completed_on DATE NOT NULL,
        completed_at DATETIME2 NULL,
        completed_by_user_id INT NULL,
        completion_notes NVARCHAR(MAX) NULL,
        created_at DATETIME2 NOT NULL CONSTRAINT DF_client_care_tasks_history_created_at DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        CONSTRAINT FK_client_care_tasks_history_task
            FOREIGN KEY (client_care_task_id) REFERENCES care.client_care_tasks(id),
        CONSTRAINT FK_client_care_tasks_history_client
            FOREIGN KEY (client_id) REFERENCES care.clients(id),
        CONSTRAINT FK_client_care_tasks_history_user
            FOREIGN KEY (completed_by_user_id) REFERENCES care.users(id)
    );
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'UX_client_care_tasks_history_task_date'
      AND object_id = OBJECT_ID('care.client_care_tasks_history')
)
BEGIN
    CREATE UNIQUE INDEX UX_client_care_tasks_history_task_date
        ON care.client_care_tasks_history (client_care_task_id, completed_on);
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_client_care_tasks_history_client_date'
      AND object_id = OBJECT_ID('care.client_care_tasks_history')
)
BEGIN
    CREATE INDEX IX_client_care_tasks_history_client_date
        ON care.client_care_tasks_history (client_id, completed_on DESC);
END;
GO

-- care.pay_groups
            IF OBJECT_ID('care.pay_groups', 'U') IS NULL
            BEGIN
                CREATE TABLE care.pay_groups (
                    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                    name VARCHAR(120) NOT NULL,
                    description VARCHAR(500) NULL,
                    created_at DATETIME2 NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
                    updated_at DATETIME2 NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2)
                );
                CREATE UNIQUE INDEX UX_pay_groups_name ON care.pay_groups(name);
            END

            IF OBJECT_ID('care.pay_group_rates', 'U') IS NULL
            BEGIN
                CREATE TABLE care.pay_group_rates (
                    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                    pay_group_id INT NOT NULL,
                    name VARCHAR(120) NOT NULL,
                    pay_type VARCHAR(20) NOT NULL DEFAULT 'Hourly',
                    rate DECIMAL(8,2) NOT NULL DEFAULT 0,
                    applies_on VARCHAR(120) NULL,
                    start_time VARCHAR(20) NULL,
                    end_time VARCHAR(20) NULL,
                    effective_date DATE NULL,
                    sort_order INT NOT NULL DEFAULT 0,
                    is_base_rate BIT NOT NULL DEFAULT 0,
                    created_at DATETIME2 NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
                    updated_at DATETIME2 NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
                    CONSTRAINT FK_pay_group_rates_group FOREIGN KEY (pay_group_id) REFERENCES care.pay_groups(id)
                );
                CREATE INDEX IX_pay_group_rates_group ON care.pay_group_rates(pay_group_id, sort_order, id);
            END

            IF OBJECT_ID('care.employee_payroll_settings', 'U') IS NULL
            BEGIN
                CREATE TABLE care.employee_payroll_settings (
                    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                    employee_id INT NOT NULL,
                    pay_group_id INT NULL,
                    pay_group_rate_id INT NULL,
                    created_at DATETIME2 NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
                    updated_at DATETIME2 NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
                    CONSTRAINT FK_employee_payroll_employee FOREIGN KEY (employee_id) REFERENCES care.employees(id),
                    CONSTRAINT FK_employee_payroll_group FOREIGN KEY (pay_group_id) REFERENCES care.pay_groups(id),
                    CONSTRAINT FK_employee_payroll_rate FOREIGN KEY (pay_group_rate_id) REFERENCES care.pay_group_rates(id)
                );
                CREATE UNIQUE INDEX UX_employee_payroll_employee ON care.employee_payroll_settings(employee_id);
            END
