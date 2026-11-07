# SeriqCare Next.js App

A simple multi-page Next.js UI prototype for a home care SaaS product.

## Included pages

- Login
- Dashboard
- Clients
- Schedule
- Timesheets

## Demo login

- Username: `admin`
- Password: `123`

After login, the app redirects directly to the dashboard.

## Main features

- Sidebar navigation for all modules
- Logged-in user shown at the top right
- Sign out button in the top right
- Hardcoded client-side authentication using localStorage
- Shared design system using global CSS
- App Router structure using Next.js

## Getting started

```bash
local run:
front end:
npm run dev

backend:
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --port 8000 
```

Then open:

```bash
http://localhost:3000/login
```

## Project structure

```text
seriqcare-nextjs-app/
├── app/
│   ├── clients/
│   ├── login/
│   ├── schedule/
│   ├── timesheets/
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── auth-context.tsx
│   ├── protected-layout.tsx
│   ├── sidebar.tsx
│   └── topbar.tsx
├── README.md
├── ARCHITECTURE.md
├── next.config.ts
├── package.json
└── tsconfig.json
```

## Notes

This is a UI prototype, not a production authentication system.

For production, replace the hardcoded login with:

- NextAuth or a custom auth service
- secure API-based session handling
- encrypted cookies or JWT strategy
- server-side authorization checks
