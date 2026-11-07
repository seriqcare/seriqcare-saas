from __future__ import annotations

import logging
import os
from datetime import datetime, tzinfo, timezone
from functools import lru_cache
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

log = logging.getLogger("seriqcare.timezone")

APP_TZ_KEY = os.getenv("APP_TIMEZONE", "America/New_York").strip() or "America/New_York"
SQLSERVER_TZ_NAME = os.getenv("SQLSERVER_TIMEZONE_NAME", "Eastern Standard Time").strip() or "Eastern Standard Time"


@lru_cache(maxsize=None)
def get_timezone(key: str) -> tzinfo:
    try:
        return ZoneInfo(key)
    except ZoneInfoNotFoundError:
        fallback = timezone.utc
        if key == APP_TZ_KEY:
            log.warning("Timezone data for %s is unavailable; falling back to UTC. Install tzdata for full DST support.", key)
        return fallback


EASTERN = get_timezone(APP_TZ_KEY)
UTC = get_timezone("UTC")

# SQL Server expression that returns configured local time with DST applied.
SQLSERVER_EASTERN_NOW_EXPR = f"CAST(SYSDATETIMEOFFSET() AT TIME ZONE '{SQLSERVER_TZ_NAME}' AS DATETIME2)"
SQLSERVER_LOCAL_DATE_EXPR = f"CAST({SQLSERVER_EASTERN_NOW_EXPR} AS DATE)"
SQLSERVER_LOCAL_WEEK_START_DATE_EXPR = (
    f"CAST(DATEADD(DAY, 1 - DATEPART(WEEKDAY, {SQLSERVER_EASTERN_NOW_EXPR}), {SQLSERVER_EASTERN_NOW_EXPR}) AS DATE)"
)


def now_eastern() -> datetime:
    """Timezone-aware current time in configured app timezone (DST-aware)."""
    return datetime.now(EASTERN)


def now_eastern_naive() -> datetime:
    """Naive local Eastern wall-clock time for DATETIME/DATETIME2 columns."""
    return now_eastern().replace(tzinfo=None)