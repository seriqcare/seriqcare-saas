# Dashboard EVV reporting

The dashboard exception total covers non-cancelled visits in the signed-in
agency across all dates. Urgent exceptions are records with EVV status `Failed`.

`Pending` alone is not an exception:

- Clock-in present and clock-out absent: In Progress, unless overdue.
- Clock-out present: Pending Verification. Validation can subsequently set Failed.
- Missing clock-out after the matching schedule's end plus grace: an exception.

The clock-out grace period defaults to 30 minutes. Set the backend environment
variable `EVV_CLOCK_OUT_GRACE_MINUTES` to a nonnegative integer to change it.
At the exact grace boundary the visit remains In Progress; it becomes overdue
only after that boundary. A visit without a matching schedule is not inferred
to be overdue. Schedule matches require the same agency, client and employee.
Adjusted clock-in/out timestamps take precedence over original timestamps.
Verified, Adjusted and Exempt records are not inferred to be exceptions.

The EVV breakdown covers the current week and separates In Progress, Pending
Verification and Exceptions. Dashboard data is fetched without caching, and the
page refreshes every 30 seconds while visible and when returning to the tab.
