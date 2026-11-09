'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth-context';
import { useLoginFlow } from '@/components/use-login-flow';

type TabId = 'schedule' | 'clock' | 'tasks' | 'profile';

type ActionState = 'idle' | 'gps' | 'saving' | 'done' | 'error';

interface ScheduleItem {
  schedule_id: number;
  client_name: string;
  date_label: string;
  start_time: string;
  end_time: string;
  address: string;
  service_code: string;
  status: string;
}

interface ActiveVisit {
  visit_id: number;
  schedule_id: number;
  client_name: string;
  clocked_in: string;
}

interface HistoryItem {
  visit_id: number;
  client_name: string;
  service_date: string;
  start_time: string | null;
  end_time: string | null;
  evv_status: string;
  service_code: string;
}

interface TaskItem {
  task_id: number;
  client_id: number;
  title: string;
  description: string | null;
  specific_time: string | null;
  recurrence_text: string | null;
  sort_order: number;
  is_completed: boolean;
  completed_at: string | null;
}

interface ProfileItem {
  username: string;
  display_name: string;
  role: string;
  employee_id: number | null;
  agency_id: number | null;
  schedule_count: number;
  status: string;
}

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by this browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });
  });
}

function useElapsed(isoStart: string | null) {
  const [elapsed, setElapsed] = useState('0m elapsed');

  useEffect(() => {
    if (!isoStart) {
      setElapsed('Select a schedule and tap Clock In');
      return;
    }

    const startMs = new Date(isoStart).getTime();

    const update = () => {
      const diff = Math.max(0, Date.now() - startMs);
      const minutes = Math.floor(diff / 60000);
      if (minutes < 60) {
        setElapsed(`${minutes}m elapsed`);
        return;
      }
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      setElapsed(`${h}h ${String(m).padStart(2, '0')}m elapsed`);
    };

    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [isoStart]);

  return elapsed;
}

export default function ClockPage() {
  const { user, apiFetch, signOut } = useAuth();

  const [activeTab, setActiveTab] = useState<TabId>('schedule');
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [profile, setProfile] = useState<ProfileItem | null>(null);

  const [loading, setLoading] = useState(true);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [tasksSaving, setTasksSaving] = useState(false);

  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null);
  const [activeVisit, setActiveVisit] = useState<ActiveVisit | null>(null);
  const [taskSelection, setTaskSelection] = useState<number[]>([]);

  const [actionState, setActionState] = useState<ActionState>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [tasksError, setTasksError] = useState('');
  const [profileError, setProfileError] = useState('');
  const [snack, setSnack] = useState('');

  const selectedSchedule = useMemo(
    () => schedules.find((s) => s.schedule_id === selectedScheduleId) ?? null,
    [schedules, selectedScheduleId],
  );

  const elapsedText = useElapsed(activeVisit?.clocked_in ?? null);

  const persistActiveVisit = useCallback((visit: ActiveVisit | null) => {
    setActiveVisit(visit);
    try {
      if (visit) {
        sessionStorage.setItem('seriqcare_active_visit', JSON.stringify(visit));
      } else {
        sessionStorage.removeItem('seriqcare_active_visit');
      }
    } catch {
      // ignore session storage errors
    }
  }, []);

  const showSnack = useCallback((msg: string) => {
    setSnack(msg);
    setTimeout(() => setSnack(''), 2400);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, hRes] = await Promise.all([
        apiFetch('/api/schedules/today'),
        apiFetch('/api/visits/history?days=1&limit=10'),
      ]);

      if (sRes.ok) {
        const rows: ScheduleItem[] = await sRes.json();
        setSchedules(rows);
      }
      if (hRes.ok) {
        const rows: HistoryItem[] = await hRes.json();
        setHistory(rows);
      }
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  const loadTasks = useCallback(async () => {
    if (!selectedScheduleId) {
      setTasks([]);
      setTaskSelection([]);
      return;
    }

    setTasksLoading(true);
    setTasksError('');
    try {
      const res = await apiFetch(`/api/tasks/?schedule_id=${selectedScheduleId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setTasksError(body.detail ?? 'Could not load tasks.');
        setTasks([]);
        return;
      }
      const rows: TaskItem[] = await res.json();
      setTasks(rows);
      setTaskSelection([]);
    } catch {
      setTasksError('Network error loading tasks.');
      setTasks([]);
    } finally {
      setTasksLoading(false);
    }
  }, [apiFetch, selectedScheduleId]);

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    setProfileError('');
    try {
      const res = await apiFetch('/api/profile/me');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setProfileError(body.detail ?? 'Could not load profile.');
        setProfile(null);
        return;
      }
      const row: ProfileItem = await res.json();
      setProfile(row);
    } catch {
      setProfileError('Network error loading profile.');
      setProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    if (!user) return;
    void loadData();
  }, [loadData, user]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('seriqcare_active_visit');
      if (raw) {
        const visit = JSON.parse(raw) as ActiveVisit;
        setActiveVisit(visit);
        setSelectedScheduleId(visit.schedule_id);
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'tasks') {
      void loadTasks();
    } else if (activeTab === 'profile') {
      void loadProfile();
    }
  }, [activeTab, loadProfile, loadTasks]);

  const clockActionDisabled = actionState === 'gps' || actionState === 'saving';

  async function handleClockIn() {
    if (!selectedSchedule) {
      showSnack('Select a schedule first');
      setActiveTab('schedule');
      return;
    }

    setActionState('gps');
    setStatusMessage('Requesting location access...');

    let pos: GeolocationPosition;
    try {
      pos = await getPosition();
    } catch (err: unknown) {
      setActionState('error');
      setStatusMessage(err instanceof Error ? err.message : 'Could not get location.');
      return;
    }

    setActionState('saving');
    setStatusMessage('Recording clock in...');

    try {
      const res = await apiFetch('/api/visits/clock-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schedule_id: selectedSchedule.schedule_id,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          timestamp: new Date().toISOString(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionState('error');
        setStatusMessage(data.detail ?? 'Clock in failed.');
        return;
      }

      persistActiveVisit({
        visit_id: data.visit_id,
        schedule_id: selectedSchedule.schedule_id,
        client_name: selectedSchedule.client_name,
        clocked_in: new Date().toISOString(),
      });
      setActionState('done');
      setStatusMessage(`Clocked In recorded for ${selectedSchedule.client_name}`);
      showSnack('Clocked In successful');
      void loadData();
      setActiveTab('clock');
    } catch {
      setActionState('error');
      setStatusMessage('Network error. Please retry.');
    }
  }

  async function handleClockOut() {
    if (!activeVisit) return;

    setActionState('gps');
    setStatusMessage('Requesting location access...');

    let pos: GeolocationPosition;
    try {
      pos = await getPosition();
    } catch (err: unknown) {
      setActionState('error');
      setStatusMessage(err instanceof Error ? err.message : 'Could not get location.');
      return;
    }

    setActionState('saving');
    setStatusMessage('Recording clock out...');

    try {
      const res = await apiFetch(`/api/visits/${activeVisit.visit_id}/clock-out`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          timestamp: new Date().toISOString(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionState('error');
        setStatusMessage(data.detail ?? 'Clock out failed.');
        return;
      }

      setActionState('done');
      setStatusMessage(`Clocked Out recorded for ${activeVisit.client_name}`);
      persistActiveVisit(null);
      setTaskSelection([]);
      showSnack('Clocked Out successful');
      void loadData();
    } catch {
      setActionState('error');
      setStatusMessage('Network error. Please retry.');
    }
  }

  async function handleCompleteTasks() {
    if (!selectedScheduleId || taskSelection.length === 0) return;

    setTasksSaving(true);
    setTasksError('');
    try {
      const res = await apiFetch('/api/tasks/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schedule_id: selectedScheduleId,
          task_ids: taskSelection,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTasksError(body.detail ?? 'Could not complete selected tasks.');
        return;
      }
      showSnack(`Complete ${taskSelection.length} selected tasks`);
      await loadTasks();
    } catch {
      setTasksError('Network error while saving tasks.');
    } finally {
      setTasksSaving(false);
    }
  }

  if (!user) return <MobileLoginScreen />;

  const lastHistory = history[0] ?? null;

  return (
    <div style={{
      minHeight: '100dvh',
      width: '100%',
      maxWidth: 480,
      margin: '0 auto',
      background: '#e6e9ef',
      fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, sans-serif',
      color: '#233046',
      position: 'relative',
    }}>
      <div style={{ background: '#fff', padding: '18px 18px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 24, lineHeight: 1.1, color: '#1f2d45', fontWeight: 700 }}>Seriq<span style={{ color: '#2f6ea8' }}>Care</span></div>
      </div>

      <div style={{ padding: '20px 16px 110px' }}>
        {activeTab === 'schedule' && (
          <>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>Good evening, {user.display_name ?? user.username}</div>
              <div style={{ fontSize: 14, color: '#65728b' }}>Here are your available schedules for today.</div>
            </div>

            <div style={{
              background: '#fff', border: '1px solid #ccd5e2', borderRadius: 18, padding: '14px 16px',
              fontSize: 14, color: '#30343b', marginBottom: 16,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <IconInfo />
              Select a schedule before clocking in.
            </div>

            {loading ? (
              <Panel>Loading schedules...</Panel>
            ) : schedules.length === 0 ? (
              <Panel>No schedules available for today.</Panel>
            ) : (
              schedules.map((s) => {
                const statusText = (s.status || 'Scheduled').trim();
                const status = statusText.toLowerCase();
                const isScheduled = status === 'scheduled';
                const isCompleted = status === 'completed';
                const isCancelled = status === 'cancelled';
                const isSelected = selectedScheduleId === s.schedule_id;
                return (
                  <div key={s.schedule_id} style={{
                    background: '#fff', borderRadius: 18, padding: 18, marginBottom: 14,
                    border: isSelected ? '2px solid #2f6ea8' : '1px solid #ced7e2',
                    boxShadow: '0 2px 6px rgba(25, 32, 46, 0.08)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ fontSize: 16, fontWeight: 800 }}>{s.client_name}</div>
                      <div style={{
                        background: isScheduled ? '#dff3e8' : isCompleted ? '#ecf0f6' : '#fdf0f0',
                        color: isScheduled ? '#11804f' : isCompleted ? '#6a768f' : '#c2332f',
                        padding: '6px 10px',
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 700,
                      }}>
                        {statusText || 'Scheduled'}
                      </div>
                    </div>
                    <div style={{ marginTop: 14, color: '#5d6b84', fontSize: 14, lineHeight: 1.5 }}>
                      <div>Today</div>
                      <div>{s.start_time} - {s.end_time}</div>
                      <div>{s.address}</div>
                    </div>
                    {!isScheduled && (
                      <div style={{ marginTop: 12, color: '#6b778f', fontSize: 13 }}>
                        {isCompleted
                          ? 'This shift is already completed.'
                          : isCancelled
                            ? 'This shift was cancelled.'
                            : 'This shift cannot be selected for clock in.'}
                      </div>
                    )}
                    <button
                      onClick={() => {
                        if (!isScheduled) {
                          setStatusMessage(
                            isCompleted
                              ? `Shift for ${s.client_name} is already completed.`
                              : `Shift for ${s.client_name} is not available for clock in.`,
                          );
                          return;
                        }
                        setSelectedScheduleId(s.schedule_id);
                        setStatusMessage('Schedule selected. Go to Clock tab to clock in.');
                        setActiveTab('clock');
                      }}
                      disabled={!isScheduled}
                      style={{
                        marginTop: 16,
                        width: '100%',
                        border: 'none',
                        borderRadius: 999,
                        background: isScheduled ? '#2f6ea8' : '#d7dbe3',
                        color: '#fff',
                        fontSize: 15,
                        fontWeight: 700,
                        padding: '14px 12px',
                        cursor: isScheduled ? 'pointer' : 'default',
                      }}
                    >
                      {isScheduled
                        ? isSelected
                          ? 'Selected schedule'
                          : 'Use this schedule'
                        : isCompleted
                          ? 'Completed shift'
                          : 'Unavailable'}
                    </button>
                  </div>
                );
              })
            )}
          </>
        )}

        {activeTab === 'clock' && (
          <>
            <div style={{
              background: activeVisit ? '#d4efe2' : '#e0e5ee',
              border: `1px solid ${activeVisit ? '#7fd9b0' : '#c3ccd9'}`,
              borderRadius: 22,
              padding: '28px 16px',
              textAlign: 'center',
              marginBottom: 14,
            }}>
              <div style={{
                width: 86,
                height: 86,
                borderRadius: 999,
                margin: '0 auto 12px',
                background: activeVisit ? '#17b56d' : '#c8ceda',
                display: 'grid',
                placeItems: 'center',
              }}>
                <IconStatusRing />
              </div>
              <div style={{ fontSize: 34, fontWeight: 800, color: activeVisit ? '#13a764' : '#65728b' }}>
                {activeVisit ? 'Clocked In' : 'Clocked Out'}
              </div>
              <div style={{ marginTop: 6, fontSize: 15, color: activeVisit ? '#22b070' : '#73809a' }}>{elapsedText}</div>
            </div>

            <div style={{ background: '#fff', borderRadius: 22, padding: 18, border: '1px solid #ccd5e2', marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#2f6ea8' }}>Active Schedule</div>
                <button onClick={() => setActiveTab('schedule')} style={{ border: 'none', background: 'none', color: '#2f6ea8', fontSize: 15, cursor: 'pointer' }}>Change</button>
              </div>
              <div style={{ borderTop: '1px solid #d3dbe7', paddingTop: 12 }}>
                {selectedSchedule ? (
                  <>
                    <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>{selectedSchedule.client_name}</div>
                    <div style={{ color: '#66758e', fontSize: 14, lineHeight: 1.55 }}>
                      <div>{selectedSchedule.start_time} - {selectedSchedule.end_time}</div>
                      <div>{selectedSchedule.address}</div>
                    </div>
                  </>
                ) : (
                  <div style={{ color: '#e38900', fontSize: 20, fontWeight: 700 }}>No schedule selected</div>
                )}
              </div>
            </div>

            <button
              onClick={handleClockIn}
              disabled={clockActionDisabled || !!activeVisit || !selectedSchedule}
              style={{
                width: '100%',
                borderRadius: 22,
                border: 'none',
                padding: '18px 14px',
                fontSize: 34,
                fontWeight: 800,
                background: clockActionDisabled || !!activeVisit || !selectedSchedule ? '#9ad8bc' : '#17b56d',
                color: '#fff',
                marginBottom: 12,
                cursor: clockActionDisabled || !!activeVisit || !selectedSchedule ? 'default' : 'pointer',
              }}
            >
              {actionState === 'gps' ? 'Locating...' : actionState === 'saving' ? 'Saving...' : activeVisit ? 'Clocked In' : 'Clock In'}
            </button>

            <button
              onClick={handleClockOut}
              disabled={clockActionDisabled || !activeVisit}
              style={{
                width: '100%',
                borderRadius: 22,
                border: `2px solid ${clockActionDisabled || !activeVisit ? '#b7bfcf' : '#f03b2f'}`,
                padding: '18px 14px',
                fontSize: 34,
                fontWeight: 800,
                background: '#fff',
                color: clockActionDisabled || !activeVisit ? '#9aa2b2' : '#e13227',
                marginBottom: 10,
                cursor: clockActionDisabled || !activeVisit ? 'default' : 'pointer',
              }}
            >
              Clock Out
            </button>

            <div style={{ textAlign: 'center', fontSize: 18, color: '#66758e', marginBottom: 14 }}>
              {statusMessage || 'Ready for clock action'}
            </div>

            <div style={{ background: '#fff', borderRadius: 22, padding: 18, border: '1px solid #ccd5e2' }}>
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 10 }}>Last Event</div>
              {lastHistory ? (
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: 8, fontSize: 18 }}>
                  <div style={{ color: '#67768f', fontWeight: 700 }}>User</div>
                  <div>{user.display_name ?? user.username}</div>
                  <div style={{ color: '#67768f', fontWeight: 700 }}>Action</div>
                  <div>{lastHistory.end_time ? 'Clocked Out' : 'Clocked In'}</div>
                  <div style={{ color: '#67768f', fontWeight: 700 }}>Time</div>
                  <div>{lastHistory.service_date}</div>
                </div>
              ) : (
                <div style={{ color: '#67768f' }}>No event yet today.</div>
              )}
            </div>
          </>
        )}

        {activeTab === 'tasks' && (
          <>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 18, fontWeight: 800 }}>
                {selectedSchedule ? `${selectedSchedule.client_name} - Personal Care Plan` : 'Select a schedule first'}
              </div>
              <div style={{ color: '#65728b', fontSize: 14, marginTop: 4 }}>Care plan tasks</div>
            </div>

            {!selectedSchedule ? (
              <Panel>Pick a schedule from Schedule tab.</Panel>
            ) : tasksLoading ? (
              <Panel>Loading tasks...</Panel>
            ) : tasksError ? (
              <Panel>{tasksError}</Panel>
            ) : tasks.length === 0 ? (
              <Panel>No tasks assigned to this schedule.</Panel>
            ) : (
              <>
                {tasks.map((task) => {
                  const checked = task.is_completed || taskSelection.includes(task.task_id);
                  return (
                    <div key={task.task_id} style={{
                      background: '#fff',
                      borderRadius: 22,
                      border: '1px solid #ccd5e2',
                      padding: '14px 14px 12px',
                      marginBottom: 12,
                    }}>
                      <label style={{ display: 'grid', gridTemplateColumns: '34px 1fr', columnGap: 10, alignItems: 'start' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={task.is_completed || tasksSaving}
                          onChange={(e) => {
                            const nextChecked = e.target.checked;
                            setTaskSelection((prev) => nextChecked
                              ? Array.from(new Set([...prev, task.task_id]))
                              : prev.filter((id) => id !== task.task_id));
                          }}
                          style={{ width: 24, height: 24, marginTop: 4 }}
                        />
                        <div>
                          <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 2 }}>{task.title}</div>
                          {task.description && (
                            <div style={{ fontSize: 14, color: '#66758e', lineHeight: 1.4 }}>{task.description}</div>
                          )}
                          <div style={{ marginTop: 6, color: '#97a2b7', fontSize: 13 }}>
                            {task.specific_time ?? 'No specific time'} - {task.recurrence_text ?? 'No recurrence'}
                          </div>
                        </div>
                      </label>
                    </div>
                  );
                })}

                <button
                  onClick={handleCompleteTasks}
                  disabled={tasksSaving || taskSelection.length === 0}
                  style={{
                    width: '100%',
                    border: 'none',
                    borderRadius: 22,
                    background: tasksSaving || taskSelection.length === 0 ? '#9bb8d7' : '#2f6ea8',
                    color: '#fff',
                    fontSize: 15,
                    fontWeight: 700,
                    padding: '16px 10px',
                    cursor: tasksSaving || taskSelection.length === 0 ? 'default' : 'pointer',
                  }}
                >
                  {tasksSaving ? 'Saving...' : `Complete ${taskSelection.length} selected tasks`}
                </button>
              </>
            )}
          </>
        )}

        {activeTab === 'profile' && (
          <>
            {profileLoading ? (
              <Panel>Loading profile...</Panel>
            ) : profileError ? (
              <Panel>{profileError}</Panel>
            ) : profile ? (
              <>
                <div style={{ background: '#fff', borderRadius: 22, border: '1px solid #ccd5e2', padding: 18, display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}>
                  <div style={{ width: 66, height: 66, borderRadius: 999, background: '#d8e2ee', color: '#2f6ea8', display: 'grid', placeItems: 'center', fontSize: 34, fontWeight: 700 }}>
                    {(profile.display_name ?? profile.username).charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 800 }}>{profile.display_name}</div>
                    <div style={{ fontSize: 14, color: '#65728b' }}>Logged in {profile.role}</div>
                  </div>
                </div>

                <ProfileCard
                  title="Profile Summary"
                  rows={[
                    ['Username', profile.username],
                    ['Today schedules', String(profile.schedule_count)],
                    ['Role', profile.role.charAt(0).toUpperCase() + profile.role.slice(1)],
                    ['Status', profile.status],
                  ]}
                />

                <ProfileCard
                  title="App Info"
                  rows={[
                    ['App name', 'SeriqCare'],
                    ['Version', '1.0.0 (1)'],
                  ]}
                />

                <button
                  onClick={signOut}
                  style={{
                    width: '100%',
                    borderRadius: 999,
                    background: '#fff',
                    border: '2px solid #7f8a9f',
                    color: '#2f6ea8',
                    fontSize: 16,
                    fontWeight: 700,
                    padding: '12px 14px',
                    cursor: 'pointer',
                  }}
                >
                  Logout
                </button>
              </>
            ) : (
              <Panel>No profile available.</Panel>
            )}
          </>
        )}
      </div>

      {snack && (
        <div style={{
          position: 'fixed',
          left: '50%',
          bottom: 100,
          transform: 'translateX(-50%)',
          width: 'min(450px, calc(100vw - 24px))',
          background: '#2f333c',
          color: '#fff',
          padding: '12px 14px',
          borderRadius: 4,
          fontSize: 16,
          fontWeight: 500,
          zIndex: 40,
        }}>
          {snack}
        </div>
      )}

      <div style={{
        position: 'fixed',
        bottom: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(480px, 100vw)',
        background: '#e7ebf2',
        borderTop: '1px solid #d4dbe7',
        padding: '8px 8px calc(8px + env(safe-area-inset-bottom))',
        zIndex: 35,
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          <BottomTab label="Schedule" icon={<IconCalendar />} active={activeTab === 'schedule'} onPress={() => setActiveTab('schedule')} />
          <BottomTab label="Clock" icon={<IconClock />} active={activeTab === 'clock'} onPress={() => setActiveTab('clock')} />
          <BottomTab label="Tasks" icon={<IconChecklist />} active={activeTab === 'tasks'} onPress={() => setActiveTab('tasks')} />
          <BottomTab label="Profile" icon={<IconUser />} active={activeTab === 'profile'} onPress={() => setActiveTab('profile')} />
        </div>
      </div>
    </div>
  );
}

function BottomTab({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <button
      onClick={onPress}
      style={{
        border: 'none',
        borderRadius: 999,
        padding: '8px 6px',
        background: active ? '#d2e0f6' : 'transparent',
        color: '#2f6ea8',
        fontSize: 12,
        fontWeight: active ? 700 : 600,
        cursor: 'pointer',
      }}
    >
      <div style={{ lineHeight: 1, marginBottom: 2 }}>{icon}</div>
      <div>{label}</div>
    </button>
  );
}

function IconCalendar() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 16 14" />
    </svg>
  );
}

function IconChecklist() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 6 11 8 15 4" />
      <polyline points="9 12 11 14 15 10" />
      <line x1="17" y1="6" x2="21" y2="6" />
      <line x1="17" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function IconUser() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function IconInfo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2f6ea8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function IconStatusRing() {
  return (
    <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="10" opacity="0.35" />
    </svg>
  );
}

function IconLock() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function IconEye() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconEyeOff() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.9 10.9 0 0 1 12 19C5 19 1 12 1 12a21.7 21.7 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A10.9 10.9 0 0 1 12 4c7 0 11 8 11 8a21.8 21.8 0 0 1-3.22 4.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #ccd5e2',
      borderRadius: 18,
      padding: '18px',
      color: '#5f6d86',
      fontSize: 14,
      textAlign: 'center',
    }}>
      {children}
    </div>
  );
}

function ProfileCard({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div style={{ background: '#fff', borderRadius: 22, border: '1px solid #ccd5e2', padding: 18, marginBottom: 14 }}>
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 10, columnGap: 10, fontSize: 14 }}>
        {rows.map(([k, v]) => (
          <Row key={k} label={k} value={v} />
        ))}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <div style={{ color: '#67768f', fontWeight: 700 }}>{label}</div>
      <div style={{ color: '#27344a', textAlign: 'left' }}>{value}</div>
    </>
  );
}

function MobileLoginScreen() {
  const { isLoading } = useAuth();
  const { phase, submit } = useLoginFlow();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const busy = phase !== 'idle';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !username.trim() || !password) return;
    setError('');
    const result = await submit(username.trim(), password);
    if (!result) return;
    if (!result.ok) setError(result.error);
  };

  if (isLoading) {
    return (
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#e6e9ef' }}>
        <div style={{ color: '#6d7990' }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100dvh',
      background: '#e6e9ef',
      fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, sans-serif',
      padding: '20px 16px 32px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-start',
    }}>
      <div style={{ width: '100%', maxWidth: 420, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 18, marginTop: 32 }}>
          <img src="/logo.png" alt="SeriqCare" width={88} height={88} style={{ borderRadius: 2 }} />
          <div style={{ fontSize: 28, fontWeight: 300, color: '#1f2d45', marginTop: 8 }}>Seriq<span style={{ color: '#2f6ea8' }}>Care</span></div>
          <div style={{ marginTop: 10, color: '#66758e', fontSize: 14 }}>Sign in to view your schedule and clock in or out.</div>
        </div>

        <form onSubmit={handleSubmit} style={{ background: '#fff', borderRadius: 20, border: '1px solid #cfd7e2', padding: 16, boxShadow: '0 2px 6px rgba(33, 43, 61, 0.1)' }}>
          <InputField icon={<IconUser />} placeholder="Username" value={username} onChange={setUsername} />
          <div style={{ height: 12 }} />
          <InputField icon={<IconLock />} placeholder="Password" type={showPw ? 'text' : 'password'} value={password} onChange={setPassword} endAdornment={
            <button type="button" onClick={() => setShowPw((v) => !v)} style={{ border: 'none', background: 'none', color: '#556', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
              {showPw ? <IconEyeOff /> : <IconEye />}
            </button>
          } />

          {error && (
            <div style={{ marginTop: 10, color: '#d23830', fontSize: 14, fontWeight: 600 }}>
              {error}
            </div>
          )}
          {phase === 'connecting' && (
            <div role="status" style={{ marginTop: 10 }}>Connecting… Waking the server and database may take a couple of minutes.</div>
          )}

          <button
            type="submit"
            disabled={busy || !username.trim() || !password}
            style={{
              marginTop: 14,
              width: '100%',
              border: 'none',
              borderRadius: 20,
              padding: '14px 12px',
              background: busy || !username.trim() || !password ? '#9bb8d7' : '#2f6ea8',
              color: '#fff',
              fontSize: 16,
              fontWeight: 700,
              cursor: busy || !username.trim() || !password ? 'default' : 'pointer',
            }}
          >
            {phase === 'connecting' ? 'Connecting…' : phase === 'signing-in' ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

function InputField({
  icon,
  placeholder,
  type = 'text',
  value,
  onChange,
  endAdornment,
}: {
  icon: React.ReactNode;
  placeholder: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  endAdornment?: React.ReactNode;
}) {
  return (
    <div style={{
      border: '1px solid #c4cedc',
      borderRadius: 14,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 12px',
      background: '#fff',
    }}>
      <span style={{ color: '#4d5666', fontSize: 18, width: 18, display: 'grid', placeItems: 'center' }}>{icon}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          border: 'none',
          outline: 'none',
          flex: 1,
          fontSize: 16,
          color: '#2c3548',
          background: 'transparent',
        }}
      />
      {endAdornment}
    </div>
  );
}
