-- =============================================================================
-- SeriqCare EVV - Phase 3 Migration: Performance Indexes + Notifications
-- =============================================================================
-- What this script does:
--   1. Creates care.notifications  (in-app alerts for caregivers/coordinators)
--   2. Adds performance indexes on care.visits, care.schedules,
--      care.visit_exceptions
--
-- Run order : must be run AFTER seriqcare_evv_phase2_migration.sql (or DDL v3+)
-- Target DB : SeriqCareDB, schema = care
-- Idempotent: Safe to re-run; all blocks guarded with IF NOT EXISTS
-- Author    : SeriqCare Engineering
-- Date      : 2026-03-11
-- =============================================================================

USE SeriqCareDB;
GO

-- =============================================================================
-- STEP 1 - care.notifications
-- Stores in-app alerts: visit exceptions, approval events, system messages.
-- user_id NULL + role_target populated  = broadcast to a role within the agency.
-- user_id populated                     = targeted at a specific user.
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'notifications'
)
BEGIN
    CREATE TABLE care.notifications (
        id           INT IDENTITY(1,1)  NOT NULL,
        agency_id    INT                NULL,
        -- NULL = broadcast to role_target within the agency
        user_id      INT                NULL,
        -- 'caregiver' | 'coordinator' | 'agency_admin' | 'super_admin'
        role_target  VARCHAR(20)        NULL,
        -- 'visit_exception' | 'visit_approval' | 'schedule_change' | 'system'
        notif_type   VARCHAR(30)        NOT NULL,
        title        VARCHAR(200)       NOT NULL,
        body         VARCHAR(1000)      NULL,
        -- Optional link to source record
        ref_type     VARCHAR(30)        NULL,   -- 'visit' | 'exception' | 'schedule'
        ref_id       INT                NULL,
        is_read      BIT                NOT NULL DEFAULT 0,
        created_at   DATETIME2          NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS DATETIME2),
        read_at      DATETIME2          NULL,
        CONSTRAINT PK_notifications         PRIMARY KEY (id),
        CONSTRAINT FK_notifications_user
            FOREIGN KEY (user_id)   REFERENCES care.users(id),
        CONSTRAINT FK_notifications_agency
            FOREIGN KEY (agency_id) REFERENCES care.agencies(id),
        CONSTRAINT CK_notifications_type
            CHECK (notif_type IN (
                'visit_exception','visit_approval','schedule_change','system'
            ))
    );
    CREATE INDEX IX_notifications_user_unread
        ON care.notifications (user_id, is_read)
        WHERE is_read = 0;
    CREATE INDEX IX_notifications_agency_role
        ON care.notifications (agency_id, role_target, is_read);
    PRINT 'STEP 1: Table care.notifications created.';
END
ELSE
    PRINT 'STEP 1: care.notifications already exists - skipped.';
GO

-- =============================================================================
-- STEP 2 - Performance indexes on care.visits
-- =============================================================================

-- Coordinator dashboard: list visits by agency + date (most common query)
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_visits_agency_date'
      AND object_id = OBJECT_ID('care.visits')
)
BEGIN
    CREATE INDEX IX_visits_agency_date
        ON care.visits (agency_id, service_date DESC);
    PRINT 'STEP 2a: IX_visits_agency_date created.';
END
ELSE
    PRINT 'STEP 2a: IX_visits_agency_date already exists - skipped.';
GO

-- Caregiver visit history
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_visits_employee_date'
      AND object_id = OBJECT_ID('care.visits')
)
BEGIN
    CREATE INDEX IX_visits_employee_date
        ON care.visits (employee_id, service_date DESC);
    PRINT 'STEP 2b: IX_visits_employee_date created.';
END
ELSE
    PRINT 'STEP 2b: IX_visits_employee_date already exists - skipped.';
GO

-- Coordinator approval queue (Pending + Processed/Verified)
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_visits_approval'
      AND object_id = OBJECT_ID('care.visits')
)
BEGIN
    CREATE INDEX IX_visits_approval
        ON care.visits (approval_status, evv_status)
        INCLUDE (agency_id, service_date);
    PRINT 'STEP 2c: IX_visits_approval created.';
END
ELSE
    PRINT 'STEP 2c: IX_visits_approval already exists - skipped.';
GO

-- =============================================================================
-- STEP 3 - Performance index on care.schedules
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_schedules_employee_start'
      AND object_id = OBJECT_ID('care.schedules')
)
BEGIN
    CREATE INDEX IX_schedules_employee_start
        ON care.schedules (employee_id, scheduled_start);
    PRINT 'STEP 3: IX_schedules_employee_start created.';
END
ELSE
    PRINT 'STEP 3: IX_schedules_employee_start already exists - skipped.';
GO

-- =============================================================================
-- STEP 4 - Performance index on care.visit_exceptions
-- Coordinator exception queue: all unacknowledged exceptions by agency
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_visit_exceptions_unacked'
      AND object_id = OBJECT_ID('care.visit_exceptions')
)
BEGIN
    -- Filtered index: only unacknowledged exceptions (the hot path)
    CREATE INDEX IX_visit_exceptions_unacked
        ON care.visit_exceptions (acknowledged, requires_ack)
        WHERE acknowledged = 0;
    PRINT 'STEP 4: IX_visit_exceptions_unacked created.';
END
ELSE
    PRINT 'STEP 4: IX_visit_exceptions_unacked already exists - skipped.';
GO

-- =============================================================================
-- VERIFICATION
-- =============================================================================
PRINT '=== Phase 3 Migration - Index verification ===';
GO

SELECT
    t.name    AS [table_name],
    i.name    AS [index_name],
    i.type_desc,
    i.has_filter,
    i.filter_definition
FROM sys.indexes i
JOIN sys.tables  t ON i.object_id = t.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
WHERE s.name = 'care'
  AND i.name IN (
      'IX_visits_agency_date',
      'IX_visits_employee_date',
      'IX_visits_approval',
      'IX_schedules_employee_start',
      'IX_visit_exceptions_unacked',
      'IX_notifications_user_unread',
      'IX_notifications_agency_role'
  )
ORDER BY t.name, i.name;
GO

SELECT
    'care.notifications' AS [table_name],
    COUNT(*)             AS [row_count]
FROM care.notifications;
GO

PRINT '=== Phase 3 Migration complete ===';
GO

