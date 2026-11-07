"""
SQLAlchemy 2.0 ORM models for SeriqCareDB — care schema.
All 16 tables are mapped here using the Mapped / mapped_column style.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.database import Base

_SCHEMA = "care"


# ---------------------------------------------------------------------------
# Reference tables
# ---------------------------------------------------------------------------

class Waiver(Base):
    __tablename__ = "waivers"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    waiver_code: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    waiver_name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    service_codes: Mapped[list["ServiceCode"]] = relationship(back_populates="waiver")


class ServiceCode(Base):
    __tablename__ = "service_codes"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    hcpcs_code: Mapped[str] = mapped_column(String(10), nullable=False, unique=True)
    description: Mapped[str] = mapped_column(String(300), nullable=False)
    waiver_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.waivers.id")
    )
    place_of_service: Mapped[Optional[str]] = mapped_column(String(10))
    unit_type: Mapped[Optional[str]] = mapped_column(String(20))
    minutes_per_unit: Mapped[Optional[int]] = mapped_column(Integer)
    max_daily_units: Mapped[Optional[int]] = mapped_column(Integer)
    effective_date: Mapped[Optional[date]] = mapped_column(Date)
    end_date: Mapped[Optional[date]] = mapped_column(Date)
    is_evv_required: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    waiver: Mapped[Optional["Waiver"]] = relationship(back_populates="service_codes")
    service_authorizations: Mapped[list["ServiceAuthorization"]] = relationship(
        back_populates="service_code"
    )
    schedules: Mapped[list["Schedule"]] = relationship(back_populates="service_code")
    visits: Mapped[list["Visit"]] = relationship(back_populates="service_code")


class EvvErrorCode(Base):
    __tablename__ = "evv_error_codes"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    esc_code: Mapped[str] = mapped_column(String(10), nullable=False, unique=True)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    severity: Mapped[Optional[str]] = mapped_column(String(20))
    action_required: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    visit_exceptions: Mapped[list["VisitException"]] = relationship(
        back_populates="esc_code"
    )


class ReasonCode(Base):
    __tablename__ = "reason_codes"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    reason_code: Mapped[str] = mapped_column(String(10), nullable=False, unique=True)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    applies_to: Mapped[Optional[str]] = mapped_column(String(50))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    visit_billings: Mapped[list["VisitBilling"]] = relationship(back_populates="reason_code")
    visit_changes: Mapped[list["VisitChange"]] = relationship(
        back_populates="reason_code"
    )
    visit_exceptions: Mapped[list["VisitException"]] = relationship(
        back_populates="reason_code"
    )


# ---------------------------------------------------------------------------
# Core operational tables
# ---------------------------------------------------------------------------

class Provider(Base):
    __tablename__ = "providers"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    provider_code: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    sandata_provider_id: Mapped[Optional[str]] = mapped_column(String(50))
    npi: Mapped[Optional[str]] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    address_line1: Mapped[Optional[str]] = mapped_column(String(200))
    address_line2: Mapped[Optional[str]] = mapped_column(String(200))
    city: Mapped[Optional[str]] = mapped_column(String(100))
    state: Mapped[Optional[str]] = mapped_column(String(2))
    zip_code: Mapped[Optional[str]] = mapped_column(String(10))
    phone: Mapped[Optional[str]] = mapped_column(String(20))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    service_authorizations: Mapped[list["ServiceAuthorization"]] = relationship(
        back_populates="provider"
    )


class Client(Base):
    __tablename__ = "clients"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_code: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    medicaid_id: Mapped[Optional[str]] = mapped_column(String(20))
    hhax_member_id: Mapped[Optional[str]] = mapped_column(String(50))
    hhax_branch_id: Mapped[Optional[str]] = mapped_column(String(50))
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    date_of_birth: Mapped[Optional[date]] = mapped_column(Date)
    gender: Mapped[Optional[str]] = mapped_column(String(10))
    ssn_last4: Mapped[Optional[str]] = mapped_column(String(4))
    ma_county: Mapped[Optional[str]] = mapped_column(String(50))
    phone: Mapped[Optional[str]] = mapped_column(String(20))
    email: Mapped[Optional[str]] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="Active", nullable=False)
    care_plan_review_date: Mapped[Optional[date]] = mapped_column(Date)
    care_plan_notes: Mapped[Optional[str]] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    addresses: Mapped[list["ClientAddress"]] = relationship(back_populates="client")
    care_tasks: Mapped[list["ClientCareTask"]] = relationship(back_populates="client")
    payer_info: Mapped[list["ClientPayerInfo"]] = relationship(back_populates="client")
    service_authorizations: Mapped[list["ServiceAuthorization"]] = relationship(
        back_populates="client"
    )
    schedules: Mapped[list["Schedule"]] = relationship(back_populates="client")
    visits: Mapped[list["Visit"]] = relationship(back_populates="client")


class ClientCareTask(Base):
    __tablename__ = "client_care_tasks"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.clients.id"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    specific_time: Mapped[Optional[str]] = mapped_column(String(50))
    recurrence_text: Mapped[Optional[str]] = mapped_column(String(100))
    sort_order: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    client: Mapped["Client"] = relationship(back_populates="care_tasks")
    history_entries: Mapped[list["ClientCareTaskHistory"]] = relationship(
        back_populates="task"
    )


class ClientCareTaskHistory(Base):
    __tablename__ = "client_care_tasks_history"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_care_task_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.client_care_tasks.id"), nullable=False
    )
    client_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.clients.id"), nullable=False
    )
    completed_on: Mapped[date] = mapped_column(Date, nullable=False)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    completed_by_user_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.users.id")
    )
    completion_notes: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    task: Mapped["ClientCareTask"] = relationship(back_populates="history_entries")
    client: Mapped["Client"] = relationship()
    completed_by_user: Mapped[Optional["User"]] = relationship(
        back_populates="completed_care_tasks"
    )


class ClientAddress(Base):
    __tablename__ = "client_addresses"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.clients.id"), nullable=False
    )
    address_type: Mapped[str] = mapped_column(
        String(20), default="Home", nullable=False
    )
    address_line1: Mapped[Optional[str]] = mapped_column(String(200))
    address_line2: Mapped[Optional[str]] = mapped_column(String(200))
    city: Mapped[Optional[str]] = mapped_column(String(100))
    state: Mapped[Optional[str]] = mapped_column(String(2))
    zip_code: Mapped[Optional[str]] = mapped_column(String(10))
    county: Mapped[Optional[str]] = mapped_column(String(50))
    is_primary: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    client: Mapped["Client"] = relationship(back_populates="addresses")


class ClientPayerInfo(Base):
    __tablename__ = "client_payer_info"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.clients.id"), nullable=False
    )
    payer_id: Mapped[Optional[str]] = mapped_column(String(20))
    program: Mapped[Optional[str]] = mapped_column(String(50))
    plan_name: Mapped[Optional[str]] = mapped_column(String(200))
    member_id: Mapped[Optional[str]] = mapped_column(String(50))
    effective_date: Mapped[Optional[date]] = mapped_column(Date)
    end_date: Mapped[Optional[date]] = mapped_column(Date)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    client: Mapped["Client"] = relationship(back_populates="payer_info")


class Employee(Base):
    __tablename__ = "employees"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_code: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    sandata_employee_id: Mapped[Optional[str]] = mapped_column(String(50))
    hhax_employee_id: Mapped[Optional[str]] = mapped_column(String(50))
    npi: Mapped[Optional[str]] = mapped_column(String(20))
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(20))
    hire_date: Mapped[Optional[date]] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    schedules: Mapped[list["Schedule"]] = relationship(back_populates="employee")
    visits: Mapped[list["Visit"]] = relationship(back_populates="employee")


class ServiceAuthorization(Base):
    __tablename__ = "service_authorizations"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.clients.id"), nullable=False
    )
    service_code_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.service_codes.id"), nullable=False
    )
    provider_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.providers.id")
    )
    auth_number: Mapped[Optional[str]] = mapped_column(String(50))
    authorized_units: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2))
    used_units: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2))
    service_start_date: Mapped[Optional[date]] = mapped_column(Date)
    service_end_date: Mapped[Optional[date]] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    client: Mapped["Client"] = relationship(back_populates="service_authorizations")
    service_code: Mapped["ServiceCode"] = relationship(
        back_populates="service_authorizations"
    )
    provider: Mapped[Optional["Provider"]] = relationship(
        back_populates="service_authorizations"
    )
    visits: Mapped[list["Visit"]] = relationship(
        back_populates="service_authorization"
    )


# ---------------------------------------------------------------------------
# EVV / Operational tables
# ---------------------------------------------------------------------------

class Schedule(Base):
    __tablename__ = "schedules"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.clients.id"), nullable=False
    )
    employee_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.employees.id")
    )
    service_code_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.service_codes.id"), nullable=False
    )
    scheduled_start: Mapped[Optional[datetime]] = mapped_column(DateTime)
    scheduled_end: Mapped[Optional[datetime]] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(
        String(30), default="Scheduled", nullable=False
    )
    notes: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    client: Mapped["Client"] = relationship(back_populates="schedules")
    employee: Mapped[Optional["Employee"]] = relationship(back_populates="schedules")
    service_code: Mapped["ServiceCode"] = relationship(back_populates="schedules")
    visits: Mapped[list["Visit"]] = relationship(back_populates="schedule")


class Visit(Base):
    __tablename__ = "visits"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    schedule_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.schedules.id")
    )
    client_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.clients.id"), nullable=False
    )
    employee_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.employees.id"), nullable=False
    )
    service_code_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.service_codes.id"), nullable=False
    )
    service_authorization_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.service_authorizations.id")
    )
    agency_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.agencies.id")
    )
    service_date: Mapped[Optional[date]] = mapped_column(Date)
    place_of_service: Mapped[Optional[str]] = mapped_column(String(10))
    visit_cancelled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    schedule: Mapped[Optional["Schedule"]] = relationship(back_populates="visits")
    client: Mapped["Client"] = relationship(back_populates="visits")
    employee: Mapped["Employee"] = relationship(back_populates="visits")
    service_code: Mapped["ServiceCode"] = relationship(back_populates="visits")
    service_authorization: Mapped[Optional["ServiceAuthorization"]] = relationship(
        back_populates="visits"
    )
    evv: Mapped[Optional["VisitEvv"]] = relationship(back_populates="visit", uselist=False)
    billing: Mapped[Optional["VisitBilling"]] = relationship(back_populates="visit", uselist=False)
    integration_status: Mapped[Optional["VisitIntegrationStatus"]] = relationship(
        back_populates="visit", uselist=False
    )
    changes: Mapped[list["VisitChange"]] = relationship(back_populates="visit")
    exceptions: Mapped[list["VisitException"]] = relationship(back_populates="visit")
    aggregator_submissions: Mapped[list["AggregatorSubmission"]] = relationship(
        back_populates="visit"
    )


class VisitEvv(Base):
    __tablename__ = "visit_evv"
    __table_args__ = {"schema": _SCHEMA}

    visit_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.visits.id"), primary_key=True
    )
    call_in_datetime: Mapped[Optional[datetime]] = mapped_column(DateTime)
    call_in_latitude: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7))
    call_in_longitude: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7))
    call_in_method: Mapped[Optional[str]] = mapped_column(String(20))
    call_out_datetime: Mapped[Optional[datetime]] = mapped_column(DateTime)
    call_out_latitude: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7))
    call_out_longitude: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7))
    call_out_method: Mapped[Optional[str]] = mapped_column(String(20))
    adj_in_datetime: Mapped[Optional[datetime]] = mapped_column(DateTime)
    adj_out_datetime: Mapped[Optional[datetime]] = mapped_column(DateTime)
    evv_status: Mapped[str] = mapped_column(
        String(30), default="Pending", nullable=False
    )
    hard_copy_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    visit: Mapped["Visit"] = relationship(back_populates="evv")


class VisitBilling(Base):
    __tablename__ = "visit_billing"
    __table_args__ = {"schema": _SCHEMA}

    visit_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.visits.id"), primary_key=True
    )
    billed_units: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2))
    approved_units: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2))
    approval_status: Mapped[str] = mapped_column(
        String(30), default="Pending", nullable=False
    )
    reason_code_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.reason_codes.id")
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    visit: Mapped["Visit"] = relationship(back_populates="billing")
    reason_code: Mapped[Optional["ReasonCode"]] = relationship(back_populates="visit_billings")


class VisitIntegrationStatus(Base):
    __tablename__ = "visit_integration_status"
    __table_args__ = {"schema": _SCHEMA}

    visit_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.visits.id"), primary_key=True
    )
    visit_id_sandata: Mapped[Optional[str]] = mapped_column(String(50))
    sandata_status: Mapped[Optional[str]] = mapped_column(String(30))
    sandata_last_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    hhax_visit_id: Mapped[Optional[str]] = mapped_column(String(50))
    hhax_status: Mapped[Optional[str]] = mapped_column(String(30))
    hhax_last_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    last_response_message: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    visit: Mapped["Visit"] = relationship(back_populates="integration_status")


class VisitChange(Base):
    __tablename__ = "visit_changes"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    visit_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.visits.id"), nullable=False
    )
    changed_by: Mapped[Optional[str]] = mapped_column(String(100))
    change_type: Mapped[Optional[str]] = mapped_column(String(50))
    old_value: Mapped[Optional[str]] = mapped_column(Text)
    new_value: Mapped[Optional[str]] = mapped_column(Text)
    reason_code_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.reason_codes.id")
    )
    notes: Mapped[Optional[str]] = mapped_column(Text)
    changed_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    visit: Mapped["Visit"] = relationship(back_populates="changes")
    reason_code: Mapped[Optional["ReasonCode"]] = relationship(
        back_populates="visit_changes"
    )


class VisitException(Base):
    __tablename__ = "visit_exceptions"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    visit_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.visits.id"), nullable=False
    )
    esc_code_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.evv_error_codes.id")
    )
    exception_type: Mapped[Optional[str]] = mapped_column(String(50))
    description: Mapped[Optional[str]] = mapped_column(Text)
    requires_ack: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    acknowledged: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    acknowledged_by: Mapped[Optional[str]] = mapped_column(String(100))
    acknowledged_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    reason_code_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.reason_codes.id")
    )
    notes: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    visit: Mapped["Visit"] = relationship(back_populates="exceptions")
    esc_code: Mapped[Optional["EvvErrorCode"]] = relationship(
        back_populates="visit_exceptions"
    )
    reason_code: Mapped[Optional["ReasonCode"]] = relationship(
        back_populates="visit_exceptions"
    )


class AggregatorSubmission(Base):
    __tablename__ = "aggregator_submissions"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    visit_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.visits.id"), nullable=False
    )
    aggregator: Mapped[Optional[str]] = mapped_column(String(20))
    submission_type: Mapped[Optional[str]] = mapped_column(String(30))
    payload: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        String(30), default="Pending", nullable=False
    )
    response_code: Mapped[Optional[str]] = mapped_column(String(20))
    response_message: Mapped[Optional[str]] = mapped_column(Text)
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    response_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    visit: Mapped["Visit"] = relationship(back_populates="aggregator_submissions")


class Timesheet(Base):
    """
    Universal payroll dataset — denormalized from visits + employees + clients.
    Single source of truth for all payroll provider exports.
    """
    __tablename__ = "timesheet"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    visit_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey(f"{_SCHEMA}.visits.id"))
    employee_id: Mapped[int] = mapped_column(Integer, ForeignKey(f"{_SCHEMA}.employees.id"), nullable=False)
    client_id: Mapped[int] = mapped_column(Integer, ForeignKey(f"{_SCHEMA}.clients.id"), nullable=False)
    service_code_id: Mapped[int] = mapped_column(Integer, ForeignKey(f"{_SCHEMA}.service_codes.id"), nullable=False)

    employee_code: Mapped[str] = mapped_column(String(20), nullable=False)
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    department_code: Mapped[Optional[str]] = mapped_column(String(100))

    client_name: Mapped[str] = mapped_column(String(200), nullable=False)
    service_type: Mapped[str] = mapped_column(String(20), nullable=False)
    place_of_service: Mapped[Optional[str]] = mapped_column(String(10), default="12")

    service_date: Mapped[date] = mapped_column(Date, nullable=False)
    clock_in: Mapped[Optional[datetime]] = mapped_column(DateTime)
    clock_out: Mapped[Optional[datetime]] = mapped_column(DateTime)
    total_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=0)
    regular_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=0)
    ot_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=0)
    holiday_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=0)
    travel_time_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=0)

    pay_rate: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0)
    gross_pay: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    differential_type: Mapped[Optional[str]] = mapped_column(String(50))
    differential_amount: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0)

    pay_period_start: Mapped[Optional[date]] = mapped_column(Date)
    pay_period_end: Mapped[Optional[date]] = mapped_column(Date)
    pay_date: Mapped[Optional[date]] = mapped_column(Date)

    clock_in_lat: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7))
    clock_in_lon: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7))
    clock_out_lat: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7))
    clock_out_lon: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7))

    evv_status: Mapped[str] = mapped_column(String(30), default="Incomplete", nullable=False)
    approval_status: Mapped[str] = mapped_column(String(30), default="Pending", nullable=False)
    verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    correction_reason: Mapped[Optional[str]] = mapped_column(String(500))
    notes: Mapped[Optional[str]] = mapped_column(Text)

    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime)


class Agency(Base):
    __tablename__ = "agencies"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agency_code: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    state_provider_id: Mapped[Optional[str]] = mapped_column(String(50))
    sandata_provider_id: Mapped[Optional[str]] = mapped_column(String(30))
    tier: Mapped[str] = mapped_column(String(20), default="core", nullable=False)
    aggregator: Mapped[Optional[str]] = mapped_column(String(10))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    users: Mapped[list["User"]] = relationship(back_populates="agency")


class User(Base):
    __tablename__ = "users"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agency_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.agencies.id")
    )
    username: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    display_name: Mapped[Optional[str]] = mapped_column(String(200))
    email: Mapped[Optional[str]] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(20), default="caregiver", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    password_hash: Mapped[Optional[str]] = mapped_column(String(200))
    entra_object_id: Mapped[Optional[str]] = mapped_column(String(36))
    employee_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.employees.id")
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    agency: Mapped[Optional["Agency"]] = relationship(back_populates="users")
    completed_care_tasks: Mapped[list["ClientCareTaskHistory"]] = relationship(
        back_populates="completed_by_user"
    )
    sessions: Mapped[list["UserSession"]] = relationship(back_populates="user")
    device_sessions: Mapped[list["DeviceSession"]] = relationship(back_populates="user")


class UserSession(Base):
    __tablename__ = "user_sessions"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.users.id"), nullable=False
    )
    jti: Mapped[str] = mapped_column(String(36), nullable=False, unique=True)
    issued_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    revoke_reason: Mapped[Optional[str]] = mapped_column(String(50))

    user: Mapped["User"] = relationship(back_populates="sessions")


class DeviceSession(Base):
    """
    Tracks refresh tokens per device.  One row per active device session.
    token_hash   — SHA-256(current_refresh_token)
    previous_hash — SHA-256(previous refresh token) for grace-window retries
    """
    __tablename__ = "device_sessions"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.users.id"), nullable=False
    )
    device_id: Mapped[str] = mapped_column(String(100), nullable=False)
    device_name: Mapped[Optional[str]] = mapped_column(String(200))
    client_type: Mapped[str] = mapped_column(String(10), nullable=False)   # web | mobile
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    previous_hash: Mapped[Optional[str]] = mapped_column(String(64))
    issued_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    last_used_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    revoke_reason: Mapped[Optional[str]] = mapped_column(String(50))

    user: Mapped["User"] = relationship(back_populates="device_sessions")


class AuthLog(Base):
    """Structured audit trail for login / logout / refresh / reuse events."""
    __tablename__ = "auth_log"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[int]] = mapped_column(Integer)
    username: Mapped[Optional[str]] = mapped_column(String(100))
    event: Mapped[str] = mapped_column(String(30), nullable=False)
    client_type: Mapped[Optional[str]] = mapped_column(String(10))
    device_id: Mapped[Optional[str]] = mapped_column(String(100))
    ip_address: Mapped[Optional[str]] = mapped_column(String(45))
    user_agent: Mapped[Optional[str]] = mapped_column(String(500))
    detail: Mapped[Optional[str]] = mapped_column(String(500))
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)


class ApiAccessLog(Base):
    """One row per inbound HTTP request, written by the access-log middleware."""
    __tablename__ = "api_access_log"
    __table_args__ = {"schema": "audit"}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    method: Mapped[str] = mapped_column(String(10), nullable=False)
    path: Mapped[str] = mapped_column(String(500), nullable=False)
    query_string: Mapped[Optional[str]] = mapped_column(String(1000))
    status_code: Mapped[int] = mapped_column(Integer, nullable=False)
    duration_ms: Mapped[Optional[int]] = mapped_column(Integer)
    user_id: Mapped[Optional[int]] = mapped_column(Integer)
    username: Mapped[Optional[str]] = mapped_column(String(100))
    agency_id: Mapped[Optional[int]] = mapped_column(Integer)
    ip_address: Mapped[Optional[str]] = mapped_column(String(45))
    user_agent: Mapped[Optional[str]] = mapped_column(String(500))
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)


class PasswordResetToken(Base):
    """Short-lived tokens for self-service password reset via email."""
    __tablename__ = "password_reset_tokens"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.users.id"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    user: Mapped["User"] = relationship()


class AuditLog(Base):
    """
    Universal audit trail.

    Entity changes (INSERT / UPDATE / DELETE):
        table_name = DB table name, record_id = PK, field_name / old_value / new_value set.

    Activity events (LOGIN / LOGOUT / FAILED_LOGIN / CLOCK_IN / CLOCK_OUT / PASSWORD_RESET):
        table_name = 'auth' or 'visits', record_id = user/visit id,
        field_name / old_value / new_value are NULL, detail carries context.
    """
    __tablename__ = "audit_log"
    __table_args__ = {"schema": "audit"}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    agency_id: Mapped[Optional[int]] = mapped_column(Integer)
    table_name: Mapped[str] = mapped_column(String(100), nullable=False)
    record_id: Mapped[Optional[int]] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(30), nullable=False)
    field_name: Mapped[Optional[str]] = mapped_column(String(100))
    old_value: Mapped[Optional[str]] = mapped_column(Text)
    new_value: Mapped[Optional[str]] = mapped_column(Text)
    changed_by: Mapped[Optional[int]] = mapped_column(Integer)
    changed_by_name: Mapped[Optional[str]] = mapped_column(String(200))
    client_type: Mapped[Optional[str]] = mapped_column(String(20))
    ip_address: Mapped[Optional[str]] = mapped_column(String(45))
    detail: Mapped[Optional[str]] = mapped_column(String(500))
    session_id: Mapped[Optional[str]] = mapped_column(String(100))
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)


# ---------------------------------------------------------------------------
# Documentation Template Builder
# ---------------------------------------------------------------------------

class DocumentationTemplate(Base):
    """
    One row per logical template.  Tracks lifecycle: draft → published → archived.
    The actual section/field schema lives in DocumentationTemplateVersion.schema_json
    so that every publish creates an immutable snapshot.
    """
    __tablename__ = "documentation_templates"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agency_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.agencies.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    category: Mapped[Optional[str]] = mapped_column(String(100))
    # status: draft | published | archived
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)
    current_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_by: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.users.id")
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    versions: Mapped[list["DocumentationTemplateVersion"]] = relationship(
        back_populates="template",
        order_by="DocumentationTemplateVersion.version_number",
    )
    submissions: Mapped[list["DocumentationSubmission"]] = relationship(
        back_populates="template",
        foreign_keys="DocumentationSubmission.template_id",
    )


class DocumentationTemplateVersion(Base):
    """
    Immutable snapshot of a template at a specific version.
    schema_json: {"sections": [{key, title, description, sort_order, fields: [...]}]}
    Once published, a version must never be mutated — new edits produce a new version.
    """
    __tablename__ = "documentation_template_versions"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    template_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.documentation_templates.id"), nullable=False
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    # Full section+field tree as JSON — self-contained for historic rendering
    schema_json: Mapped[Optional[str]] = mapped_column(Text)
    # status mirrors the template status at the time this version was created/published
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)
    created_by: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.users.id")
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    template: Mapped["DocumentationTemplate"] = relationship(back_populates="versions")
    submissions: Mapped[list["DocumentationSubmission"]] = relationship(
        back_populates="template_version",
        foreign_keys="DocumentationSubmission.template_version_id",
    )


class DocumentationSubmission(Base):
    """
    One row per form completion (draft or submitted).
    values_json: flat map {"field_key": value, ...} matching the schema at submission time.
    Stores both template_version_id and template_version_number so historic submissions
    can always be rendered against the exact schema used when the form was filled.
    """
    __tablename__ = "documentation_submissions"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agency_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.agencies.id"), nullable=False
    )
    template_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.documentation_templates.id"), nullable=False
    )
    template_version_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.documentation_template_versions.id"), nullable=False
    )
    template_version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    patient_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.clients.id")
    )
    # staff_id: the staff member who created/filled the submission
    staff_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.users.id")
    )
    visit_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.visits.id")
    )
    # status: draft | submitted | reviewed | approved
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)
    # Flat JSON map: {"field_key": value}
    values_json: Mapped[Optional[str]] = mapped_column(Text)
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_by: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey(f"{_SCHEMA}.users.id")
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    template: Mapped["DocumentationTemplate"] = relationship(
        back_populates="submissions",
        foreign_keys=[template_id],
    )
    template_version: Mapped["DocumentationTemplateVersion"] = relationship(
        back_populates="submissions",
        foreign_keys=[template_version_id],
    )
