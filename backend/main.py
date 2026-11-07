"""
SeriqCare FastAPI Backend — Unified (Web Portal + Flutter Mobile)
PA-DHS EVV Vendor Spec v1.4 · ODP EVV Guidance v2.0

Run:
    .venv/Scripts/uvicorn backend.main:app --reload --port 8000

Serves:
  • Web portal  (Next.js, /api/*)          — portal management, aggregator, timesheets
  • Flutter app (mobile, /api/schedules/*, /api/visits/clock-*, /api/profile/*, etc.)
"""
from __future__ import annotations

import asyncio
import logging
import logging.handlers
import os
from contextlib import asynccontextmanager
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv(*args, **kwargs):
        return False

# load_dotenv MUST run before any module-level os.getenv() calls in routers/db
load_dotenv()

# ---------------------------------------------------------------------------
# Logging — all seriqcare.* loggers share one config.
#
# On Render (ENV=prod): stdout only — Render captures stdout as its log stream.
# Locally (ENV=local):  stdout + rotating file at logs/seriqcare.log
#                       Override the file path with LOG_FILE env var.
# ---------------------------------------------------------------------------
_ENV = os.getenv("ENV", "local").strip().lower()

_seriqcare_logger = logging.getLogger("seriqcare")
_seriqcare_logger.setLevel(logging.INFO)

_fmt = logging.Formatter(
    "%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

_stdout_handler = logging.StreamHandler()
_stdout_handler.setFormatter(_fmt)
_seriqcare_logger.addHandler(_stdout_handler)

if _ENV != "prod":
    _LOG_FILE = os.getenv("LOG_FILE", "logs/seriqcare.log")
    _log_path = Path(_LOG_FILE)
    _log_path.parent.mkdir(parents=True, exist_ok=True)
    _file_handler = logging.handlers.RotatingFileHandler(
        _log_path,
        maxBytes=5 * 1024 * 1024,  # 5 MB
        backupCount=5,
        encoding="utf-8",
    )
    _file_handler.setFormatter(_fmt)
    _seriqcare_logger.addHandler(_file_handler)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from sqlalchemy import text

from backend.middleware.api_access_log import api_access_log_middleware
from db.database import engine, test_connection

log = logging.getLogger("seriqcare.keepalive")

# ---------------------------------------------------------------------------
# DB keepalive — pings every 4 min to prevent Azure LB from dropping idle
# TCP connections in the SQLAlchemy pool (Azure drops idle conns at ~4 min).
# Runs as a background asyncio task inside the existing Render process;
# zero additional cost since the process is already running 24/7.
# ---------------------------------------------------------------------------
_KEEPALIVE_INTERVAL = int(os.getenv("DB_KEEPALIVE_INTERVAL", "240"))  # seconds


async def _db_keepalive_loop() -> None:
    while True:
        await asyncio.sleep(_KEEPALIVE_INTERVAL)
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        except Exception as exc:
            # Log but never crash — pool_pre_ping handles reconnect on next request
            log.warning("[keepalive] ping failed: %s", exc)
from backend.routers import (
    dashboard, clients, schedule, visits, caregivers,
    auth, aggregator, timesheets, settings, billing,
    super_admin, documentation,
)
from backend.routers import (
    mobile_schedules,
    mobile_visits,
    mobile_coordinator,
    profile,
    tasks,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    env_name = os.getenv("ENV", "local").strip().lower()
    use_key_vault = os.getenv("USE_KEY_VAULT", "false").strip().lower() in {"1", "true", "yes", "on"}
    use_service_principal = env_name == "prod"
    print(
        f"[startup] Environment: {env_name} | "
        f"Service Principal: {'enabled' if use_service_principal else 'disabled'} | "
        f"Key Vault: {'enabled' if use_key_vault else 'disabled'}"
    )
    ok = test_connection()
    if ok:
        print("[startup] Database connection OK")
    else:
        print("[startup] WARNING: Database connection FAILED — check .env settings")

    keepalive_task = asyncio.create_task(_db_keepalive_loop())
    print(f"[startup] DB keepalive started (interval: {_KEEPALIVE_INTERVAL}s)")

    yield

    keepalive_task.cancel()
    print("[shutdown] SeriqCare backend stopped")


app = FastAPI(
    title="SeriqCare EVV API",
    description=(
        "PA-DHS EVV Vendor Spec v1.4 · ODP EVV Guidance v2.0 · "
        "Sandata aggregator integration"
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
# Include all local dev ports + allow any origin for the Flutter mobile app.
# In production, lock CORS_ORIGINS to specific domains.
_raw_origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000",
)
origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r".*",   # allows Flutter mobile app (no fixed origin)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.middleware("http")(api_access_log_middleware)

# ---------------------------------------------------------------------------
# Routers — Portal (web)
# ---------------------------------------------------------------------------
app.include_router(auth.router,        prefix="/api/auth",        tags=["Auth"])
app.include_router(dashboard.router,   prefix="/api/dashboard",   tags=["Dashboard"])
app.include_router(clients.router,     prefix="/api/clients",     tags=["Clients"])
app.include_router(schedule.router,    prefix="/api/schedule",    tags=["Schedule"])
app.include_router(visits.router,      prefix="/api/visits",      tags=["Visits"])
app.include_router(caregivers.router,  prefix="/api/caregivers",  tags=["Caregivers"])
app.include_router(aggregator.router,  prefix="/api/aggregator",  tags=["Aggregator"])
app.include_router(timesheets.router,  prefix="/api/timesheets",  tags=["Timesheets"])
app.include_router(settings.router,    prefix="/api/settings",    tags=["Settings"])
app.include_router(billing.router,     prefix="/api/billing",     tags=["Billing"])
app.include_router(super_admin.router,    prefix="/api/super-admin",    tags=["Super Admin"])
app.include_router(documentation.router, prefix="/api/documentation", tags=["Documentation"])

# ---------------------------------------------------------------------------
# Routers — Mobile (Flutter caregiver app)
# ---------------------------------------------------------------------------
app.include_router(mobile_schedules.router,   prefix="/api/schedules",   tags=["Mobile – Schedules"])
app.include_router(mobile_visits.router,      prefix="/api/visits",      tags=["Mobile – Visits"])
app.include_router(mobile_coordinator.router, prefix="/api/coordinator", tags=["Mobile – Coordinator"])
app.include_router(profile.router,            prefix="/api/profile",     tags=["Mobile – Profile"])
app.include_router(tasks.router,              prefix="/api/tasks",       tags=["Mobile – Tasks"])


# ---------------------------------------------------------------------------
# Root redirect
# ---------------------------------------------------------------------------
@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse(url="/docs")
