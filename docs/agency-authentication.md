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
remain essential.

## Platform administrators

On the web login page, enter agency code `999` with an existing active
`super_admin` account's username/email and password. The backend treats `999`
as a reserved platform login selector, without looking up or creating an agency.
Agency creation rejects this code. Regular agency users cannot sign in with it,
and super admins cannot sign in with ordinary agency codes. Mobile password
sign-in with `999` is rejected. Existing Entra sign-in remains available through
its backend endpoint.

Platform access tokens and refreshed responses carry agency code `999`; a
platform account without agency membership retains `agency_id: null`. The code
does not grant a role or alter membership. Authentication still verifies the
password, active account, stored role, session owner, and signed claims, and uses
the existing login throttling and HttpOnly web refresh cookie. Successful web
sign-in redirects to `/super-admin`. Passwords are not created or reset by this
change; an Entra-only account needs a password configured before password login.

## Password setup and recovery

The agency creation response and confirmation show both the numeric Agency ID
and Agency Code. Use the code for login. Setup and recovery emails also include
the Agency ID, Agency Code and administrator email.

Forgot Password requires `agency_code` and `email`; a shared email is looked up
only within that active agency. Code `999` selects an active platform account.
Unmatched requests return the same response without sending email.

Password links keep their existing single-use token. The password page posts
that token to `/api/auth/password-reset-context` to resolve the account's
current Agency ID, Agency Code and email from trusted database records. Those
fields are read-only, and URL parameters cannot override them. The reset POST
must include the same `agency_id`, `agency_code` and `email` alongside `token`
and `new_password`. The backend revalidates all details and atomically consumes
the unexpired token before saving. Existing unused links work with this page;
no schema migration or replacement invitation is required.

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
