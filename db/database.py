from __future__ import annotations

from functools import lru_cache
import os
import struct
import time
from threading import Lock
from urllib.parse import quote_plus

from dotenv import load_dotenv
from sqlalchemy import event
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase

load_dotenv()


def _require_env(name: str) -> str:
    value = os.getenv(name)
    if value is None or not value.strip():
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value.strip()


def _env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    try:
        return int(value.strip())
    except ValueError:
        return default


def _runtime_env() -> str:
    return os.getenv("ENV", "local").strip().lower()


def _should_use_key_vault() -> bool:
    return _env_flag("USE_KEY_VAULT")


def _should_use_service_principal() -> bool:
    return _runtime_env() == "prod"


def _env_db_settings() -> dict[str, str]:
    return {
        "server": _require_env("DB_SERVER"),
        "port": _require_env("DB_PORT"),
        "name": _require_env("DB_NAME"),
        "user": _require_env("DB_USER"),
        "password": _require_env("DB_PASSWORD"),
        "driver": _require_env("ODBC_DRIVER"),
    }


def _get_secret_value(secret_client, secret_name_env: str) -> str:
    secret_name = os.getenv(secret_name_env, "").strip() or secret_name_env.removeprefix("KV_").removesuffix("_SECRET_NAME").lower().replace("_", "-")
    secret_value = secret_client.get_secret(secret_name).value
    if secret_value is None or not secret_value.strip():
        raise RuntimeError(
            f"Key Vault secret referenced by {secret_name_env} is empty"
        )
    return secret_value.strip()


@lru_cache(maxsize=1)
def _key_vault_service_principal() -> dict[str, str]:
    from azure.identity import DefaultAzureCredential
    from azure.keyvault.secrets import SecretClient

    secret_client = SecretClient(
        vault_url=_require_env("VAULT_URL"),
        credential=DefaultAzureCredential(),
    )
    return {
        "tenant_id": _get_secret_value(secret_client, "KV_DB_TENANT_ID_SECRET_NAME"),
        "client_id": _get_secret_value(secret_client, "KV_DB_CLIENT_ID_SECRET_NAME"),
        "client_secret": _get_secret_value(secret_client, "KV_DB_CLIENT_SECRET_SECRET_NAME"),
    }


def _env_service_principal() -> dict[str, str]:
    return {
        "tenant_id": _require_env("DB_TENANT_ID"),
        "client_id": _require_env("DB_CLIENT_ID"),
        "client_secret": _require_env("DB_CLIENT_SECRET"),
    }


_sql_token_lock = Lock()
_sql_token_bytes: bytes | None = None
_sql_token_expires_at: float = 0.0


def _sql_access_token() -> bytes:
    from azure.identity import ClientSecretCredential

    global _sql_token_bytes, _sql_token_expires_at

    now = time.time()
    if _sql_token_bytes is not None and now < (_sql_token_expires_at - 300):
        return _sql_token_bytes

    with _sql_token_lock:
        now = time.time()
        if _sql_token_bytes is not None and now < (_sql_token_expires_at - 300):
            return _sql_token_bytes

        sp = _key_vault_service_principal() if _should_use_key_vault() else _env_service_principal()
        credential = ClientSecretCredential(
            tenant_id=sp["tenant_id"],
            client_id=sp["client_id"],
            client_secret=sp["client_secret"],
        )
        access_token = credential.get_token("https://database.windows.net/.default")
        token_bytes = access_token.token.encode("utf-16-le")
        _sql_token_bytes = struct.pack("<I", len(token_bytes)) + token_bytes
        _sql_token_expires_at = float(access_token.expires_on)
        return _sql_token_bytes


def _prod_conn_str() -> str:
    server = _require_env("DB_SERVER")
    port = _require_env("DB_PORT")
    name = _require_env("DB_NAME")
    driver = quote_plus(_require_env("ODBC_DRIVER"))
    return (
        f"mssql+pyodbc://@{server}:{port}/{name}"
        f"?driver={driver}"
        f"&Encrypt=yes"
        f"&TrustServerCertificate=no"
        f"&KeepAlive=30"
        f"&KeepAliveInterval=30"
    )


def _build_conn_str() -> str:
    if _should_use_service_principal():
        return _prod_conn_str()

    settings = _env_db_settings()

    server = settings["server"]
    port = settings["port"]
    name = settings["name"]
    user = quote_plus(settings["user"])
    password = quote_plus(settings["password"])
    driver = quote_plus(settings["driver"])

    return (
        f"mssql+pyodbc://{user}:{password}@{server}:{port}/{name}"
        f"?driver={driver}"
        f"&KeepAlive=30"
        f"&KeepAliveInterval=30"
    )


engine = create_engine(
    _build_conn_str(),
    echo=os.getenv("DEBUG", "false").lower() == "true",
    pool_pre_ping=True,
    pool_recycle=1800,
    pool_size=_env_int("DB_POOL_SIZE", 5),
    max_overflow=_env_int("DB_MAX_OVERFLOW", 10),
    pool_timeout=_env_int("DB_POOL_TIMEOUT", 30),
    connect_args={"timeout": _env_int("DB_CONNECT_TIMEOUT", 30)},
)


if _should_use_key_vault():
    @event.listens_for(engine, "do_connect")
    def _provide_sql_access_token(dialect, conn_rec, cargs, cparams):
        cargs[0] = cargs[0].replace(";Trusted_Connection=Yes", "")
        cparams["attrs_before"] = {1256: _sql_access_token()}


if _should_use_service_principal() and not _should_use_key_vault():
    @event.listens_for(engine, "do_connect")
    def _provide_sql_access_token_from_env(dialect, conn_rec, cargs, cparams):
        cargs[0] = cargs[0].replace(";Trusted_Connection=Yes", "")
        cparams["attrs_before"] = {1256: _sql_access_token()}


if _should_use_service_principal():
    @event.listens_for(engine, "handle_error")
    def _invalidate_on_token_expiry(context):
        """
        28000 = 'Login failed — token is expired.'
        SQLAlchemy's is_disconnect() does not recognise this as a disconnection,
        so pool_pre_ping would propagate the error instead of reconnecting.
        Marking the connection invalid here forces the pool to open a new one,
        which triggers do_connect and injects a fresh Azure AD token.
        """
        orig = context.original_exception
        if (
            hasattr(orig, "args")
            and orig.args
            and isinstance(orig.args[0], str)
            and orig.args[0] == "28000"
        ):
            context.invalidate_pool_on_disconnect = True
            context.is_disconnect = True


# ---------------------------------------------------------------------------
# Transient disconnect states
#   08S01 — communication link failure
#   08001 — unable to connect
#   08007 — connection failure during transaction
#   HYT00 — query timeout expired
#   HYT01 — connection timeout expired
# ---------------------------------------------------------------------------
_TRANSIENT_SQLSTATES = {"08S01", "08001", "08007", "HYT00", "HYT01"}


@event.listens_for(engine, "handle_error")
def _invalidate_on_transient_disconnect(context):
    """
    Treat common SQL Server / ODBC transient transport failures as disconnects
    so SQLAlchemy invalidates stale pooled connections and reconnects cleanly.
    """
    orig = context.original_exception
    if not hasattr(orig, "args") or not orig.args:
        return

    first = orig.args[0]
    sqlstate = first if isinstance(first, str) else ""

    if sqlstate in _TRANSIENT_SQLSTATES:
        context.invalidate_pool_on_disconnect = True
        context.is_disconnect = True


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI dependency — yields a SQLAlchemy Session and closes it after use."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def test_connection() -> bool:
    """Return True if the database is reachable."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as e:
        print(f"[db] Connection test failed: {e}")
        return False
