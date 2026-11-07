# SeriqCare Implementation Guide

**Platform:** Multi-agency home care operations & EVV management SaaS
**Stack:** Next.js 15 (React 19, TypeScript) + FastAPI (Python) + SQL Server
**Compliance:** PA-DHS EVV Vendor Specification v1.4 · 21st Century Cures Act

---

## Table of Contents

1. [Environment & Project Setup](#1-environment--project-setup)
2. [Database Schema](#2-database-schema)
3. [Backend — Authentication](#3-backend--authentication)
4. [Backend — Core API Routers](#4-backend--core-api-routers)
5. [Frontend — Auth Pages](#5-frontend--auth-pages)
6. [Frontend — Protected Pages](#6-frontend--protected-pages)
7. [Frontend — Layout & Components](#7-frontend--layout--components)
8. [Multi-Agency Isolation Rules](#8-multi-agency-isolation-rules)
9. [EVV & Aggregator Integration](#9-evv--aggregator-integration)
10. [Payroll & Export](#10-payroll--export)
11. [Environment Variables Reference](#11-environment-variables-reference)
12. [Implementation Order](#12-implementation-order)

---

## 1. Environment & Project Setup

### 1.1 Monorepo Structure

```
seriqcare-app-release/
├── app/                        # Next.js App Router pages
├── components/                 # Shared React components
├── lib/                        # Frontend utilities, queries, types
│   ├── queries/                # API fetch functions per domain
│   ├── payroll/                # Payroll export formatters
│   └── types.ts                # Shared TypeScript types
├── backend/                    # FastAPI application
│   ├── routers/                # One file per API domain
│   ├── services/               # Business logic & integrations
│   ├── auth/                   # Auth dependencies & middleware
│   └── db/                     # DB connection & ORM models
├── public/                     # Static assets
├── .env                        # All environment variables (single source)
├── next.config.ts
├── pyproject.toml
└── requirements.txt
```

### 1.2 Frontend Bootstrap

```bash
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir
pnpm add @tanstack/react-query axios date-fns
```

### 1.3 Backend Bootstrap

```bash
pip install fastapi uvicorn sqlalchemy pyodbc python-jose[cryptography] \
  passlib[bcrypt] python-multipart httpx aiosmtplib azure-identity azure-keyvault-secrets
```

### 1.4 Key Config Files

**next.config.ts**
```ts
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_BASE_URL}/api/:path*`,
      },
    ]
  },
}
export default nextConfig
```

**middleware.ts** — Protect all routes except auth pages:
```ts
export function middleware(request: NextRequest) {
  const session = request.cookies.get('seriqcare-session')
  const isAuthPage = request.nextUrl.pathname.startsWith('/login') ||
                     request.nextUrl.pathname.startsWith('/forgot-password') ||
                     request.nextUrl.pathname.startsWith('/reset-password')
  if (!session && !isAuthPage) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  if (session && isAuthPage) {
    return NextResponse.redirect(new URL('/', request.url))
  }
}
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|public).*)'],
}
```

---

## 2. Database Schema

All tables live in the `care` schema on SQL Server. Apply in this order.

### 2.1 Tenants & Reference Data

```sql
-- Agencies (SaaS tenants)
CREATE TABLE care.agencies (
  id            INT IDENTITY PRIMARY KEY,
  agency_code   VARCHAR(20) UNIQUE NOT NULL,
  name          VARCHAR(255) NOT NULL,
  npi           VARCHAR(20),
  tier          VARCHAR(20) DEFAULT 'standard' CHECK (tier IN ('basic','standard','enterprise')),
  is_active     BIT DEFAULT 1,
  created_at    DATETIME2 DEFAULT GETUTCDATE()
);

-- Waivers (PA programs: IDD, OBRA, etc.)
CREATE TABLE care.waivers (
  id          INT IDENTITY PRIMARY KEY,
  agency_id   INT NOT NULL REFERENCES care.agencies(id),
  code        VARCHAR(20) NOT NULL,
  name        VARCHAR(255) NOT NULL,
  is_active   BIT DEFAULT 1
);

-- HCPCS Service Codes
CREATE TABLE care.service_codes (
  id               INT IDENTITY PRIMARY KEY,
  agency_id        INT NOT NULL REFERENCES care.agencies(id),
  hcpcs_code       VARCHAR(10) NOT NULL,
  description      VARCHAR(255),
  unit_type        VARCHAR(20) CHECK (unit_type IN ('15min','hour','visit','day')),
  place_of_service VARCHAR(10),
  is_evv_required  BIT DEFAULT 1,
  is_active        BIT DEFAULT 1
);

-- EVV ESC Error Codes (Sandata)
CREATE TABLE care.evv_error_codes (
  code        VARCHAR(10) PRIMARY KEY,
  description VARCHAR(500),
  severity    VARCHAR(20) CHECK (severity IN ('exception','denial','warning'))
);

-- Reason Codes (manual adjustments)
CREATE TABLE care.reason_codes (
  id          INT IDENTITY PRIMARY KEY,
  agency_id   INT NOT NULL REFERENCES care.agencies(id),
  code        VARCHAR(20) NOT NULL,
  description VARCHAR(255),
  category    VARCHAR(50) CHECK (category IN ('LateEntry','Adjustment','Exception','Cancellation'))
);

-- Providers (agency Sandata/NPI registration)
CREATE TABLE care.providers (
  id               INT IDENTITY PRIMARY KEY,
  agency_id        INT NOT NULL REFERENCES care.agencies(id),
  npi              VARCHAR(20),
  sandata_provider_id VARCHAR(50),
  tax_id           VARCHAR(20),
  is_active        BIT DEFAULT 1
);
```

### 2.2 Users & Authentication

```sql
-- Platform Users
CREATE TABLE care.users (
  id                INT IDENTITY PRIMARY KEY,
  agency_id         INT REFERENCES care.agencies(id),   -- NULL for super_admin
  employee_id       INT,                                 -- FK to employees (for caregivers)
  username          VARCHAR(100) UNIQUE NOT NULL,
  email             VARCHAR(255),
  display_name      VARCHAR(255),
  role              VARCHAR(30) NOT NULL CHECK (role IN ('caregiver','coordinator','agency_admin','super_admin')),
  password_hash     VARCHAR(255),
  entra_object_id   VARCHAR(100),                       -- Azure AD SSO (super_admin)
  is_active         BIT DEFAULT 1,
  failed_attempts   INT DEFAULT 0,
  locked_until      DATETIME2,
  created_at        DATETIME2 DEFAULT GETUTCDATE(),
  updated_at        DATETIME2 DEFAULT GETUTCDATE()
);

-- JWT Session Tracking (for revocation)
CREATE TABLE care.user_sessions (
  jti           VARCHAR(100) PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES care.users(id),
  created_at    DATETIME2 DEFAULT GETUTCDATE(),
  expires_at    DATETIME2 NOT NULL,
  revoked_at    DATETIME2
);

-- Device Sessions (refresh token rotation)
CREATE TABLE care.device_sessions (
  id              INT IDENTITY PRIMARY KEY,
  user_id         INT NOT NULL REFERENCES care.users(id),
  token_hash      VARCHAR(255) NOT NULL,
  previous_hash   VARCHAR(255),                          -- Grace window replay detection
  client_type     VARCHAR(20) CHECK (client_type IN ('web','mobile')),
  created_at      DATETIME2 DEFAULT GETUTCDATE(),
  last_used_at    DATETIME2,
  revoked_at      DATETIME2
);

-- Auth Audit Log
CREATE TABLE care.auth_log (
  id          BIGINT IDENTITY PRIMARY KEY,
  user_id     INT REFERENCES care.users(id),
  action      VARCHAR(30) NOT NULL,                      -- login, refresh, logout, failed_login
  ip_address  VARCHAR(45),
  user_agent  VARCHAR(500),
  jti         VARCHAR(100),
  created_at  DATETIME2 DEFAULT GETUTCDATE()
);

-- Password Reset Tokens
CREATE TABLE care.password_reset_tokens (
  token         VARCHAR(100) PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES care.users(id),
  expires_at    DATETIME2 NOT NULL,
  used_at       DATETIME2
);
```

### 2.3 Clients & Care

```sql
-- Clients (beneficiaries)
CREATE TABLE care.clients (
  id                   INT IDENTITY PRIMARY KEY,
  agency_id            INT NOT NULL REFERENCES care.agencies(id),
  medicaid_id          VARCHAR(50),
  first_name           VARCHAR(100) NOT NULL,
  last_name            VARCHAR(100) NOT NULL,
  date_of_birth        DATE,
  gender               VARCHAR(10),
  phone                VARCHAR(20),
  email                VARCHAR(255),
  status               VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','inactive','pending')),
  care_plan_review_date DATE,
  notes                TEXT,
  created_at           DATETIME2 DEFAULT GETUTCDATE(),
  updated_at           DATETIME2 DEFAULT GETUTCDATE()
);

CREATE TABLE care.client_addresses (
  id             INT IDENTITY PRIMARY KEY,
  client_id      INT NOT NULL REFERENCES care.clients(id),
  address_type   VARCHAR(20) DEFAULT 'service',
  street         VARCHAR(255),
  city           VARCHAR(100),
  state          VARCHAR(2),
  zip            VARCHAR(10),
  latitude       DECIMAL(10,7),
  longitude      DECIMAL(10,7),
  is_primary     BIT DEFAULT 1
);

CREATE TABLE care.client_payer_info (
  id             INT IDENTITY PRIMARY KEY,
  client_id      INT NOT NULL REFERENCES care.clients(id),
  payer_name     VARCHAR(255),
  payer_id       VARCHAR(100),
  member_id      VARCHAR(100),
  plan_type      VARCHAR(50),
  is_primary     BIT DEFAULT 1
);

CREATE TABLE care.client_care_tasks (
  id               INT IDENTITY PRIMARY KEY,
  client_id        INT NOT NULL REFERENCES care.clients(id),
  task_name        VARCHAR(255) NOT NULL,
  task_description TEXT,
  frequency        VARCHAR(50),
  is_active        BIT DEFAULT 1,
  last_completed   DATETIME2,
  created_at       DATETIME2 DEFAULT GETUTCDATE()
);

CREATE TABLE care.client_care_tasks_history (
  id           INT IDENTITY PRIMARY KEY,
  task_id      INT NOT NULL REFERENCES care.client_care_tasks(id),
  completed_by INT REFERENCES care.users(id),
  completed_at DATETIME2 DEFAULT GETUTCDATE(),
  visit_id     INT,
  notes        TEXT
);

-- Service Authorizations (prior auth)
CREATE TABLE care.service_authorizations (
  id               INT IDENTITY PRIMARY KEY,
  client_id        INT NOT NULL REFERENCES care.clients(id),
  agency_id        INT NOT NULL REFERENCES care.agencies(id),
  service_code_id  INT NOT NULL REFERENCES care.service_codes(id),
  authorized_units DECIMAL(10,2) NOT NULL,
  used_units       DECIMAL(10,2) DEFAULT 0,
  start_date       DATE NOT NULL,
  end_date         DATE NOT NULL,
  auth_number      VARCHAR(100),
  status           VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','expired','exhausted'))
);
```

### 2.4 Employees & Schedules

```sql
CREATE TABLE care.employees (
  id                   INT IDENTITY PRIMARY KEY,
  agency_id            INT NOT NULL REFERENCES care.agencies(id),
  employee_code        VARCHAR(50),
  first_name           VARCHAR(100) NOT NULL,
  last_name            VARCHAR(100) NOT NULL,
  hire_date            DATE,
  termination_date     DATE,
  phone                VARCHAR(20),
  email                VARCHAR(255),
  sandata_employee_id  VARCHAR(100),
  status               VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','inactive','terminated')),
  pay_rate             DECIMAL(10,2),
  pay_type             VARCHAR(20) DEFAULT 'hourly' CHECK (pay_type IN ('hourly','salary')),
  ot_threshold         DECIMAL(5,2) DEFAULT 40,
  tax_filing_status    VARCHAR(50),
  federal_allowances   INT DEFAULT 0,
  state_allowances     INT DEFAULT 0,
  created_at           DATETIME2 DEFAULT GETUTCDATE()
);

CREATE TABLE care.schedules (
  id               INT IDENTITY PRIMARY KEY,
  agency_id        INT NOT NULL REFERENCES care.agencies(id),
  client_id        INT REFERENCES care.clients(id),
  employee_id      INT REFERENCES care.employees(id),   -- NULL = open shift
  service_code_id  INT REFERENCES care.service_codes(id),
  scheduled_start  DATETIME2 NOT NULL,
  scheduled_end    DATETIME2 NOT NULL,
  status           VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','assigned','completed','cancelled')),
  notes            TEXT,
  created_at       DATETIME2 DEFAULT GETUTCDATE()
);
```

### 2.5 Visits (EVV Core)

```sql
-- Master visit record (6 Cures Act elements)
CREATE TABLE care.visits (
  id                  INT IDENTITY PRIMARY KEY,
  agency_id           INT NOT NULL REFERENCES care.agencies(id),
  schedule_id         INT REFERENCES care.schedules(id),
  client_id           INT NOT NULL REFERENCES care.clients(id),
  employee_id         INT NOT NULL REFERENCES care.employees(id),
  service_code_id     INT REFERENCES care.service_codes(id),
  service_date        DATE NOT NULL,
  -- EVV Element 5 & 6: Time
  call_in_datetime    DATETIME2,
  call_out_datetime   DATETIME2,
  -- EVV Element 4: Location
  call_in_latitude    DECIMAL(10,7),
  call_in_longitude   DECIMAL(10,7),
  call_out_latitude   DECIMAL(10,7),
  call_out_longitude  DECIMAL(10,7),
  place_of_service    VARCHAR(10),
  -- Units
  billed_units        DECIMAL(10,2),
  approved_units      DECIMAL(10,2),
  -- Status flags
  evv_status          VARCHAR(30) DEFAULT 'pending' CHECK (evv_status IN ('pending','validated','exception','submitted','accepted','rejected')),
  approval_status     VARCHAR(20) DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
  visit_cancelled     BIT DEFAULT 0,
  cancellation_reason VARCHAR(255),
  -- Audit
  created_at          DATETIME2 DEFAULT GETUTCDATE(),
  updated_at          DATETIME2 DEFAULT GETUTCDATE()
);

CREATE TABLE care.visit_evv (
  id               INT IDENTITY PRIMARY KEY,
  visit_id         INT NOT NULL REFERENCES care.visits(id),
  clock_in         DATETIME2,
  clock_out        DATETIME2,
  clock_in_method  VARCHAR(20),   -- gps, telephony, fixed, manual
  clock_out_method VARCHAR(20),
  device_id        VARCHAR(100),
  raw_payload      NVARCHAR(MAX)
);

CREATE TABLE care.visit_billing (
  id               INT IDENTITY PRIMARY KEY,
  visit_id         INT NOT NULL REFERENCES care.visits(id),
  billed_units     DECIMAL(10,2),
  approved_units   DECIMAL(10,2),
  bill_rate        DECIMAL(10,4),
  total_amount     DECIMAL(10,2),
  approval_status  VARCHAR(20) DEFAULT 'pending',
  approved_by      INT REFERENCES care.users(id),
  approved_at      DATETIME2
);

CREATE TABLE care.visit_integration_status (
  id               INT IDENTITY PRIMARY KEY,
  visit_id         INT NOT NULL REFERENCES care.visits(id),
  sandata_status   VARCHAR(30),
  hhax_status      VARCHAR(30),
  last_synced_at   DATETIME2
);

-- Immutable audit trail for clock adjustments
CREATE TABLE care.visit_changes (
  id              BIGINT IDENTITY PRIMARY KEY,
  visit_id        INT NOT NULL REFERENCES care.visits(id),
  changed_by      INT NOT NULL REFERENCES care.users(id),
  change_type     VARCHAR(50),
  field_changed   VARCHAR(100),
  old_value       NVARCHAR(500),
  new_value       NVARCHAR(500),
  reason_code_id  INT REFERENCES care.reason_codes(id),
  notes           TEXT,
  changed_at      DATETIME2 DEFAULT GETUTCDATE()
);

CREATE TABLE care.visit_exceptions (
  id               INT IDENTITY PRIMARY KEY,
  visit_id         INT NOT NULL REFERENCES care.visits(id),
  esc_code         VARCHAR(10) REFERENCES care.evv_error_codes(code),
  description      VARCHAR(500),
  acknowledged_by  INT REFERENCES care.users(id),
  acknowledged_at  DATETIME2,
  created_at       DATETIME2 DEFAULT GETUTCDATE()
);
```

### 2.6 Aggregator & Billing

```sql
CREATE TABLE care.aggregator_submissions (
  id               INT IDENTITY PRIMARY KEY,
  agency_id        INT NOT NULL REFERENCES care.agencies(id),
  visit_id         INT NOT NULL REFERENCES care.visits(id),
  aggregator       VARCHAR(20) CHECK (aggregator IN ('sandata','hhax')),
  mode             VARCHAR(20) CHECK (mode IN ('simulate','live')),
  payload          NVARCHAR(MAX),
  response_code    VARCHAR(20),
  response_message NVARCHAR(MAX),
  submitted_at     DATETIME2 DEFAULT GETUTCDATE(),
  retry_count      INT DEFAULT 0
);

CREATE TABLE care.claims (
  id             INT IDENTITY PRIMARY KEY,
  agency_id      INT NOT NULL REFERENCES care.agencies(id),
  client_id      INT NOT NULL REFERENCES care.clients(id),
  claim_number   VARCHAR(100),
  period_start   DATE NOT NULL,
  period_end     DATE NOT NULL,
  total_units    DECIMAL(10,2),
  total_amount   DECIMAL(10,2),
  status         VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','submitted','paid','denied','voided')),
  payer_id       VARCHAR(100),
  submitted_at   DATETIME2,
  created_at     DATETIME2 DEFAULT GETUTCDATE()
);
```

### 2.7 Payroll & Audit

```sql
CREATE TABLE care.timesheet (
  id             INT IDENTITY PRIMARY KEY,
  agency_id      INT NOT NULL REFERENCES care.agencies(id),
  visit_id       INT NOT NULL REFERENCES care.visits(id),
  employee_id    INT NOT NULL REFERENCES care.employees(id),
  service_date   DATE NOT NULL,
  clock_in       DATETIME2,
  clock_out      DATETIME2,
  total_hours    DECIMAL(5,2),
  regular_hours  DECIMAL(5,2),
  ot_hours       DECIMAL(5,2),
  holiday_hours  DECIMAL(5,2),
  travel_hours   DECIMAL(5,2),
  pay_rate       DECIMAL(10,4),
  differential   DECIMAL(10,4),
  gross_pay      DECIMAL(10,2),
  status         VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','exported')),
  approved_by    INT REFERENCES care.users(id),
  approved_at    DATETIME2,
  export_batch   VARCHAR(100)
);

CREATE TABLE care.audit_log (
  id          BIGINT IDENTITY PRIMARY KEY,
  agency_id   INT REFERENCES care.agencies(id),
  user_id     INT REFERENCES care.users(id),
  action      VARCHAR(100) NOT NULL,
  table_name  VARCHAR(100),
  record_id   INT,
  old_values  NVARCHAR(MAX),
  new_values  NVARCHAR(MAX),
  ip_address  VARCHAR(45),
  created_at  DATETIME2 DEFAULT GETUTCDATE()
);

CREATE TABLE care.api_access_log (
  id              BIGINT IDENTITY PRIMARY KEY,
  agency_id       INT,
  user_id         INT,
  method          VARCHAR(10),
  endpoint        VARCHAR(500),
  status_code     INT,
  duration_ms     INT,
  created_at      DATETIME2 DEFAULT GETUTCDATE()
);
```

---

## 3. Backend — Authentication

### 3.1 Token Architecture

| Token | Type | TTL | Storage |
|---|---|---|---|
| Access Token | HS256 JWT | 10 minutes | Memory (React state) |
| Refresh Token | Random 64-char hex | 30 days | HttpOnly cookie (`seriqcare-rt`) on web; secure storage on mobile |
| Session cookie | Presence-only `seriqcare-session` | Session | Set by frontend on sign-in |

**JWT Claims:**
```json
{
  "sub": "username",
  "role": "coordinator",
  "agency_id": 1,
  "employee_id": null,
  "jti": "uuid4",
  "iat": 1700000000,
  "exp": 1700000600
}
```

- `agency_id` is `null` for `super_admin` — used to bypass row-level filtering
- `employee_id` is populated only for `caregiver` role — links to `care.employees`

### 3.2 Auth Service (`backend/services/auth_tokens.py`)

```python
import secrets, hashlib
from jose import jwt
from datetime import datetime, timedelta, timezone
import os

SECRET_KEY = os.environ["SECRET_KEY"]
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 10

def create_access_token(user: dict) -> str:
    payload = {
        "sub": user["username"],
        "role": user["role"],
        "agency_id": user["agency_id"],
        "employee_id": user.get("employee_id"),
        "jti": str(__import__("uuid").uuid4()),
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def create_refresh_token() -> tuple[str, str]:
    """Returns (raw_token, hashed_token)"""
    raw = secrets.token_hex(64)
    hashed = hashlib.sha256(raw.encode()).hexdigest()
    return raw, hashed

def decode_access_token(token: str) -> dict:
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
```

### 3.3 Auth Dependencies (`backend/auth/dependencies.py`)

```python
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

bearer = HTTPBearer()

async def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(get_db)
) -> dict:
    try:
        payload = decode_access_token(creds.credentials)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    # Verify JTI not revoked
    session = db.query(UserSession).filter_by(jti=payload["jti"]).first()
    if not session or session.revoked_at:
        raise HTTPException(status_code=401, detail="Session revoked")

    return payload  # { sub, role, agency_id, employee_id, jti }

class AgencyScope:
    """Enforce agency isolation — use for all coordinator+ routes"""
    def __call__(self, user: dict = Depends(get_current_user)) -> dict:
        if user["role"] == "caregiver":
            raise HTTPException(status_code=403, detail="Forbidden")
        return user

class AdminScope:
    """Restrict to agency_admin and super_admin"""
    def __call__(self, user: dict = Depends(get_current_user)) -> dict:
        if user["role"] not in ("agency_admin", "super_admin"):
            raise HTTPException(status_code=403, detail="Forbidden")
        return user

class SuperAdminScope:
    """Restrict to super_admin only"""
    def __call__(self, user: dict = Depends(get_current_user)) -> dict:
        if user["role"] != "super_admin":
            raise HTTPException(status_code=403, detail="Forbidden")
        return user
```

### 3.4 Agency Isolation Helper

```python
def agency_filter(query, model, user: dict):
    """Apply agency_id filter from JWT — never from request params"""
    if user["agency_id"] is not None:
        return query.filter(model.agency_id == user["agency_id"])
    return query  # super_admin: no filter
```

### 3.5 Auth Router (`/api/auth`)

#### POST `/api/auth/login`
1. Look up user by username
2. Check `locked_until` — if locked, return 423 with remaining seconds
3. Verify password hash (bcrypt) — skip if `DEV_NO_HASH_AUTH=true`
4. On failure: increment `failed_attempts`, lock after 10 failures for 15 min, log to `auth_log`
5. On success: reset `failed_attempts`, create access + refresh tokens
6. Insert `user_sessions` row (jti)
7. Insert `device_sessions` row (hashed refresh token, client_type from header)
8. Set `seriqcare-rt` cookie (HttpOnly, SameSite=Lax, Secure in prod)
9. Log to `auth_log` (action=login)
10. Return: `{ access_token, token_type: "bearer", user: { username, display_name, role, agency_id } }`

#### POST `/api/auth/refresh`
1. Read refresh token from `seriqcare-rt` cookie (web) or `Authorization: Bearer` body (mobile)
2. Hash incoming token, look up `device_sessions` by hash
3. If not found: check `previous_hash` (5-min grace window for legitimate retries)
4. If grace expired or neither hash matches: revoke all user sessions (reuse attack), return 401
5. Generate new access token + new refresh token
6. Update `device_sessions`: `token_hash = new_hash`, `previous_hash = old_hash`
7. Rotate `seriqcare-rt` cookie
8. Return: `{ access_token }`

#### POST `/api/auth/logout`
1. Decode access token (allow expired tokens — use without exp validation)
2. Mark `user_sessions.revoked_at = NOW()` for this jti
3. Mark `device_sessions.revoked_at = NOW()`
4. Clear `seriqcare-rt` cookie
5. Log to `auth_log` (action=logout)
6. Return 204

#### POST `/api/auth/forgot-password`
1. Look up user by email
2. Generate secure token (32 bytes hex), store in `password_reset_tokens` (expires in 1 hour)
3. Send email via SMTP with reset link: `{FRONTEND_BASE_URL}/reset-password?token={token}`
4. Always return 200 (never reveal if email exists)

#### POST `/api/auth/reset-password`
1. Validate token exists in `password_reset_tokens`, not expired, not used
2. Hash new password (bcrypt)
3. Update `users.password_hash`
4. Mark token `used_at = NOW()`
5. Revoke all active sessions for that user
6. Return 200

#### POST `/api/auth/change-password`
- Requires valid JWT. Verify `old_password`, set new bcrypt hash.

#### POST `/api/auth/admin-reset-password`
- Requires `coordinator+`. Force-reset another user's password within same agency.

---

## 4. Backend — Core API Routers

All routers follow these rules:
- Import `AgencyScope`, `AdminScope`, or `SuperAdminScope` as the `Depends`
- **Never** trust `agency_id` from request body/params — always read from `user["agency_id"]`
- Use `agency_filter()` helper on all queries
- Log mutations to `care.audit_log`

### 4.1 Profile (`/api/profile`)

```
GET /api/profile/me
```
Returns current user info from JWT + DB lookup (display_name, email, role, agency details).

### 4.2 Dashboard (`/api/dashboard`)

```
GET /api/dashboard/metrics
```
Returns KPI snapshot:
- `total_clients` — active clients count (agency-scoped)
- `visits_today` — count of visits with `service_date = TODAY`
- `pending_exceptions` — visit_exceptions not acknowledged
- `evv_pending` — visits with `evv_status = 'pending'`
- `claims_draft` — claims with `status = 'draft'`
- `timesheets_pending` — timesheets awaiting approval

```
GET /api/dashboard/dashboard
```
Returns full dashboard payload (above metrics + recent activity feed).

### 4.3 Clients (`/api/clients`)

```
GET    /api/clients                         # Paginated list (search, status filter)
POST   /api/clients                         # Create client
GET    /api/clients/{id}                    # Full detail
PUT    /api/clients/{id}                    # Update client
GET    /api/clients/{id}/insurance          # Payer info
GET    /api/clients/{id}/authorizations     # Service authorizations
GET    /api/clients/{id}/visits             # Client's visit history
GET    /api/clients/{id}/care-tasks         # Care plan tasks
PATCH  /api/clients/{id}/care-tasks         # Bulk update tasks
```

**Query filters for list:** `search` (name/medicaid_id), `status` (active/inactive/pending), `page`, `limit`
**Agency scope:** `WHERE c.agency_id = :agency_id`
**Roles:** `AgencyScope` (coordinator+)

### 4.4 Caregivers (`/api/caregivers`)

```
GET    /api/caregivers                      # Roster with this-week hours
POST   /api/caregivers                      # Onboard new caregiver (creates employee + user)
GET    /api/caregivers/{id}                 # Detail view
GET    /api/caregivers/{id}/payroll         # Payroll settings
PATCH  /api/caregivers/{id}/payroll         # Update payroll config
```

**Roles for POST:** `AdminScope`
**Payroll fields:** `pay_rate`, `pay_type`, `ot_threshold`, `tax_filing_status`, `federal_allowances`, `state_allowances`

### 4.5 Schedule (`/api/schedule`)

```
GET    /api/schedule/today                  # Today's shifts
GET    /api/schedule/week                   # Weekly schedule (start_date param)
POST   /api/schedule                        # Create shift
PATCH  /api/schedule/{id}                   # Update shift (assign employee, change times, cancel)
```

**Create shift body:** `client_id`, `employee_id` (optional — null = open shift), `service_code_id`, `scheduled_start`, `scheduled_end`
**Week query:** Group by day, return `{ date, shifts: [...] }`

### 4.6 Visits (`/api/visits`)

#### Coordinator-side endpoints:
```
GET    /api/visits                          # EVV log (filters: date, status, client, employee)
GET    /api/visits/week                     # Weekly summary
PATCH  /api/visits/{id}                     # Manual clock adjustment (writes to visit_changes)
PATCH  /api/visits/{id}/approve             # Approve for billing
PATCH  /api/visits/{id}/fix                 # Fix EVV data with reason code
POST   /api/visits/validate/{id}            # Run EVV validation rules
POST   /api/visits/validate-all             # Bulk validate pending visits
PUT    /api/visits/{id}/approve             # Full approval workflow
PUT    /api/visits/{id}/reject              # Reject visit
```

#### Mobile (caregiver) endpoints:
```
POST   /api/visits/clock-in                 # Start EVV session (captures GPS location)
PUT    /api/visits/{id}/clock-out           # End EVV session + location capture
POST   /api/visits/complete                 # Mark visit complete
```

**All manual adjustments** must:
1. Write old + new values to `care.visit_changes`
2. Require a `reason_code_id`
3. Recalculate `billed_units` after time change

**EVV Validation rules:**
- Clock-in before clock-out
- Total duration within authorized units for the period
- Place of service matches client address (geofence within 0.5 miles)
- Employee linked to a valid schedule for that day/client
- Service date within authorization date range

### 4.7 Aggregator (`/api/aggregator`)

```
GET    /api/aggregator/mode                 # Current mode per aggregator
GET    /api/aggregator/queue                # Visits pending submission
GET    /api/aggregator/submissions          # Submission history
POST   /api/aggregator/submit/{visit_id}    # Submit single visit
POST   /api/aggregator/batch                # Batch submit (limit 50)
POST   /api/aggregator/submissions/{id}/retry  # Retry failed submission
```

**Mode** is read from env: `SANDATA_MODE` and `HHAX_MODE` (`simulate` | `live`)
**Simulate mode:** POST to simulator URL, no real credentials needed
**Live mode:** POST to real aggregator API with `SANDATA_API_KEY` / HHAX OAuth

**Submission flow:**
1. Build aggregator-specific payload (see Section 9)
2. POST to aggregator endpoint
3. Write result to `care.aggregator_submissions`
4. Update `care.visit_integration_status`
5. On Sandata ESC code in response: create `care.visit_exceptions` row

### 4.8 Timesheets (`/api/timesheets`)

```
GET    /api/timesheets                      # List (period_start, period_end, status filters)
PATCH  /api/timesheets/{visit_id}           # Update record
PATCH  /api/timesheets/{visit_id}/approve   # Approve for payroll
```

Timesheets are **denormalized** — one row per visit, pre-computed hours breakdown.

### 4.9 Billing (`/api/billing`)

```
GET    /api/billing                         # Claims list
GET    /api/billing/stats                   # Period stats
GET    /api/billing/auth-utilization        # Remaining auth units per client
GET    /api/billing/claims                  # Claims history
GET    /api/billing/claims/{id}             # Claim detail + line items
GET    /api/billing/claims/{id}/export      # PDF/Excel export
POST   /api/billing/generate                # Generate single claim
POST   /api/billing/generate-bulk           # Batch generate claims
PATCH  /api/billing/claims/{id}/status      # Update claim status
GET    /api/billing/group-visits            # Preview claim grouping
POST   /api/billing/export                  # Export billing CSV for payroll
```

**Claim generation logic:**
- Group approved visits by client + service_code + date range
- Sum `approved_units`, calculate `total_amount = approved_units × bill_rate`
- Check against active `service_authorizations` — warn if over-utilized

### 4.10 Settings (`/api/settings`)

```
GET    /api/settings/agency                 # Current agency config
PUT    /api/settings/agency                 # Update agency info (AdminScope)
GET    /api/settings/payroll                # Payroll config
PUT    /api/settings/payroll                # Update payroll config (AdminScope)
GET    /api/settings/service-codes          # Available HCPCS codes
GET    /api/settings/users                  # Agency users (AdminScope)
GET    /api/settings/audit-log              # Audit trail (AdminScope)
GET    /api/settings/api-access-log         # API call history (AdminScope)
```

Agency settings include: `name`, `npi`, `tier`, `timezone`, `evv_aggregator` (sandata|hhax)

### 4.11 Super Admin (`/api/super-admin`)

```
GET    /api/super-admin/agencies            # All agencies (SuperAdminScope)
POST   /api/settings/agencies               # Create agency tenant (SuperAdminScope)
PATCH  /api/settings/agencies/{id}          # Update agency (SuperAdminScope)
GET    /api/super-admin/dashboard           # Platform-wide stats
```

### 4.12 Mobile Endpoints

```
GET    /api/schedules/today                 # Caregiver's today schedule (caregiver role only)
GET    /api/schedules/week                  # Caregiver's week schedule
GET    /api/tasks                           # Caregiver's care tasks for today
POST   /api/tasks/complete                  # Mark task complete
```

All mobile endpoints are restricted to `role = 'caregiver'`. Use `employee_id` from JWT to scope.

---

## 5. Frontend — Auth Pages

### 5.1 Auth Context (`components/auth-context.tsx`)

```tsx
interface AuthState {
  accessToken: string | null
  user: { username: string; displayName: string; role: string; agencyId: number | null } | null
}

// Provides:
// - signIn(username, password) → sets accessToken in memory, sets seriqcare-session cookie
// - signOut() → calls /api/auth/logout, clears state + cookie
// - apiFetch(url, options) → wraps fetch with Authorization header, auto-refreshes on 401
```

**Token storage:** access token lives in React state (never localStorage/sessionStorage).
**`seriqcare-session` cookie:** Presence-only cookie (no value). Set by frontend JS on sign-in, cleared on sign-out. Used by `middleware.ts` to decide route protection without exposing the access token.

### 5.2 `/login` Page

**UI Elements:**
- Agency logo / SeriqCare branding
- Username input
- Password input
- "Sign In" button (shows spinner while loading)
- Rate limit countdown: "Too many attempts. Try again in Xs"
- Link: "Forgot password?"

**Logic:**
1. POST to `/api/auth/login`
2. On 200: store access token in auth context, set `seriqcare-session` cookie, redirect to `/`
3. On 423 (locked): show countdown timer from `lockout_seconds` in response
4. On 401 (wrong credentials): show "Invalid username or password" — include attempt count if returned
5. On 429 (rate limited): show "Too many attempts. Try again in Xs"

### 5.3 `/forgot-password` Page

- Email input + submit button
- On submit: POST `/api/auth/forgot-password`
- Always show: "If that email is registered, a reset link has been sent."

### 5.4 `/reset-password` Page

- Read `?token=` from URL
- On load: validate token (optionally pre-validate via GET endpoint)
- Inputs: new password + confirm password
- On submit: POST `/api/auth/reset-password` with `{ token, new_password }`
- On success: redirect to `/login` with success message

---

## 6. Frontend — Protected Pages

All protected pages are wrapped by `ProtectedLayout` and use `apiFetch` from auth context for all API calls.

### 6.1 `/` — Dashboard

**Data:** `GET /api/dashboard/metrics`
**Layout:** Grid of KPI cards + activity feed

**KPI Cards:**
- Active Clients (count)
- Visits Today (count, with on-duty indicator)
- Pending Exceptions (count, orange badge if > 0)
- EVV Pending Submission (count)
- Timesheets Awaiting Approval (count)
- Draft Claims (count)

**Priority Queue:** List of visits with exceptions or pending actions, sortable by urgency.

### 6.2 `/clients` — Clients List

**Data:** `GET /api/clients?search=&status=&page=&limit=`
**Filters:** Search bar (name or Medicaid ID), status dropdown (all/active/inactive/pending)
**Table columns:** Name, Medicaid ID, Care Plan Review Date (highlight if expired/upcoming), Status, Actions

**Actions per row:**
- View detail → `/clients/[id]`
- Quick approve pending care plan

**"New Client" button** → `/clients/new` (AdminScope)

### 6.3 `/clients/new` — Create Client

**Form fields:**
- First Name, Last Name (required)
- Date of Birth
- Gender
- Medicaid ID
- Phone, Email
- Service Address (Street, City, State, ZIP)
- Care Plan Review Date

On submit: `POST /api/clients` → redirect to `/clients/[id]`

### 6.4 `/clients/[id]` — Client Detail

**Tabs:**
1. **Demographics** — Display/edit all client fields
2. **Payers** — Insurance info from `client_payer_info`
3. **Authorizations** — `GET /api/clients/{id}/authorizations` — table: service code, authorized units, used units, date range, status
4. **Visits** — `GET /api/clients/{id}/visits` — recent visit history
5. **Care Tasks** — `GET /api/clients/{id}/care-tasks` — checklist with completion status

### 6.5 `/caregivers` — Caregiver Roster

**Data:** `GET /api/caregivers`
**Table:** Name, Employee Code, Status (on-duty/off), This Week Hours, Pay Rate
**Filter:** Name search, status (active/inactive)
**"Onboard Caregiver" button** → `/caregivers/new` (AdminScope)

### 6.6 `/caregivers/new` — Onboard Caregiver

**Form fields:**
- First Name, Last Name
- Employee Code
- Hire Date
- Phone, Email
- Initial Pay Rate
- Pay Type (hourly/salary)

**Backend action:** Create `care.employees` row + create `care.users` row (role=caregiver) + set temp password.

### 6.7 `/caregivers/[id]` — Caregiver Detail

**Tabs:**
1. **Profile** — Employee info, edit name/phone/email
2. **Shifts** — Historical schedules
3. **Payroll** — `GET /api/caregivers/{id}/payroll` — pay rate, OT threshold, tax config. Edit via `PATCH`.

### 6.8 `/schedule` — Weekly Schedule

**Data:** `GET /api/schedule/week?start_date=YYYY-MM-DD`
**View:** 7-column grid (Mon–Sun), each cell shows shifts for that day

**Shift card shows:** Client name, Employee name (or "OPEN" in yellow), Start–End time, Status badge

**Interactions:**
- Click "New Shift" → `new-shift-modal` (select client, employee, date/time, service code)
- Click shift card → edit modal (assign employee, adjust times, cancel)
- Week navigation: prev/next arrows

### 6.9 `/visits` — EVV Visit Log

**Data:** `GET /api/visits?date=&client_id=&employee_id=&evv_status=`
**Filters:** Date range picker, client dropdown, employee dropdown, EVV status

**Table columns:** Service Date, Client, Employee, Clock In, Clock Out, Duration, EVV Status, Approval Status, Actions

**Actions per row:**
- View detail (opens `visit-detail-modal`)
- Approve (`PATCH /api/visits/{id}/approve`)
- Fix (`PATCH /api/visits/{id}/fix` — requires reason code selection)

**Exception indicator:** Red badge on rows with unacknowledged exceptions.

### 6.10 `/clock` — Mobile Clock Page

**No sidebar, no topbar** — standalone mobile-optimized page.
**Role:** Caregiver only.

**States:**
1. **Clocked Out:** Show today's schedule, "Clock In" button
2. **Clocked In:** Show active visit timer (elapsed time), client name, "Clock Out" button

**On Clock In:** `POST /api/visits/clock-in` with GPS coordinates
**On Clock Out:** `PUT /api/visits/{id}/clock-out` with GPS coordinates
**After clock-out:** Show summary (duration, care tasks checklist)

### 6.11 `/timesheets` — Timesheet Approval

**Data:** `GET /api/timesheets?period_start=&period_end=&status=`
**Pay period selector** at top (dropdown or date pickers)

**Table:** Employee, Service Date, Clock In/Out, Total Hours, Regular, OT, Holiday, Pay Rate, Gross Pay, Status

**Bulk approve:** Checkbox selection + "Approve Selected" button
**Export:** `timesheet-export-btn` — select payroll provider (ADP, Guidepoint, Paychex), download CSV

### 6.12 `/claims` — Claims Management

**Data:** `GET /api/billing/claims?date_start=&date_end=&status=`

**Table:** Claim #, Client, Period, Total Units, Total Amount, Status, Actions

**Actions:**
- View detail → claim line items
- Export (PDF/Excel)
- Update status (submitted / paid / denied)

**Generate claims:**
- "Generate" button → select client + date range → `POST /api/billing/generate`
- "Bulk Generate" → select date range → `POST /api/billing/generate-bulk`

### 6.13 `/billing` — Auth Utilization

**Data:** `GET /api/billing/auth-utilization`

**Table per client:** Service Code, Authorized Units, Used Units, Remaining Units, % Used (progress bar)
**Highlight:** Rows where remaining units < 10% (red), < 25% (yellow)

### 6.14 `/evv` — EVV Aggregator

**Tabs:** Sandata | HHAeXchange (using `aggregator-tabs` component)
**Mode indicator:** "SIMULATE MODE" banner if `mode = simulate`

**Queue tab:** `GET /api/aggregator/queue` — visits ready to submit
- Columns: Visit ID, Client, Employee, Service Date, EVV Status
- Actions: Submit single, select multiple + Batch Submit

**Submissions tab:** `GET /api/aggregator/submissions` — history
- Columns: Submitted At, Visit ID, Response Code, Response Message, Retry button (if failed)

### 6.15 `/care-plans` — Care Plan Review

**Data:** Derived from `GET /api/clients` filtered for care plan review dates

**Table:** Client name, Review Date, Days Until Review, Status (upcoming/overdue)
**Color coding:** Overdue = red, within 30 days = yellow, OK = green
**Click row → `/clients/[id]` (Care Tasks tab)**

### 6.16 `/reports` — Custom Reports

**Report types (select from dropdown):**
- EVV Compliance Report (visits with exceptions by period)
- Hours by Caregiver (payroll summary)
- Authorization Utilization (units remaining by client)
- Claims Summary (billing by period)

**Each report:** Date range pickers, generate button, preview table, export CSV/PDF

### 6.17 `/settings` — Agency Settings

**Tabs (AdminScope):**
1. **Agency Info** — Name, NPI, address, tier
2. **Payroll** — Pay period type (weekly/bi-weekly/semi-monthly), OT rules, holiday calendar
3. **Service Codes** — List HCPCS codes, toggle active/inactive
4. **Users** — Agency user list, reset passwords, deactivate accounts
5. **Audit Log** — Paginated `care.audit_log` (action, user, timestamp, record)
6. **API Log** — `care.api_access_log` (endpoint, status, duration)

### 6.18 `/administration` — Data Management

**AdminScope+ only.**

**Sections:**
- **Waivers** — Add/edit/deactivate PA waivers
- **Reason Codes** — CRUD for manual adjustment reason codes
- **EVV Error Codes** — View Sandata ESC codes (read-only reference)
- **Providers** — Agency Sandata/NPI registration data

### 6.19 `/super-admin` — Platform Admin

**SuperAdminScope only.**

**Sections:**
- **Agencies** — Table of all tenants (name, code, tier, status, user count)
  - Create new agency → form modal
  - Edit agency → inline edit or modal
- **Platform Stats** — `GET /api/super-admin/dashboard` — total agencies, visits today, system health
- **Audit Log** — Cross-agency audit trail

### 6.20 `/documentation` — Help Center

**Static or CMS-driven content pages.** Role-filtered topics (caregivers see clock-in help; admins see billing docs).

---

## 7. Frontend — Layout & Components

### 7.1 `ProtectedLayout` (`components/protected-layout.tsx`)

Wraps all authenticated pages:
```tsx
<div className="flex h-screen">
  <Sidebar />
  <div className="flex flex-col flex-1 overflow-hidden">
    <Topbar />
    <main className="flex-1 overflow-auto p-6">
      {children}
    </main>
  </div>
</div>
```

### 7.2 `Sidebar` (`components/sidebar.tsx`)

Left nav with role-based visibility:

| Nav Item | Roles |
|---|---|
| Dashboard | All |
| Clients | Coordinator+ |
| Caregivers | Coordinator+ |
| Schedule | Coordinator+ |
| Visits | Coordinator+ |
| Timesheets | Coordinator+ |
| Claims | Coordinator+ |
| Billing | Coordinator+ |
| EVV | Coordinator+ |
| Care Plans | Coordinator+ |
| Reports | Coordinator+ |
| Settings | Agency Admin+ |
| Administration | Agency Admin+ |
| Super Admin | Super Admin |
| Documentation | All |

Active item highlighted. Collapse to icon-only on mobile.

### 7.3 `Topbar` (`components/topbar.tsx`)

- Right side: user display name + role badge + sign-out button
- Calls `signOut()` from auth context on click

### 7.4 Key Modals

**`new-shift-modal`:**
- Client select, Employee select (optional), Date, Start/End time, Service Code
- POST `/api/schedule`

**`visit-detail-modal`:**
- All EVV fields (times, location, employee)
- Exceptions list with ESC codes
- Approve / Fix buttons

### 7.5 API Query Layer (`lib/queries/`)

One file per domain. Each exports typed fetch functions using `apiFetch` from auth context:

```ts
// lib/queries/clients.ts
export async function getClients(params: ClientListParams) {
  return apiFetch(`/api/clients?${new URLSearchParams(params)}`)
}

export async function getClient(id: number) {
  return apiFetch(`/api/clients/${id}`)
}
```

---

## 8. Multi-Agency Isolation Rules

These rules are **non-negotiable** and must be applied consistently:

1. **JWT is the authority.** The `agency_id` in the decoded JWT is the only valid agency scope. Never accept `agency_id` in request bodies, query params, or headers for filtering.

2. **Every query is scoped.** All `SELECT`, `UPDATE`, `DELETE` operations on agency-owned tables must include `WHERE agency_id = :agency_id` from the JWT.

3. **FK lookups must be validated.** When a coordinator submits `client_id=5`, verify `clients.agency_id = JWT.agency_id` before proceeding. Never assume the FK is valid.

4. **Super admin exemption.** `role = 'super_admin'` has `agency_id = null`. The `agency_filter()` helper must return unfiltered results for this role.

5. **Cross-agency write is forbidden.** Even super_admin cannot write to one agency's data on behalf of another via normal API endpoints — use admin-specific endpoints.

6. **Audit everything.** Every mutation writes to `care.audit_log` with `user_id`, `agency_id`, `action`, `table_name`, `record_id`.

---

## 9. EVV & Aggregator Integration

### 9.1 EVV Validation (`backend/services/evv_validation.py`)

Run on every visit before aggregator submission:

```python
def validate_visit(visit: Visit, db: Session) -> list[str]:
    errors = []

    # Rule 1: Times are set
    if not visit.call_in_datetime or not visit.call_out_datetime:
        errors.append("Missing clock-in or clock-out time")

    # Rule 2: Clock-in before clock-out
    if visit.call_in_datetime >= visit.call_out_datetime:
        errors.append("Clock-out must be after clock-in")

    # Rule 3: Date within authorization range
    auth = db.query(ServiceAuthorization).filter(
        ServiceAuthorization.client_id == visit.client_id,
        ServiceAuthorization.service_code_id == visit.service_code_id,
        ServiceAuthorization.start_date <= visit.service_date,
        ServiceAuthorization.end_date >= visit.service_date,
        ServiceAuthorization.status == 'active'
    ).first()
    if not auth:
        errors.append("No active authorization for this service on this date")

    # Rule 4: Units within authorized
    # (15-minute blocks, no rounding — truncate)
    duration_minutes = (visit.call_out_datetime - visit.call_in_datetime).total_seconds() / 60
    billed_units = int(duration_minutes / 15)
    if auth and (auth.used_units + billed_units) > auth.authorized_units:
        errors.append("Visit would exceed authorized units")

    # Rule 5: Geofence (optional — if client has coordinates)
    # ...

    return errors
```

### 9.2 Sandata Payload (`backend/services/sandata.py`)

Build the XML/JSON payload per Sandata EVV Vendor Specification v1.4. Key fields:
- `ProviderID` → `SANDATA_PROVIDER_ID` env var
- `MedicaidID` → `clients.medicaid_id`
- `EmployeeID` → `employees.sandata_employee_id`
- `ServiceCode` → `service_codes.hcpcs_code`
- `StartDateTime`, `EndDateTime` → clock-in/out in Eastern time (use `APP_TIMEZONE`)
- `PlaceOfService` → `visits.place_of_service`
- `CallInLatitude`, `CallInLongitude`, `CallOutLatitude`, `CallOutLongitude`

### 9.3 HHAeXchange Payload (`backend/services/hhax.py`)

HHAeXchange uses OAuth2. Flow:
1. POST to `{HHAX_BASE_URL}/oauth/token` with `client_credentials` grant
2. Use access token for visit submission
3. Key fields: `AgencyTaxId` → `HHAX_AGENCY_TAX_ID`, `PayerId` → from `client_payer_info` or `HHAX_DEFAULT_PAYER_ID`

### 9.4 Simulate Mode

When `SANDATA_MODE=simulate`: POST payload to `{SANDATA_SIMULATOR_URL}` — no real credentials needed.
When `HHAX_MODE=simulate`: POST to `{HHAX_BASE_URL}` with test credentials.

The UI shows a yellow banner: **"SIMULATE MODE — No real submissions"**

---

## 10. Payroll & Export

### 10.1 Timesheet Calculation

When a visit is approved:
1. Fetch employee's `pay_rate`, `ot_threshold`, `pay_type`
2. Calculate `total_hours = (call_out - call_in).total_seconds() / 3600`
3. Determine `regular_hours` vs `ot_hours` (compare weekly totals vs `ot_threshold`)
4. Apply `differential` (shift differential rates if configured)
5. `gross_pay = (regular_hours × pay_rate) + (ot_hours × pay_rate × 1.5) + ...`
6. Write to `care.timesheet`

### 10.2 Export Formats (`lib/payroll/`)

Supported providers: ADP, Guidepoint, Paychex, generic CSV.

Each provider has a column mapping:
```ts
const ADP_MAPPING = {
  'File #': 'employee_code',
  'Reg Hours': 'regular_hours',
  'O/T Hours': 'ot_hours',
  'Holiday Hours': 'holiday_hours',
  // ...
}
```

Export function reads `GET /api/timesheets?status=approved&period_start=&period_end=`, maps columns, outputs CSV download.

---

## 11. Environment Variables Reference

All variables are defined in `.env` at project root. Never hardcode any of these values.

### Database
| Variable | Description |
|---|---|
| `DB_SERVER` | SQL Server hostname |
| `DB_PORT` | Default: 1433 |
| `DB_NAME` | SeriqCareDB |
| `DB_USER` | SQL auth (local dev only) |
| `DB_PASSWORD` | SQL auth (local dev only) |
| `DB_CLIENT_ID` | Service principal client ID (Azure) |
| `DB_CLIENT_SECRET` | Service principal secret (Azure) |
| `DB_TENANT_ID` | Azure tenant ID |
| `ODBC_DRIVER` | "ODBC Driver 17 for SQL Server" |
| `DB_POOL_SIZE` | Connection pool size |
| `DB_MAX_OVERFLOW` | Pool overflow limit |
| `DB_POOL_TIMEOUT` | Pool checkout timeout (seconds) |
| `DB_KEEPALIVE_INTERVAL` | Keepalive ping interval (seconds) |

### Authentication
| Variable | Description |
|---|---|
| `SECRET_KEY` | HS256 JWT signing key (56+ chars) |
| `JWT_SECRET` | Alias of SECRET_KEY (mobile) |
| `JWT_EXPIRE_HOURS` | Access token TTL (use 10 min = 0.167) |
| `COOKIE_SECURE` | true in production (HTTPS only) |
| `DEV_NO_HASH_AUTH` | Skip bcrypt check in dev (never true in prod) |
| `DEV_PASSWORD` | Dev mode bypass password |
| `SUPER_ADMIN_PASSWORD` | Initial super admin seed password |

### API & CORS
| Variable | Description |
|---|---|
| `ENV` | local \| dev \| prod |
| `PORT` | Backend port (8000) |
| `API_BASE_URL` | Backend URL (used by Next.js rewrites) |
| `NEXT_PUBLIC_API_BASE_URL` | Exposed to browser (must start with NEXT_PUBLIC_) |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `DEBUG` | Log SQL queries (true in dev) |
| `APP_TIMEZONE` | America/New_York |
| `SQLSERVER_TIMEZONE_NAME` | Eastern Standard Time |

### Azure
| Variable | Description |
|---|---|
| `USE_KEY_VAULT` | Enable Azure Key Vault (false in dev) |
| `VAULT_URL` | Key vault endpoint |
| `KV_DB_CLIENT_ID_SECRET_NAME` | Secret name in vault |
| `KV_DB_CLIENT_SECRET_SECRET_NAME` | Secret name in vault |
| `KV_DB_TENANT_ID_SECRET_NAME` | Secret name in vault |
| `ENTRA_TENANT_ID` | Azure AD tenant (for super_admin SSO) |
| `ENTRA_CLIENT_ID` | Azure AD app client ID |
| `ENTRA_APP_URI` | App URI for token validation |
| `ENTRA_SCOPE` | OAuth scope for Entra login |

### Email (SMTP)
| Variable | Description |
|---|---|
| `SMTP_HOST` | mail.smtp2go.com |
| `SMTP_PORT` | 2525 |
| `SMTP_USER` | SMTP username |
| `SMTP_PASSWORD` | SMTP password |
| `SMTP_FROM` | noreply@seriqcare.com |
| `FRONTEND_BASE_URL` | Used in reset-password email links |

### Sandata EVV
| Variable | Description |
|---|---|
| `SANDATA_MODE` | simulate \| live |
| `SANDATA_API_URL` | Live API endpoint |
| `SANDATA_API_KEY` | Live API credentials |
| `SANDATA_PROVIDER_ID` | Registered provider ID |
| `SANDATA_TIMEOUT` | Request timeout (seconds) |
| `SANDATA_SIMULATOR_URL` | Local simulator URL (dev) |
| `SANDATA_SIMULATOR_TIMEOUT` | Simulator request timeout |

### HHAeXchange
| Variable | Description |
|---|---|
| `HHAX_MODE` | simulate \| live |
| `HHAX_BASE_URL` | Base URL for HHAX API |
| `HHAX_CLIENT_ID` | OAuth client ID |
| `HHAX_CLIENT_SECRET` | OAuth client secret |
| `HHAX_SCOPE` | OAuth scope |
| `HHAX_AGENCY_TAX_ID` | Agency tax ID for submissions |
| `HHAX_DEFAULT_PAYER_ID` | Fallback payer ID |
| `HHAX_TIMEOUT` | Request timeout (seconds) |

---

## 12. Implementation Order

Build in this exact order — each phase depends on the previous.

### Phase 1 — Foundation
1. Database schema (all tables in Section 2)
2. Backend DB connection + ORM models
3. `backend/services/auth_tokens.py` (JWT + refresh token utilities)
4. `backend/auth/dependencies.py` (auth deps, scope classes, agency_filter)
5. Auth router (`/api/auth` — all endpoints)
6. Profile router (`/api/profile/me`)

### Phase 2 — Frontend Auth Shell
7. Next.js project init with Tailwind
8. `middleware.ts` (route protection)
9. `components/auth-context.tsx` (token management, apiFetch)
10. `/login` page
11. `/forgot-password` page
12. `/reset-password` page

### Phase 3 — Layout & Navigation
13. `components/sidebar.tsx` (role-based nav)
14. `components/topbar.tsx`
15. `components/protected-layout.tsx`

### Phase 4 — Core Data API
16. Dashboard router + `/` dashboard page
17. Clients router + `/clients`, `/clients/new`, `/clients/[id]`
18. Caregivers router + `/caregivers`, `/caregivers/new`, `/caregivers/[id]`
19. Schedule router + `/schedule` + `new-shift-modal`

### Phase 5 — EVV Operations
20. Visits router (coordinator endpoints) + `/visits` + `visit-detail-modal`
21. `backend/services/evv_validation.py`
22. Mobile clock endpoints + `/clock` page

### Phase 6 — Aggregator & Billing
23. `backend/services/sandata.py`
24. `backend/services/hhax.py`
25. Aggregator router + `/evv` page
26. Billing router + `/billing`, `/claims`

### Phase 7 — Payroll & Reporting
27. Timesheets router + `/timesheets`
28. `lib/payroll/export.ts` + payroll export button
29. `/reports` page
30. `/care-plans` page

### Phase 8 — Administration
31. Settings router + `/settings`
32. Administration router + `/administration`
33. Super admin router + `/super-admin`

### Phase 9 — Polish
34. `backend/services/migrations.py` (startup migration runner)
35. Audit log middleware (log all mutations to `care.audit_log`)
36. API access log middleware (log all requests to `care.api_access_log`)
37. `/documentation` page
38. Error boundaries, loading states, empty states on all pages
