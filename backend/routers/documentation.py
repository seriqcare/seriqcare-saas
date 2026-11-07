"""
Documentation Template Builder — FastAPI router.

Prefix: /api/documentation

Agency isolation is enforced in every service function via AgencyScope.
The service layer loads template versions from DB and validates submission values
against the stored schema — client-submitted metadata is never trusted.

Roles:
  - agency_admin: full CRUD on templates, view all submissions
  - coordinator / supervisor: view templates, create/view submissions, approve
  - caregiver: view published templates, create/save/submit their own submissions

Endpoints:
  Templates:
    GET    /templates                   list templates
    POST   /templates                   create draft template
    GET    /templates/{id}              get template detail (with schema)
    PUT    /templates/{id}              update draft (or clone new version if published)
    POST   /templates/{id}/publish      publish template
    POST   /templates/{id}/archive      archive template
    POST   /templates/{id}/duplicate    duplicate as new draft
    GET    /templates/{id}/fill         get template ready for filling (current published version)

  Submissions:
    GET    /submissions                  list submissions (scoped to agency)
    POST   /submissions                  create/save a submission
    GET    /submissions/{id}             get submission detail
    PUT    /submissions/{id}             update draft submission values
    POST   /submissions/{id}/submit      submit a draft
    POST   /submissions/{id}/review      review/approve a submission
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.auth.dependencies import (
    AgencyScope,
    get_agency_scope,
    get_current_user,
    require_role,
)
from backend.documentation_schemas import (
    DISPLAY_ONLY,
    OPTIONS_REQUIRED,
    SubmissionCreateRequest,
    SubmissionDetail,
    SubmissionListResponse,
    SubmissionReviewRequest,
    SubmissionSubmitRequest,
    SubmissionSummary,
    SubmissionUpdateRequest,
    TemplateCreateRequest,
    TemplateDetail,
    TemplateListResponse,
    TemplateSummary,
    TemplateSchemaBody,
    TemplateUpdateRequest,
)
from db.database import get_db
from db.models import (
    DocumentationSubmission,
    DocumentationTemplate,
    DocumentationTemplateVersion,
    User,
)

log = logging.getLogger("seriqcare.documentation")
router = APIRouter()

_NOW = lambda: datetime.now(timezone.utc).replace(tzinfo=None)  # naive UTC


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _parse_schema(schema_json: Optional[str]) -> Optional[TemplateSchemaBody]:
    """Safely parse schema_json string → TemplateSchemaBody. Returns None on error."""
    if not schema_json:
        return TemplateSchemaBody()
    try:
        return TemplateSchemaBody.model_validate_json(schema_json)
    except Exception:
        return TemplateSchemaBody()


def _get_template_or_404(
    template_id: int,
    db: Session,
    scope: AgencyScope,
) -> DocumentationTemplate:
    """Load template and verify agency ownership."""
    tpl = db.query(DocumentationTemplate).filter(
        DocumentationTemplate.id == template_id
    ).first()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found.")
    scope.assert_access(tpl.agency_id)
    return tpl


def _get_current_version(
    template: DocumentationTemplate, db: Session
) -> Optional[DocumentationTemplateVersion]:
    return (
        db.query(DocumentationTemplateVersion)
        .filter(
            DocumentationTemplateVersion.template_id == template.id,
            DocumentationTemplateVersion.version_number == template.current_version,
        )
        .first()
    )


def _validate_submission_values(
    schema: TemplateSchemaBody,
    values: dict[str, Any],
) -> list[str]:
    """
    Validate submission values against the template schema.
    Returns a list of error messages (empty = valid).

    Values are keyed as "<section.key>.<field.key>" to prevent cross-section
    collisions when multiple sections use the same field key name.
    """
    errors: list[str] = []
    # Build compound-key field map: "<section.key>.<field.key>" → FieldSchema
    all_fields = {
        f"{section.key}.{f.key}": f
        for section in schema.sections
        for f in section.fields
        if f.is_active
    }
    # Validate required and type constraints
    for key, field in all_fields.items():
        if field.type in DISPLAY_ONLY:
            continue  # display-only fields are never in submission values
        value = values.get(key)
        if field.required and (value is None or value == "" or value == []):
            errors.append(f"Field '{field.label}' is required.")
            continue
        if value is None or value == "":
            continue  # optional empty — skip further validation

        # Type validation
        if field.type == "number":
            try:
                num = float(str(value))
                if field.min_value is not None and num < field.min_value:
                    errors.append(
                        f"Field '{field.label}' must be ≥ {field.min_value}."
                    )
                if field.max_value is not None and num > field.max_value:
                    errors.append(
                        f"Field '{field.label}' must be ≤ {field.max_value}."
                    )
            except (ValueError, TypeError):
                errors.append(f"Field '{field.label}' must be a number.")

        elif field.type in {"short_text", "long_text"}:
            s = str(value)
            if field.min_length is not None and len(s) < field.min_length:
                errors.append(
                    f"Field '{field.label}' must be at least {field.min_length} characters."
                )
            if field.max_length is not None and len(s) > field.max_length:
                errors.append(
                    f"Field '{field.label}' must be at most {field.max_length} characters."
                )

        elif field.type in OPTIONS_REQUIRED and field.options:
            allowed_values = {o.value for o in field.options}
            submitted = value if isinstance(value, list) else [value]
            bad = [v for v in submitted if v not in allowed_values]
            if bad:
                errors.append(
                    f"Field '{field.label}' has invalid option(s): {bad}."
                )

        elif field.type == "yes_no":
            if str(value).lower() not in {"yes", "no", "true", "false", "1", "0"}:
                errors.append(f"Field '{field.label}' must be yes or no.")

    return errors


def _lookup_patient_name(patient_id: Optional[int], db: Session) -> Optional[str]:
    if not patient_id:
        return None
    row = db.execute(
        text("SELECT first_name + ' ' + last_name AS name FROM care.clients WHERE id = :id"),
        {"id": patient_id},
    ).fetchone()
    return row.name if row else None


def _lookup_user_name(user_id: Optional[int], db: Session) -> Optional[str]:
    if not user_id:
        return None
    row = db.execute(
        text("SELECT display_name FROM care.users WHERE id = :id"),
        {"id": user_id},
    ).fetchone()
    return row.display_name if row else None


def _to_template_summary(tpl: DocumentationTemplate) -> TemplateSummary:
    return TemplateSummary(
        id=tpl.id,
        name=tpl.name,
        description=tpl.description,
        category=tpl.category,
        status=tpl.status,
        current_version=tpl.current_version,
        created_at=tpl.created_at,
        updated_at=tpl.updated_at,
    )


def _to_template_detail(
    tpl: DocumentationTemplate,
    version: Optional[DocumentationTemplateVersion],
) -> TemplateDetail:
    parsed_schema = _parse_schema(version.schema_json if version else None)
    return TemplateDetail(
        id=tpl.id,
        name=tpl.name,
        description=tpl.description,
        category=tpl.category,
        status=tpl.status,
        current_version=tpl.current_version,
        created_at=tpl.created_at,
        updated_at=tpl.updated_at,
        template_schema=parsed_schema,
        version_id=version.id if version else None,
    )


# ---------------------------------------------------------------------------
# Template endpoints
# ---------------------------------------------------------------------------

@router.get("/templates", response_model=TemplateListResponse)
def list_templates(
    scope: AgencyScope = Depends(get_agency_scope),
    db: Session = Depends(get_db),
    status_filter: Optional[str] = Query(None, alias="status"),
    category: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    take: int = Query(50, ge=1, le=200),
):
    """List all templates for the current agency."""
    conditions = [scope.sql_filter("t")]
    params = scope.bind({"skip": skip, "take": take})

    if status_filter:
        conditions.append("t.status = :status_filter")
        params["status_filter"] = status_filter
    if category:
        conditions.append("t.category = :category")
        params["category"] = category

    where = " AND ".join(conditions)

    total_row = db.execute(
        text(f"SELECT COUNT(*) AS cnt FROM care.documentation_templates t WHERE {where}"),
        params,
    ).fetchone()
    total = total_row.cnt if total_row else 0

    rows = db.execute(
        text(
            f"""
            SELECT t.id, t.name, t.description, t.category, t.status,
                   t.current_version, t.created_at, t.updated_at
            FROM care.documentation_templates t
            WHERE {where}
            ORDER BY t.updated_at DESC, t.id DESC
            OFFSET :skip ROWS FETCH NEXT :take ROWS ONLY
            """
        ),
        params,
    ).fetchall()

    items = [
        TemplateSummary(
            id=r.id, name=r.name, description=r.description,
            category=r.category, status=r.status,
            current_version=r.current_version,
            created_at=r.created_at, updated_at=r.updated_at,
        )
        for r in rows
    ]
    return TemplateListResponse(total=total, items=items)


@router.post("/templates", response_model=TemplateDetail, status_code=201)
def create_template(
    body: TemplateCreateRequest,
    current_user: User = Depends(require_role("coordinator", "agency_admin", "super_admin")),
    db: Session = Depends(get_db),
):
    """Create a new draft template.  Agency admins only."""
    scope = AgencyScope(current_user, db)
    if scope.agency_id is None:
        raise HTTPException(400, "Super admins must specify agency_id via a scoped endpoint.")

    now = _utcnow()
    tpl = DocumentationTemplate(
        agency_id=scope.agency_id,
        name=body.name,
        description=body.description,
        category=body.category,
        status="draft",
        current_version=1,
        created_by=current_user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(tpl)
    db.flush()  # get tpl.id

    version = DocumentationTemplateVersion(
        template_id=tpl.id,
        version_number=1,
        schema_json=body.template_schema.model_dump_json(),
        status="draft",
        created_by=current_user.id,
        created_at=now,
    )
    db.add(version)
    db.commit()
    db.refresh(tpl)

    log.info("[doc] Template %d '%s' created by user %d", tpl.id, tpl.name, current_user.id)
    return _to_template_detail(tpl, version)


@router.get("/templates/{template_id}", response_model=TemplateDetail)
def get_template(
    template_id: int,
    scope: AgencyScope = Depends(get_agency_scope),
    db: Session = Depends(get_db),
    version: Optional[int] = Query(None, description="Specific version number; defaults to current"),
):
    """Get a template with its schema.  Optionally load a specific version."""
    tpl = _get_template_or_404(template_id, db, scope)
    version_number = version if version is not None else tpl.current_version
    ver = (
        db.query(DocumentationTemplateVersion)
        .filter(
            DocumentationTemplateVersion.template_id == tpl.id,
            DocumentationTemplateVersion.version_number == version_number,
        )
        .first()
    )
    return _to_template_detail(tpl, ver)


@router.put("/templates/{template_id}", response_model=TemplateDetail)
def update_template(
    template_id: int,
    body: TemplateUpdateRequest,
    current_user: User = Depends(require_role("coordinator", "agency_admin", "super_admin")),
    db: Session = Depends(get_db),
):
    """
    Update a template.
    - If the template is in 'draft' status: update in place (same version).
    - If the template is 'published': create a new version (immutability rule).
      The template stays published and current_version is bumped.
    Agency admins only.
    """
    scope = AgencyScope(current_user, db)
    tpl = _get_template_or_404(template_id, db, scope)

    now = _utcnow()

    if tpl.status == "archived":
        raise HTTPException(400, "Archived templates cannot be edited.")

    if body.name is not None:
        tpl.name = body.name
    if body.description is not None:
        tpl.description = body.description
    if body.category is not None:
        tpl.category = body.category
    tpl.updated_at = now

    if tpl.status == "draft":
        # Update the draft version in place
        current_ver = _get_current_version(tpl, db)
        if body.template_schema is not None and current_ver:
            current_ver.schema_json = body.template_schema.model_dump_json()
    else:
        # Published: create a new draft version
        current_ver = _get_current_version(tpl, db)
        new_version_number = tpl.current_version + 1
        new_schema = (
            body.template_schema
            if body.template_schema is not None
            else _parse_schema(current_ver.schema_json if current_ver else None)
        )
        new_ver = DocumentationTemplateVersion(
            template_id=tpl.id,
            version_number=new_version_number,
            schema_json=new_schema.model_dump_json() if new_schema else "{}",
            status="draft",
            created_by=current_user.id,
            created_at=now,
        )
        db.add(new_ver)
        tpl.current_version = new_version_number
        tpl.status = "draft"
        current_ver = new_ver

    db.commit()
    db.refresh(tpl)
    log.info("[doc] Template %d updated by user %d", tpl.id, current_user.id)
    return _to_template_detail(tpl, current_ver)


@router.post("/templates/{template_id}/publish", response_model=TemplateDetail)
def publish_template(
    template_id: int,
    current_user: User = Depends(require_role("coordinator", "agency_admin", "super_admin")),
    db: Session = Depends(get_db),
):
    """Publish a draft template.  Agency admins only."""
    scope = AgencyScope(current_user, db)
    tpl = _get_template_or_404(template_id, db, scope)

    if tpl.status == "published":
        raise HTTPException(400, "Template is already published.")
    if tpl.status == "archived":
        raise HTTPException(400, "Archived templates cannot be published.")

    current_ver = _get_current_version(tpl, db)
    if not current_ver:
        raise HTTPException(400, "Template has no version to publish.")

    now = _utcnow()
    tpl.status = "published"
    tpl.updated_at = now
    current_ver.status = "published"

    db.commit()
    db.refresh(tpl)
    log.info("[doc] Template %d published by user %d", tpl.id, current_user.id)
    return _to_template_detail(tpl, current_ver)


@router.post("/templates/{template_id}/archive", response_model=TemplateDetail)
def archive_template(
    template_id: int,
    current_user: User = Depends(require_role("coordinator", "agency_admin", "super_admin")),
    db: Session = Depends(get_db),
):
    """Archive a template.  Archived templates cannot receive new submissions."""
    scope = AgencyScope(current_user, db)
    tpl = _get_template_or_404(template_id, db, scope)

    if tpl.status == "archived":
        raise HTTPException(400, "Template is already archived.")

    now = _utcnow()
    tpl.status = "archived"
    tpl.updated_at = now

    db.commit()
    db.refresh(tpl)
    log.info("[doc] Template %d archived by user %d", tpl.id, current_user.id)
    current_ver = _get_current_version(tpl, db)
    return _to_template_detail(tpl, current_ver)


@router.post("/templates/{template_id}/duplicate", response_model=TemplateDetail, status_code=201)
def duplicate_template(
    template_id: int,
    current_user: User = Depends(require_role("coordinator", "agency_admin", "super_admin")),
    db: Session = Depends(get_db),
):
    """Clone a template as a new draft (name prefixed with 'Copy of ')."""
    scope = AgencyScope(current_user, db)
    original = _get_template_or_404(template_id, db, scope)
    original_ver = _get_current_version(original, db)

    now = _utcnow()
    new_tpl = DocumentationTemplate(
        agency_id=original.agency_id,
        name=f"Copy of {original.name}",
        description=original.description,
        category=original.category,
        status="draft",
        current_version=1,
        created_by=current_user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(new_tpl)
    db.flush()

    new_ver = DocumentationTemplateVersion(
        template_id=new_tpl.id,
        version_number=1,
        schema_json=original_ver.schema_json if original_ver else "{}",
        status="draft",
        created_by=current_user.id,
        created_at=now,
    )
    db.add(new_ver)
    db.commit()
    db.refresh(new_tpl)
    log.info("[doc] Template %d duplicated as %d by user %d", original.id, new_tpl.id, current_user.id)
    return _to_template_detail(new_tpl, new_ver)


@router.get("/templates/{template_id}/fill", response_model=TemplateDetail)
def get_template_for_fill(
    template_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Return the current published version of a template for filling.
    Available to all authenticated agency users (caregivers, coordinators, admins).
    """
    tpl = db.query(DocumentationTemplate).filter(
        DocumentationTemplate.id == template_id
    ).first()
    if not tpl:
        raise HTTPException(404, "Template not found.")

    # Agency isolation — caregivers also belong to an agency
    if current_user.role != "super_admin" and tpl.agency_id != current_user.agency_id:
        raise HTTPException(403, "Access denied.")

    if tpl.status != "published":
        raise HTTPException(400, "Only published templates can be filled.")

    current_ver = _get_current_version(tpl, db)
    return _to_template_detail(tpl, current_ver)


# ---------------------------------------------------------------------------
# Submission endpoints
# ---------------------------------------------------------------------------

@router.get("/submissions", response_model=SubmissionListResponse)
def list_submissions(
    scope: AgencyScope = Depends(get_agency_scope),
    db: Session = Depends(get_db),
    template_id: Optional[int] = Query(None),
    patient_id: Optional[int] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    skip: int = Query(0, ge=0),
    take: int = Query(50, ge=1, le=200),
):
    """List submissions for the current agency."""
    conditions = [scope.sql_filter("s")]
    params = scope.bind({"skip": skip, "take": take})

    if template_id:
        conditions.append("s.template_id = :template_id")
        params["template_id"] = template_id
    if patient_id:
        conditions.append("s.patient_id = :patient_id")
        params["patient_id"] = patient_id
    if status_filter:
        conditions.append("s.status = :status_filter")
        params["status_filter"] = status_filter

    where = " AND ".join(conditions)

    total_row = db.execute(
        text(f"SELECT COUNT(*) AS cnt FROM care.documentation_submissions s WHERE {where}"),
        params,
    ).fetchone()
    total = total_row.cnt if total_row else 0

    rows = db.execute(
        text(
            f"""
            SELECT
                s.id, s.template_id, t.name AS template_name,
                s.template_version_number,
                s.patient_id,
                CASE WHEN s.patient_id IS NOT NULL
                     THEN c.first_name + ' ' + c.last_name ELSE NULL END AS patient_name,
                s.staff_id,
                u.display_name AS staff_name,
                s.status, s.created_at, s.submitted_at, s.updated_at
            FROM care.documentation_submissions s
            JOIN care.documentation_templates t ON t.id = s.template_id
            LEFT JOIN care.clients c ON c.id = s.patient_id
            LEFT JOIN care.users u ON u.id = s.staff_id
            WHERE {where}
            ORDER BY s.updated_at DESC, s.id DESC
            OFFSET :skip ROWS FETCH NEXT :take ROWS ONLY
            """
        ),
        params,
    ).fetchall()

    items = [
        SubmissionSummary(
            id=r.id, template_id=r.template_id, template_name=r.template_name,
            template_version_number=r.template_version_number,
            patient_id=r.patient_id, patient_name=r.patient_name,
            staff_id=r.staff_id, staff_name=r.staff_name,
            status=r.status, created_at=r.created_at,
            submitted_at=r.submitted_at, updated_at=r.updated_at,
        )
        for r in rows
    ]
    return SubmissionListResponse(total=total, items=items)


@router.post("/submissions", response_model=SubmissionDetail, status_code=201)
def create_submission(
    body: SubmissionCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Create or save a draft submission.
    Available to all authenticated agency users.
    On status='submitted', full validation is run before saving.
    """
    # Load template — enforce agency isolation
    tpl = db.query(DocumentationTemplate).filter(
        DocumentationTemplate.id == body.template_id
    ).first()
    if not tpl:
        raise HTTPException(404, "Template not found.")
    if current_user.role != "super_admin" and tpl.agency_id != current_user.agency_id:
        raise HTTPException(403, "Access denied.")
    if tpl.status != "published":
        raise HTTPException(400, "Submissions can only be created against published templates.")

    current_ver = _get_current_version(tpl, db)
    if not current_ver:
        raise HTTPException(400, "Template has no published version.")

    schema = _parse_schema(current_ver.schema_json)

    # Validate on submit; allow incomplete drafts
    if body.status == "submitted":
        errors = _validate_submission_values(schema, body.values)
        if errors:
            raise HTTPException(422, detail={"validation_errors": errors})

    now = _utcnow()
    submission = DocumentationSubmission(
        agency_id=tpl.agency_id,
        template_id=tpl.id,
        template_version_id=current_ver.id,
        template_version_number=current_ver.version_number,
        patient_id=body.patient_id,
        staff_id=current_user.id,
        visit_id=body.visit_id,
        status=body.status,
        values_json=json.dumps(body.values),
        submitted_at=now if body.status == "submitted" else None,
        created_by=current_user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(submission)
    db.commit()
    db.refresh(submission)

    log.info(
        "[doc] Submission %d created (template %d, status=%s) by user %d",
        submission.id, tpl.id, body.status, current_user.id,
    )
    return _build_submission_detail(submission, tpl, current_ver, db)


@router.get("/submissions/{submission_id}", response_model=SubmissionDetail)
def get_submission(
    submission_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get a submission with its values and historic schema."""
    sub = db.query(DocumentationSubmission).filter(
        DocumentationSubmission.id == submission_id
    ).first()
    if not sub:
        raise HTTPException(404, "Submission not found.")
    if current_user.role != "super_admin" and sub.agency_id != current_user.agency_id:
        raise HTTPException(403, "Access denied.")

    # Caregivers can only see their own submissions
    if current_user.role == "caregiver" and sub.staff_id != current_user.id:
        raise HTTPException(403, "Access denied.")

    tpl = db.query(DocumentationTemplate).filter(
        DocumentationTemplate.id == sub.template_id
    ).first()
    ver = db.query(DocumentationTemplateVersion).filter(
        DocumentationTemplateVersion.id == sub.template_version_id
    ).first()
    return _build_submission_detail(sub, tpl, ver, db)


@router.put("/submissions/{submission_id}", response_model=SubmissionDetail)
def update_submission(
    submission_id: int,
    body: SubmissionUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update a draft submission's values.  Only drafts can be updated."""
    sub = db.query(DocumentationSubmission).filter(
        DocumentationSubmission.id == submission_id
    ).first()
    if not sub:
        raise HTTPException(404, "Submission not found.")
    if current_user.role != "super_admin" and sub.agency_id != current_user.agency_id:
        raise HTTPException(403, "Access denied.")
    # Approved submissions are locked; everything else is editable
    if sub.status == "approved":
        raise HTTPException(400, "Approved submissions cannot be edited.")
    # Only the creator or an admin/coordinator can edit
    if current_user.role not in {"agency_admin", "coordinator", "super_admin"} and sub.created_by != current_user.id:
        raise HTTPException(403, "Access denied.")

    now = _utcnow()
    if body.values is not None:
        sub.values_json = json.dumps(body.values)
    if body.patient_id is not None:
        sub.patient_id = body.patient_id
    if body.visit_id is not None:
        sub.visit_id = body.visit_id
    # Revert to draft if it was previously submitted/reviewed so it can be re-submitted
    if sub.status in {"submitted", "reviewed"}:
        sub.status = "draft"
        sub.submitted_at = None
    sub.updated_at = now

    db.commit()
    db.refresh(sub)

    tpl = db.query(DocumentationTemplate).filter(DocumentationTemplate.id == sub.template_id).first()
    ver = db.query(DocumentationTemplateVersion).filter(DocumentationTemplateVersion.id == sub.template_version_id).first()
    return _build_submission_detail(sub, tpl, ver, db)


@router.post("/submissions/{submission_id}/submit", response_model=SubmissionDetail)
def submit_submission(
    submission_id: int,
    body: SubmissionSubmitRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Transition a draft submission to 'submitted'.  Runs full validation."""
    sub = db.query(DocumentationSubmission).filter(
        DocumentationSubmission.id == submission_id
    ).first()
    if not sub:
        raise HTTPException(404, "Submission not found.")
    if current_user.role != "super_admin" and sub.agency_id != current_user.agency_id:
        raise HTTPException(403, "Access denied.")
    if sub.status != "draft":
        raise HTTPException(400, "Only draft submissions can be submitted.")
    if current_user.role == "caregiver" and sub.created_by != current_user.id:
        raise HTTPException(403, "Access denied.")

    # Apply optional last-minute updates
    if body.values is not None:
        sub.values_json = json.dumps(body.values)
    if body.patient_id is not None:
        sub.patient_id = body.patient_id

    ver = db.query(DocumentationTemplateVersion).filter(
        DocumentationTemplateVersion.id == sub.template_version_id
    ).first()
    schema = _parse_schema(ver.schema_json if ver else None)
    values = json.loads(sub.values_json or "{}")

    errors = _validate_submission_values(schema, values)
    if errors:
        raise HTTPException(422, detail={"validation_errors": errors})

    now = _utcnow()
    sub.status = "submitted"
    sub.submitted_at = now
    sub.updated_at = now

    db.commit()
    db.refresh(sub)

    tpl = db.query(DocumentationTemplate).filter(DocumentationTemplate.id == sub.template_id).first()
    log.info("[doc] Submission %d submitted by user %d", sub.id, current_user.id)
    return _build_submission_detail(sub, tpl, ver, db)


@router.post("/submissions/{submission_id}/review", response_model=SubmissionDetail)
def review_submission(
    submission_id: int,
    body: SubmissionReviewRequest,
    current_user: User = Depends(
        require_role("coordinator", "agency_admin", "super_admin")
    ),
    db: Session = Depends(get_db),
):
    """Review or approve a submitted submission.  Coordinators/admins only."""
    sub = db.query(DocumentationSubmission).filter(
        DocumentationSubmission.id == submission_id
    ).first()
    if not sub:
        raise HTTPException(404, "Submission not found.")
    scope = AgencyScope(current_user, db)
    scope.assert_access(sub.agency_id)

    if sub.status not in {"submitted", "reviewed"}:
        raise HTTPException(400, "Only submitted or reviewed submissions can be reviewed.")

    # Map review_status → submission status
    status_map = {"reviewed": "reviewed", "approved": "approved", "rejected": "draft"}
    now = _utcnow()
    sub.status = status_map[body.review_status]
    sub.updated_at = now

    # Write a review record
    db.execute(
        text(
            """
            INSERT INTO care.documentation_submission_reviews
                (submission_id, reviewer_id, review_status, comments, reviewed_at)
            VALUES (:sid, :rid, :rs, :comments, :ts)
            """
        ),
        {
            "sid": sub.id,
            "rid": current_user.id,
            "rs": body.review_status,
            "comments": body.comments,
            "ts": now,
        },
    )
    db.commit()
    db.refresh(sub)

    tpl = db.query(DocumentationTemplate).filter(DocumentationTemplate.id == sub.template_id).first()
    ver = db.query(DocumentationTemplateVersion).filter(DocumentationTemplateVersion.id == sub.template_version_id).first()
    log.info("[doc] Submission %d reviewed (%s) by user %d", sub.id, body.review_status, current_user.id)
    return _build_submission_detail(sub, tpl, ver, db)


# ---------------------------------------------------------------------------
# Shared builder
# ---------------------------------------------------------------------------

def _build_submission_detail(
    sub: DocumentationSubmission,
    tpl: Optional[DocumentationTemplate],
    ver: Optional[DocumentationTemplateVersion],
    db: Session,
) -> SubmissionDetail:
    values = json.loads(sub.values_json or "{}")
    schema = _parse_schema(ver.schema_json if ver else None)
    patient_name = _lookup_patient_name(sub.patient_id, db)
    staff_name = _lookup_user_name(sub.staff_id, db)
    return SubmissionDetail(
        id=sub.id,
        template_id=sub.template_id,
        template_name=tpl.name if tpl else "",
        template_version_id=sub.template_version_id,
        template_version_number=sub.template_version_number,
        patient_id=sub.patient_id,
        patient_name=patient_name,
        staff_id=sub.staff_id,
        staff_name=staff_name,
        visit_id=sub.visit_id,
        status=sub.status,
        values=values,
        template_schema=schema,
        created_at=sub.created_at,
        submitted_at=sub.submitted_at,
        updated_at=sub.updated_at,
    )
