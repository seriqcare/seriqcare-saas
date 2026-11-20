"""Live delivered-unit totals; never increment a cached balance on repeated reads.

Completed visits count regardless of payroll/aggregator approval. Effective EVV
times incorporate corrections; cancelled/open visits contribute nothing. Use the
service's configured minutes per unit, truncating incomplete units. A missing
visit authorization can resolve only to a single active matching authorization.
"""


def authorization_usage_join(*, include_unassigned=False):
    completed = """
        FROM care.visits usage_visit
        JOIN care.visit_evv usage_evv ON usage_evv.visit_id = usage_visit.id
        JOIN care.service_codes usage_service ON usage_service.id = usage_visit.service_code_id
        JOIN care.clients usage_client ON usage_client.id = usage_visit.client_id
            AND usage_client.agency_id = usage_visit.agency_id
        JOIN care.employees usage_employee ON usage_employee.id = usage_visit.employee_id
            AND usage_employee.agency_id = usage_visit.agency_id
        WHERE usage_visit.agency_id = sa.agency_id
          AND usage_visit.client_id = sa.client_id
          AND usage_visit.service_code_id = sa.service_code_id
          AND usage_visit.service_date BETWEEN sa.service_start_date AND sa.service_end_date
          AND usage_visit.visit_cancelled = 0
          AND COALESCE(usage_evv.adj_out_datetime, usage_evv.call_out_datetime)
              > COALESCE(usage_evv.adj_in_datetime, usage_evv.call_in_datetime)
    """
    other = """
        SELECT 1 FROM care.service_authorizations other_auth
        WHERE other_auth.agency_id = usage_visit.agency_id
          AND other_auth.client_id = usage_visit.client_id
          AND other_auth.service_code_id = usage_visit.service_code_id
          AND other_auth.is_active = 1 AND other_auth.id <> sa.id
          AND usage_visit.service_date BETWEEN other_auth.service_start_date AND other_auth.service_end_date
    """
    sql = f"""
        OUTER APPLY (
            SELECT COALESCE(SUM(FLOOR(
                DATEDIFF_BIG(SECOND,
                    COALESCE(usage_evv.adj_in_datetime, usage_evv.call_in_datetime),
                    COALESCE(usage_evv.adj_out_datetime, usage_evv.call_out_datetime))
                / 60.0 / NULLIF(usage_service.minutes_per_unit, 0)
            )), 0) AS used_units
            {completed}
              AND usage_service.minutes_per_unit > 0
              AND (usage_visit.service_authorization_id = sa.id
                OR (usage_visit.service_authorization_id IS NULL AND sa.is_active = 1
                    AND NOT EXISTS ({other})))
        ) auth_usage
    """
    if include_unassigned:
        sql += f"""
            OUTER APPLY (
                SELECT COUNT(*) AS unassigned_visits
                {completed}
                  AND usage_visit.service_authorization_id IS NULL AND sa.is_active = 1
                  AND EXISTS ({other})
            ) auth_unassigned
        """
    return sql
