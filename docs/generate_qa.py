"""
Generates docs/SeriqCare_QA_TestCases.xlsx
Run: python docs/generate_qa.py
"""
from openpyxl import Workbook
from openpyxl.styles import (
    PatternFill, Font, Alignment, Border, Side, GradientFill
)
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from datetime import date

TODAY = date.today().strftime("%Y-%m-%d")

# ── Colour palette ────────────────────────────────────────────────────────────
C = {
    # Section header fills
    "auth":      "1A3D5C",   # dark navy
    "dashboard": "1F8C8A",   # teal
    "clients":   "2567A4",   # primary blue
    "caregivers":"5B7BA8",   # slate-blue
    "schedule":  "7B5EA7",   # purple
    "visits":    "2AA8A1",   # cyan-teal
    "timesheets":"E98B3A",   # orange
    "settings":  "6D8A6D",   # sage green
    "backend":   "3A3A5C",   # dark indigo
    "col_hdr":   "24343F",   # column header bg (almost black)
    # Text
    "white":     "FFFFFF",
    "light":     "F0F4F8",
    "muted":     "6A7A86",
    # Status fills
    "pass_bg":   "EDF7EF",
    "fail_bg":   "F8E3E3",
    "na_bg":     "FFF6E7",
    "pass_txt":  "35693C",
    "fail_txt":  "944949",
    "na_txt":    "8A6424",
}

def fill(hex_color):
    return PatternFill("solid", fgColor=hex_color)

def font(bold=False, color="24343F", size=11, italic=False):
    return Font(name="Calibri", bold=bold, color=color, size=size, italic=italic)

def thin_border():
    s = Side(border_style="thin", color="D4DCE8")
    return Border(left=s, right=s, top=s, bottom=s)

def center():
    return Alignment(horizontal="center", vertical="center", wrap_text=True)

def left():
    return Alignment(horizontal="left", vertical="center", wrap_text=True)

# ── Test data ─────────────────────────────────────────────────────────────────
# Each item: (section_key, id, test_name, description, expected_result)
TESTS = [

    # ── AUTH ──────────────────────────────────────────────────────────────────
    ("auth", "AUTH-001", "Login — valid credentials",
     "Enter a valid username and password (coordinator1 / SeriqCare2024!) and click Sign in.",
     "User is redirected to the Dashboard (/). JWT token saved to localStorage and cookie."),

    ("auth", "AUTH-002", "Login — invalid password",
     "Enter a valid username with an incorrect password and submit.",
     "Error message 'Invalid username or password.' displayed. User stays on /login."),

    ("auth", "AUTH-003", "Login — blank fields",
     "Submit the login form with both username and password empty.",
     "Browser or app prevents submission. No API call is made."),

    ("auth", "AUTH-004", "Login — account lockout after 10 failures",
     "Submit incorrect credentials 10 consecutive times for the same username.",
     "HTTP 429 returned. UI shows lockout message with countdown timer (~15 min)."),

    ("auth", "AUTH-005", "Login — lockout countdown clears on expiry",
     "Wait for the 15-minute lockout timer to expire.",
     "Countdown reaches 0, error banner clears, login form is re-enabled automatically."),

    ("auth", "AUTH-006", "Logout",
     "Click the Logout option from the sidebar/profile chip while authenticated.",
     "Session cleared from localStorage and cookie. User redirected to /login."),

    ("auth", "AUTH-007", "Protected route redirect — unauthenticated",
     "Open /clients in a fresh browser tab with no session cookie.",
     "Middleware redirects to /login?from=/clients. No flash of protected content."),

    ("auth", "AUTH-008", "Auth route bypass — already logged in",
     "Navigate to /login while already authenticated.",
     "Middleware redirects to /. Login page never renders."),

    ("auth", "AUTH-009", "Agency signup — valid data",
     "Fill all required fields on /signup (agency name, admin name, email, username, password x2) and click Start Free Trial.",
     "Account created (HTTP 201). User auto-signed in and redirected to Dashboard."),

    ("auth", "AUTH-010", "Agency signup — duplicate username",
     "Register with a username that already exists in the database.",
     "HTTP 409 error. Message 'Username … is already taken.' displayed inline."),

    ("auth", "AUTH-011", "Agency signup — password mismatch",
     "Enter different values in Password and Confirm Password fields.",
     "Client-side validation fires before API call. Error 'Passwords do not match.' shown."),

    ("auth", "AUTH-012", "Agency signup — password < 8 chars",
     "Enter a password shorter than 8 characters.",
     "Client-side validation error: 'Password must be at least 8 characters.'"),

    ("auth", "AUTH-013", "Agency signup — missing required fields",
     "Submit the form with Agency Name left blank.",
     "Client validation blocks submission. Error 'Agency name is required.' shown."),

    ("auth", "AUTH-014", "Signup page accessible without session",
     "Navigate directly to /signup with no session cookie.",
     "/signup loads correctly. Not redirected to /login."),

    # ── DASHBOARD ─────────────────────────────────────────────────────────────
    ("dashboard", "DASH-001", "Dashboard loads KPI cards",
     "Log in and navigate to / (Dashboard).",
     "Six KPI summary cards render with numeric values from the API (active clients, visits this week, open shifts, etc.)."),

    ("dashboard", "DASH-002", "14-day activity bar chart",
     "Observe the visit activity chart on the dashboard.",
     "Bar chart shows 14 days of visit counts. Today's bar is highlighted in primary blue."),

    ("dashboard", "DASH-003", "EVV breakdown bars",
     "Check the EVV status section of the dashboard.",
     "Processed / Verified / Incomplete / Omit counts and progress bars render with correct percentages."),

    ("dashboard", "DASH-004", "Priority queue list",
     "Check the priority queue / compliance alerts panel.",
     "Alert items (e.g. expiring care plans, EVV exceptions) are listed with type badges."),

    ("dashboard", "DASH-005", "Dashboard renders with backend offline",
     "Stop the FastAPI backend and reload the dashboard.",
     "Page renders with fallback zero values. No unhandled error or blank screen."),

    # ── CLIENTS ───────────────────────────────────────────────────────────────
    ("clients", "CLT-001", "Client list loads",
     "Navigate to /clients.",
     "Table renders with paginated client rows. Stats bar shows totals."),

    ("clients", "CLT-002", "Client search",
     "Type a client's last name into the search box.",
     "Table filters in real-time (or on submit) to show matching clients only."),

    ("clients", "CLT-003", "Client status tab filter — Active",
     "Click the 'Active' status tab.",
     "Only clients with status=Active are shown in the table."),

    ("clients", "CLT-004", "Client status tab filter — Inactive",
     "Click the 'Inactive' status tab.",
     "Only inactive clients are displayed."),

    ("clients", "CLT-005", "Client detail — profile tab",
     "Click a client row to open /clients/[id]. Land on the Profile tab.",
     "Client hero header shows name, DOB, Medicaid ID. Profile tab displays demographics grid."),

    ("clients", "CLT-006", "Client detail — all 8 tabs navigate",
     "Click each tab: Profile, Insurance, Auths, Care Plan, Visits, Billing, Docs, Address.",
     "Each tab renders its content panel without errors."),

    ("clients", "CLT-007", "Add client form loads",
     "Click 'Add Client' and navigate to /clients/new.",
     "Multi-section form renders with all input fields enabled."),

    ("clients", "CLT-008", "Client detail — invalid ID",
     "Navigate to /clients/99999 (non-existent ID).",
     "404 or 'Client not found' message shown. No server error."),

    # ── CAREGIVERS ────────────────────────────────────────────────────────────
    ("caregivers", "CGV-001", "Caregiver list loads",
     "Navigate to /caregivers.",
     "Table renders with caregiver rows, utilization bars, and staffing stat cards."),

    ("caregivers", "CGV-002", "Add caregiver — valid data",
     "Navigate to /caregivers/new. Fill employee code, first/last name. Click Save Caregiver.",
     "POST /api/caregivers returns 201. Success banner shown. Redirects to /caregivers after 1.5 s."),

    ("caregivers", "CGV-003", "Add caregiver — duplicate employee code",
     "Submit the add caregiver form with an employee_code already in the database.",
     "HTTP 409. Error message displayed in form. User stays on /caregivers/new."),

    ("caregivers", "CGV-004", "Add caregiver with login account",
     "Fill Step 5 (Login Account) with a unique username and password ≥ 8 chars. Submit.",
     "Employee row and care.users row both created. Password stored as bcrypt hash."),

    ("caregivers", "CGV-005", "Add caregiver — login password < 8 chars",
     "In Step 5 enter a password shorter than 8 characters.",
     "Validation error displayed. Form not submitted to API."),

    ("caregivers", "CGV-006", "Add caregiver — login passwords mismatch",
     "Enter different values in Initial Password and Confirm Password in Step 5.",
     "Client-side error 'Passwords do not match.' API not called."),

    ("caregivers", "CGV-007", "Cancel button — returns to caregiver list",
     "On /caregivers/new click the Cancel button.",
     "User navigated back to /caregivers. No data saved."),

    # ── SCHEDULE ──────────────────────────────────────────────────────────────
    ("schedule", "SCH-001", "Schedule week grid loads",
     "Navigate to /schedule.",
     "Weekly Mon–Sun grid renders with visit entries in the correct day columns."),

    ("schedule", "SCH-002", "Schedule stats bar",
     "Observe the stats bar at top of /schedule.",
     "Scheduled visits, open shifts, assigned caregivers, coverage rate displayed."),

    ("schedule", "SCH-003", "Schedule alerts panel",
     "Check the alerts sidebar on the schedule page.",
     "At-risk visits and late-clock-out alerts listed with severity badges."),

    # ── VISITS / EVV ──────────────────────────────────────────────────────────
    ("visits", "VIS-001", "Visits table loads",
     "Navigate to /visits.",
     "EVV visits table renders with employee name, client, service date, clock-in/out, EVV status, approval status."),

    ("visits", "VIS-002", "EVV status breakdown bars",
     "Check the EVV breakdown section on /visits.",
     "Processed / Incomplete / Exception counts shown with colour-coded progress bars."),

    ("visits", "VIS-003", "Visit exception alerts",
     "Check the exception alerts panel on /visits.",
     "Visits with EVV exceptions listed with ESC code and description."),

    # ── TIMESHEETS ────────────────────────────────────────────────────────────
    ("timesheets", "TS-001", "Timesheets table loads",
     "Navigate to /timesheets.",
     "Timesheet rows render with employee code, client, hours, gross pay, EVV status, approval status."),

    ("timesheets", "TS-002", "Approve timesheet — Pending visit",
     "Find a row with approval_status=Pending. Click the Approve button.",
     "PATCH /api/timesheets/{id}/approve returns 200. Row status updates to Approved without full page reload."),

    ("timesheets", "TS-003", "Approve timesheet — already Approved",
     "Click Approve on a row already showing Approved status.",
     "Button is hidden/disabled for already-approved rows. No API call made."),

    ("timesheets", "TS-004", "Export payroll — approved rows only",
     "Click the Export Payroll button. Verify exported data.",
     "CSV/export contains only rows with approval_status=Approved. Pending rows excluded."),

    ("timesheets", "TS-005", "Export payroll — no approved rows",
     "When no timesheets are approved, click Export Payroll.",
     "Message 'No approved timesheets to export.' shown. No file download triggered."),

    # ── SETTINGS ──────────────────────────────────────────────────────────────
    ("settings", "SET-001", "Agency settings load",
     "Navigate to /settings.",
     "GET /api/settings/agency returns current values. Form pre-populated with agency name, email, phone, etc."),

    ("settings", "SET-002", "Save agency settings",
     "Change the Agency Name field and click Save.",
     "PUT /api/settings/agency returns success. Success toast/banner shown. Value persisted to settings/agency.json."),

    ("settings", "SET-003", "Settings persist on reload",
     "Save settings, then hard-reload the settings page.",
     "Previously saved values are loaded from the JSON file. Changes not lost."),

    ("settings", "SET-004", "Change password — correct current password",
     "Submit POST /api/auth/change-password with correct current password and valid new password.",
     "HTTP 204. Password updated in database."),

    ("settings", "SET-005", "Change password — wrong current password",
     "Submit change-password with an incorrect current password.",
     "HTTP 401. Error 'Current password is incorrect.' returned."),

    ("settings", "SET-006", "Admin reset password — coordinator resets mobile user",
     "As coordinator, submit admin-reset-password for a caregiver (mobile) user.",
     "HTTP 204. Password updated."),

    ("settings", "SET-007", "Admin reset password — coordinator tries portal user",
     "As coordinator, attempt to reset a coordinator/agency_admin account.",
     "HTTP 403. 'Coordinators can only reset Mobile App user passwords.' returned."),

    # ── BACKEND API ───────────────────────────────────────────────────────────
    ("backend", "API-001", "GET /api/dashboard/metrics — authenticated",
     "Call GET /api/dashboard/metrics with a valid Bearer token.",
     "HTTP 200. Response matches DashboardMetrics schema: activeClients, visitsByDay[], priorityQueue[], etc."),

    ("backend", "API-002", "GET /api/clients — pagination",
     "Call GET /api/clients?page=1&per_page=10.",
     "HTTP 200. Response has total, page=1, per_page=10, items[] (max 10), stats object."),

    ("backend", "API-003", "GET /api/clients — search filter",
     "Call GET /api/clients?search=Smith.",
     "HTTP 200. All returned clients have 'Smith' in their name."),

    ("backend", "API-004", "GET /api/clients — status filter",
     "Call GET /api/clients?status=Active.",
     "HTTP 200. All returned items have status=Active."),

    ("backend", "API-005", "POST /api/caregivers — valid payload",
     "POST with employee_code, first_name, last_name.",
     "HTTP 201. CaregiverCreateResponse: success=true, id (int), employee_code, message."),

    ("backend", "API-006", "POST /api/caregivers — duplicate employee_code",
     "POST with an employee_code already in care.employees.",
     "HTTP 409. Detail: 'Employee code … already exists.'"),

    ("backend", "API-007", "GET /api/schedule/week — current week",
     "Call GET /api/schedule/week (no date param).",
     "HTTP 200. ScheduleResponse with week_start, week_end, entries[], stats, alerts[]."),

    ("backend", "API-008", "GET /api/visits — per_page cap",
     "Call GET /api/visits?per_page=1001.",
     "HTTP 422 validation error (max per_page is 1000)."),

    ("backend", "API-009", "PATCH /api/timesheets/{id}/approve — Pending visit",
     "PATCH a visit that has approval_status=Pending.",
     "HTTP 200. TimesheetApproveResponse: success=true. care.visits and care.timesheet rows updated to Approved."),

    ("backend", "API-010", "PATCH /api/timesheets/{id}/approve — already Approved",
     "PATCH a visit that is already Approved.",
     "HTTP 422. Detail indicates visit is already approved."),

    ("backend", "API-011", "PATCH /api/timesheets/{id}/approve — not found",
     "PATCH with a visit_id that does not exist (e.g. 999999).",
     "HTTP 404. Detail: 'Visit not found.'"),

    ("backend", "API-012", "GET /api/settings/agency",
     "Call GET /api/settings/agency.",
     "HTTP 200. AgencySettings object returned. Falls back to defaults if agency.json missing."),

    ("backend", "API-013", "PUT /api/settings/agency",
     "PUT with partial body: { agencyName: 'Test Agency' }.",
     "HTTP 200. AgencySettingsResponse success=true. Only provided fields overwritten in agency.json."),

    ("backend", "API-014", "POST /api/auth/login — rate limiting throttle",
     "Submit 6 consecutive failed logins for the same username.",
     "From the 6th attempt onward, response is delayed by progressive throttle (2 s+). HTTP 401 returned."),

    ("backend", "API-015", "POST /api/auth/signup — valid",
     "POST with all required fields, unique username.",
     "HTTP 201. LoginResponse: token (JWT), username, display_name, role, agency_id."),

    ("backend", "API-016", "POST /api/auth/signup — duplicate username",
     "POST with a username that already exists.",
     "HTTP 409. Detail: 'Username … is already taken.'"),

    ("backend", "API-017", "POST /api/auth/logout — valid token",
     "POST /api/auth/logout with a valid Bearer token.",
     "HTTP 204. care.user_sessions row has revoked_at populated."),

    ("backend", "API-018", "GET /api/aggregator/queue",
     "Call GET /api/aggregator/queue with auth token.",
     "HTTP 200. AggregatorQueueResponse with mode (simulate/live), total, items[]."),

    ("backend", "API-019", "GET /api/timesheets?status=Approved&per_page=500",
     "Call the timesheets endpoint filtering by Approved status with large page size.",
     "HTTP 200. Only Approved rows returned. No 422 validation error (per_page ≤ 1000 is valid)."),

    ("backend", "API-020", "Database offline — API returns 500 gracefully",
     "Stop SQL Server and call any data endpoint.",
     "HTTP 500 with descriptive error. FastAPI does not crash/hang. Returns JSON error body."),
]

# ── Build workbook ────────────────────────────────────────────────────────────
wb = Workbook()
ws = wb.active
ws.title = "QA Test Cases"

# Column widths
col_widths = [12, 11, 34, 52, 52, 18, 14]
for i, w in enumerate(col_widths, 1):
    ws.column_dimensions[get_column_letter(i)].width = w

ws.row_dimensions[1].height = 52
ws.row_dimensions[2].height = 30

# ── Title row ──────────────────────────────────────────────────────────────────
ws.merge_cells("A1:G1")
title_cell = ws["A1"]
title_cell.value = "SeriqCare — QA Test Cases"
title_cell.font = Font(name="Calibri", bold=True, size=18, color=C["white"])
title_cell.fill = fill(C["auth"])
title_cell.alignment = Alignment(horizontal="center", vertical="center")

# ── Column header row ─────────────────────────────────────────────────────────
headers = ["Date", "Test ID", "Test Name", "Description", "Expected Result", "Actual Result", "Pass / Fail"]
for col, h in enumerate(headers, 1):
    cell = ws.cell(row=2, column=col, value=h)
    cell.font = Font(name="Calibri", bold=True, size=11, color=C["white"])
    cell.fill = fill(C["col_hdr"])
    cell.alignment = center()
    cell.border = thin_border()

# Freeze header rows
ws.freeze_panes = "A3"

# ── Pass/Fail data validation ─────────────────────────────────────────────────
dv = DataValidation(type="list", formula1='"Pass,Fail,N/A,Blocked"', allow_blank=True)
dv.sqref = "G3:G1000"
ws.add_data_validation(dv)

# ── Section colours map ───────────────────────────────────────────────────────
SECTION_META = {
    "auth":       ("Authentication & Signup",  C["auth"]),
    "dashboard":  ("Dashboard",                C["dashboard"]),
    "clients":    ("Clients",                  C["clients"]),
    "caregivers": ("Caregivers",               C["caregivers"]),
    "schedule":   ("Schedule",                 C["schedule"]),
    "visits":     ("Visits / EVV",             C["visits"]),
    "timesheets": ("Timesheets & Payroll",     C["timesheets"]),
    "settings":   ("Settings & Password",      C["settings"]),
    "backend":    ("Backend API",              C["backend"]),
}

current_section = None
row = 3

for (section, tid, name, desc, expected) in TESTS:
    # Insert section header row when section changes
    if section != current_section:
        current_section = section
        label, hex_col = SECTION_META[section]
        ws.merge_cells(f"A{row}:G{row}")
        sec_cell = ws.cell(row=row, column=1, value=f"  {label.upper()}")
        sec_cell.font = Font(name="Calibri", bold=True, size=11, color=C["white"])
        sec_cell.fill = fill(hex_col)
        sec_cell.alignment = Alignment(horizontal="left", vertical="center")
        ws.row_dimensions[row].height = 20
        row += 1

    # Data row
    ws.row_dimensions[row].height = 52
    row_data = [TODAY, tid, name, desc, expected, "", ""]

    _, hex_col = SECTION_META[section]
    # Subtle tint for alternating rows
    even = (row % 2 == 0)
    row_fill = PatternFill("solid", fgColor="F7FAFD") if even else PatternFill("solid", fgColor="FFFFFF")
    left_accent = fill(hex_col)  # col A accent strip

    for col, val in enumerate(row_data, 1):
        cell = ws.cell(row=row, column=col, value=val)
        cell.border = thin_border()

        if col == 1:
            # Date — accent left strip
            cell.font = Font(name="Calibri", size=10, color=C["white"])
            cell.fill = left_accent
            cell.alignment = center()
        elif col == 2:
            # Test ID — bold
            cell.font = Font(name="Calibri", bold=True, size=10, color=hex_col)
            cell.fill = row_fill
            cell.alignment = center()
        elif col in (3, 4, 5):
            cell.font = Font(name="Calibri", size=10, color="24343F")
            cell.fill = row_fill
            cell.alignment = left()
        elif col == 6:
            # Actual Result — italic placeholder
            cell.font = Font(name="Calibri", size=10, italic=True, color=C["muted"])
            cell.fill = row_fill
            cell.alignment = left()
        elif col == 7:
            # Pass/Fail dropdown
            cell.font = Font(name="Calibri", bold=True, size=10)
            cell.fill = PatternFill("solid", fgColor=C["na_bg"])
            cell.alignment = center()

    row += 1

# ── Summary tab ───────────────────────────────────────────────────────────────
ws2 = wb.create_sheet("Summary")
ws2.column_dimensions["A"].width = 30
ws2.column_dimensions["B"].width = 14

# Title
ws2.merge_cells("A1:B1")
t = ws2["A1"]
t.value = "Test Summary"
t.font = Font(name="Calibri", bold=True, size=14, color=C["white"])
t.fill = fill(C["auth"])
t.alignment = center()
ws2.row_dimensions[1].height = 32

# Headers
for col, h in enumerate(["Section", "# Tests"], 1):
    c = ws2.cell(row=2, column=col, value=h)
    c.font = Font(name="Calibri", bold=True, size=11, color=C["white"])
    c.fill = fill(C["col_hdr"])
    c.alignment = center()
    c.border = thin_border()

section_counts = {}
for (sec, *_) in TESTS:
    section_counts[sec] = section_counts.get(sec, 0) + 1

for r, (sec, cnt) in enumerate(section_counts.items(), 3):
    label, hex_col = SECTION_META[sec]
    c1 = ws2.cell(row=r, column=1, value=label)
    c1.font = Font(name="Calibri", bold=True, size=10, color=C["white"])
    c1.fill = fill(hex_col)
    c1.alignment = left()
    c1.border = thin_border()

    c2 = ws2.cell(row=r, column=2, value=cnt)
    c2.font = Font(name="Calibri", bold=True, size=11)
    c2.alignment = center()
    c2.border = thin_border()
    ws2.row_dimensions[r].height = 22

# Total row
total_row = 3 + len(section_counts)
c1 = ws2.cell(row=total_row, column=1, value="TOTAL")
c1.font = Font(name="Calibri", bold=True, size=11, color=C["white"])
c1.fill = fill(C["col_hdr"])
c1.alignment = center()
c1.border = thin_border()

c2 = ws2.cell(row=total_row, column=2, value=len(TESTS))
c2.font = Font(name="Calibri", bold=True, size=12, color=C["white"])
c2.fill = fill(C["col_hdr"])
c2.alignment = center()
c2.border = thin_border()

# ── Save ──────────────────────────────────────────────────────────────────────
out = "docs/SeriqCare_QA_TestCases.xlsx"
wb.save(out)
print(f"Saved: {out}  ({len(TESTS)} test cases)")
