# SeriqCare QA Test Cases

## Purpose
This document defines manual QA test cases for the current SeriqCare Next.js frontend and FastAPI backend.

It is based on the current application structure, including:
- Frontend pages under `app/`
- Backend routers under `backend/routers/`
- Auth flows in `components/auth-context.tsx` and `backend/routers/auth.py`
- Visit, aggregator, and timesheet workflows, including `sql/add_timesheet_table.sql`

## Test Environments
Use at least these environments during QA:
- Local development: Next.js + FastAPI + local or dev Azure SQL database
- Cloud staging or production-like: Vercel frontend + Render backend + Azure SQL

## Recommended Test Data
Prepare test users and records before execution:
- One active coordinator user
- One active agency admin user
- One active super admin user
- One active caregiver user
- One inactive user
- At least 3 clients
- At least 3 caregivers/employees
- Visits in these states: `Incomplete`, `Ready`, `Submitted`, `Processed`, `Verified`
- Visits with and without GPS coordinates
- Visits with and without clock-out timestamps
- At least one cancelled visit
- Aggregator submission history with accepted and rejected rows
- A database state before `care.timesheet` exists, and another after `sql/add_timesheet_table.sql` has been run

## Frontend Coverage Map
Primary UI routes to validate:
- `/login`
- `/signup`
- `/`
- `/clients`
- `/caregivers`
- `/schedule`
- `/visits`
- `/timesheets`
- `/evv`

---

## Frontend Test Cases

| ID | Area | Scenario | Preconditions | Steps | Expected Result |
| --- | --- | --- | --- | --- | --- |
| FE-AUTH-001 | Login | Successful login with valid portal user | Active user exists | Open `/login`; enter valid username and password; submit | User is authenticated, session is stored, and user is redirected to `/` |
| FE-AUTH-002 | Login | Invalid login shows error | Active user exists | Open `/login`; enter valid username and wrong password; submit | Login fails, user stays on `/login`, and an error message is shown |
| FE-AUTH-003 | Login | Lockout countdown after repeated failed attempts | Rate limiting enabled | Submit invalid credentials repeatedly until lockout occurs | UI shows lockout error, retry countdown appears, and submit action is blocked during lockout |
| FE-AUTH-004 | Logout | User can sign out from protected UI | Logged-in user exists | Login; click sign out from top bar | Local session is cleared, cookie is removed, and user returns to `/login` |
| FE-AUTH-005 | Route protection | Unauthenticated user cannot access protected pages | No saved session | Open `/`, `/clients`, `/schedule`, `/visits`, `/timesheets` directly | User is redirected to `/login` |
| FE-AUTH-006 | Signup | Successful signup creates session and lands in app | Signup enabled | Open `/signup`; complete form with matching passwords; submit | New account is created, JWT session is established, and user is redirected into the app |
| FE-AUTH-007 | Signup | Signup validation blocks bad input | Signup enabled | Submit form with short password or mismatched passwords | Form submission fails and validation error is shown |
| FE-DASH-001 | Dashboard | Dashboard loads KPIs, alerts, and charts | Logged-in user; API reachable | Login and open `/` | KPI cards, alerts, EVV breakdown, and activity chart render without page errors |
| FE-DASH-002 | Dashboard | Dashboard handles empty or no-data state | Backend returns empty/fallback values | Open `/` in a dataset with no recent activity | Empty-state messaging renders and page does not crash |
| FE-CLIENT-001 | Clients | Clients list loads with summary stats | Logged-in user; client data exists | Open `/clients` | Client table, summary cards, and quick actions are visible |
| FE-CLIENT-002 | Clients | Search filters the client list | Client data exists | On `/clients`, search by client name, caregiver, or code | List updates to matching results and result count text reflects filter |
| FE-CLIENT-003 | Clients | No-match search renders empty state | Client data exists | Search for a value that does not exist | Table shows no-results state and app remains usable |
| FE-CLIENT-004 | Clients | Client actions remain visible per row | Client data exists | Open `/clients`; inspect rows with different statuses | Expected row actions appear for the corresponding client status |
| FE-CARE-001 | Caregivers | Caregiver list loads with metrics | Logged-in user; caregiver data exists | Open `/caregivers` | List and stats load successfully |
| FE-CARE-002 | Caregivers | Status tab filters work | Caregiver data exists | Toggle `All`, `Active`, `On Leave`, `Inactive` tabs | Table contents update to match selected filter |
| FE-CARE-003 | Caregivers | Search filters caregivers by name or employee code | Caregiver data exists | Search from `/caregivers` | Matching caregivers remain and non-matching rows disappear |
| FE-SCHED-001 | Schedule | Weekly schedule renders current week | Schedule data exists | Open `/schedule` | Week view loads entries, daily columns, stats, and alerts |
| FE-SCHED-002 | Schedule | Schedule date navigation works | Schedule data exists | Use previous and next navigation on `/schedule` | Week range updates and entries change to selected week |
| FE-SCHED-003 | Schedule | Schedule search filters displayed shifts | Schedule data exists | Search by client or caregiver on `/schedule` | Visible schedule entries narrow to matches |
| FE-VISIT-001 | Visits | Visits page loads with status summary and table | Visit data exists | Open `/visits` | Stats, filters, table rows, and submission panel render |
| FE-VISIT-002 | Visits | EVV status tab filters work | Visit data exists | Toggle visit status tabs on `/visits` | Table updates to matching EVV status |
| FE-VISIT-003 | Visits | Visit search works | Visit data exists | Search by visit ID, caregiver, client, or employee code | Matching rows remain visible |
| FE-VISIT-004 | Visits | Fix visit action succeeds for incomplete visit | Visit with `Incomplete` status exists | Open row action; submit correction reason and optional corrected times | Success message appears and row status updates to `Ready` after refresh |
| FE-VISIT-005 | Visits | Submit visit action succeeds for ready visit | Visit with `Ready` status exists | Click submit action | Submission succeeds, UI reflects updated status, and submission history updates after refresh |
| FE-VISIT-006 | Visits | Visit actions handle API errors gracefully | Simulate failed backend request | Trigger fix or submit on a failing record | User sees error message and UI stays stable |
| FE-TS-001 | Timesheets | Timesheets page loads timesheet entries | Timesheet API reachable | Open `/timesheets` | Summary cards and timesheet table render correctly |
| FE-TS-002 | Timesheets | Timesheet approval button approves pending entry | Pending timesheet entry exists | Click approve on a pending row | Approval succeeds and row changes to `Approved` after refresh |
| FE-TS-003 | Timesheets | Timesheet export button starts export flow | Export action enabled | Click export from `/timesheets` | Export action is triggered without page crash |
| FE-TS-004 | Timesheets | GPS indicators display correctly | Rows with and without GPS exist | Open `/timesheets` and compare multiple rows | GPS badges reflect clock-in and clock-out availability accurately |
| FE-EVV-001 | Aggregator UI | Aggregator queue and submissions render | Aggregator data exists | Open `/evv` | Queue, mode, submissions, and relevant controls load without UI errors |
| FE-RESP-001 | Responsive | Core pages remain usable on smaller viewport | Browser resized to tablet/mobile widths | Test `/`, `/clients`, `/schedule`, `/visits`, `/timesheets` at narrower widths | Navigation, tables, filters, and actions remain accessible without broken layout |

---

## Backend Coverage Map
Primary API groups to validate:
- `/api/auth/*`
- `/api/dashboard/*`
- `/api/clients`
- `/api/caregivers`
- `/api/schedule/*`
- `/api/visits/*`
- `/api/timesheets/*`
- `/api/aggregator/*`
- `/api/settings/*`

---

## Backend Test Cases

| ID | API / Area | Scenario | Preconditions | Steps | Expected Result |
| --- | --- | --- | --- | --- | --- |
| BE-AUTH-001 | `POST /api/auth/login` | Successful login returns JWT and profile data | Active user exists | Send valid username and password | Response is `200`; body includes token, username, role, and profile identifiers |
| BE-AUTH-002 | `POST /api/auth/login` | Invalid password is rejected | Active user exists | Send valid username and wrong password | Response is `401` with `Invalid username or password.` |
| BE-AUTH-003 | `POST /api/auth/login` | Lockout activates after repeated failures | Rate limiting enabled | Submit invalid password until threshold is exceeded | Response becomes `429` and includes `Retry-After` header |
| BE-AUTH-004 | `POST /api/auth/logout` | Logout revokes active session | Valid JWT exists | Call logout with bearer token | Response is `204` and session row is marked revoked if it exists |
| BE-AUTH-005 | `POST /api/auth/change-password` | Portal user can change password | Valid JWT for coordinator, agency admin, or super admin | Submit correct current password and valid new password | Response is `204`; subsequent login works with new password |
| BE-AUTH-006 | `POST /api/auth/change-password` | Wrong current password is rejected | Valid JWT exists | Submit wrong current password | Response is `401` |
| BE-AUTH-007 | `POST /api/auth/admin-reset-password` | Coordinator cannot reset portal user password | Coordinator JWT exists | Attempt to reset a portal user with `user_type=portal` | Response is `403` |
| BE-AUTH-008 | `POST /api/auth/admin-reset-password` | Agency admin can reset allowed user in same agency | Agency admin JWT; target user in same agency | Submit valid reset request | Response is `204`; target can log in with new password |
| BE-AUTH-009 | `POST /api/auth/signup` | Signup creates new portal account | Signup enabled | Submit valid first name, last name, username, email, role, password, confirm password | Response is `201` and body includes token and user identity fields |
| BE-AUTH-010 | `POST /api/auth/signup` | Signup rejects bad password confirmation | Signup enabled | Submit mismatched passwords | Response is `422` |
| BE-DASH-001 | `GET /api/dashboard/metrics` | Dashboard metrics return complete payload | Auth and DB configured | Call endpoint | Response is `200` with KPI fields, `visitsByDay`, and `priorityQueue` |
| BE-CLIENT-001 | `GET /api/clients` | Clients endpoint supports paging | Client data exists | Call with `page` and `per_page` | Response is `200` with `total`, `stats`, and paged `items` |
| BE-CLIENT-002 | `GET /api/clients` | Clients endpoint supports search | Client data exists | Call with `search=<known term>` | Response includes only matching clients |
| BE-CLIENT-003 | `PUT /api/clients/{client_id}` | Client update persists allowed fields | Existing client exists | Submit update payload for demographics or address | Response is success and subsequent read reflects the update |
| BE-CARE-001 | `GET /api/caregivers` | Caregiver listing supports search and status filter | Caregiver data exists | Call with `search` and `status` variations | Response filters rows correctly |
| BE-CARE-002 | `POST /api/caregivers` | New caregiver can be created | Valid payload; unique employee code | Submit create request | Response is `201` and new caregiver is persisted |
| BE-CARE-003 | `POST /api/caregivers` | Duplicate employee code is rejected | Existing employee code exists | Submit create request with duplicate code | Response is `409` |
| BE-SCHED-001 | `GET /api/schedule/week` | Weekly schedule returns entries, stats, and alerts | Schedule data exists | Call with no date | Response is `200` and includes week range plus schedule entries |
| BE-SCHED-002 | `GET /api/schedule/week` | Specific ISO date anchors the correct week | Schedule data exists | Call with `date=YYYY-MM-DD` | Response week start and end match anchored ISO week |
| BE-VISIT-001 | `GET /api/visits` | Visits endpoint supports page, week, search, and status filters | Visit data exists | Call with combinations of `week`, `search`, and `status` | Response is filtered correctly and includes stats |
| BE-VISIT-002 | `PATCH /api/visits/{visit_id}/fix` | Incomplete visit can be corrected | Visit exists with `evv_status=Incomplete` | Submit correction reason and optional corrected times | Response is success; visit status becomes `Ready` |
| BE-VISIT-003 | `PATCH /api/visits/{visit_id}/fix` | Non-incomplete visit cannot be corrected through fix endpoint | Visit exists with status other than `Incomplete` | Call fix endpoint | Response is `422` |
| BE-VISIT-004 | `POST /api/visits/{visit_id}/submit` | Ready visit submits to aggregator | Visit exists with `evv_status=Ready` | Call submit endpoint | Response succeeds, submission record is created, and visit becomes `Submitted` when accepted |
| BE-VISIT-005 | `POST /api/visits/{visit_id}/submit` | Already submitted visit is blocked | Visit exists with `evv_status=Submitted` | Call submit endpoint | Response is `409` |
| BE-AGG-001 | `GET /api/aggregator/mode` | Aggregator mode is exposed correctly | Backend configured | Call endpoint | Response is `200` with `simulate` or `live` |
| BE-AGG-002 | `GET /api/aggregator/queue` | Queue only contains visits ready for submission | Mixed visit statuses exist | Call endpoint | Only eligible `Ready` visits without accepted submission appear |
| BE-AGG-003 | `GET /api/aggregator/submissions` | Submission history is paged and filterable | Submission data exists | Call with page and optional status | Response returns paged submission history matching filter |
| BE-AGG-004 | `POST /api/aggregator/submit/{visit_id}` | Direct aggregator submit works | Valid visit exists | Call direct aggregator submit | Response contains transaction ID, status, and payload |
| BE-TS-001 | `GET /api/timesheets` | Endpoint works before `care.timesheet` exists | `sql/add_timesheet_table.sql` has not been run | Call endpoint | Response succeeds using fallback join on visits/employees/clients/service codes |
| BE-TS-002 | `GET /api/timesheets` | Endpoint uses denormalized table after setup | `care.timesheet` exists from `sql/add_timesheet_table.sql` | Call endpoint | Response succeeds and data comes from `care.timesheet` |
| BE-TS-003 | `PATCH /api/timesheets/{visit_id}/approve` | Pending timesheet entry can be approved | Visit exists with `approval_status=Pending` | Call approve endpoint | Response is success; `care.visits` and `care.timesheet` are both updated to `Approved` |
| BE-TS-004 | Timesheet sync | Visit mutations sync the denormalized timesheet row | `care.timesheet` and `care.usp_sync_timesheet_from_visit` exist | Fix or submit a visit, then inspect corresponding timesheet row | Timesheet row reflects updated EVV status, times, notes, and approval values |
| BE-TS-005 | SQL setup | Initial timesheet population inserts one row per eligible visit | `care.timesheet` absent; source visits exist | Run `sql/add_timesheet_table.sql` | Table is created, eligible visit rows are inserted, and `visit_id` remains unique |
| BE-SET-001 | `GET /api/settings/agency` | Agency settings return defaults or saved values | Backend running | Call endpoint | Response is `200` with agency settings payload |
| BE-SET-002 | `PUT /api/settings/agency` | Agency settings persist successfully | Valid payload | Update agency settings; read them back | Save succeeds and later reads return updated values |
| BE-ERR-001 | Error handling | API returns stable error payload on invalid resource | Invalid record IDs used | Call invalid client, visit, or timesheet actions | API returns appropriate non-2xx code with readable `detail` message |

---

## Cross-System End-to-End Tests
These are the highest-value end-to-end QA flows.

| ID | Flow | Preconditions | Steps | Expected Result |
| --- | --- | --- | --- | --- |
| E2E-001 | Portal login to dashboard | Valid coordinator account | Login through UI and land on dashboard | User is authenticated and dashboard data renders |
| E2E-002 | Correct incomplete visit and submit to aggregator | Incomplete visit exists | Login; open `/visits`; fix visit; submit visit | Visit becomes `Ready`, then `Submitted` or returns clear submission feedback |
| E2E-003 | Approve timesheet after visit sync | `care.timesheet` exists | Fix or submit visit; open `/timesheets`; approve entry | Timesheet row is present and approval state updates in UI and DB |
| E2E-004 | Add caregiver and verify visibility | Agency admin access exists | Create caregiver; open caregivers list | New caregiver appears in caregiver listing |
| E2E-005 | Update client and verify read model | Editable client exists | Update client details; reload `/clients` | Updated values are visible in list or detail views |
| E2E-006 | Save agency settings and re-read them | Settings page or API access exists | Save agency settings; refresh or call GET API | New settings persist correctly |

---

## Regression Focus After Each Deployment
Run these after every cloud deployment:
- Login, logout, and protected-route redirect
- Dashboard load
- Client search
- Caregiver filter/search
- Schedule week navigation
- Visit fix and submit actions
- Timesheet load and approval
- Aggregator queue and submissions history
- CORS validation between frontend and backend domains
- Backend startup health and Azure SQL connectivity

## Notes for Test Execution
- For cloud validation, confirm both `API_BASE_URL` and `NEXT_PUBLIC_API_BASE_URL` point to the deployed backend.
- For auth testing, include both valid and invalid JWT scenarios.
- For timesheet testing, execute cases both before and after running `sql/add_timesheet_table.sql`.
- For aggregator testing, exercise both `simulate` and `live` modes when available.
