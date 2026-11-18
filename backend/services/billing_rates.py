"""Effective-dated rates: always match the visit agency, never shared defaults."""
RATE_JOIN = """
    OUTER APPLY (
        SELECT TOP 1 sr.rate_per_unit
        FROM care.agency_service_rates sr
        WHERE sr.agency_id = v.agency_id
          AND sr.service_code_id = v.service_code_id
          AND sr.effective_from <= v.service_date
          AND (sr.effective_to IS NULL OR sr.effective_to >= v.service_date)
        ORDER BY sr.effective_from DESC, sr.id DESC
    ) rate
"""


def ensure_service_rates_table(engine):
    from pathlib import Path
    from sqlalchemy import text
    with engine.begin() as conn:
        conn.execute(text((Path(__file__).resolve().parents[2] / 'sql' / 'agency_service_rates.sql').read_text()))
