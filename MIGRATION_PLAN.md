# SeriqCare SaaS Migration Plan

## Purpose and constraints

Create a separate `seriqcare-saas` application for Dashboard, Clients, Caregivers,
Scheduling, Time Tracking, Invoices, Payroll, and Reports while keeping this
repository and its files intact. This is a migration plan only; no application
code, configuration, or database files are changed by this document.

The recommendations below distinguish reusable implementation from product
behavior that must be redesigned. “Copy” means a starting point for the new
repository after review; it does not mean copying secrets or deploying against
the current production database.

## Existing application shape

- Frontend: Next.js App Router, React, and TypeScript (`package.json`,
  `app/`, `components/`, `lib/`).
- Backend: a FastAPI application registered in `backend/main.py`; portal and
  mobile endpoints currently share the same application.
- Persistence: SQLAlchemy models in `db/models.py`, SQL Server connection and
  session code in `db/database.py`, and manually maintained SQL scripts in
  `sql/` and `db/migrations/`.
- Deployment: Docker/Render configuration for the backend and Vercel
  configuration for the frontend (`Dockerfile`, `render.yaml`, `vercel.json`).

## File-by-file migration inventory

### Frontend pages

| Existing file(s) | Module / behavior | Recommendation |
|---|---|---|
| `app/page.tsx` | Dashboard landing page | **Refactor.** Keep as the dashboard entry point; replace mixed legacy/demo assumptions with explicit dashboard API contracts and tenant-aware metrics. |
| `app/clients/page.tsx`, `app/clients/[id]/page.tsx`, `app/clients/new/page.tsx` | Client list, detail, and create flows | **Copy then refactor.** Retain core CRUD, verify fields against the selected SaaS schema, and remove care-plan/documentation/claims assumptions unless deliberately retained. |
| `app/caregivers/page.tsx`, `app/caregivers/[id]/page.tsx`, `app/caregivers/new/page.tsx` | Caregiver list, detail, and create flows | **Copy then refactor.** Resolve `caregiver` vs. database/API `Employee` naming and separate payroll configuration from profile management. |
| `app/schedule/page.tsx` | Schedule management | **Copy core UI; refactor data dependencies.** Preserve schedule creation/editing and service-code selection; decouple mobile and EVV-only behavior as needed. |
| `app/timesheets/page.tsx` | Timesheet review and approval | **Copy then refactor.** Establish the new status/approval contract and verify links to visits, employee, client, and service code. |
| `app/clock/page.tsx`, `app/clock/layout.tsx` | Mobile-oriented clock-in/out | **Refactor or defer.** This is a time-tracking boundary, not just a page: it depends on mobile APIs, location/EVV behavior, schedule data, and visit state transitions. Decide explicitly whether it belongs in the SaaS web product. |
| `app/billing/page.tsx` | Billing / invoice interface | **Refactor.** Current backend mixes invoice-like billing entries, claims, utilization, and exports. Define “invoice” semantics and separate optional claims and clearinghouse work. |
| `app/reports/page.tsx` | Reports UI | **Refactor.** No dedicated reports API router was identified; inventory its calls and establish versioned report endpoints and authorization rules before porting. |
| `app/layout.tsx`, `app/globals.css` | Root document, global styles | **Copy selectively.** Retain shared design tokens/base styles after removing unrelated branding or page assumptions and validating accessible states. |
| `app/login/page.tsx`, `app/forgot-password/page.tsx`, `app/reset-password/page.tsx` | Authentication entry and recovery | **Refactor.** Reuse the UX only after choosing the new secure session model and confirming password reset/email requirements. |
| `app/visits/page.tsx` | Visit list/detail support | **Extract required behaviors or defer.** Visits underpin time tracking and invoice generation, but this page is outside the requested navigation modules. |
| `app/care-plans/page.tsx` | Care plans | **Exclude initially**, except where tasks or authorizations are a required scheduling/billing prerequisite. |
| `app/claims/page.tsx` | Claims | **Exclude or isolate as optional.** Do not silently equate claims with invoices. |
| `app/evv/page.tsx` | EVV administration | **Defer/optional.** Retain only the minimum visit validation required by agreed time-tracking/compliance scope. |
| `app/documentation/**` | Documentation templates, filling, and submissions | **Exclude initially.** Client/visit references do not make these pages a dependency of core SaaS. |
| `app/settings/page.tsx`, `app/administration/page.tsx` | Settings/administration | **Refactor selectively.** Extract tenant settings needed by the eight modules; leave platform and integration administration out of the initial shell. |
| `app/super-admin/**` | Platform administration and plans | **Exclude from tenant app.** If needed, design as a separate privileged control plane. |

### Shared frontend components

| Existing file(s) | Reuse guidance |
|---|---|
| `components/auth-context.tsx`, `components/protected-layout.tsx` | **Refactor before reuse.** Current frontend auth/session checks must agree with backend token/session validation; do not treat presence of a browser-readable cookie as proof of authorization. |
| `components/sidebar.tsx`, `components/topbar.tsx` | **Copy and simplify.** Keep navigation shell; remove unsupported modules and apply tenant/role-aware visibility without relying on visibility for API authorization. |
| `components/query-tabs.tsx`, `components/query-search-input.tsx` | **Copy directly after review** if their props/contracts remain suitable. |
| `components/client-tabs.tsx`, `components/clients-search.tsx` | **Copy then refactor** for final client detail sections and search API. |
| `components/caregiver-detail.tsx`, `components/caregiver-sidebar.tsx`, `components/caregivers-filter.tsx` | **Copy then refactor** to match caregiver/employee domain boundaries and role permissions. |
| `components/new-shift-modal.tsx` | **Copy then refactor** with new schedule API validation, authorization checks, and conflict handling. |
| `components/timesheet-approve-btn.tsx`, `components/timesheet-export-btn.tsx`, `components/visit-period-select.tsx`, `components/visit-detail-modal.tsx` | **Copy selectively.** Align transitions and export format with new time-tracking requirements; check for EVV-only assumptions. |
| `components/billing-generate-btn.tsx`, `components/billing-generate-all-btn.tsx`, `components/billing-history-panel.tsx`, `components/billing-claims-panel.tsx` | **Refactor.** Preserve invoice-relevant generation/history UI; separate claims panel/logic as optional and make financial actions auditable/idempotent. |
| `components/aggregator-off-banner.tsx`, `components/aggregator-tabs.tsx`, `components/evv-aggregator-panel.tsx`, `components/esc-code-panel.tsx`, `components/visit-submit-btn.tsx` | **Exclude/defer** unless an explicit EVV integration scope requires them. |
| `components/turnstile-widget.tsx` | **Optional/refactor.** Keep only if the new auth threat model and deployment configuration require bot protection. |

### Frontend query/data modules

| Existing file(s) | Recommendation |
|---|---|
| `lib/queries/dashboard.ts`, `clients.ts`, `caregivers.ts`, `schedule.ts`, `timesheets.ts`, `billing.ts` | **Copy as contract/reference; refactor.** Verify every request/response type, API origin, error path, pagination, and tenant context. `billing.ts` needs invoice/claim separation. |
| `lib/queries/payroll.ts`, `lib/payroll/export.ts`, `lib/payroll/providers.ts` | **Refactor.** Payroll is not a standalone UI module today; verify supported providers, payroll period rules, approval prerequisites, and export schemas. |
| `lib/queries/server-auth.ts` | **Refactor or replace** with the chosen server-side session and API-auth strategy. |
| `lib/queries/aggregator.ts`, `lib/queries/documentation.ts` | **Exclude initially**, unless those features are explicitly added later. |
| `lib/billing-mode-config.ts` | **Refactor or omit.** Determine whether its mode branching is required for invoices in the new product. |

### Backend API routers

Router registration is centralized in `backend/main.py`; retain only the selected
router surface in the new app. Endpoint contracts must be captured in tests
before copying implementation.

| Existing file(s) | Module / dependency | Recommendation |
|---|---|---|
| `backend/routers/dashboard.py` | Dashboard metrics | **Refactor.** It aggregates operational data across modules; define tenant-filtered metrics and avoid importing optional claims/EVV behavior unnecessarily. |
| `backend/routers/clients.py` | Client CRUD, detail, payer/authorization, visit/task support | **Copy core then refactor.** Inventory endpoint-by-endpoint; care tasks, payer, authorization, and visits are cross-module dependencies and require explicit scope decisions. |
| `backend/routers/caregivers.py` | Caregiver/employee CRUD and payroll settings | **Copy core then refactor.** Separate employee profile APIs from pay-group/payroll APIs. |
| `backend/routers/schedule.py` | Service codes and schedule operations | **Copy core then refactor** for new tenancy, authorization, conflict validation, and minimal service-code requirements. |
| `backend/routers/timesheets.py` | Timesheet list/update/approve/export-related operations | **Refactor.** Confirm visit creation/approval state machine, role checks, audit behavior, and whether export belongs here or in payroll. |
| `backend/routers/visits.py` | Visit queries, submission, and EVV validation paths | **Refactor/extract.** Visits are a core data dependency for scheduling, time tracking, dashboard, and invoices; isolate EVV submission from core visit state. |
| `backend/routers/billing.py` | Billing entries, generation, claims, utilization, exports | **Refactor substantially.** Split invoice lifecycle from optional claims/aggregator workflows and specify accounting behavior. |
| `backend/routers/auth.py` | Login, refresh, logout, reset, signup, Entra flows | **Refactor before porting.** Preserve only required identity features; implement coherent secure session, role, and tenant authorization. |
| `backend/routers/settings.py` | Tenant/configuration, payroll settings, pay-period helpers | **Extract/refactor.** Keep required tenant/payroll configuration only; prevent broad settings APIs from becoming an authorization bypass. |
| `backend/routers/aggregator.py`, `backend/routers/documentation.py`, `backend/routers/super_admin.py` | EVV, documentation, platform admin | **Exclude/defer**, or isolate behind separate optional modules and permissions. |
| `backend/routers/mobile_coordinator.py`, `mobile_schedules.py`, `mobile_visits.py`, `profile.py`, `tasks.py` | Mobile coordinator, clock, profile, client-task endpoints | **Exclude initially or extract specific dependencies.** `mobile_visits.py` may contain clock transitions needed for time tracking; do not copy all mobile API surface by default. |

### Backend support, authentication, and database files

| Existing file(s) | Recommendation |
|---|---|
| `backend/main.py` | **Refactor.** Create the new app composition, CORS, lifespan/startup, middleware, health endpoint, and router registry. Do not retain registration for excluded routes by accident. |
| `backend/auth/dependencies.py` | **Refactor and retain.** This is central to JWT/user/role/agency enforcement; validate authorization on every endpoint and enforce tenant scoping in queries. |
| `backend/services/auth_tokens.py` | **Refactor and retain as appropriate.** Review key rotation, token claims, expiry, refresh, and secret management. |
| `backend/services/db_retry.py` | **Copy after review.** Retain only safe transient-error retries; writes must not be repeated unless idempotent. |
| `backend/services/timezone.py` | **Copy after review.** Scheduling, time tracking, payroll, and reporting depend on consistent timezone/date boundary semantics. |
| `backend/services/evv_validation.py` | **Extract/refactor.** Keep legally/compliance-required validation only; avoid coupling ordinary time tracking to external submission. |
| `backend/services/migrations.py` | **Refactor.** Prefer explicit versioned migrations and controlled deployment over implicit startup schema mutation. |
| `backend/services/aggregator_router.py`, `hhax.py`, `sandata.py` | **Exclude/defer** unless EVV aggregator integrations are in the confirmed product scope. |
| `db/database.py` | **Refactor and retain.** Keep connection/session primitives; redesign configuration, credential source, pool settings, transaction boundaries, and migration lifecycle for new deployment. |
| `db/models.py` | **Selectively migrate after schema reconciliation.** Candidate core models are listed below. Avoid copying all 32 models without confirming ownership, columns, foreign keys, indexes, tenancy, and lifecycle. |
| `db/audit.py` | **Review and retain selectively.** Financial and authentication changes should remain auditable; define retention and access controls. |
| `db/migrate_employees.py` | **Migration utility only.** Do not run against production by assumption; assess data safety and whether it is still needed. |
| `backend/schemas.py`, `backend/documentation_schemas.py`, `backend/payroll_settings.py` | **Split/refactor.** Keep only relevant typed API schemas and payroll domain logic; remove documentation-specific schemas from the core app. |

### SQLAlchemy model and table families

`db/models.py` has 32 mapped classes. The following are the likely core
starting set; confirm exact class/table names and foreign keys in the model
definitions and against the deployed database before migration:

- **Tenant and identity:** `Agency`, `User`, `UserSession`, `DeviceSession`,
  `PasswordResetToken`, `AuthLog`. Keep tenancy/identity records only after
  the authentication design is confirmed.
- **Clients:** `Client`, `ClientAddress`, `ClientPayerInfo`,
  `ServiceAuthorization`, `ClientCareTask`, `ClientCareTaskHistory`.
  Payer/authorization/tasks may be optional feature boundaries, but currently
  influence billing, scheduling, and care delivery.
- **Caregivers and scheduling:** `Employee`, `ServiceCode`, `Schedule`.
- **Time tracking:** `Visit`, `Timesheet`; `VisitChange` and `VisitException`
  only if required by corrections, compliance, or exception handling.
- **Invoices:** `VisitBilling`, plus billing claim tables only if claims are
  explicitly in scope. `VisitEvv`, `VisitIntegrationStatus`, and
  `AggregatorSubmission` are EVV/integration-specific and should not be
  included just because billing currently references them.
- **Payroll:** payroll settings tables are created/managed in SQL/service
  code rather than clearly represented as mapped model classes. Confirm the
  actual `pay_groups`, `pay_group_rates`, and
  `employee_payroll_settings` schema and foreign keys before defining new
  models.
- **Cross-cutting audit:** `AuditLog`, `ApiAccessLog` and auth logs should be
  kept only with explicit retention, privacy, and access policies.
- **Out of initial scope:** `DocumentationTemplate`,
  `DocumentationTemplateVersion`, `DocumentationSubmission`, plus EVV/
  aggregator-specific models unless enabled by a later product decision.

### SQL scripts and migration history

Treat every script below as evidence, not as a guaranteed linear deployment
sequence. Reconcile scripts with a schema-only export of the actual target
database, and establish one tested, ordered migration chain for the new app.
Do not copy a script and run it against the existing database as part of this
migration.

| Existing file | Apparent relevance / action |
|---|---|
| `sql/seriqcare_evv_ddl.sql` | Base EVV/application DDL, including agency/user/employee/provider and operational schema; inspect for reusable core definitions and EVV-specific columns. |
| `sql/seriqcare_evv_ddl_old.sql` | Legacy DDL snapshot; compare for drift only, not a source to apply. |
| `sql/seriqcare_evv_phase2_migration.sql` | Agency tenancy and related schema changes across users/employees/clients/schedules/visits/authorizations; critical to tenant model and migration ordering. |
| `sql/seriqcare_evv_phase3_migration.sql`, `sql/seriqcare_evv_phase4_migration.sql` | Later phased schema changes; reconcile object-by-object with current database and model definitions. |
| `sql/seriqcare_evv_phase5_migration.sql`, `sql/seriqcare_evv_phase5_fix.sql`, `sql/seriqcare_evv_phase5_fix2.sql`, `sql/seriqcare_evv_phase5_fix3.sql`, `sql/seriqcare_evv_phase5_revert.sql` | Conflicting migration/fix/revert history; determine actual applied state before porting. Never infer final state from filenames alone. |
| `sql/seriqcare_evv_phase7_agency_settings.sql` | Agency settings additions; potentially reusable for tenant configuration after validation. |
| `sql/phase6_client_extended_fields.sql` | Client schema additions; validate which fields the new client UI/API needs. |
| `sql/add_timesheet_table.sql` | Timesheet table and visit/employee/client/service-code relationships; primary time-tracking reference. |
| `sql/add_client_care_tasks_table.sql`, `sql/add_client_care_task_history_table.sql` | Client care-task/history schema; optional clinical/task dependency, and the latter also contains payroll table definitions per existing migration notes. Separate unrelated DDL before reuse. |
| `sql/billing_phase1_migration.sql` | Billing claims and claim-visit relationships; claim/visit relationship is not automatically equivalent to an invoice model. |
| `sql/seriqcare_audit_schema.sql` | Audit schema; assess tables, sensitive data, retention, and audit requirements. |
| `sql/documentation_templates.sql` | Documentation templates/submissions and their agency/template/client/visit/user relationships; exclude from initial core migration unless selected. |
| `sql/startup_schema_migrations.sql` | Startup schema migration behavior; review carefully and replace with controlled migration execution where possible. |
| `sql/billing_page_plan.txt`, `sql/phase5_session_notes.txt` | Planning/history notes, not deployable DDL; consult only for context. |
| `db/migrations/V007__rename_agency_tiers.sql`, `db/migrations/V008__add_agency_aggregator.sql` | Additional versioned migration history; include when reconstructing current schema and determine whether those changes remain relevant. |

Key relationships indicated by the repository scripts include:

- `billing_claims` → agencies and `billing_claim_visits` → claims/visits
  (`sql/billing_phase1_migration.sql`).
- `timesheet` → visits, employees, clients, and service codes
  (`sql/add_timesheet_table.sql`).
- Payroll tables → employees, pay groups, and rates
  (`sql/add_client_care_task_history_table.sql`).
- Agency tenancy across users, employees, clients, schedules, visits, and
  authorizations (`sql/seriqcare_evv_phase2_migration.sql`).
- Documentation submissions → agencies, templates, clients, visits, and users
  (`sql/documentation_templates.sql`).

## Reusable authentication, navigation, styling, and data components

- **Authentication:** reuse validated domain concepts and selected token
  utilities, not the current browser-cookie-only gate as an authorization
  system. Frontend and backend must share one session contract; enforce
  tenant/role checks server-side for every protected route.
- **Navigation:** `components/sidebar.tsx` and `components/topbar.tsx` are
  reusable shell starting points. Remove links for documentation, EVV,
  claims, care plans, and super-admin unless those are explicitly enabled.
- **Styling:** `app/globals.css`, `app/layout.tsx`, and presentational
  components can be copied selectively, then checked for accessibility,
  responsive states, and dead feature-specific styles.
- **Database:** `db/database.py`, selected SQLAlchemy models, and the
  timezone/retry helpers are shared foundations. The new app should own its
  migration chain and configuration, and must not silently connect to or
  mutate the old production database.
- **Queries:** the `lib/queries/*` files provide useful endpoint call patterns;
  adapt to a single configured API origin, typed errors, and explicit
  tenant-aware auth rather than copying assumptions without review.

## Functionality outside the eight modules

1. **Authentication, agency tenancy, and roles** are required across all eight
   modules, not optional cleanup.
2. **Visits** are the shared transaction model connecting schedules, time
   tracking, invoices, payroll, dashboard, and reports. Keep a minimal visit
   domain even if the current `Visits` page is omitted.
3. **Service codes and authorizations** affect schedule validation and may
   affect billing. Define the minimum supported subset before porting.
4. **EVV and aggregators** (Sandata/HHAeXchange, submission, exceptions,
   aggregator status) are currently intertwined with visit and billing
   flows. Isolate integration adapters from the core visit/invoice state.
5. **Claims, payer workflows, and exports** are mixed into billing and are
   distinct from invoice generation. Decide if claims are excluded, optional,
   or included in a later phase.
6. **Payroll** depends on employee setup, approved time, pay groups, rates,
   pay periods, and export/provider formats. The repo does not show a complete
   standalone payroll UI.
7. **Reports and dashboard** aggregate records from other modules. Add
   explicit endpoint contracts, tenant filters, permissions, and reconciled
   definitions rather than reusing arbitrary UI aggregates.
8. **Mobile clock and profile flows** may update visits/timesheets. Do not
   migrate these workflows without including their state-transition and
   concurrency tests.
9. **Client care tasks/documentation** are adjacent features; exclude unless
   the new scope confirms them as operational prerequisites.

## Direct-copy vs. refactor summary

### Reasonable copy candidates (after review)

- Presentational layout and query/search components listed above.
- Core page layouts for clients, caregivers, schedules, and timesheets.
- Query module structure and established response schemas.
- Database retry/timezone helpers, if their assumptions and tests are verified.
- Docker's Python/ODBC setup and frontend deployment patterns, with new
  environment configuration and secrets.

### Must refactor before production use

- Auth/session, role/agency enforcement, and frontend protected-route logic.
- `backend/main.py` router registry, middleware, startup, health and CORS.
- Database connection config, schema migration strategy, and tenant filters.
- Billing into explicit invoice semantics separate from claims and EVV export.
- Payroll domain/API/UI, including approved time and export/provider behavior.
- Reports/dashboard contracts and data reconciliation.
- Mobile clock/visit flows if included in web time tracking.
- Navigation and settings to reflect the reduced module set.

### Exclude initially or isolate behind a later feature boundary

- Flutter/mobile app and mobile-only APIs, except extracted clock behavior
  selected for the SaaS time-tracking scope.
- EVV aggregator adapters and submission screens unless required.
- Documentation templates/submissions, super-admin, platform plans, and
  unrelated clinical workflows.
- Existing local environment files and any credentials, tokens, or production
  connection values. Configure the new app's secrets independently.

## Dependencies and deployment files

| Existing file | Migration action |
|---|---|
| `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `next.config.ts`, `next-env.d.ts` | Copy as a baseline, trim dependencies/scripts to retained modules, and regenerate/validate the new lockfile in the new repository. |
| `requirements.txt`, `pyproject.toml` | Copy only backend dependencies actually imported by the new app; verify dependency versions and Python support. |
| `Dockerfile` | Reuse as a starting point for FastAPI/ODBC; keep the ODBC driver only if SQL Server remains the database. |
| `render.yaml` | Reference deployment shape only. Create a separate service with fresh secrets, CORS origins, database identity, health checks, and environment values. |
| `vercel.json` | Reference only; configure the new frontend project and environment variables independently. |
| `README.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_GUIDE.md`, `authentication.md` | Use as migration context; author new-app setup and operations docs after implementation decisions. Do not imply the old login/demo instructions are production-safe. |
| `.env`, `.env.local`, `.env.example` | **Never copy populated files or values.** Create a new, sanitized example from required setting names only and provision unique secrets. |

The frontend package currently includes Next.js/React/TypeScript and
Turnstile-related support. The Python backend includes FastAPI/Uvicorn,
SQLAlchemy, pyodbc, dotenv, and auth-related packages. Verify actual imports
and remove packages for excluded features only after dependency scans and
tests; do not hand-edit lockfiles.

## Recommended migration sequence

1. **Freeze scope and baseline:** confirm invoice vs. claim behavior, web vs.
   mobile clocking, payer/authorization requirements, payroll exports, report
   definitions, roles, and compliance/EVV obligations. Record current app
   behavior and API contracts.
2. **Reconcile database:** inventory deployed SQL Server schema, applied
   migration history, indexes, constraints, stored procedures, and data
   volumes. Compare to `db/models.py` and every relevant SQL script; resolve
   drift and identify a source-of-truth migration chain.
3. **Create isolated SaaS shell:** new repository/application, separate
   deployment projects, health checks, API origin, logging, secret management,
   and safe non-production database. No copied production credentials.
4. **Design identity and tenancy:** select secure session/token architecture,
   agency onboarding/tenant boundaries, roles, audit policy, and data
   isolation tests before migrating protected APIs.
5. **Port shared foundations:** typed API client, error handling, navigation,
   styles, SQLAlchemy session/transaction helpers, and validated common
   schemas/models.
6. **Migrate Clients and Caregivers:** CRUD, search, detail, tenant scoping,
   and minimum payer/authorization/employee configuration needed by later
   phases.
7. **Migrate Scheduling:** service codes, authorizations, schedule CRUD,
   conflict validation, timezone behavior, and role checks.
8. **Migrate Time Tracking:** visit lifecycle, web/mobile clock scope,
   timesheets, corrections, approval, concurrency, and any required EVV
   compliance boundary.
9. **Migrate Invoices:** define invoice lifecycle and source data; add
   generation, adjustment, history, and reconciliation. Keep claims and
   aggregators separate unless explicitly selected.
10. **Migrate Payroll:** pay groups/rates, periods, approved-time input,
    calculations, audit trail, provider export, and duplicate-export handling.
11. **Migrate Dashboard and Reports:** build explicit, permissioned aggregates
    on stable APIs and reconcile totals to source records.
12. **Data migration and cutover rehearsal:** map IDs/tenants, validate
    constraints and financial totals, rehearse rollback, and test restore from
    backup before any production cutover.
13. **Production rollout:** deploy independently, monitor auth, tenant
    isolation, database health, financial reconciliation, and error rates.
    Defer optional integrations until the core product is stable.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Existing scripts are not one authoritative ordered migration chain; old, fix, and revert scripts coexist. | Inspect live schema and migration ledger; generate a reviewed baseline and replayable, versioned migrations against a clean database. |
| Tenant isolation may be inconsistent across routers or joins. | Add agency scoping at service/query boundaries and automated cross-tenant read/write denial tests for every module. |
| Frontend cookie-presence checks differ from backend JWT/session authority. | Replace with one server-validated auth contract; test expiry, refresh, logout, and unauthorized access. |
| Visit, EVV, timesheet, and invoice states are intertwined. | Define state machines and ownership boundaries; isolate external integrations and test transitions/idempotency. |
| “Invoices” may currently mean billing entries or claims. | Product decision and accounting contract before porting `billing.py` or related UI. |
| Payroll logic and tables may not be fully represented by SQLAlchemy models. | Reconcile live payroll DDL and exports; specify payroll rules and validate against approved time samples. |
| Dashboard/report aggregates may disagree with source module definitions. | Publish metric/report definitions and add reconciliation tests using fixed data fixtures. |
| Clock workflows can create duplicate/out-of-order visits under retries or concurrent actions. | Define idempotency keys, transaction boundaries, and concurrency tests. |
| Copying existing environment/configuration could expose credentials or couple services. | Never copy populated env files; provision separate least-privilege identities and secrets. |
| Unsupported pages or UI components retain hidden imports/API calls. | Use dependency scans, route smoke tests, and build checks after each feature boundary is removed. |

## Verification checklist

### Repository and build

- [ ] New app is in a separate repository/directory; this original repository
      remains unchanged by the migration.
- [ ] Frontend install, lint, type-check, and production build pass.
- [ ] Backend dependency install, import/startup, lint/type checks (where
      configured), and focused tests pass.
- [ ] No retained code imports excluded modules or legacy paths unintentionally.
- [ ] New deployment configuration references only new environment variables
      and secrets.

### Security and tenancy

- [ ] Login, refresh, logout, expiry, password reset, and unauthorized access
      have automated tests.
- [ ] Every API operation enforces role and agency scope server-side.
- [ ] Cross-tenant client, caregiver, schedule, visit, timesheet, invoice,
      payroll, dashboard, and report access is denied.
- [ ] Secrets are absent from source, build artifacts, logs, and committed
      environment files.
- [ ] Financial and identity changes produce appropriately access-controlled
      audit records.

### Domain and data correctness

- [ ] Clean database migration replay and upgrade-from-baseline both pass.
- [ ] Foreign keys, indexes, nullability, and delete/update behavior match
      documented relationships.
- [ ] CRUD and validation tests cover clients, caregivers, schedules,
      time/visit lifecycle, invoices, and payroll.
- [ ] Visit/time transitions handle retries, concurrency, correction, and
      timezone/daylight-saving boundaries.
- [ ] Invoice totals reconcile with their source visits, authorizations, and
      payer rules.
- [ ] Payroll totals reconcile with approved hours, pay groups/rates, and
      exports; duplicate exports are safely handled.
- [ ] Dashboard and report aggregates reconcile to canonical module queries.
- [ ] Data migration dry run validates row counts, tenant mapping, referential
      integrity, and financial totals; backup/restore and rollback are tested.

### UX and deployment

- [ ] Navigation contains only enabled modules and role-appropriate actions.
- [ ] Empty, loading, validation, API error, and forbidden states are tested.
- [ ] CORS, frontend/backend connectivity, database connectivity, health
      endpoint, and observability are verified in a staging environment.
- [ ] Product decisions on claims, EVV, clocking, payer data, care tasks, and
      payroll provider integrations are recorded before cutover.

## Repository evidence and limitations

This plan is based on the checked-in application structure, route registration,
models, migration scripts, frontend query modules, and deployment files. Several
schema scripts are historical or corrective, and some billing/payroll tables
are not clearly represented by mapped SQLAlchemy classes. Therefore, the
deployed database schema and applied migration history remain authoritative
inputs to the implementation phase. No `.env` values or other credentials are
included in this plan.
