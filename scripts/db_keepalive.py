"""Render keep-alive DB probe.

Runs a lightweight `SELECT 1` using the same env-based SQLAlchemy connection
configuration as the backend (`db.database`).

Expected environment variables (same as backend):
- `ENV`
- `DB_SERVER`
- `DB_PORT`
- `DB_NAME`
- `ODBC_DRIVER`
- For local user/password auth: `DB_USER`, `DB_PASSWORD`
- For prod service principal auth: `DB_TENANT_ID`, `DB_CLIENT_ID`, `DB_CLIENT_SECRET`
"""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import text

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from db.database import engine  # noqa: E402


def main() -> int:
    try:
        with engine.connect() as connection:
            result = connection.execute(text("SELECT 1")).scalar_one()
        print(f"[keepalive] DB reachable. SELECT 1 -> {result}")
        return 0
    except Exception as exc:
        print(f"[keepalive] DB keepalive failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
