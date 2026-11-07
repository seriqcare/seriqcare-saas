import Link from 'next/link';
import { ProtectedLayout } from '@/components/protected-layout';
import { getScheduleWeek, getServiceCodes, type ScheduleEntry } from '@/lib/queries/schedule';
import { getClients } from '@/lib/queries/clients';
import { getCaregivers } from '@/lib/queries/caregivers';
import { QuerySearchInput } from '@/components/query-search-input';
import { NewShiftButton } from '@/components/new-shift-modal';

export const dynamic = 'force-dynamic';

/* ── Constants ─────────────────────────────────────── */
const CHIP_STYLE: Record<string, { bg: string; border: string; text: string }> = {
  Scheduled: { bg: '#eaf4fb', border: '#c8dff0', text: '#1d5a96' },
  Completed: { bg: '#edf7ef', border: '#bddbbf', text: '#35693c' },
  Open:      { bg: '#fff6e7', border: '#eed6a6', text: '#8a6424' },
  Cancelled: { bg: '#f8e3e3', border: '#e6baba', text: '#944949' },
};
const STATUS_CLS: Record<string, string> = {
  Scheduled: '', Completed: 'active', Open: 'pending', Cancelled: 'hold',
};

const SCHEDULE_LIST_LIMIT = 7;

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function parseDateTime(value: string) {
  return new Date(value.includes('T') ? value : value.replace(' ', 'T'));
}
function parseDateOnly(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}
function fmtTime(iso: string) {
  return parseDateTime(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}
function fmtTimeShort(iso: string) {
  return parseDateTime(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(':00', '').toLowerCase();
}
function localIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function isToday(dateStr: string) {
  return dateStr === localIsoDate(new Date());
}
function fmtDate(iso: string) {
  return parseDateTime(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function weekDayLabel(weekStart: string, dayIndex: number) {
  if (!weekStart) return DAY_LABELS[dayIndex] ?? '';
  const d = parseDateOnly(weekStart);
  d.setDate(d.getDate() + dayIndex);
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
}
function weekDayDate(weekStart: string, dayIndex: number): string {
  if (!weekStart) return '';
  const d = parseDateOnly(weekStart);
  d.setDate(d.getDate() + dayIndex);
  return localIsoDate(d);
}
function initials(name: string | null) {
  if (!name) return '?';
  return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}
function parseIsoDate(value?: string) {
  if (!value) return new Date();
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}
function isoDate(date: Date) {
  const copy = new Date(date);
  copy.setHours(12, 0, 0, 0);
  return localIsoDate(copy);
}
function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}
function startOfMonth(date: Date) { return new Date(date.getFullYear(), date.getMonth(), 1, 12); }
function endOfMonth(date: Date) { return new Date(date.getFullYear(), date.getMonth() + 1, 0, 12); }
function startOfWeek(date: Date) { return addDays(date, -date.getDay() + 1 - (date.getDay() === 0 ? 7 : 0)); }
function endOfWeek(date: Date) { return addDays(startOfWeek(date), 6); }

function entryMatchesSearch(entry: ScheduleEntry, search: string) {
  if (!search) return true;
  const term = search.toLowerCase();
  return [entry.client_name, entry.employee_name ?? '', entry.service_type ?? '']
    .some((value) => value.toLowerCase().includes(term));
}
function buildScheduleStats(entries: ScheduleEntry[], pendingClockOut: number) {
  const scheduledVisits = entries.length;
  const openShifts = entries.filter((e) => !e.employee_name).length;
  const assignedCaregivers = new Set(entries.filter((e) => e.employee_name).map((e) => e.employee_name)).size;
  const completedThisWeek = entries.filter((e) => e.status === 'Completed').length;
  const coverageRate = scheduledVisits > 0 ? Math.round(((scheduledVisits - openShifts) / scheduledVisits) * 100) : 100;
  return { scheduled_visits: scheduledVisits, open_shifts: openShifts, assigned_caregivers: assignedCaregivers, completed_this_week: completedThisWeek, pending_clock_out: pendingClockOut, coverage_rate: coverageRate, at_risk_visits: openShifts };
}
function buildQuery(base: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(base)) { if (value) params.set(key, value); }
  const query = params.toString();
  return query ? `/schedule?${query}` : '/schedule';
}


export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; mode?: string; search?: string; client?: string; caregiver?: string }>;
}) {
  const params = await searchParams;
  const search = params.search?.trim() ?? '';
  const mode = params.mode === 'month' ? 'month' : 'week';
  const anchorDate = parseIsoDate(params.date);
  const filterClient = params.client ?? '';
  const filterCaregiver = params.caregiver ?? '';

  // Fetch clients, caregivers, and service codes for the shift modal
  const [clientsData, caregiversData, serviceCodes] = await Promise.all([
    getClients(1, 100),
    getCaregivers(1, 100),
    getServiceCodes(),
  ]);
  const clientList = clientsData.items.map((c) => ({ id: c.id, name: c.name }));
  const caregiverList = caregiversData.items.map((c) => ({ id: c.id, name: c.name }));

  let entries: ScheduleEntry[] = [];
  let stats = buildScheduleStats([], 0);
  let periodLabel = 'Current Week';
  let dateLabel = '';
  let dayHeaders: string[] = [];
  let weekStart = '';

  if (mode === 'month') {
    const monthStart = startOfMonth(anchorDate);
    const monthEnd = endOfMonth(anchorDate);
    const firstWeek = startOfWeek(monthStart);
    const lastWeek = endOfWeek(monthEnd);
    const weekDates: string[] = [];
    for (let cursor = new Date(firstWeek); cursor <= lastWeek; cursor = addDays(cursor, 7)) {
      weekDates.push(isoDate(cursor));
    }
    const weekData = await Promise.all(weekDates.map((wd) => getScheduleWeek(wd)));
    const uniqueEntries = new Map<number, ScheduleEntry>();
    let pendingClockOut = 0;
    for (const chunk of weekData) {
      pendingClockOut += chunk.stats.pending_clock_out;
      for (const entry of chunk.entries) {
        const sd = entry.scheduled_start.slice(0, 10);
        if (sd >= isoDate(monthStart) && sd <= isoDate(monthEnd)) uniqueEntries.set(entry.id, entry);
      }
    }
    entries = [...uniqueEntries.values()].sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));
    stats = buildScheduleStats(entries, pendingClockOut);
    periodLabel = anchorDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    dateLabel = `${monthStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${monthEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    dayHeaders = DAY_LABELS;
  } else {
    const data = await getScheduleWeek(isoDate(anchorDate));
    entries = data.entries;
    weekStart = data.week_start;
    stats = buildScheduleStats(entries, data.stats.pending_clock_out);
    dayHeaders = DAY_LABELS.map((_, i) => weekDayLabel(data.week_start, i));
    periodLabel = data.week_start && data.week_end
      ? `${parseDateOnly(data.week_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${parseDateOnly(data.week_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
      : 'Current Week';
    dateLabel = periodLabel;
  }

  let filteredEntries = entries.filter((e) => entryMatchesSearch(e, search));
  if (filterClient) filteredEntries = filteredEntries.filter((e) => String(e.client_id ?? '') === filterClient);
  if (filterCaregiver) {
    const cgName = caregiverList.find((c) => String(c.id) === filterCaregiver)?.name ?? '';
    filteredEntries = filteredEntries.filter((e) => e.employee_name === cgName);
  }

  const coveragePct = stats.coverage_rate;

  const prevHref = buildQuery({ mode, date: isoDate(mode === 'month' ? addMonths(anchorDate, -1) : addDays(anchorDate, -7)), search: search || undefined });
  const nextHref = buildQuery({ mode, date: isoDate(mode === 'month' ? addMonths(anchorDate, 1) : addDays(anchorDate, 7)), search: search || undefined });
  const weekHref = buildQuery({ mode: 'week', date: isoDate(anchorDate), search: search || undefined });
  const monthHref = buildQuery({ mode: 'month', date: isoDate(anchorDate), search: search || undefined });

  const weeklyGroups = Array.from({ length: 7 }, (_, dayIndex) => ({
    label: dayHeaders[dayIndex] ?? DAY_LABELS[dayIndex],
    date: weekStart ? weekDayDate(weekStart, dayIndex) : '',
    entries: filteredEntries.filter((e) => e.day_of_week === dayIndex).sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start)),
  }));

  const monthStart = startOfMonth(anchorDate);
  const monthGridStart = startOfWeek(monthStart);
  const monthGridEnd = endOfWeek(endOfMonth(anchorDate));
  const monthCells: { key: string; date: Date; entries: ScheduleEntry[]; isCurrentMonth: boolean }[] = [];
  for (let cursor = new Date(monthGridStart); cursor <= monthGridEnd; cursor = addDays(cursor, 1)) {
    const key = isoDate(cursor);
    monthCells.push({ key, date: new Date(cursor), entries: filteredEntries.filter((e) => e.scheduled_start.slice(0, 10) === key), isCurrentMonth: cursor.getMonth() === anchorDate.getMonth() });
  }

  return (
    <ProtectedLayout>

      {/* ── Topbar ─────────────────────────────────────── */}
      <div className="topbar">
        <div>
          <h1 className="page-title">Schedule</h1>
          <p className="page-subtitle">Weekly caregiver assignments · open shift coverage · real-time status</p>
        </div>
        <div className="top-actions">
          <QuerySearchInput placeholder="Search client, caregiver, or service..." />
          {filterCaregiver && (
            <Link href={buildQuery({ mode, date: isoDate(anchorDate), search, client: filterClient })} className="btn secondary">
              Clear caregiver filter
            </Link>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Link href={prevHref} className="btn secondary" style={{ display: 'flex', alignItems: 'center' }}>Prev</Link>
            <div className="date-chip">{periodLabel}</div>
            <Link href={nextHref} className="btn secondary" style={{ display: 'flex', alignItems: 'center' }}>Next</Link>
          </div>
          <div className="status-tabs" style={{ marginBottom: 0 }}>
            <Link href={weekHref} className={`status-tab${mode === 'week' ? ' active' : ''}`}>Week</Link>
            <Link href={monthHref} className={`status-tab${mode === 'month' ? ' active' : ''}`}>Month</Link>
          </div>
          <button className="btn secondary">Export</button>
          <NewShiftButton clients={clientList} caregivers={caregiverList} serviceCodes={serviceCodes} />
        </div>
      </div>

      {/* ── Schedule layout ────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 260px', gap: 14, alignItems: 'start', marginBottom: 16 }}>

        <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
        {/* ── Week / Month grid ─────────────────────────── */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line-soft)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div className="card-title">{mode === 'month' ? 'Monthly Schedule Calendar' : 'Weekly Schedule Board'}</div>
              <div className="card-subtitle">Live · {dateLabel} · color = visit status</div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {[['Completed','#35693c'],['Scheduled','#2567a4'],['Open','#c4831e']].map(([l, c]) => (
                <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--muted)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: c, display: 'inline-block' }} />
                  {l}
                </span>
              ))}
            </div>
          </div>

          {filteredEntries.length === 0 && mode === 'week' ? (
            /* Empty week — show day columns with + buttons */
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderTop: '1px solid var(--line-soft)' }}>
              {weeklyGroups.map((group) => (
                <div key={group.label} style={{ borderRight: '1px solid var(--line-soft)' }}>
                  <div className="day-head" style={{ borderBottom: '1px solid var(--line-soft)' }}>{group.label}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 200, gap: 6, padding: 8 }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>No visits</div>
                    <AddShiftDayButton date={group.date} clients={clientList} caregivers={caregiverList} serviceCodes={serviceCodes} />
                  </div>
                </div>
              ))}
            </div>
          ) : mode === 'month' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderTop: '1px solid var(--line-soft)' }}>
              {DAY_LABELS.map((label) => (
                <div key={label} style={{ padding: '10px 12px', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid var(--line-soft)', background: '#f8fafc' }}>
                  {label}
                </div>
              ))}
              {monthCells.map((cell) => (
                <div key={cell.key} style={{ minHeight: 150, padding: 10, borderRight: '1px solid var(--line-soft)', borderBottom: '1px solid var(--line-soft)', background: cell.isCurrentMonth ? '#fff' : '#f8fafc' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: cell.isCurrentMonth ? 'var(--text)' : 'var(--muted)' }}>{cell.date.getDate()}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>{cell.entries.length}</div>
                  </div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {cell.entries.slice(0, SCHEDULE_LIST_LIMIT).map((entry) => {
                      const chip = CHIP_STYLE[entry.status] ?? CHIP_STYLE.Scheduled;
                      return (
                        <div key={entry.id} style={{ borderRadius: 5, padding: '6px 8px', fontSize: 10, lineHeight: 1.35, border: `1px solid ${chip.border}`, background: chip.bg, color: chip.text }}>
                          <div style={{ fontWeight: 700 }}>{fmtTime(entry.scheduled_start)}</div>
                          <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.client_name}</div>
                        </div>
                      );
                    })}
                    {cell.entries.length > SCHEDULE_LIST_LIMIT && <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700 }}>+{cell.entries.length - SCHEDULE_LIST_LIMIT} more</div>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Week view */
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderTop: '1px solid var(--line-soft)' }}>
              {weeklyGroups.map((group) => {
                const todayCol = isToday(group.date);
                return (
                  <div key={group.label} style={{ minWidth: 0, borderRight: '1px solid var(--line-soft)', background: todayCol ? '#f4f8ff' : undefined }}>
                    {/* Day header */}
                    <div style={{
                      padding: '8px 6px', borderBottom: '1px solid var(--line-soft)',
                      textAlign: 'center', fontSize: 11, fontWeight: 700,
                      color: todayCol ? 'var(--primary)' : 'var(--muted)',
                      background: todayCol ? 'var(--primary-soft)' : '#f8fafc',
                    }}>
                      {group.label.split(' ')[0]}&nbsp;
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 20, height: 20, borderRadius: 4,
                        background: todayCol ? 'var(--primary)' : 'transparent',
                        color: todayCol ? '#fff' : 'inherit',
                        fontWeight: 800,
                      }}>
                        {group.label.split(' ')[1] ?? ''}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gap: 5, padding: 7, minHeight: 260, alignContent: 'start' }}>
                      {group.entries.slice(0, SCHEDULE_LIST_LIMIT).map((entry) => {
                        const chip = CHIP_STYLE[entry.status] ?? CHIP_STYLE.Scheduled;
                        const emp = entry.employee_name;
                        const empIni = emp ? emp.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase() : '??';
                        return (
                          <div key={entry.id} style={{
                            borderRadius: 5, padding: '5px 7px', fontSize: 10, lineHeight: 1.35,
                            borderLeft: `3px solid ${chip.border}`,
                            border: `1px solid ${chip.border}`,
                            borderLeftWidth: 3,
                            background: chip.bg, color: chip.text,
                          }}>
                            <div style={{ fontWeight: 700, marginBottom: 3 }}>
                              {fmtTimeShort(entry.scheduled_start)}–{fmtTimeShort(entry.scheduled_end)}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                              <div style={{
                                width: 15, height: 15, borderRadius: 3, flexShrink: 0,
                                background: chip.border, color: '#fff',
                                fontSize: 8, fontWeight: 800,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                              }}>{empIni}</div>
                              <div style={{ fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.9 }}>
                                {emp ?? 'Unassigned'}
                              </div>
                            </div>
                            <div style={{ fontSize: 9, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.8 }}>
                              {entry.client_name}
                            </div>
                          </div>
                        );
                      })}
                      {group.entries.length > SCHEDULE_LIST_LIMIT ? (
                        <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, padding: '2px 4px' }}>
                          +{group.entries.length - SCHEDULE_LIST_LIMIT} more visits
                        </div>
                      ) : null}
                      <AddShiftDayButton date={group.date} clients={clientList} caregivers={caregiverList} serviceCodes={serviceCodes} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      {/* ── All visits list table ───────────────────────── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line-soft)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="card-title">All Scheduled Visits — {periodLabel}</div>
            <div className="card-subtitle">Full list · filtered by search and current period</div>
          </div>
          <div className="filter">{filteredEntries.length} results</div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date &amp; Time</th>
                <th>Client</th>
                <th>Caregiver</th>
                <th>Service</th>
                <th>Duration</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: '#999', padding: '32px 0' }}>
                    No visits match this search in the current period
                  </td>
                </tr>
              ) : filteredEntries.map((e) => {
                const durH = ((parseDateTime(e.scheduled_end).getTime() - parseDateTime(e.scheduled_start).getTime()) / 3_600_000).toFixed(1);
                return (
                  <tr key={e.id}>
                    <td>
                      <div style={{ fontWeight: 700, fontSize: 12 }}>{fmtDate(e.scheduled_start)}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtTime(e.scheduled_start)} – {fmtTime(e.scheduled_end)}</div>
                    </td>
                    <td>
                      <div className="person-cell">
                        <div className="person-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#2567a4' }}>{initials(e.client_name)}</div>
                        <div className="person-name">{e.client_name}</div>
                      </div>
                    </td>
                    <td>
                      {e.employee_name ? (
                        <div className="person-cell">
                          <div className="person-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#35693c', background: 'linear-gradient(135deg,#d7edd7,#9ecb9e)' }}>{initials(e.employee_name)}</div>
                          <div className="person-name">{e.employee_name}</div>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: '#c4831e', fontWeight: 700 }}>⚠ Unassigned</span>
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>{e.service_type ?? '—'}</td>
                    <td style={{ fontSize: 13, fontWeight: 700 }}>{durH}h</td>
                    <td><span className={`status ${STATUS_CLS[e.status] ?? ''}`}>{e.status}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <a href="#" className="action-link">View</a>
                        {e.status === 'Open'      && <a href="#" className="action-link">Assign</a>}
                        {e.status === 'Scheduled' && <a href="#" className="action-link">Confirm</a>}
                        <NewShiftButton
                          clients={clientList}
                          caregivers={caregiverList}
                          serviceCodes={serviceCodes}
                          linkLabel="Edit"
                          shift={{
                            id: e.id,
                            client_id: e.client_id,
                            employee_id: e.employee_id,
                            service_code: e.service_code,
                            scheduled_start: e.scheduled_start,
                            scheduled_end: e.scheduled_end,
                            status: e.status,
                            notes: e.notes ?? null,
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="pagination" style={{ padding: '10px 18px' }}>
          <div>Showing 1–{filteredEntries.length} of {filteredEntries.length} visits in this {mode}</div>
          <div className="page-controls">
            <div className="page-btn">‹</div>
            <div className="page-btn active">1</div>
            <div className="page-btn">›</div>
          </div>
        </div>
      </div>
      </div>

        {/* ── Right sidebar ─────────────────────────────── */}
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="card">
            <div className="card-title" style={{ marginBottom: 10 }}>Week at a Glance</div>
            <div className="quick-stats">
              {[
                ['Open Shifts',       String(stats.open_shifts)],
                ['Pending Clock-Out', String(stats.pending_clock_out)],
                ['Completed',         String(stats.completed_this_week)],
                ['At Risk',           String(stats.at_risk_visits)],
              ].map(([label, value]) => (
                <div className="quick-stat" key={label}>
                  <div className="quick-stat-label">{label}</div>
                  <div className="quick-stat-value">{value}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, textAlign: 'center' }}>
              Coverage rate: {coveragePct}%
            </div>
            <div style={{ height: 6, background: '#e9eef4', borderRadius: 99, overflow: 'hidden', marginTop: 6 }}>
              <div style={{ height: '100%', width: `${coveragePct}%`, background: coveragePct > 80 ? '#35693c' : '#c4831e', borderRadius: 99 }} />
            </div>
          </div>

          <div className="card">
            <div className="card-title" style={{ marginBottom: 10 }}>Quick Actions</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {[['Caregivers','/caregivers'],['Timesheets','/timesheets'],['Visits / EVV','/visits']].map(([l,h]) => (
                <Link key={h} href={h} style={{ display: 'block', padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12, fontWeight: 600, color: 'var(--primary)', background: 'var(--primary-soft)', textDecoration: 'none' }}>{l}</Link>
              ))}
            </div>
          </div>
        </div>
      </div>

    </ProtectedLayout>
  );
}

/* ── Inline per-day + button (client component) ─────── */
function AddShiftDayButton({ date, clients, caregivers, serviceCodes }: { date: string; clients: { id: number; name: string }[]; caregivers: { id: number; name: string }[]; serviceCodes: { id: number; code: string; description: string }[] }) {
  return (
    <div style={{ marginTop: 4 }}>
      <NewShiftButton defaultDate={date} clients={clients} caregivers={caregivers} serviceCodes={serviceCodes} compact />
    </div>
  );
}
