# Payroll and billing exports

Exports prepare supporting CSV files. They do not submit claims, send EVV records, or confirm payment.

## Independent eligibility

Both export kinds require a non-cancelled visit within the signed-in agency and selected period, completed clock-in/out with positive recorded hours.

- **Payroll:** Requires timesheet approval, an employee code and an assigned caregiver pay group/rate, with a positive Hourly or Per Visit rate effective on the visit date. Billing rates, authorizations, and EVV acceptance do not gate payroll. Existing Timesheets minute-based hours and gross-pay calculation are retained.
- **Billing:** Uses visit EVV approval/aggregator acceptance, independently of timesheet approval. Requires positive billing units, a service billing rate effective on the visit date, a client Medicaid ID, a current active service authorization with an authorization number and sufficient units, and an active agency provider. EVV-required services also require local verification and acceptance by the agency's aggregator. Sandata provider IDs must match the agency configuration. Caregiver pay rates do not gate billing.

A visit without a linked authorization can use an exact, unique agency/client/service/date match; ambiguous matches require explicit selection. The link is saved when billing is exported, or through Assign authorization.

Readiness is derived on the backend. The appropriate approval plus complete setup makes a visit ready automatically; there is no Draft or manual Ready transition.

## Batches and history

`POST /api/exports` rechecks eligibility, snapshots the data, generates the CSV, and creates an immutable batch. Each request has a UUID idempotency key. The agency lock and unique `(agency_id, kind, visit_id)` constraint prevent overlapping exports. The same visit can appear once in payroll and once in billing.

`Exported` means included in a prepared batch; it does not confirm that a file was saved to disk or submitted externally. If downloading fails, retry the existing batch from Export History. Re-downloads return its original CSV, even after rates or source data change, without creating another batch.

History records the user, UTC creation timestamp, selected visit period, totals, format, and per-visit snapshots. History and downloads enforce agency scope. No export/payment status can be manually advanced.

Earlier claim records remain read-only under Billing's Export History. Previous claim-generation/status APIs and the untracked bulk billing download return HTTP 410. Saved legacy claim CSVs remain accessible.

## Database setup

Backend startup applies the idempotent `sql/data_exports.sql` migration. It creates `care.data_exports` and `care.data_export_items` without changing existing claim data. For opt-in SQL Server checks, run `RUN_EXPORT_DB_TESTS=1` with `test_export_workflow_integration.py`; all test batches are rolled back.
