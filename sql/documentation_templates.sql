-- =============================================================================
-- SeriqCare — Documentation Template Builder
-- Migration: create documentation tables in care schema
-- Run once against the target database.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. documentation_templates
--    One row per logical template (draft → published → archived lifecycle).
--    Sections and fields live in documentation_template_versions.schema_json.
-- -----------------------------------------------------------------------------
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'documentation_templates'
)
BEGIN
    CREATE TABLE care.documentation_templates (
        id              INT             NOT NULL IDENTITY(1,1) PRIMARY KEY,
        agency_id       INT             NOT NULL REFERENCES care.agencies(id),
        name            NVARCHAR(200)   NOT NULL,
        description     NVARCHAR(MAX)   NULL,
        category        NVARCHAR(100)   NULL,
        -- status: draft | published | archived
        status          NVARCHAR(20)    NOT NULL DEFAULT 'draft',
        current_version INT             NOT NULL DEFAULT 1,
        created_by      INT             NULL REFERENCES care.users(id),
        created_at      DATETIME        NOT NULL DEFAULT GETUTCDATE(),
        updated_at      DATETIME        NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_doc_templates_agency ON care.documentation_templates (agency_id);
    CREATE INDEX IX_doc_templates_status  ON care.documentation_templates (status);
END;

-- -----------------------------------------------------------------------------
-- 2. documentation_template_versions
--    Immutable snapshot of a template at a point in time.
--    schema_json holds the full section/field tree (see JSON schema spec).
--    Design choice: sections and fields are embedded in schema_json rather than
--    separate tables.  This makes each version a self-contained, immutable
--    document — perfect for rendering historic submissions exactly as they were.
--    Future: if query-by-field is needed, a separate fields table can be added
--    without breaking existing submissions.
-- -----------------------------------------------------------------------------
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'documentation_template_versions'
)
BEGIN
    CREATE TABLE care.documentation_template_versions (
        id              INT             NOT NULL IDENTITY(1,1) PRIMARY KEY,
        template_id     INT             NOT NULL REFERENCES care.documentation_templates(id),
        version_number  INT             NOT NULL,
        -- schema_json: {"sections": [{key, title, description, sort_order, fields: [{...}]}]}
        schema_json     NVARCHAR(MAX)   NULL,
        -- status: draft | published | archived  (mirrors parent template status at publish time)
        status          NVARCHAR(20)    NOT NULL DEFAULT 'draft',
        created_by      INT             NULL REFERENCES care.users(id),
        created_at      DATETIME        NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT UQ_doc_version UNIQUE (template_id, version_number)
    );
    CREATE INDEX IX_doc_versions_template ON care.documentation_template_versions (template_id);
END;

-- -----------------------------------------------------------------------------
-- 3. documentation_submissions
--    One row per submitted (or draft) form completion.
--    values_json: flat map of field_key → value.
--    template_version_id + template_version_number allow rendering the exact
--    schema used at submission time even after new versions are published.
-- -----------------------------------------------------------------------------
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'documentation_submissions'
)
BEGIN
    CREATE TABLE care.documentation_submissions (
        id                      INT             NOT NULL IDENTITY(1,1) PRIMARY KEY,
        agency_id               INT             NOT NULL REFERENCES care.agencies(id),
        template_id             INT             NOT NULL REFERENCES care.documentation_templates(id),
        template_version_id     INT             NOT NULL REFERENCES care.documentation_template_versions(id),
        template_version_number INT             NOT NULL,
        patient_id              INT             NULL REFERENCES care.clients(id),
        staff_id                INT             NULL REFERENCES care.users(id),
        visit_id                INT             NULL REFERENCES care.visits(id),
        -- status: draft | submitted | reviewed | approved
        status                  NVARCHAR(20)    NOT NULL DEFAULT 'draft',
        -- values_json: {"field_key": value, ...}
        values_json             NVARCHAR(MAX)   NULL,
        submitted_at            DATETIME        NULL,
        created_by              INT             NULL REFERENCES care.users(id),
        created_at              DATETIME        NOT NULL DEFAULT GETUTCDATE(),
        updated_at              DATETIME        NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_doc_submissions_agency   ON care.documentation_submissions (agency_id);
    CREATE INDEX IX_doc_submissions_template ON care.documentation_submissions (template_id);
    CREATE INDEX IX_doc_submissions_patient  ON care.documentation_submissions (patient_id);
    CREATE INDEX IX_doc_submissions_status   ON care.documentation_submissions (status);
END;

-- -----------------------------------------------------------------------------
-- 4. documentation_submission_reviews  (lightweight review trail)
-- -----------------------------------------------------------------------------
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'care' AND t.name = 'documentation_submission_reviews'
)
BEGIN
    CREATE TABLE care.documentation_submission_reviews (
        id              INT             NOT NULL IDENTITY(1,1) PRIMARY KEY,
        submission_id   INT             NOT NULL REFERENCES care.documentation_submissions(id),
        reviewer_id     INT             NOT NULL REFERENCES care.users(id),
        -- review_status: reviewed | approved | rejected
        review_status   NVARCHAR(20)    NOT NULL,
        comments        NVARCHAR(MAX)   NULL,
        reviewed_at     DATETIME        NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_doc_reviews_submission ON care.documentation_submission_reviews (submission_id);
END;
