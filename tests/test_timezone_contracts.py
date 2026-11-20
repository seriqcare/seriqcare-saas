import os
import unittest
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch

os.environ.setdefault('SECRET_KEY', 'test-only-timezone-secret')
from fastapi.encoders import jsonable_encoder
from backend.routers import schedule, super_admin
from backend.services import timezone as app_time
from backend.auth.dependencies import AgencyScope
from test_client_tenant_access import user


class TimezoneContractTests(unittest.TestCase):
    def test_utc_audit_marker_preserves_the_recorded_instant(self):
        self.assertEqual(app_time.utc_iso(datetime(2026, 11, 20, 22, 46)), '2026-11-20T22:46:00Z')
        self.assertEqual(app_time.utc_iso(datetime.fromisoformat('2026-11-20T17:46:00-05:00')), '2026-11-20T22:46:00Z')
        self.assertIsNone(app_time.utc_iso(None))

    def test_schedule_input_normalizes_to_eastern_wall_time_without_shifting_naive_values(self):
        for value in ('2026-11-20T09:00:00', '2026-11-20T09:00:00-05:00', '2026-11-20T14:00:00Z'):
            self.assertEqual(schedule._parse_schedule_datetime(value), datetime(2026, 11, 20, 9))
        self.assertEqual(schedule._parse_schedule_datetime('2026-07-20T13:00:00Z'), datetime(2026, 7, 20, 9))

    def test_schedule_output_identifies_the_correct_seasonal_offset(self):
        self.assertEqual(app_time.eastern_iso('2026-11-20 09:00:00'), '2026-11-20T09:00:00-05:00')
        self.assertEqual(app_time.eastern_iso('2026-07-20 09:00:00'), '2026-07-20T09:00:00-04:00')
        self.assertEqual(app_time.eastern_iso('2026-11-20T14:00:00Z'), '2026-11-20T09:00:00-05:00')

    def test_weekly_schedule_api_preserves_stored_eastern_time_and_adds_offset(self):
        row = SimpleNamespace(id=1, client_id=1, client_name='Test Client', employee_id=2,
            employee_name='Test Caregiver', service_code='S5130', service_type='Test service',
            scheduled_start='2026-11-20 09:00:00', scheduled_end='2026-11-20 11:00:00',
            status='Scheduled', notes=None, day_of_week_sql=6)
        db = Mock()
        db.execute.side_effect = [Mock(fetchall=lambda: [row]), Mock(fetchone=lambda: SimpleNamespace(pending_clock_out=0))]
        result = schedule.get_week_schedule(date='2026-11-20', db=db, scope=AgencyScope(user()))
        self.assertEqual(result.entries[0].scheduled_start, '2026-11-20T09:00:00-05:00')
        self.assertEqual(result.entries[0].scheduled_end, '2026-11-20T11:00:00-05:00')

    def test_eastern_day_boundaries_use_23_and_25_hour_dst_days(self):
        for day, expected_hours in ((datetime(2026, 3, 8, 12), 23), (datetime(2026, 11, 1, 12), 25)):
            with patch.object(app_time, 'now_eastern', return_value=day.replace(tzinfo=app_time.EASTERN)):
                start, end = app_time.eastern_day_utc_bounds()
            self.assertEqual(end - start, timedelta(hours=expected_hours))
            self.assertIsNone(start.tzinfo)

    def test_overview_uses_eastern_today_boundaries_for_utc_audit_rows(self):
        event = SimpleNamespace(created_at=datetime(2026, 11, 20, 22, 46))
        event._mapping = {'id': 1, 'created_at': event.created_at, 'action': 'LOGIN'}
        db = Mock()
        db.execute.side_effect = [
            Mock(fetchone=lambda: SimpleNamespace(total_agencies=4, active_agencies=4, total_users=17, visits_today=0)),
            Mock(fetchone=lambda: SimpleNamespace(logins=1, failed=0, clock_ins=0)),
            Mock(fetchall=lambda: [event]),
        ]
        start, end = datetime(2026, 11, 20, 5), datetime(2026, 11, 21, 5)
        with patch.object(super_admin, 'eastern_day_utc_bounds', return_value=(start, end)):
            output = jsonable_encoder(super_admin.get_overview(current_user=None, db=db))
        self.assertEqual(output['recent_events'][0]['created_at'], '2026-11-20T22:46:00Z')
        sql, params = db.execute.call_args_list[1].args
        self.assertIn('created_at < :day_end', str(sql))
        self.assertEqual(params, {'day_start': start, 'day_end': end})

    def test_audit_and_api_log_endpoints_return_unambiguous_timestamps(self):
        event = SimpleNamespace(created_at=datetime(2026, 11, 20, 22, 46))
        event._mapping = {'id': 1, 'created_at': event.created_at}
        for method, filters in ((super_admin.get_audit_log, {'action': None, 'agency_id': None}),
                                (super_admin.get_api_access_log, {'status_code': None, 'user_id': None})):
            db = Mock()
            db.execute.side_effect = [Mock(fetchall=lambda: [event]), Mock(fetchone=lambda: (1,))]
            output = jsonable_encoder(method(**filters, limit=100, offset=0, current_user=None, db=db))
            self.assertEqual(output['rows'][0]['created_at'], '2026-11-20T22:46:00Z')
