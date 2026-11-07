"""
set_password.py — Manually set a bcrypt password for one or all users in care.users.

Usage (run from the project root with .venv active):

  List all users:
    python scripts/set_password.py --list

    Set a single user by username OR email:
    python scripts/set_password.py --username coordinator1 --password SeriqCare2024!
        python scripts/set_password.py --username info@seriqcare.com --password SeriqCare2024!

  Set ALL active users to the same password:
    python scripts/set_password.py --all --password SeriqCare2024!
"""
import argparse
import os
import sys
from pathlib import Path
from urllib.parse import quote_plus

import bcrypt
from passlib.context import CryptContext
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session

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

_conn_str = (
    f"mssql+pyodbc://{quote_plus(DB_USER)}:{quote_plus(DB_PASS)}"
    f"@{DB_SERVER}:{DB_PORT}/{DB_NAME}"
    f"?driver={quote_plus(DB_DRIVER)}"
)

_engine      = create_engine(_conn_str, echo=False)
_SessionLocal = sessionmaker(bind=_engine, autocommit=False, autoflush=False)
_ctx          = CryptContext(schemes=["bcrypt_sha256", "bcrypt"], deprecated="auto")


def _hash(password: str) -> str:
    return _ctx.hash(password)


def _test_connection() -> None:
    try:
        with _engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        print(f"[DB] Connected  →  {DB_SERVER}:{DB_PORT}  /  {DB_NAME}  (user: {DB_USER})\n")
    except Exception as e:
        print(f"[DB] Connection FAILED: {e}")
        sys.exit(1)


def list_users(db: Session) -> None:
    rows = db.execute(
        text(
            f"SELECT username, email, role, is_active, password_hash "
            f"FROM {DB_SCHEMA}.users ORDER BY role, username"
        )
    ).fetchall()
    print(f"{'Username':<20} {'Email':<30} {'Role':<15} {'Active':<8} {'Password set?'}")
    print("-" * 95)
    for r in rows:
        has_hash = "yes" if r.password_hash else "NO (NULL)"
        active   = "yes" if r.is_active else "no"
        email = r.email or "-"
        print(f"{r.username:<20} {email:<30} {r.role:<15} {active:<8} {has_hash}")
    print()


def set_one(db: Session, identifier: str, password: str) -> bool:
    row = db.execute(
        text(
            f"SELECT id, username, email, role "
            f"FROM {DB_SCHEMA}.users "
            f"WHERE username = :u OR email = :u"
        ),
        {"u": identifier}
    ).fetchone()
    if not row:
        print(f"  [ERROR] User/email '{identifier}' not found.")
        return False

    target_username = row.username
    db.execute(
        text(f"UPDATE {DB_SCHEMA}.users SET password_hash = :h WHERE id = :id"),
        {"h": _hash(password), "id": row.id}
    )
    db.commit()
    print(
        f"  [OK]  Password set for username='{target_username}' "
        f"email='{row.email or '-'}' (role: {row.role})"
    )
    return True


def set_all(db: Session, password: str) -> None:
    rows = db.execute(
        text(f"SELECT username, role FROM {DB_SCHEMA}.users WHERE is_active = 1")
    ).fetchall()
    print(f"Setting password for {len(rows)} active user(s)…")
    for r in rows:
        db.execute(
            text(f"UPDATE {DB_SCHEMA}.users SET password_hash = :h WHERE username = :u"),
            {"h": _hash(password), "u": r.username}
        )
        print(f"  [OK]  {r.username:<20} role: {r.role}")
    db.commit()
    print("Done.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Set bcrypt passwords in care.users")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--username", metavar="NAME",      help="Set password for a single user (username OR email)")
    mode.add_argument("--all",      action="store_true", help="Set password for ALL active users")
    mode.add_argument("--list",     action="store_true", help="List all users and password status")
    parser.add_argument("--password", metavar="PASS",    help="Plain-text password to hash (min 8 chars)")
    args = parser.parse_args()

    if not args.list and not args.password:
        parser.error("--password is required unless using --list")
    if args.password and len(args.password) < 8:
        print("Error: password must be at least 8 characters.")
        sys.exit(1)

    _test_connection()

    db = _SessionLocal()
    try:
        if args.list:
            list_users(db)
        elif args.all:
            set_all(db, args.password)
        else:
            ok = set_one(db, args.username, args.password)
            sys.exit(0 if ok else 1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
