-- =============================================================================
-- care.timesheet — Universal payroll dataset
-- Denormalized from visits + employees + clients + service_codes
-- This is the single source of truth for all payroll provider exports.
-- Run once to create and populate; re-run the sync block to refresh.
-- =============================================================================

-- ── 1. Create table (idempotent) ──────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'care' AND TABLE_NAME = 'timesheet'
)
BEGIN
    CREATE TABLE care.timesheet (
        id                  INT IDENTITY(1,1)   NOT NULL PRIMARY KEY,
        visit_id            INT                 NULL,   -- FK to visits (NULL = manual entry)
        employee_id         INT                 NOT NULL,
        client_id           INT                 NOT NULL,
        service_code_id     INT                 NOT NULL,

        -- Denormalized employee (no JOIN needed on export)
        employee_code       VARCHAR(20)         NOT NULL,
        first_name          VARCHAR(100)        NOT NULL,
        last_name           VARCHAR(100)        NOT NULL,
        department_code     VARCHAR(100)        NULL,

        -- Denormalized client & service
        client_name         VARCHAR(200)        NOT NULL,
        service_type        VARCHAR(20)         NOT NULL,  -- HCPCS code e.g. W7076
        place_of_service    VARCHAR(10)         NULL DEFAULT '12',

        -- Time
        service_date        DATE                NOT NULL,
        clock_in            DATETIME            NULL,
        clock_out           DATETIME            NULL,
        total_hours         DECIMAL(6,2)        NOT NULL DEFAULT 0,
        regular_hours       DECIMAL(6,2)        NOT NULL DEFAULT 0,
        ot_hours            DECIMAL(6,2)        NOT NULL DEFAULT 0,
        holiday_hours       DECIMAL(6,2)        NOT NULL DEFAULT 0,
        travel_time_hours   DECIMAL(6,2)        NOT NULL DEFAULT 0,

        -- Pay (populated by payroll admin or future pay rate table)
        pay_rate            DECIMAL(8,2)        NOT NULL DEFAULT 0,
        gross_pay           DECIMAL(10,2)       NOT NULL DEFAULT 0,
        differential_type   VARCHAR(50)         NULL,
        differential_amount DECIMAL(8,2)        NOT NULL DEFAULT 0,

        -- Pay period
        pay_period_start    DATE                NULL,
        pay_period_end      DATE                NULL,
        pay_date            DATE                NULL,

        -- GPS
        clock_in_lat        DECIMAL(10,7)       NULL,
        clock_in_lon        DECIMAL(10,7)       NULL,
        clock_out_lat       DECIMAL(10,7)       NULL,
        clock_out_lon       DECIMAL(10,7)       NULL,

        -- Status
        evv_status          VARCHAR(30)         NOT NULL DEFAULT 'Incomplete',
        approval_status     VARCHAR(30)         NOT NULL DEFAULT 'Pending',
        verified            BIT                 NOT NULL DEFAULT 0,
        correction_reason   VARCHAR(500)        NULL,
        notes               TEXT                NULL,

        -- Audit
        created_at          DATETIME            NOT NULL DEFAULT GETDATE(),
        updated_at          DATETIME            NULL,

        CONSTRAINT FK_timesheet_visit
            FOREIGN KEY (visit_id)        REFERENCES care.visits(id),
        CONSTRAINT FK_timesheet_employee
            FOREIGN KEY (employee_id)     REFERENCES care.employees(id),
        CONSTRAINT FK_timesheet_client
            FOREIGN KEY (client_id)       REFERENCES care.clients(id),
        CONSTRAINT FK_timesheet_service_code
            FOREIGN KEY (service_code_id) REFERENCES care.service_codes(id),

        CONSTRAINT UQ_timesheet_visit_id
            UNIQUE (visit_id)   -- one timesheet row per EVV visit
    );

    PRINT 'care.timesheet created.';
END
ELSE
    PRINT 'care.timesheet already exists — skipping CREATE.';
GO

-- ── 2. Populate from visits (idempotent — skips rows already present) ─────────
INSERT INTO care.timesheet (
    visit_id,
    employee_id,    client_id,       service_code_id,
    employee_code,  first_name,      last_name,       department_code,
    client_name,    service_type,    place_of_service,
    service_date,   clock_in,        clock_out,
    total_hours,    regular_hours,   ot_hours,
    clock_in_lat,   clock_in_lon,    clock_out_lat,   clock_out_lon,
    evv_status,     approval_status, verified,
    pay_period_start, pay_period_end, pay_date,
    notes
)
SELECT
    v.id,
    v.employee_id,
    v.client_id,
    v.service_code_id,

    e.employee_code,
    e.first_name,
    e.last_name,
    'DSP',

    c.first_name + ' ' + c.last_name,
    sc.hcpcs_code,
    ISNULL(v.place_of_service, '12'),

    v.service_date,
    COALESCE(v.adj_in_datetime,  v.call_in_datetime),
    COALESCE(v.adj_out_datetime, v.call_out_datetime),

    -- total_hours
    ISNULL(
        CASE WHEN v.call_out_datetime IS NOT NULL
        THEN CAST(DATEDIFF(MINUTE,
            COALESCE(v.adj_in_datetime,  v.call_in_datetime),
            COALESCE(v.adj_out_datetime, v.call_out_datetime)
        ) AS DECIMAL(6,2)) / 60
        ELSE 0 END,
    0),

    -- regular_hours  (capped at 8 h per day)
    ISNULL(
        CASE WHEN v.call_out_datetime IS NOT NULL
        THEN
            CASE
                WHEN DATEDIFF(MINUTE,
                    COALESCE(v.adj_in_datetime,  v.call_in_datetime),
                    COALESCE(v.adj_out_datetime, v.call_out_datetime)) / 60.0 > 8
                THEN 8.00
                ELSE CAST(DATEDIFF(MINUTE,
                    COALESCE(v.adj_in_datetime,  v.call_in_datetime),
                    COALESCE(v.adj_out_datetime, v.call_out_datetime)
                ) AS DECIMAL(6,2)) / 60
            END
        ELSE 0 END,
    0),

    -- ot_hours
    ISNULL(
        CASE WHEN v.call_out_datetime IS NOT NULL
        THEN
            CASE
                WHEN DATEDIFF(MINUTE,
                    COALESCE(v.adj_in_datetime,  v.call_in_datetime),
                    COALESCE(v.adj_out_datetime, v.call_out_datetime)) / 60.0 > 8
                THEN CAST(DATEDIFF(MINUTE,
                    COALESCE(v.adj_in_datetime,  v.call_in_datetime),
                    COALESCE(v.adj_out_datetime, v.call_out_datetime)
                ) AS DECIMAL(6,2)) / 60 - 8.00
                ELSE 0
            END
        ELSE 0 END,
    0),

    CAST(v.call_in_latitude   AS DECIMAL(10,7)),
    CAST(v.call_in_longitude  AS DECIMAL(10,7)),
    CAST(v.call_out_latitude  AS DECIMAL(10,7)),
    CAST(v.call_out_longitude AS DECIMAL(10,7)),

    v.evv_status,
    v.approval_status,
    CASE WHEN v.evv_status IN ('Processed', 'Verified') THEN 1 ELSE 0 END,

    v.service_date,   -- pay_period_start (= service date until pay calendar is built)
    v.service_date,   -- pay_period_end
    v.service_date,   -- pay_date

    v.notes

FROM care.visits v
JOIN care.employees     e  ON v.employee_id     = e.id
JOIN care.clients       c  ON v.client_id       = c.id
JOIN care.service_codes sc ON v.service_code_id = sc.id
WHERE v.visit_cancelled = 0
  AND NOT EXISTS (
      SELECT 1 FROM care.timesheet t WHERE t.visit_id = v.id
  );

PRINT CAST(@@ROWCOUNT AS VARCHAR) + ' timesheet record(s) inserted.';
GO

-- ── 3. Sync helper — call this after any visit is created or updated ───────────
-- Usage: EXEC care.usp_sync_timesheet_from_visit @visit_id = 5;
IF OBJECT_ID('care.usp_sync_timesheet_from_visit', 'P') IS NOT NULL
    DROP PROCEDURE care.usp_sync_timesheet_from_visit;
GO

CREATE PROCEDURE care.usp_sync_timesheet_from_visit
    @visit_id INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE
        @total_h   DECIMAL(6,2),
        @regular_h DECIMAL(6,2),
        @ot_h      DECIMAL(6,2);

    SELECT
        @total_h = ISNULL(
            CASE WHEN v.call_out_datetime IS NOT NULL
            THEN CAST(DATEDIFF(MINUTE,
                COALESCE(v.adj_in_datetime, v.call_in_datetime),
                COALESCE(v.adj_out_datetime, v.call_out_datetime)
            ) AS DECIMAL(6,2)) / 60
            ELSE 0 END, 0)
    FROM care.visits v WHERE v.id = @visit_id;

    SET @regular_h = CASE WHEN @total_h > 8 THEN 8 ELSE @total_h END;
    SET @ot_h      = CASE WHEN @total_h > 8 THEN @total_h - 8 ELSE 0 END;

    IF EXISTS (SELECT 1 FROM care.timesheet WHERE visit_id = @visit_id)
    BEGIN
        UPDATE t SET
            clock_in        = COALESCE(v.adj_in_datetime,  v.call_in_datetime),
            clock_out       = COALESCE(v.adj_out_datetime, v.call_out_datetime),
            total_hours     = @total_h,
            regular_hours   = @regular_h,
            ot_hours        = @ot_h,
            clock_in_lat    = CAST(v.call_in_latitude   AS DECIMAL(10,7)),
            clock_in_lon    = CAST(v.call_in_longitude  AS DECIMAL(10,7)),
            clock_out_lat   = CAST(v.call_out_latitude  AS DECIMAL(10,7)),
            clock_out_lon   = CAST(v.call_out_longitude AS DECIMAL(10,7)),
            evv_status      = v.evv_status,
            approval_status = v.approval_status,
            verified        = CASE WHEN v.evv_status IN ('Processed','Verified') THEN 1 ELSE 0 END,
            notes           = v.notes,
            updated_at      = GETDATE()
        FROM care.timesheet t
        JOIN care.visits v ON t.visit_id = v.id
        WHERE t.visit_id = @visit_id;
    END
    ELSE
    BEGIN
        INSERT INTO care.timesheet (
            visit_id, employee_id, client_id, service_code_id,
            employee_code, first_name, last_name, department_code,
            client_name, service_type, place_of_service,
            service_date, clock_in, clock_out,
            total_hours, regular_hours, ot_hours,
            clock_in_lat, clock_in_lon, clock_out_lat, clock_out_lon,
            evv_status, approval_status, verified,
            pay_period_start, pay_period_end, pay_date, notes
        )
        SELECT
            v.id, v.employee_id, v.client_id, v.service_code_id,
            e.employee_code, e.first_name, e.last_name, 'DSP',
            c.first_name + ' ' + c.last_name, sc.hcpcs_code, ISNULL(v.place_of_service,'12'),
            v.service_date,
            COALESCE(v.adj_in_datetime, v.call_in_datetime),
            COALESCE(v.adj_out_datetime, v.call_out_datetime),
            @total_h, @regular_h, @ot_h,
            CAST(v.call_in_latitude  AS DECIMAL(10,7)),
            CAST(v.call_in_longitude AS DECIMAL(10,7)),
            CAST(v.call_out_latitude AS DECIMAL(10,7)),
            CAST(v.call_out_longitude AS DECIMAL(10,7)),
            v.evv_status, v.approval_status,
            CASE WHEN v.evv_status IN ('Processed','Verified') THEN 1 ELSE 0 END,
            v.service_date, v.service_date, v.service_date,
            v.notes
        FROM care.visits v
        JOIN care.employees     e  ON v.employee_id     = e.id
        JOIN care.clients       c  ON v.client_id       = c.id
        JOIN care.service_codes sc ON v.service_code_id = sc.id
        WHERE v.id = @visit_id AND v.visit_cancelled = 0;
    END
END;
GO

-- -- Quick smoke test — should UPDATE all 6 existing rows without error
-- EXEC care.usp_sync_timesheet_from_visit @visit_id = 1;
-- EXEC care.usp_sync_timesheet_from_visit @visit_id = 2;
-- SELECT id, visit_id, first_name, last_name, total_hours, evv_status FROM care.timesheet;

PRINT 'care.usp_sync_timesheet_from_visit created.';
