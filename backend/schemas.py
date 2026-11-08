"""
Pydantic v2 response schemas for the SeriqCare FastAPI backend.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

class VisitByDay(BaseModel):
    date: str
    count: int
    hours: float


class PriorityItem(BaseModel):
    title: str
    sub: str
    type: str


class CaregiverUtilization(BaseModel):
    employee_id: int
    name: str
    scheduled_hours: float
    utilization_pct: float


class DashboardMetrics(BaseModel):
    activeClients: int
    carePlansExpiringSoon: int
    scheduledVisitsThisWeek: int
    openShifts: int
    totalHoursThisWeek: float
    pendingApproval: int
    evvExceptions: int
    urgentExceptions: int
    evvProcessed: int
    evvVerified: int
    evvIncomplete: int
    evvOmit: int
    pendingSubmissions: int
    rejectedSubmissions: int
    visitsByDay: list[VisitByDay]
    priorityQueue: list[PriorityItem]


# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------

class ClientNote(BaseModel):
    title: str
    sub: str
    text: str


class ClientStats(BaseModel):
    total_clients: int
    new_this_month: int
    active_care_plans: int
    due_for_review: int
    assigned_caregivers: int
    multi_staff_cases: int
    doc_flags: int
    urgent_followup: int


class ClientSummary(BaseModel):
    id: int
    client_code: str
    name: str
    age: Optional[int]
    city: Optional[str]
    state: Optional[str]
    status: str
    service_type: Optional[str]
    primary_caregiver: Optional[str]
    next_visit: Optional[str]
    care_plan_status: str
    care_plan_review_date: Optional[str] = None


class ClientDetail(BaseModel):
    id: int
    client_code: str
    first_name: str
    last_name: str
    medicaid_id: Optional[str] = None
    date_of_birth: Optional[str] = None
    gender: Optional[str] = None
    ssn_last4: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    status: str
    # Extended demographics
    primary_language: Optional[str] = None
    secondary_language: Optional[str] = None
    race_ethnicity: Optional[str] = None
    marital_status: Optional[str] = None
    communication_needs: Optional[str] = None
    # Address
    street_address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    county: Optional[str] = None
    # Emergency / guardian
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    emergency_contact_relationship: Optional[str] = None
    legal_guardian: Optional[str] = None
    guardian_phone: Optional[str] = None
    power_of_attorney: Optional[str] = None
    representative_payee: Optional[str] = None
    # Care plan
    care_coordinator: Optional[str] = None
    physician: Optional[str] = None
    level_of_care: Optional[str] = None
    care_plan_review_date: Optional[str] = None
    care_plan_notes: Optional[str] = None


class ClientPayerItem(BaseModel):
    id: int
    payer_id: str
    program: str
    waiver_code: Optional[str] = None
    waiver_name: Optional[str] = None
    effective_date: Optional[str] = None
    end_date: Optional[str] = None
    is_active: bool


class ClientAuthItem(BaseModel):
    id: int
    service_code: str
    service_description: str
    auth_number: Optional[str] = None
    authorized_units: float
    used_units: float
    remaining_units: float
    utilization_pct: float
    service_start_date: Optional[str] = None
    service_end_date: Optional[str] = None
    is_active: bool


class ClientVisitItem(BaseModel):
    id: int
    service_date: str
    service_code: Optional[str] = None
    service_description: Optional[str] = None
    caregiver: Optional[str] = None
    clock_in: Optional[str] = None
    clock_out: Optional[str] = None
    total_hours: float
    evv_status: Optional[str] = None
    approval_status: Optional[str] = None


class ClientsResponse(BaseModel):
    total: int
    page: int
    per_page: int
    stats: ClientStats
    items: list[ClientSummary]


class ClientCareTask(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    specific_time: Optional[str] = None
    recurrence_text: Optional[str] = None
    sort_order: int
    completed_today: bool = False
    completed_on: Optional[str] = None
    completed_at: Optional[str] = None
    completed_by: Optional[str] = None
    completion_notes: Optional[str] = None


class ClientCareTasksResponse(BaseModel):
    client_id: int
    date: str
    items: list[ClientCareTask]


class ClientCareTaskInput(BaseModel):
    id: Optional[int] = None
    title: str
    description: Optional[str] = None
    specific_time: Optional[str] = None
    recurrence_text: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: bool = True


class ClientCareTasksUpdateRequest(BaseModel):
    items: list[ClientCareTaskInput]


class ClientCareTaskCompletionRequest(BaseModel):
    completed: bool = True
    completed_on: Optional[str] = None
    completion_notes: Optional[str] = None


class ClientCareTaskCompletionResponse(BaseModel):
    client_id: int
    task_id: int
    completed: bool
    completed_on: str
    completed_at: Optional[str] = None
    completed_by: Optional[str] = None
    completion_notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Schedule
# ---------------------------------------------------------------------------

class ScheduleStats(BaseModel):
    scheduled_visits: int
    open_shifts: int
    assigned_caregivers: int
    completed_this_week: int
    pending_clock_out: int
    coverage_rate: int
    at_risk_visits: int


class ScheduleEntry(BaseModel):
    id: int
    client_id: int
    client_name: str
    employee_id: Optional[int] = None
    employee_name: Optional[str]
    service_code: Optional[str] = None
    service_type: Optional[str]
    scheduled_start: str
    scheduled_end: str
    status: str
    notes: Optional[str] = None
    day_of_week: int  # 0=Mon … 6=Sun


class ScheduleAlert(BaseModel):
    title: str
    sub: str
    text: str
    pill: str
    cls: str


class ScheduleResponse(BaseModel):
    week_start: str
    week_end: str
    stats: ScheduleStats
    entries: list[ScheduleEntry]
    alerts: list[ScheduleAlert]


class ScheduleCreateRequest(BaseModel):
    client_id: int
    employee_id: Optional[int] = None
    service_code: Optional[str] = None
    scheduled_start: str
    scheduled_end: str
    status: Optional[str] = None
    notes: Optional[str] = None


class ScheduleCreateResponse(BaseModel):
    success: bool
    id: int
    message: str


class ScheduleUpdateRequest(BaseModel):
    client_id: int
    employee_id: Optional[int] = None
    service_code: Optional[str] = None
    scheduled_start: str
    scheduled_end: str
    status: Optional[str] = None
    notes: Optional[str] = None


class ScheduleUpdateResponse(BaseModel):
    success: bool
    id: int
    message: str


# ---------------------------------------------------------------------------
# Visits / Timesheets
# ---------------------------------------------------------------------------

class VisitStats(BaseModel):
    total_hours: float
    pending_approval: int
    approved: int
    evv_exceptions: int


class VisitEntry(BaseModel):
    id: int
    employee_name: str
    employee_code: str
    client_name: str
    service_date: str
    clock_in: Optional[str]
    clock_out: Optional[str]
    total_hours: float
    evv_status: str
    approval_status: str
    clock_in_lat: Optional[float]
    clock_in_lon: Optional[float]
    clock_out_lat: Optional[float]
    clock_out_lon: Optional[float]
    sandata_status: Optional[str] = None
    hhax_status: Optional[str] = None


class VisitsResponse(BaseModel):
    total: int
    page: int
    per_page: int
    stats: VisitStats
    items: list[VisitEntry]


class VisitSubmitResponse(BaseModel):
    success: bool
    visit_id: int
    transaction_id: str
    status: str          # Accepted | Rejected | Simulated
    message: str
    payload: Optional[dict] = None


# ---------------------------------------------------------------------------
# Caregivers
# ---------------------------------------------------------------------------

class CaregiverCreateRequest(BaseModel):
    employee_code: str
    first_name: str
    last_name: str
    phone: Optional[str] = None
    hire_date: Optional[str] = None   # ISO date string YYYY-MM-DD
    is_active: bool = True
    sandata_employee_id: Optional[str] = None
    hhax_employee_id: Optional[str] = None
    npi: Optional[str] = None
    ssn_last5: Optional[str] = None   # Last 5 digits of SSN — Sandata EmployeeSSN (0000#####)
    employee_pin: Optional[str] = None  # 4-digit EVV PIN — required by Sandata (ESC-609)
    # Optional login account creation
    username: Optional[str] = None
    initial_password: Optional[str] = None
    email: Optional[str] = None


class CaregiverCreateResponse(BaseModel):
    success: bool
    id: int
    employee_code: str
    message: str
    sandata_status: Optional[str] = None
    sandata_message: Optional[str] = None


class AgencySettings(BaseModel):
    agencyName: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    website: Optional[str] = None
    timezone: Optional[str] = None
    currency: Optional[str] = None
    defaultHourlyRate: Optional[str] = None
    integration_mode: Optional[str] = None  # 'SANDATA' | 'HHAX'


class AgencySettingsResponse(BaseModel):
    success: bool
    message: str


class PayrollRateItem(BaseModel):
    id: Optional[int] = None
    name: str
    pay_type: str
    rate: float
    applies_on: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    effective_date: Optional[str] = None
    sort_order: int = 0
    is_base_rate: bool = False


class PayrollGroup(BaseModel):
    id: Optional[int] = None
    name: str
    description: Optional[str] = None
    items: list[PayrollRateItem] = []


class PayrollPayPeriod(BaseModel):
    frequency: str = "weekly"
    week_starts_on: Optional[str] = "monday"
    anchor_date: Optional[str] = None
    monthly_day: Optional[int] = None
    semi_monthly_days: list[int] = Field(default_factory=lambda: [1, 15])


class PayrollSettingsResponse(BaseModel):
    groups: list[PayrollGroup]
    pay_period: PayrollPayPeriod


class PayrollSettingsUpdateRequest(BaseModel):
    groups: list[PayrollGroup]
    pay_period: PayrollPayPeriod


class CaregiverPayrollSettingsResponse(BaseModel):
    caregiver_id: int
    pay_group_id: Optional[int] = None
    pay_group_rate_id: Optional[int] = None
    pay_group_name: Optional[str] = None
    pay_rate_name: Optional[str] = None
    pay_type: Optional[str] = None
    pay_rate: Optional[float] = None


class CaregiverPayrollSettingsUpdateRequest(BaseModel):
    pay_group_id: Optional[int] = None
    pay_group_rate_id: Optional[int] = None


class CaregiverPayrollSettingsUpdateResponse(BaseModel):
    success: bool
    caregiver_id: int
    message: str


class CaregiverStats(BaseModel):
    total_caregivers: int
    active: int
    on_leave: int
    inactive: int
    assigned_this_week: int
    total_hours_this_week: float


class CaregiverSummary(BaseModel):
    id: int
    employee_code: str
    name: str
    role: str
    status: str
    hire_date: Optional[str]
    clients_assigned: int
    visits_this_week: int
    hours_this_week: float


class CaregiversResponse(BaseModel):
    total: int
    page: int
    per_page: int
    stats: CaregiverStats
    items: list[CaregiverSummary]


class ClientUpdateRequest(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    date_of_birth: Optional[str] = None
    gender: Optional[str] = None
    primary_language: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    status: Optional[str] = None
    street_address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    county: Optional[str] = None
    medicaid_id: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    emergency_contact_relationship: Optional[str] = None
    legal_guardian: Optional[str] = None
    guardian_phone: Optional[str] = None
    power_of_attorney: Optional[str] = None
    representative_payee: Optional[str] = None
    race_ethnicity: Optional[str] = None
    marital_status: Optional[str] = None
    secondary_language: Optional[str] = None
    communication_needs: Optional[str] = None
    care_coordinator: Optional[str] = None
    physician: Optional[str] = None
    level_of_care: Optional[str] = None
    care_plan_review_date: Optional[str] = None
    care_plan_notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Visit child tables — read (Out) schemas
# ---------------------------------------------------------------------------

class VisitEvvOut(BaseModel):
    call_in_datetime: Optional[str] = None
    call_in_latitude: Optional[float] = None
    call_in_longitude: Optional[float] = None
    call_in_method: Optional[str] = None
    call_out_datetime: Optional[str] = None
    call_out_latitude: Optional[float] = None
    call_out_longitude: Optional[float] = None
    call_out_method: Optional[str] = None
    adj_in_datetime: Optional[str] = None
    adj_out_datetime: Optional[str] = None
    evv_status: str
    hard_copy_required: bool


class VisitBillingOut(BaseModel):
    billed_units: Optional[float] = None
    approved_units: Optional[float] = None
    approval_status: str
    reason_code_id: Optional[int] = None


class VisitIntegrationStatusOut(BaseModel):
    visit_id_sandata: Optional[str] = None
    sandata_status: Optional[str] = None
    sandata_last_at: Optional[str] = None
    hhax_visit_id: Optional[str] = None
    hhax_status: Optional[str] = None
    hhax_last_at: Optional[str] = None
    last_response_message: Optional[str] = None


class VisitDetail(BaseModel):
    id: int
    schedule_id: Optional[int] = None
    client_id: int
    employee_id: int
    service_code_id: int
    service_authorization_id: Optional[int] = None
    agency_id: Optional[int] = None
    service_date: Optional[str] = None
    place_of_service: Optional[str] = None
    visit_cancelled: bool
    notes: Optional[str] = None
    evv: Optional[VisitEvvOut] = None
    billing: Optional[VisitBillingOut] = None
    integration_status: Optional[VisitIntegrationStatusOut] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


# ---------------------------------------------------------------------------
# Visit child tables — write (Update) schemas
# ---------------------------------------------------------------------------

class VisitEvvUpdate(BaseModel):
    call_in_datetime: Optional[str] = None
    call_in_latitude: Optional[float] = None
    call_in_longitude: Optional[float] = None
    call_in_method: Optional[str] = None
    call_out_datetime: Optional[str] = None
    call_out_latitude: Optional[float] = None
    call_out_longitude: Optional[float] = None
    call_out_method: Optional[str] = None
    adj_in_datetime: Optional[str] = None
    adj_out_datetime: Optional[str] = None
    evv_status: Optional[str] = None
    hard_copy_required: Optional[bool] = None


class VisitBillingUpdate(BaseModel):
    billed_units: Optional[float] = None
    approved_units: Optional[float] = None
    approval_status: Optional[str] = None
    reason_code_id: Optional[int] = None


class VisitIntegrationStatusUpdate(BaseModel):
    visit_id_sandata: Optional[str] = None
    sandata_status: Optional[str] = None
    hhax_visit_id: Optional[str] = None
    hhax_status: Optional[str] = None
    last_response_message: Optional[str] = None


# ---------------------------------------------------------------------------
# Aggregator / Sandata submissions
# ---------------------------------------------------------------------------

class AggregatorQueueItem(BaseModel):
    visit_id: int
    service_date: str
    client_name: str
    employee_name: str
    service_code: str
    evv_status: str
    approval_status: str
    sandata_status: Optional[str] = None
    hhax_status: Optional[str] = None
    prior_attempts: int
    last_attempt_at: Optional[str]


class AggregatorQueueResponse(BaseModel):
    total: int
    mode: str       # 'simulate' | 'live'
    items: list[AggregatorQueueItem]


class SubmissionRecord(BaseModel):
    id: int
    visit_id: int
    aggregator: Optional[str] = None
    service_date: Optional[str]
    client_name: Optional[str]
    employee_name: Optional[str]
    submission_type: str
    status: str
    response_code: Optional[str]
    response_message: Optional[str]
    submitted_at: Optional[str]
    transaction_id: Optional[str]


class SubmissionsResponse(BaseModel):
    total: int
    page: int
    per_page: int
    items: list[SubmissionRecord]


class BatchSubmitResponse(BaseModel):
    total_queued: int
    submitted: int
    accepted: int
    rejected: int
    errors: int
    results: list[VisitSubmitResponse]


class ClientUpdateResponse(BaseModel):
    success: bool
    id: int
    message: str


class ClientCreateRequest(BaseModel):
    first_name: str
    last_name: str
    middle_name: Optional[str] = None
    date_of_birth: str                   # YYYY-MM-DD
    medicaid_id: str
    gender: Optional[str] = None
    ssn_last4: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    status: Optional[str] = "Active"
    # Address
    street_address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = "PA"
    zip_code: Optional[str] = None
    # Sandata / Payer
    procedure_code: Optional[str] = None  # HCPCS code for Sandata payer segment


class ClientCreateResponse(BaseModel):
    success: bool
    id: int
    client_code: str
    message: str
    sandata_status: Optional[str] = None
    sandata_message: Optional[str] = None


class VisitFixRequest(BaseModel):
    reason: str
    notes: Optional[str] = None
    clock_in: Optional[str] = None   # e.g. "09:00 AM" or ISO datetime
    clock_out: Optional[str] = None


class VisitFixResponse(BaseModel):
    success: bool
    visit_id: int
    message: str


class VisitValidateResponse(BaseModel):
    success: bool
    visit_id: int
    evv_status: str
    message: str


class VisitValidateAllResponse(BaseModel):
    processed: int
    updated: int
    message: str


# ---------------------------------------------------------------------------
# Timesheets (universal dataset)
# ---------------------------------------------------------------------------

class TimesheetStats(BaseModel):
    total_records: int
    total_hours: float
    pending: int
    approved: int
    exceptions: int


class TimesheetEntry(BaseModel):
    visit_id: int
    employee_code: str
    first_name: str
    last_name: str
    department_code: str
    client_name: str
    client_id: str
    service_date: str
    service_type: str
    scheduled_start: Optional[str]
    scheduled_end: Optional[str]
    clock_in: Optional[str]
    clock_out: Optional[str]
    total_hours: float
    regular_hours: float
    ot_hours: float
    has_gps_in: bool
    has_gps_out: bool
    clock_in_lat: Optional[float]
    clock_in_lon: Optional[float]
    clock_out_lat: Optional[float]
    clock_out_lon: Optional[float]
    evv_status: str
    approval_status: str
    place_of_service: str
    notes: str
    pay_rate: float
    gross_pay: float


class TimesheetAppliedPeriod(BaseModel):
    selection: str
    label: str
    frequency: Optional[str] = None
    start_date: str
    end_date: str


class TimesheetsResponse(BaseModel):
    total: int
    page: int
    per_page: int
    stats: TimesheetStats
    applied_period: TimesheetAppliedPeriod
    items: list[TimesheetEntry]


class TimesheetApproveResponse(BaseModel):
    success: bool
    visit_id: int
    message: str


class TimesheetUpdateRequest(BaseModel):
    scheduled_start: Optional[str] = None
    scheduled_end: Optional[str] = None
    clock_in: Optional[str] = None
    clock_out: Optional[str] = None
    notes: Optional[str] = None


class TimesheetUpdateResponse(BaseModel):
    success: bool
    visit_id: int
    message: str


# ---------------------------------------------------------------------------
# Billing — Phase 1
# ---------------------------------------------------------------------------

class BillingEntry(BaseModel):
    visit_id: int
    service_date: str
    client_name: str
    employee_name: str
    service_code: Optional[str] = None
    billed_units: Optional[float] = None
    approved_units: Optional[float] = None
    evv_status: Optional[str] = None
    approval_status: Optional[str] = None
    sandata_status: Optional[str] = None
    hhax_status: Optional[str] = None
    default_rate: Optional[float] = None
    estimated_amount: Optional[float] = None
    claim_id: Optional[int] = None
    billing_status: str


class BillingStats(BaseModel):
    total_visits: int
    total_units: float
    total_estimated_amount: float
    ready_to_bill: int
    pending_claims: int
    approved: int
    denied: int


class BillingResponse(BaseModel):
    total: int
    page: int
    per_page: int
    stats: BillingStats
    items: list[BillingEntry]


class BillingClaimCreate(BaseModel):
    visit_ids: list[int]
    payer: str   # sandata | hhax | private


class BillingClaimResponse(BaseModel):
    id: int
    claim_date: str
    payer: str
    status: str
    total_units: float
    total_amount: float
    visit_count: int


class AuthUtilizationItem(BaseModel):
    auth_id: int
    client_id: int
    client_name: str
    service_code: Optional[str] = None
    auth_number: Optional[str] = None
    authorized_units: float
    used_units: float
    remaining_units: float
    utilization_pct: float
    service_start_date: str
    service_end_date: str
    days_until_expiry: int
    is_active: bool


class BillingClaimLineItem(BaseModel):
    line_id: int
    visit_id: int
    service_date: str
    client_name: str
    employee_name: str
    service_code: Optional[str] = None
    units: float
    amount: float


class BillingClaimDetail(BaseModel):
    id: int
    claim_date: str
    payer: str
    status: str
    total_units: float
    total_amount: float
    created_at: str
    line_items: list[BillingClaimLineItem]


class BillingClaimListItem(BaseModel):
    id: int
    claim_date: str
    payer: str
    status: str
    total_units: float
    total_amount: float
    visit_count: int
    created_at: str


class BillingClaimListResponse(BaseModel):
    total: int
    page: int
    per_page: int
    items: list[BillingClaimListItem]


class ClaimGroup(BaseModel):
    client_id: int
    client_name: str
    payer: str
    service_authorization_id: Optional[int] = None
    period_start_date: str
    period_end_date: str
    visit_ids: list[int]
    visit_count: int
    total_units: float
    total_amount: float


class ClaimGroupPreview(BaseModel):
    groups: list[ClaimGroup]
    total_groups: int
    total_visits: int
    total_units: float
    total_amount: float


class ClaimStatusUpdate(BaseModel):
    status: str


class BulkGenerateRequest(BaseModel):
    period: str = "this_month"


class BulkGenerateResponse(BaseModel):
    claims_created: int
    total_visits: int
    total_units: float
    total_amount: float
    claim_ids: list[int]
