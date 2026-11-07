"""
Shared transient-retry helpers for SQLAlchemy database operations.

Usage (sync endpoint):
    from backend.services.db_retry import run_with_retry

    result = run_with_retry(db, lambda: db.query(User).filter(...).first())

Usage (async endpoint):
    from backend.services.db_retry import run_with_retry_async

    result = await run_with_retry_async(db, lambda: db.query(User).filter(...).first())

Only retries on genuine transient network/transport failures identified by
SQLSTATE code. Permission errors, syntax errors, and constraint violations
are never retried — they raise immediately.
"""
from __future__ import annotations

import asyncio
import time
from typing import Callable, TypeVar

from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

T = TypeVar("T")

# ---------------------------------------------------------------------------
# Transient SQLSTATE codes for SQL Server / ODBC
#   08S01 — communication link failure
#   08001 — unable to connect to data source
#   08007 — connection failure during transaction
#   HYT00 — query timeout expired
#   HYT01 — connection timeout expired
# ---------------------------------------------------------------------------
_TRANSIENT_SQLSTATES = {"08S01", "08001", "08007", "HYT00", "HYT01"}


def _is_transient(error: Exception) -> bool:
    """Return True only for recoverable network/transport errors."""
    if not isinstance(error, OperationalError):
        return False
    orig = getattr(error, "orig", None)
    args = getattr(orig, "args", None)
    if not args:
        return False
    first = args[0]
    return isinstance(first, str) and first in _TRANSIENT_SQLSTATES


def run_with_retry(
    db: Session,
    fn: Callable[[], T],
    retries: int = 2,
    delay: float = 0.15,
) -> T:
    """
    Run fn() inside a sync context, retrying up to `retries` times on
    transient DB errors. Rolls back the session before each retry so
    the session is in a clean state.

    Args:
        db:      The active SQLAlchemy session.
        fn:      Zero-argument callable that performs the DB operation.
        retries: Maximum number of retry attempts (default 2 = 3 total tries).
        delay:   Seconds to wait between attempts (default 0.15s).

    Raises:
        The original exception if all retries are exhausted or the error
        is not a transient network failure.
    """
    for attempt in range(retries + 1):
        try:
            return fn()
        except Exception as exc:
            if attempt >= retries or not _is_transient(exc):
                raise
            db.rollback()
            time.sleep(delay)


async def run_with_retry_async(
    db: Session,
    fn: Callable[[], T],
    retries: int = 2,
    delay: float = 0.15,
) -> T:
    """
    Async version of run_with_retry — use in async FastAPI endpoints to
    avoid blocking the event loop during the retry delay.

    fn() itself is still synchronous (SQLAlchemy Core/ORM is sync) — only
    the sleep between retries is non-blocking.

    Args:
        db:      The active SQLAlchemy session.
        fn:      Zero-argument callable that performs the DB operation.
        retries: Maximum number of retry attempts (default 2 = 3 total tries).
        delay:   Seconds to wait between attempts (default 0.15s).

    Raises:
        The original exception if all retries are exhausted or the error
        is not a transient network failure.
    """
    for attempt in range(retries + 1):
        try:
            return fn()
        except Exception as exc:
            if attempt >= retries or not _is_transient(exc):
                raise
            db.rollback()
            await asyncio.sleep(delay)
