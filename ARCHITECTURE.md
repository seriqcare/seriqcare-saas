# SeriqCare Architecture

This project uses the Next.js App Router with a small client-side authentication layer and shared reusable UI components.

## Overview

- `app/layout.tsx` wraps the app in `AuthProvider`
- `auth-context.tsx` manages login state using localStorage
- `protected-layout.tsx` blocks access to protected routes when not signed in
- `sidebar.tsx` renders the left navigation
- `topbar.tsx` shows the current user and sign-out action
- each page under `app/` renders a specific module UI

## Mermaid diagram

```mermaid
flowchart TD
    A[Browser] --> B[Next.js App Router]
    B --> C[Root Layout]
    C --> D[AuthProvider]

    D --> E[Login Page]
    D --> F[Protected Layout]

    F --> G[Sidebar Navigation]
    F --> H[Page Content]
    H --> I[Dashboard Page]
    H --> J[Clients Page]
    H --> K[Schedule Page]
    H --> L[Timesheets Page]

    D --> M[localStorage Auth State]
    E --> M
    F --> M

    H --> N[Header User + Sign Out]
```

## Route flow

```mermaid
sequenceDiagram
    participant U as User
    participant L as Login Page
    participant A as AuthProvider
    participant P as Protected Route
    participant S as localStorage

    U->>L: Open /login
    U->>L: Enter admin / 123
    L->>A: signIn(username, password)
    A->>S: store seriqcare-auth-user
    A-->>U: authenticated
    U->>P: Navigate to /
    P->>A: read auth state
    A->>S: get stored user
    A-->>P: user available
    P-->>U: show dashboard
```

## Suggested future production upgrades

- move authentication to a secure server-side solution
- add role-based access control
- fetch clients, schedules, and timesheets from APIs
- split large page sections into more reusable components
- add a data layer with TanStack Query or server actions
