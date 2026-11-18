def visit_edit_locked_sql() -> str:
    """Aliases v and vi must be the visit and its integration status."""
    return """(vi.sandata_status IN ('Accepted','Submitted','Pending')
        OR vi.hhax_status IN ('Accepted','Submitted','Pending')
        OR EXISTS (SELECT 1 FROM care.aggregator_submissions submitted
            WHERE submitted.visit_id=v.id AND submitted.status IN ('Accepted','Submitted','Pending')))"""
