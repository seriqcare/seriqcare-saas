"""
Sandata REST API v1.1 client  —  PA-DHS EVV Vendor Spec v1.4
=============================================================
Controlled via environment variables in .env:

  SANDATA_MODE        = simulate (default) | live
  SANDATA_API_URL     = https://api.sandata.com/interfaces/intake
  SANDATA_API_KEY     = <Sandata-issued API key>
  SANDATA_PROVIDER_ID = <Sandata provider ID>
  SANDATA_TIMEOUT     = 30  (seconds per request)

In SIMULATE mode (default):
  - No HTTP call is made.
  - Every submission returns a deterministic Accepted response.
  - The payload is still fully built and stored in care.aggregator_submissions.

In LIVE mode:
  - Payload is POSTed to https://api.sandata.com/interfaces/intake/visits/rest/api/v1.1
  - Response is parsed for ESC error codes (deny codes → Rejected, info → Accepted).
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from typing import Any

_MODE             = os.getenv("SANDATA_MODE", "simulate").lower()
_API_URL          = os.getenv("SANDATA_API_URL", "https://api.sandata.com/interfaces/intake")
_API_KEY          = os.getenv("SANDATA_API_KEY", "")
_PROVIDER_ID      = os.getenv("SANDATA_PROVIDER_ID", "")
_TIMEOUT          = int(os.getenv("SANDATA_TIMEOUT", "30"))
_SIMULATOR_URL     = os.getenv("SANDATA_SIMULATOR_URL", "https://seriqcare-sandata-simulator.onrender.com")
_SIMULATOR_TIMEOUT = int(os.getenv("SANDATA_SIMULATOR_TIMEOUT", "30"))

# ESC codes that result in a hard denial
_DENY_ESC_CODES = {"927", "928", "902"}

_log = logging.getLogger("seriqcare.sandata")


def is_live() -> bool:
    """True when SANDATA_MODE=live."""
    return _MODE == "live"


# ---------------------------------------------------------------------------
# Payload builder
# ---------------------------------------------------------------------------

def build_visit_payload(row: Any, transaction_id: str, now_utc: datetime) -> dict:
    """
    Build a PA-DHS EVV Vendor Spec v1.4 VisitMaintenanceRequest payload.

    `row` must expose these attributes (matches the JOIN query used by both
    visits.py and aggregator.py):
        id, service_date, call_in_datetime, call_out_datetime,
        call_in_latitude, call_in_longitude, call_out_latitude, call_out_longitude,
        place_of_service, evv_status, hcpcs_code, service_desc,
        client_medicaid_id, client_name, employee_code, employee_name,
        employee_npi, provider_npi, provider_name
    """

    def _fmt_dt(dt) -> str | None:
        if dt is None:
            return None
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ") if hasattr(dt, "strftime") else str(dt)

    def _fmt_gps(val) -> float | None:
        return round(float(val), 7) if val is not None else None

    # Truncate to 15-min units — no rounding per PA ODP EVV Guidance v2.0
    units = 0
    if row.call_in_datetime and row.call_out_datetime:
        minutes = int(
            (row.call_out_datetime - row.call_in_datetime).total_seconds() / 60
        )
        units = minutes // 15

    return {
        "VisitMaintenanceRequest": {
            "Header": {
                "MessageID":    transaction_id,
                "Source":       "SeriqCare",
                "BusinessDate": now_utc.strftime("%Y-%m-%d"),
                "Program":      "ODP",
                "Payer":        "PAODP",
                "ApiVersion":   "v1.1",
            },
            "VisitRecord": {
                "VisitID":            str(row.id),
                "ProviderNPI":        row.provider_npi or "UNKNOWN",
                "ProviderName":       row.provider_name or "Seriq Home Care LLC",
                "ServiceCode":        row.hcpcs_code,
                "ServiceDescription": row.service_desc,
                "ClientMedicaidID":   row.client_medicaid_id or "UNKNOWN",
                "ClientName":         row.client_name,
                "EmployeeID":         row.employee_code,
                "EmployeeName":       row.employee_name,
                "EmployeeNPI":        row.employee_npi,
                "ServiceDate":        str(row.service_date),
                "CallInDatetime":     _fmt_dt(row.call_in_datetime),
                "CallOutDatetime":    _fmt_dt(row.call_out_datetime),
                "CallInLatitude":     _fmt_gps(row.call_in_latitude),
                "CallInLongitude":    _fmt_gps(row.call_in_longitude),
                "CallOutLatitude":    _fmt_gps(row.call_out_latitude),
                "CallOutLongitude":   _fmt_gps(row.call_out_longitude),
                "PlaceOfService":     row.place_of_service or "12",
                "Units":              units,
            },
        }
    }


# ---------------------------------------------------------------------------
# Submission client
# ---------------------------------------------------------------------------

def post_to_sandata(
    payload_json: str,
    transaction_id: str = "",
    submission_type: str = "visits",
) -> tuple[str, str, str]:
    """
    Submit a JSON payload to Sandata.

    Returns:
        (status, response_code, response_message)
        status          : 'Accepted' | 'Rejected' | 'Error'
        response_code   : HTTP status code string, or '0' on network error
        response_message: Human-readable result or error text
    """
    if not is_live():
        return (
            "Accepted",
            "200",
            f"[SIMULATED] Transaction {transaction_id} accepted by Sandata aggregator. "
            f"Mode: simulate. Set SANDATA_MODE=live to enable real submissions.",
        )

    url = f"{_API_URL}/{submission_type}/rest/api/v1.1"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {_API_KEY}",
        "X-Provider-ID": _PROVIDER_ID,
    }

    try:
        import requests  # pip install requests

        resp = requests.post(url, data=payload_json, headers=headers, timeout=_TIMEOUT)

        if resp.status_code == 200:
            try:
                body = resp.json()
            except Exception:
                return ("Accepted", "200", resp.text[:500])

            # Parse Sandata ESC response codes
            esc_codes = body.get("ESCCodes", [])
            deny_codes = [
                c for c in esc_codes
                if str(c.get("code", "")) in _DENY_ESC_CODES
                or c.get("severity", "").lower() == "deny"
            ]
            if deny_codes:
                codes_str = ", ".join(
                    f"ESC {c.get('code','')} ({c.get('description','')})"
                    for c in deny_codes
                )
                return ("Rejected", "200", f"Denied — {codes_str}")

            return ("Accepted", "200", resp.text[:500])

        # Non-200 response
        return ("Rejected", str(resp.status_code), resp.text[:500])

    except ImportError:
        return ("Error", "0", "requests library not installed — run: pip install requests")
    except Exception as exc:
        return ("Error", "0", str(exc)[:500])


# ---------------------------------------------------------------------------
# Simulator helpers — PA ODP EVV payload builders for the Sandata simulator
# ---------------------------------------------------------------------------

def _seq_id(now_utc: datetime) -> str:
    """SequenceID as YYYYMMDDHHMMSS string."""
    return now_utc.strftime("%Y%m%d%H%M%S")


def _normalize_medicaid_id(mid: str | None) -> str:
    """Strip non-digits, pad/truncate to 10 digits."""
    if not mid:
        return "0000000000"
    digits = "".join(c for c in mid if c.isdigit())
    return digits.zfill(10)[:10]


def _normalize_zip(zip_code: str | None) -> str:
    """Ensure 9-digit ZIP; pad with zeros if only 5-digit."""
    if not zip_code:
        return "000000000"
    digits = "".join(c for c in zip_code if c.isdigit())
    return digits.ljust(9, "0")[:9]


def _normalize_phone(phone: str | None) -> str:
    """Strip non-digits from phone number."""
    if not phone:
        return ""
    return "".join(c for c in phone if c.isdigit())[:10]


def build_client_evv_payload(row: Any, now_utc: datetime) -> list[dict]:
    """
    Build a PA ODP Sandata simulator client payload.

    row must expose: client_code, first_name, last_name, medicaid_id,
                     phone, address1, city, state, zip, hcpcs_code, provider_id

    Payload uses the nested section structure the Sandata simulator validates:
      ProviderIdentification    → object: ProviderQualifier, ProviderID
      ClientGeneralInformation  → object: SequenceID (int), ClientQualifier, etc.
      ClientAddress             → array:  at least one address object (ESC-603)
      ClientPayerInformation    → array:  at least one payer object (ESC-607)
      ClientPhone               → array:  conditional, only when phone present
    """
    mid = _normalize_medicaid_id(getattr(row, "medicaid_id", None))

    record: dict = {
        "ProviderIdentification": {
            "ProviderQualifier": "MedicaidID",
            "ProviderID":        str(getattr(row, "provider_id", "") or ""),
        },
        "ClientGeneralInformation": {
            "SequenceID":          int(_seq_id(now_utc)),  # must be numeric
            "ClientQualifier":     "ClientCustomID",
            "ClientIdentifier":    mid,
            "ClientFirstName":     (getattr(row, "first_name", "") or "")[:30],
            "ClientMiddleInitial": str(getattr(row, "middle_name", "") or "")[:1],
            "ClientLastName":      (getattr(row, "last_name", "") or "")[:30],
            "ClientMedicaidID":    mid,
            "MissingMedicaidID":   "false",
            "ClientOtherID":       str(getattr(row, "client_code", "") or ""),
            "ClientTimeZone":      "US/Eastern",
            "ClientCustomID":      mid,
        },
        # Arrays — simulator requires at least one element in each segment
        "ClientAddress": [
            {
                "ClientAddressType":      "Home",
                "ClientAddressIsPrimary": "true",
                "ClientAddressLine1":     str(getattr(row, "address1", "") or ""),
                "ClientAddressLine2":     "",
                "ClientCity":             str(getattr(row, "city",  "") or ""),
                "ClientState":            str(getattr(row, "state", "PA") or "PA"),
                "ClientZip":              _normalize_zip(getattr(row, "zip", None)),
            }
        ],
        "ClientPayerInformation": [
            {
                "PayerID":       "PAODP",
                "PayerProgram":  "ODP",
                "ProcedureCode": str(getattr(row, "hcpcs_code", "") or ""),
                "Modifier1":     "NULL",
                "Modifier2":     "NULL",
                "Modifier3":     "NULL",
                "Modifier4":     "NULL",
            }
        ],
    }

    phone = _normalize_phone(getattr(row, "phone", None))
    if phone:
        record["ClientPhone"] = [
            {
                "ClientPhoneType": "Home",
                "ClientPhone":     phone,
            }
        ]

    return [record]


def build_employee_evv_payload(row: Any, now_utc: datetime) -> list[dict]:
    """
    Build a PA ODP Sandata simulator employee payload.

    row must expose: employee_code, first_name, last_name, email,
                     sandata_employee_id, provider_id, ssn_last5, employee_pin

    Payload uses the nested section structure the Sandata simulator validates:
      ProviderIdentification  → ProviderQualifier, ProviderID
      EmployeeGeneralInformation → SequenceID (int), EmployeeQualifier, etc.
      EmployeePIN             → top-level (ESC-609)
    """
    ssn_suffix = str(getattr(row, "ssn_last5", "") or "00000").zfill(5)[:5]
    pin        = str(getattr(row, "employee_pin", "") or "").strip()
    email      = str(getattr(row, "email", "") or "").strip()

    record: dict = {
        "ProviderIdentification": {
            "ProviderQualifier": "MedicaidID",
            "ProviderID":        str(getattr(row, "provider_id", "") or ""),
        },
        "EmployeeGeneralInformation": {
            "SequenceID":         int(_seq_id(now_utc)),   # must be numeric per ESC-603
            "EmployeeQualifier":  "EmployeeCustomID",
            "EmployeeIdentifier": str(getattr(row, "employee_code",       "") or ""),
            "EmployeeOtherID":    str(getattr(row, "sandata_employee_id", "") or ""),
            "EmployeeSSN":        f"0000{ssn_suffix}",
            "EmployeeLastName":   (getattr(row, "last_name",  "") or "")[:30],
            "EmployeeFirstName":  (getattr(row, "first_name", "") or "")[:30],
        },
        "EmployeePIN": pin,
    }

    if email:
        record["EmployeeGeneralInformation"]["EmployeeEmail"] = email

    return [record]


def build_visit_simulator_payload(row: Any, now_utc: datetime) -> list[dict]:
    """
    Build a PA ODP Sandata simulator visit payload.
    Uses the same row structure as build_visit_payload (aggregator.py join query).

    Payload uses the nested section structure the Sandata simulator validates:
      ProviderIdentification  → object: ProviderQualifier, ProviderID
      VisitGeneralInformation → object: SequenceID (int), VisitOtherID, employee/client IDs, payer, etc.
      Calls                   → array:  one entry per clock-in/out event (conditional)
    """
    def _fmt(dt) -> str | None:
        if dt is None:
            return None
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ") if hasattr(dt, "strftime") else str(dt)

    mid        = _normalize_medicaid_id(getattr(row, "client_medicaid_id", None))
    emp_code   = str(getattr(row, "employee_code",       "") or "")
    hcpcs      = str(getattr(row, "hcpcs_code",          "") or "")
    vid        = str(getattr(row, "id",                  "") or "")
    pos        = str(getattr(row, "place_of_service", "12") or "12")
    loc_type   = 2 if pos == "99" else 1
    provider_id = str(getattr(row, "provider_id_sandata", "") or "")

    visit_info: dict = {
        "SequenceID":              int(_seq_id(now_utc)),  # must be numeric
        "VisitOtherID":            f"V-{vid.zfill(5)}",
        "EmployeeQualifier":       "EmployeeCustomID",
        "EmployeeOtherID":         "",
        "EmployeeIdentifier":      emp_code,
        "GroupCode":               "",
        "ClientIDQualifier":       "ClientCustomID",
        "ClientIdentifier":        mid,
        "ClientID":                mid,
        "ClientOtherID":           "",
        "VisitCancelledIndicator": "false",
        "PayerID":                 "PAODP",
        "PayerProgram":            "ODP",
        "ProcedureCode":           hcpcs,
        "Modifier1":               "NULL",
        "VisitTimeZone":           "US/Eastern",
        "BillVisit":               True,
    }

    adj_in  = _fmt(getattr(row, "adj_in_datetime",  None))
    adj_out = _fmt(getattr(row, "adj_out_datetime", None))
    if adj_in:
        visit_info["AdjInDateTime"]  = adj_in
    if adj_out:
        visit_info["AdjOutDateTime"] = adj_out

    record: dict = {
        "ProviderIdentification": {
            "ProviderQualifier": "MedicaidID",
            "ProviderID":        provider_id,
        },
        "VisitGeneralInformation": visit_info,
    }

    calls = []
    for assignment, dt_attr, lat_attr, lng_attr, call_suffix in (
        ("Time In",  "call_in_datetime",  "call_in_latitude",  "call_in_longitude",  "IN"),
        ("Time Out", "call_out_datetime", "call_out_latitude", "call_out_longitude", "OUT"),
    ):
        dt = _fmt(getattr(row, dt_attr, None))
        if not dt:
            continue
        call: dict = {
            "CallExternalID":         f"CALL-V{vid}-{call_suffix}",
            "CallDateTime":           dt,
            "CallAssignment":         assignment,
            "GroupCode":              "",
            "CallType":               "Mobile",
            "ProcedureCode":          hcpcs,
            "ClientIdentifierOnCall": mid,
            "MobileLogin":            emp_code,
            "VisitLocationType":      loc_type,
        }
        lat = getattr(row, lat_attr, None)
        lng = getattr(row, lng_attr, None)
        if lat is not None:
            call["CallLatitude"]  = round(float(lat), 7)
        if lng is not None:
            call["CallLongitude"] = round(float(lng), 7)
        calls.append(call)

    if calls:
        record["Calls"] = calls

    return [record]


# ---------------------------------------------------------------------------
# Simulator submission client
# ---------------------------------------------------------------------------

def post_to_simulator(
    endpoint: str,
    payload_json: str,
    entity_id: str = "",
) -> tuple[str, str, str]:
    """
    POST a JSON payload to the Sandata EVV simulator.

    endpoint : e.g. '/api/evv/clients', '/api/evv/employees', '/api/evv/visits'

    Returns:
        (status, response_code, response_message)
        status: 'Success' | 'Failed' | 'Error'
    """
    url = f"{_SIMULATOR_URL.rstrip('/')}{endpoint}"

    try:
        import requests

        resp = requests.post(
            url,
            data=payload_json,
            headers={"Content-Type": "application/json"},
            timeout=_SIMULATOR_TIMEOUT,
        )

        try:
            body = resp.json()
        except Exception:
            body = {}

        overall = body.get("Status", "FAILED")
        message = body.get("Message", resp.text[:500])

        if resp.status_code == 200 and overall == "SUCCESS":
            return ("Success", "200", message)

        records = body.get("Records", [])
        errors  = [
            r.get("RecordError", "")
            for r in records
            if r.get("RecordStatus") == "FAILED" and r.get("RecordError")
        ]
        error_text = "; ".join(errors) if errors else message

        if resp.status_code == 200:
            return ("Failed", "200", error_text)

        return ("Error", str(resp.status_code), resp.text[:500])

    except ImportError:
        return ("Error", "0", "requests library not installed")
    except Exception as exc:
        _log.warning("Simulator POST %s failed for %s: %s", url, entity_id, exc)
        return ("Error", "0", str(exc)[:500])
