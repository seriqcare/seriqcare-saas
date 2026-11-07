"""
create_super_admin.py — Insert a super_admin user into care.users.

Usage (run from the project root with .venv active):
    python scripts/create_super_admin.py
"""
import os
import sys
from pathlib import Path
from urllib.parse import quote_plus

import bcrypt
from passlib.context import CryptContext
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv(*args, **kwargs):
        return False


def _load_env_file_fallback(env_path: Path) -> None:
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


if not hasattr(bcrypt, "__about__"):
    class _BcryptAbout:
        __version__ = getattr(bcrypt, "__version__", "unknown")

    bcrypt.__about__ = _BcryptAbout()

# Load .env from project root and fallback to process environment variables.
_project_env = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(_project_env)
load_dotenv()
_load_env_file_fallback(_project_env)


def _require_env(name: str) -> str:
    value = os.getenv(name)
    if value is None or not value.strip():
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value.strip()


def _env_any(*names: str) -> str:
    for name in names:
        value = os.getenv(name)
        if value is not None and value.strip():
            return value.strip()
    raise RuntimeError(f"Missing required environment variable. Expected one of: {', '.join(names)}")


DB_SERVER = _require_env("DB_SERVER")
DB_PORT = _require_env("DB_PORT")
DB_NAME = _require_env("DB_NAME")
DB_USER = _require_env("DB_USER")
DB_PASS = _env_any("DB_PASSWORD", "DB_PASS")
DB_DRIVER = _env_any("ODBC_DRIVER", "DB_DRIVER")
DB_SCHEMA = os.getenv("DB_SCHEMA", "care").strip() or "care"

# ---------------------------------------------------------------------------
# Super admin details
# ---------------------------------------------------------------------------
SA_USERNAME     = "superadmin"
SA_DISPLAY_NAME = "Super Admin"
SA_EMAIL        = "admin@seriqcare.com"
SA_PASSWORD     = _require_env("SUPER_ADMIN_PASSWORD")
SA_ROLE         = "super_admin"

# ---------------------------------------------------------------------------
_conn_str = (
    f"mssql+pyodbc://{quote_plus(DB_USER)}:{quote_plus(DB_PASS)}"
    f"@{DB_SERVER}:{DB_PORT}/{DB_NAME}"
    f"?driver={quote_plus(DB_DRIVER)}"
)
_engine = create_engine(_conn_str, echo=False)
_Session = sessionmaker(bind=_engine, autocommit=False, autoflush=False)
_ctx = CryptContext(schemes=["bcrypt_sha256", "bcrypt"], deprecated="auto")


def main():
    # Test connection
    try:
        with _engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        print(f"[DB] Connected  ->  {DB_SERVER}:{DB_PORT}  /  {DB_NAME}")
    except Exception as e:
        print(f"[DB] Connection FAILED: {e}")
        sys.exit(1)

    db = _Session()
    try:
        # Check if user already exists
        existing = db.execute(
            text(f"SELECT id, role FROM {DB_SCHEMA}.users WHERE username = :u"),
            {"u": SA_USERNAME},
        ).fetchone()

        if existing:
            print(f"\n  User '{SA_USERNAME}' already exists (id={existing.id}, role={existing.role}).")
            # Update role to super_admin if needed
            if existing.role != SA_ROLE:
                db.execute(
                    text(f"UPDATE {DB_SCHEMA}.users SET role = :role WHERE username = :u"),
                    {"role": SA_ROLE, "u": SA_USERNAME},
                )
                print(f"  [OK] Updated role to '{SA_ROLE}'")
            # Update password
            db.execute(
                text(f"UPDATE {DB_SCHEMA}.users SET password_hash = :h, email = :e, is_active = 1 WHERE username = :u"),
                {"h": _ctx.hash(SA_PASSWORD), "e": SA_EMAIL, "u": SA_USERNAME},
            )
            db.commit()
            print(f"  [OK] Password reset and account activated.")
        else:
            # Insert new super admin user (agency_id = NULL for super admin)
            result = db.execute(text(f"""
                INSERT INTO {DB_SCHEMA}.users
                    (username, display_name, email, role, is_active, password_hash, agency_id)
                OUTPUT INSERTED.id
                VALUES
                    (:username, :display_name, :email, :role, 1, :password_hash, NULL)
            """), {
                "username":      SA_USERNAME,
                "display_name":  SA_DISPLAY_NAME,
                "email":         SA_EMAIL,
                "role":          SA_ROLE,
                "password_hash": _ctx.hash(SA_PASSWORD),
            })
            new_id = result.fetchone()[0]
            db.commit()
            print(f"\n  [OK] Created super admin user:")
            print(f"        id       = {new_id}")
            print(f"        username = {SA_USERNAME}")
            print(f"        email    = {SA_EMAIL}")
            print(f"        role     = {SA_ROLE}")

        print(f"\n  Login with:")
        print(f"    Username: {SA_USERNAME}")
        print(f"    Password: {SA_PASSWORD}")
        print()

    finally:
        db.close()


if __name__ == "__main__":
    main()
