"""
Pydantic v2 schemas for the Documentation Template Builder.

JSON schema spec for schema_json stored in DocumentationTemplateVersion:
{
  "sections": [
    {
      "key": "visit_info",
      "title": "Visit Information",
      "description": null,
      "sort_order": 1,
      "fields": [
        {
          "key": "visit_date",
          "type": "date",          // see FIELD_TYPES below
          "label": "Visit Date",
          "help_text": null,
          "placeholder": null,
          "required": true,
          "default_value": null,
          "options": null,         // [{label, value}, ...] for dropdown/radio/checkbox
          "min_length": null,
          "max_length": null,
          "min_value": null,
          "max_value": null,
          "sort_order": 1,
          "width": "full",         // "full" | "half"
          "is_active": true
        }
      ]
    }
  ]
}

Submission values_json: {"field_key": value, ...}
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, field_validator, model_validator

# ---------------------------------------------------------------------------
# Allowed field types
# ---------------------------------------------------------------------------
FIELD_TYPES = {
    "short_text",
    "long_text",
    "number",
    "date",
    "time",
    "datetime",
    "dropdown",
    "radio",
    "checkbox",
    "yes_no",
    "signature_placeholder",
    "file_upload_placeholder",
    "instruction_block",
    "staff_selector",
    "patient_selector",
}

# Types that require an options list
OPTIONS_REQUIRED = {"dropdown", "radio", "checkbox"}

# Display-only types (not validated as inputs)
DISPLAY_ONLY = {"instruction_block", "signature_placeholder", "file_upload_placeholder"}

# ---------------------------------------------------------------------------
# Starter categories
# ---------------------------------------------------------------------------
TEMPLATE_CATEGORIES = [
    "progress_note",
    "service_note",
    "incident_report",
    "medication_log",
    "supervisor_note",
    "care_plan",
    "assessment",
    "other",
]


# ---------------------------------------------------------------------------
# Field schema
# ---------------------------------------------------------------------------

class FieldOption(BaseModel):
    label: str
    value: str


class FieldSchema(BaseModel):
    key: str
    type: str
    label: str
    help_text: Optional[str] = None
    placeholder: Optional[str] = None
    required: bool = False
    default_value: Optional[Any] = None
    options: Optional[list[FieldOption]] = None  # dropdown / radio / checkbox
    min_length: Optional[int] = None
    max_length: Optional[int] = None
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    sort_order: int = 0
    width: Optional[str] = "full"   # "full" | "half"
    is_active: bool = True

    @field_validator("type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        if v not in FIELD_TYPES:
            raise ValueError(f"Unknown field type '{v}'. Allowed: {sorted(FIELD_TYPES)}")
        return v

    @model_validator(mode="after")
    def validate_options_present(self) -> "FieldSchema":
        if self.type in OPTIONS_REQUIRED and not self.options:
            raise ValueError(f"Field type '{self.type}' requires a non-empty options list.")
        return self


class SectionSchema(BaseModel):
    key: str
    title: str
    description: Optional[str] = None
    sort_order: int = 0
    fields: list[FieldSchema] = []


class TemplateSchemaBody(BaseModel):
    """The full schema stored in schema_json."""
    sections: list[SectionSchema] = []


# ---------------------------------------------------------------------------
# Template CRUD
# ---------------------------------------------------------------------------

class TemplateCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    template_schema: TemplateSchemaBody = TemplateSchemaBody()


class TemplateUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    template_schema: Optional[TemplateSchemaBody] = None


class TemplateVersionResponse(BaseModel):
    id: int
    version_number: int
    status: str
    created_at: Optional[datetime]

    model_config = {"from_attributes": True}


class TemplateSummary(BaseModel):
    id: int
    name: str
    description: Optional[str]
    category: Optional[str]
    status: str
    current_version: int
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    model_config = {"from_attributes": True}


class TemplateDetail(BaseModel):
    id: int
    name: str
    description: Optional[str]
    category: Optional[str]
    status: str
    current_version: int
    created_at: Optional[datetime]
    updated_at: Optional[datetime]
    # Parsed schema from the current (or specified) version
    template_schema: Optional[TemplateSchemaBody] = None
    version_id: Optional[int] = None

    model_config = {"from_attributes": True}


class TemplateListResponse(BaseModel):
    total: int
    items: list[TemplateSummary]


# ---------------------------------------------------------------------------
# Submission CRUD
# ---------------------------------------------------------------------------

class SubmissionCreateRequest(BaseModel):
    template_id: int
    patient_id: Optional[int] = None
    visit_id: Optional[int] = None
    values: dict[str, Any] = {}
    # save as draft by default; pass status="submitted" to submit immediately
    status: str = "draft"

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        if v not in {"draft", "submitted"}:
            raise ValueError("status must be 'draft' or 'submitted'.")
        return v


class SubmissionUpdateRequest(BaseModel):
    values: Optional[dict[str, Any]] = None
    patient_id: Optional[int] = None
    visit_id: Optional[int] = None


class SubmissionSubmitRequest(BaseModel):
    """Explicit submit action — transitions draft → submitted."""
    values: Optional[dict[str, Any]] = None  # optional final values update
    patient_id: Optional[int] = None


class SubmissionReviewRequest(BaseModel):
    review_status: str   # reviewed | approved | rejected
    comments: Optional[str] = None

    @field_validator("review_status")
    @classmethod
    def validate_review_status(cls, v: str) -> str:
        if v not in {"reviewed", "approved", "rejected"}:
            raise ValueError("review_status must be 'reviewed', 'approved', or 'rejected'.")
        return v


class SubmissionSummary(BaseModel):
    id: int
    template_id: int
    template_name: str
    template_version_number: int
    patient_id: Optional[int]
    patient_name: Optional[str]
    staff_id: Optional[int]
    staff_name: Optional[str]
    status: str
    created_at: Optional[datetime]
    submitted_at: Optional[datetime]
    updated_at: Optional[datetime]

    model_config = {"from_attributes": True}


class SubmissionDetail(BaseModel):
    id: int
    template_id: int
    template_name: str
    template_version_id: int
    template_version_number: int
    patient_id: Optional[int]
    patient_name: Optional[str]
    staff_id: Optional[int]
    staff_name: Optional[str]
    visit_id: Optional[int]
    status: str
    values: dict[str, Any]
    # The schema used when this submission was created (for exact historic rendering)
    template_schema: Optional[TemplateSchemaBody] = None
    created_at: Optional[datetime]
    submitted_at: Optional[datetime]
    updated_at: Optional[datetime]

    model_config = {"from_attributes": True}


class SubmissionListResponse(BaseModel):
    total: int
    items: list[SubmissionSummary]
