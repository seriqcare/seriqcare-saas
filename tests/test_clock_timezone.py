import os
import unittest
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch

os.environ.setdefault('SECRET_KEY', 'test-only-clock-timezone-secret')
from backend.routers import mobile_schedules, mobile_visits, caregivers, profile, tasks
from backend.services.timezone import UTC, EASTERN
from backend.auth.dependencies import AgencyScope
from test_client_tenant_access import user


class ClockTimezoneTests(unittest.TestCase):
    def setUp(self):
        # November 21 in UTC is still November 20 for the agency.
        self.now = datetime(2026, 11, 21, 2, 15, tzinfo=UTC).astimezone(EASTERN)
        self.caregiver = user('caregiver', 4, 102)
        self.caregiver.is_active = True

    def schedule(self, day=date(2026, 11, 20)):
        return SimpleNamespace(id=55, client_id=10, client_name='Test Client',
            scheduled_start=datetime.combine(day, datetime.min.time()).replace(hour=21),
            scheduled_end=datetime.combine(day, datetime.min.time()).replace(hour=23),
            address='Test Address', hcpcs_code='S5130', status='Scheduled')

    def test_today_selects_the_eastern_date_after_utc_midnight(self):
        db = Mock()
        db.execute.return_value.fetchall.return_value = [self.schedule()]
        with patch.object(mobile_schedules, 'now_eastern', return_value=self.now):
            rows = mobile_schedules.get_today_schedules(self.caregiver, db)
        sql, params = db.execute.call_args.args
        self.assertEqual(params['from_d'], date(2026, 11, 20))
        self.assertEqual(params['to_d'], date(2026, 11, 20))
        self.assertEqual((params['agency_id'], params['emp_id']), (4, 102))
        self.assertEqual((rows[0].date_label, rows[0].start_time), ('Today', '9:00 PM'))

    def test_week_defaults_to_eastern_today_and_preserves_explicit_dates(self):
        db = Mock()
        db.execute.return_value.fetchall.return_value = [self.schedule(date(2026, 11, 22))]
        with patch.object(mobile_schedules, 'now_eastern', return_value=self.now):
            mobile_schedules.get_week_schedules(start_date=None, current_user=self.caregiver, db=db)
            self.assertEqual(db.execute.call_args.args[1]['from_d'], date(2026, 11, 20))
            rows = mobile_schedules.get_week_schedules(start_date=date(2026, 11, 22), current_user=self.caregiver, db=db)
        self.assertEqual(db.execute.call_args.args[1]['to_d'], date(2026, 11, 28))
        self.assertEqual(rows[0].date_label, 'Nov 22')

    def test_profile_tasks_and_visit_history_use_the_same_eastern_day(self):
        db = Mock()
        db.execute.return_value.fetchone.return_value = SimpleNamespace(cnt=1)
        with patch.object(profile, 'now_eastern', return_value=self.now):
            self.assertEqual(profile.get_my_profile(self.caregiver, db).schedule_count, 1)
        self.assertEqual(db.execute.call_args.args[1]['today'], date(2026, 11, 20))
        db.execute.return_value.fetchall.return_value = []
        with patch.object(mobile_visits, 'now_eastern', return_value=self.now):
            mobile_visits.get_visit_history(days=1, skip=0, limit=10, current_user=self.caregiver, db=db)
        self.assertEqual(db.execute.call_args.args[1]['since'], date(2026, 11, 19))
        with patch.object(tasks, 'now_eastern', return_value=self.now), \
             patch.object(tasks, '_get_schedule_with_access_check', return_value=SimpleNamespace(client_id=10)):
            tasks.get_tasks(schedule_id=55, current_user=self.caregiver, db=db)
        self.assertEqual(db.execute.call_args.args[1]['today'], date(2026, 11, 20))

    def test_caregiver_created_at_is_marked_utc_and_week_boundaries_use_eastern(self):
        db = Mock()
        row = SimpleNamespace(id=102, employee_code='EMP102', name='Test Caregiver', role='DSP', status='Active',
            hire_date='2026-11-20', created_at='2026-11-21T02:15:00', clients_assigned=0, visits_this_week=0, hours_this_week=0)
        db.execute.side_effect = [Mock(fetchone=lambda: SimpleNamespace(total=1)),
            Mock(fetchone=lambda: SimpleNamespace(total_caregivers=1, active=1, on_leave=0, inactive=0)),
            Mock(fetchone=lambda: SimpleNamespace(assigned_this_week=0, total_hours_this_week=0)),
            Mock(fetchall=lambda: [row])]
        with patch.object(caregivers, 'now_eastern', return_value=self.now):
            result = caregivers.get_caregivers(page=1, per_page=20, status='', search='', db=db, scope=AgencyScope(user(agency_id=4)))
        self.assertEqual(result.items[0].created_at, '2026-11-21T02:15:00Z')
        # UTC Monday morning is still Sunday in Eastern time.
        with patch.object(caregivers, 'now_eastern', return_value=datetime(2026, 11, 23, 2, tzinfo=UTC).astimezone(EASTERN)):
            self.assertEqual(caregivers._current_week_bounds(), (date(2026, 11, 16), date(2026, 11, 22)))

    def test_schedule_dates_roll_at_eastern_midnight_in_both_seasons(self):
        for instant in (datetime(2026, 11, 21, 5, tzinfo=UTC), datetime(2026, 7, 21, 4, tzinfo=UTC)):
            db = Mock()
            db.execute.return_value.fetchall.return_value = []
            for delta, expected_day in ((timedelta(seconds=-1), 20), (timedelta(), 21)):
                with patch.object(mobile_schedules, 'now_eastern', return_value=(instant + delta).astimezone(EASTERN)):
                    mobile_schedules.get_today_schedules(self.caregiver, db)
                self.assertEqual(db.execute.call_args.args[1]['from_d'].day, expected_day)
