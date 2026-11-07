"""
HHAeXchange REST API client — Pennsylvania EVV field model
==========================================================
Controlled via environment variables in .env:

  HHAX_MODE             = simulate (default) | live
  HHAX_BASE_URL         = http://localhost:3000  (simulator) or production URL
  HHAX_CLIENT_ID        = <OAuth client_id>
  HHAX_CLIENT_SECRET    = <OAuth client_secret>
  HHAX_SCOPE            = <OAuth scope>
  HHAX_AGENCY_TAX_ID    = <Agency EIN in XX-XXXXXXX format>
  HHAX_DEFAULT_PAYER_ID = <Fallback PayerId when not stored on the visit>
  HHAX_TIMEOUT          = 30  (seconds per request)

In SIMULATE mode (default):
  - No HTTP call is made.
  - Every submission returns a deterministic Accepted response with a
    simulated VisitId (VIS-...) and EVVMSID (HHAX-...).
  - The payload is still fully built and stored in care.aggregator_submissions.

In LIVE mode:
  - OAuth token is acquired from HHAX_BASE_URL/identity/connect/token
    using client_credentials flow.
  - Token is cached and reused until 60 s before expiry.
  - Payload is POSTed to HHAX_BASE_URL/api/evv/visits.
  - HTTP 201 Created → Accepted; any 4xx/5xx → Rejected.
"""
from __future__ import annotations

import os
import random
import string
import time
from datetime import datetime
from typing import Any

_MODE             = os.getenv("HHAX_MODE", "simulate").lower()
_BASE_URL         = os.getenv("HHAX_BASE_URL", "http://localhost:3000").rstrip("/")
_CLIENT_ID        = os.getenv("HHAX_CLIENT_ID", "")
_CLIENT_SECRET    = os.getenv("HHAX_CLIENT_SECRET", "")
_SCOPE            = os.getenv("HHAX_SCOPE", "")
_AGENCY_TAX_ID    = os.getenv("HHAX_AGENCY_TAX_ID", "")
_DEFAULT_PAYER_ID = os.getenv("HHAX_DEFAULT_PAYER_ID", "")
_TIMEOUT          = int(os.getenv("HHAX_TIMEOUT", "30"))

# ---------------------------------------------------------------------------
# OAuth token cache
# ---------------------------------------------------------------------------

_token_cache: dict = {
    "access_token": "",
    "expires_at": 0.0,   # Unix timestamp
}

_EARLY_REFRESH_SECS = 60   # refresh token this many seconds before actual expiry


def _get_bearer_token() -> str:
    """
    Return a valid Bearer token, refreshing from HHAx if the cached one
    is absent or within _EARLY_REFRESH_SECS of expiry.
    """
    now = time.time()
    if _token_cache["access_token"] and now < _token_cache["expires_at"] - _EARLY_REFRESH_SECS:
        return _token_cache["access_token"]

    try:
        import requests
    except ImportError as exc:
        raise RuntimeError("requests library not installed — run: pip install requests") from exc

    resp = requests.post(
        f"{_BASE_URL}/identity/connect/token",
        data={
            "grant_type":    "client_credentials",
            "client_id":     _CLIENT_ID,
            "client_secret": _CLIENT_SECRET,
            "scope":         _SCOPE,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=_TIMEOUT,
    )

    if resp.status_code != 200:
        raise RuntimeError(
            f"HHAx OAuth failed ({resp.status_code}): {resp.text[:300]}"
        )

    body = resp.json()
    token = body.get("access_token", "")
    expires_in = int(body.get("expires_in", 1800))

    _token_cache["access_token"] = token
    _token_cache["expires_at"]   = now + expires_in

    return token


# ---------------------------------------------------------------------------
# ID generators (mirror HHAx simulator conventions)
# ---------------------------------------------------------------------------

def _random_alphanum(n: int) -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=n))


def _sim_visit_id() -> str:
    return f"VIS-{_random_alphanum(9)}"


def _sim_evvmsid() -> str:
    return f"HHAX-{_random_alphanum(9)}"


# ---------------------------------------------------------------------------
# Payload builder
# ---------------------------------------------------------------------------

def build_visit_payload(row: Any) -> dict:
    """
    Build the HHAeXchange EVV visit submission payload (PA field model).

    `row` must expose these attributes (matches the JOIN query in aggregator.py):
        id, service_date,
        call_in_datetime, call_out_datetime,
        call_in_latitude, call_in_longitude,
        call_out_latitude, call_out_longitude,
        employee_code, hhax_employee_id  (optional, falls back to employee_code),
        client_medicaid_id, hhax_payer_id  (optional, falls back to HHAX_DEFAULT_PAYER_ID),
        hcpcs_code,
        agency_tax_id  (optional, falls back to HHAX_AGENCY_TAX_ID env var)
    """

    def _fmt_dt(dt) -> str | None:
        if dt is None:
            return None
        if hasattr(dt, "strftime"):
            return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")
        return str(dt)

    def _fmt_gps(val) -> float | None:
        return round(float(val), 7) if val is not None else None

    # agencyTaxId: prefer DB value, fall back to env var
    agency_tax_id = getattr(row, "agency_tax_id", None) or _AGENCY_TAX_ID

    # caregiverCode: prefer hhax_employee_id if set, otherwise use employee_code
    caregiver_code = getattr(row, "hhax_employee_id", None) or row.employee_code

    # payerId: prefer per-client hhax_payer_id, fall back to env default
    payer_id = getattr(row, "hhax_payer_id", None) or _DEFAULT_PAYER_ID

    # ExternalEVVMSID lets HHAx trace the record back to SeriqCare.
    # Must start with ~ per the simulator spec; suffix must be alphanumeric/dash.
    external_evvmsid = f"~SERIQCARE-{row.id}"

    # When scheduled start/end times are not stored separately, the clock
    # datetimes are the best available approximation.
    schedule_start = _fmt_dt(row.call_in_datetime)
    schedule_end   = _fmt_dt(row.call_out_datetime)

    return {
        "agencyTaxId":                   agency_tax_id,
        "caregiverCode":                 caregiver_code,
        "medicaidNumber":                row.client_medicaid_id or "",
        "procedureCode":                 row.hcpcs_code,
        "payerId":                       payer_id,
        "scheduleDate":                  str(row.service_date),
        "scheduleStartTime":             schedule_start,
        "scheduleEndTime":               schedule_end,
        "clockInDatetime":               schedule_start,
        "clockOutDatetime":              schedule_end,
        "clockInServiceLocationType":    "Home",
        "clockInServiceLocationAddress": None,
        "clockOutServiceLocationType":   "Home",
        "clockOutServiceLocationAddress": None,
        "clockInLatitude":               _fmt_gps(row.call_in_latitude),
        "clockInLongitude":              _fmt_gps(row.call_in_longitude),
        "clockOutLatitude":              _fmt_gps(row.call_out_latitude),
        "clockOutLongitude":             _fmt_gps(row.call_out_longitude),
        "externalEvvmsid":               external_evvmsid,
        "missedVisit":                   False,
        "missedVisitReasonCode":         None,
        "missedVisitActionCode":         None,
        "dutyCodes":                     [],
        "invoiceNumber":                 None,
        "notes":                         None,
    }


# ---------------------------------------------------------------------------
# Submission client
# ---------------------------------------------------------------------------

def post_to_hhax(
    payload: dict,
    visit_id: int,
) -> tuple[str, str, str, str | None]:
    """
    Submit an EVV visit payload to HHAeXchange.

    Returns:
        (status, response_code, response_message, hhax_visit_id)
        status          : 'Accepted' | 'Rejected' | 'Error'
        response_code   : HTTP status code string, or '0' on network error
        response_message: Human-readable result or error text
        hhax_visit_id   : VisitId returned by HHAx (None on failure or simulate)
                          Store this in visit_integration_status.hhax_visit_id
    """
    if not is_live():
        sim_visit_id = _sim_visit_id()
        sim_evvmsid  = _sim_evvmsid()
        return (
            "Accepted",
            "201",
            (
                f"[SIMULATED] Visit {visit_id} accepted by HHAeXchange. "
                f"VisitId={sim_visit_id} EVVMSID={sim_evvmsid}. "
                f"Mode: simulate. Set HHAX_MODE=live to enable real submissions."
            ),
            sim_visit_id,
        )

    try:
        import requests
    except ImportError:
        return ("Error", "0", "requests library not installed — run: pip install requests", None)

    try:
        token = _get_bearer_token()
    except RuntimeError as exc:
        return ("Error", "0", f"Token acquisition failed: {exc}", None)

    try:
        resp = requests.post(
            f"{_BASE_URL}/api/evv/visits",
            json=payload,
            headers={
                "Content-Type":  "application/json",
                "Authorization": f"Bearer {token}",
            },
            timeout=_TIMEOUT,
        )

        if resp.status_code == 201:
            try:
                body = resp.json()
                data = body.get("data", {})
                hhax_visit_id_returned = data.get("visitId")
            except Exception:
                hhax_visit_id_returned = None
            return ("Accepted", "201", resp.text[:500], hhax_visit_id_returned)

        # 4xx / 5xx
        return ("Rejected", str(resp.status_code), resp.text[:500], None)

    except Exception as exc:
        return ("Error", "0", str(exc)[:500], None)


def post_claim_to_hhax(
    claim_number: str,
    claim_amount: float,
    visit_count: int,
    claim_period_start: str | None = None,
    claim_period_end: str | None = None,
    agency_tax_id: str | None = None,
) -> tuple[str, str, str, str | None]:
    """
    Upload a claim batch to HHAeXchange.

    Returns:
        (status, response_code, response_message, hhax_claim_id)
        status         : 'Accepted' | 'Rejected' | 'Simulated' | 'Error'
        response_code  : HTTP status string or '0' on network error
        response_message: Human-readable result
        hhax_claim_id  : ClaimId returned by HHAx (None on failure)
                         Store in care.billing_claims.hhax_claim_id
    """
    eid = agency_tax_id or _AGENCY_TAX_ID

    if not is_live():
        sim_claim_id = f"CLM-{_random_alphanum(9)}"
        return (
            "Accepted",
            "202",
            (
                f"[SIMULATED] Claim {claim_number} accepted by HHAeXchange. "
                f"ClaimId={sim_claim_id}. "
                f"Mode: simulate. Set HHAX_MODE=live to enable real submissions."
            ),
            sim_claim_id,
        )

    try:
        import requests
    except ImportError:
        return ("Error", "0", "requests library not installed — run: pip install requests", None)

    try:
        token = _get_bearer_token()
    except RuntimeError as exc:
        return ("Error", "0", f"Token acquisition failed: {exc}", None)

    payload: dict = {
        "agencyTaxId":  eid,
        "claimNumber":  claim_number,
        "fileName":     f"seriqcare_claim_{claim_number}.csv",
        "fileFormat":   "CSV",
        "claimAmount":  round(claim_amount, 2),
        "visitCount":   visit_count,
        "lineItemCount": visit_count,
    }
    if claim_period_start:
        payload["claimPeriodStart"] = claim_period_start
    if claim_period_end:
        payload["claimPeriodEnd"] = claim_period_end

    try:
        resp = requests.post(
            f"{_BASE_URL}/api/claims/upload",
            json=payload,
            headers={
                "Content-Type":  "application/json",
                "Authorization": f"Bearer {token}",
            },
            timeout=_TIMEOUT,
        )

        if resp.status_code == 202:
            try:
                body = resp.json()
                hhax_claim_id = body.get("data", {}).get("claimId")
            except Exception:
                hhax_claim_id = None
            return ("Accepted", "202", resp.text[:500], hhax_claim_id)

        return ("Rejected", str(resp.status_code), resp.text[:500], None)

    except Exception as exc:
        return ("Error", "0", str(exc)[:500], None)


def register_caregiver(row: Any) -> tuple[str, str]:
    """
    Pre-register a caregiver with HHAeXchange.

    `row` must expose:
        employee_code, hhax_employee_id (optional),
        first_name, last_name,
        caregiver_type (optional — defaults to 'DCW'),
        npi (optional),
        agency_tax_id (optional — falls back to HHAX_AGENCY_TAX_ID env var)

    Returns:
        (status, message)
        status  : 'Registered' | 'AlreadyRegistered' | 'Simulated' | 'Failed' | 'Error'
        message : Human-readable result
    """
    caregiver_code = getattr(row, "hhax_employee_id", None) or row.employee_code
    agency_tax_id  = getattr(row, "agency_tax_id", None) or _AGENCY_TAX_ID
    caregiver_type = getattr(row, "caregiver_type", None) or "DCW"
    npi            = getattr(row, "npi", None)

    if not is_live():
        return (
            "Simulated",
            (
                f"[SIMULATED] Caregiver '{caregiver_code}' pre-registered with HHAeXchange. "
                f"Mode: simulate. Set HHAX_MODE=live to enable real registration."
            ),
        )

    try:
        import requests
    except ImportError:
        return ("Error", "requests library not installed — run: pip install requests")

    try:
        token = _get_bearer_token()
    except RuntimeError as exc:
        return ("Error", f"Token acquisition failed: {exc}")

    payload: dict = {
        "agencyTaxId":   agency_tax_id,
        "caregiverCode": caregiver_code,
        "firstName":     row.first_name,
        "lastName":      row.last_name,
        "caregiverType": caregiver_type,
    }
    if npi:
        payload["npi"] = npi

    try:
        resp = requests.post(
            f"{_BASE_URL}/api/caregivers",
            json=payload,
            headers={
                "Content-Type":  "application/json",
                "Authorization": f"Bearer {token}",
            },
            timeout=_TIMEOUT,
        )

        if resp.status_code == 201:
            return ("Registered", f"Caregiver '{caregiver_code}' registered successfully with HHAeXchange.")

        if resp.status_code == 409:
            return ("AlreadyRegistered", f"Caregiver '{caregiver_code}' is already registered with HHAeXchange.")

        return ("Failed", f"HHAx returned {resp.status_code}: {resp.text[:300]}")

    except Exception as exc:
        return ("Error", str(exc)[:500])


def is_live() -> bool:
    """True when HHAX_MODE=live."""
    return _MODE == "live"
