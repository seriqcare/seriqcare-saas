# Agency-bound authentication

Web, `/clock`, and Flutter sign-in require `care.agencies.agency_code` alongside
username (or email) and password. This is the agency code, not its numeric ID.
Codes are trimmed and matched without case sensitivity.

The backend verifies active agency membership before issuing a session. Access
tokens include the verified agency ID and code. Authenticated requests check the
stored session owner and current user identity, role, employee, and agency against
the token. Disabled agencies and invalid caregiver employee links are rejected.

```json
{
  "agency_code": "YOUR-AGENCY-CODE",
  "username": "your.username",
  "password": "your-password",
  "client_type": "web"
}
```

Flutter uses `client_type: "mobile"` and its existing device fields. Subsequent
requests use the bearer token. Client-submitted agency IDs/codes do not override
the authenticated tenant. Server-side `AgencyScope` and record ownership checks
remain essential. Platform super administrators retain separate Entra sign-in.

Refresh tokens bind the original agency within the complete, hash-verified token.
Changed agency membership and old unbound refresh tokens require sign-in again.
Existing users must sign in again once; no database migration is required.

`/api/auth/signup` now requires an agency administrator or super administrator and
the target agency code. Agency admins can provision only within their own agency.
It no longer chooses the first agency or signs the administrator into the new
user's account.

Mobile schedules, profile counts, tasks, timesheet corrections, and visit
corrections were also reviewed and tightened. Tests cover these routes and
authentication; this is not a certification of every application endpoint.

The Flutter source changes are in `dev_mobile/seriqcare_mobile/lib/main.dart` and
`dev_mobile/seriqcare_mobile/lib/services/auth_service.dart`. This workspace ignores
`dev_mobile/` in Git; include those files through the mobile source workflow when
releasing, and rebuild the installed app.
