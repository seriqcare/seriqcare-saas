Authorization usage is calculated on read from completed, non-cancelled visits.
The legacy `care.service_authorizations.used_units` column is not the source for
the dashboard, client authorizations, billing utilization, or export eligibility.
They share `backend/services/authorization_usage.py`.

- Use adjusted EVV timestamps when present, otherwise original timestamps.
- Count only a positive completed duration; an open shift consumes no units.
- Divide recorded seconds by 60 and the service code's `minutes_per_unit`,
  truncating incomplete units separately for each visit.
- Match agency, client, service, and the authorization's inclusive service dates.
- Use an explicit matching visit authorization when present. For an unlinked
  visit, infer only a single active matching authorization. Overlaps require an
  explicit selection in Billing and are flagged in the tracker.
- Exclude visits whose client or employee belongs to another agency.
- Payroll approval and aggregator submission do not gate delivered-service usage.
- Remaining = authorized units minus used units. Preserve negative remaining
  values to expose overuse. Never decrement the authorized total.

Recalculating avoids duplicate deductions and reflects corrected times,
cancellations, and changed authorization assignments without a balance backfill.
It does not include consumption recorded only in another system without visits.
