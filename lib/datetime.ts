/** Audit instants are UTC; legacy unzoned schedule values are Eastern wall time. */
export const AGENCY_TIME_ZONE = 'America/New_York';
const hasOffset = (value: string) => /(?:z|[+-]\d{2}:?\d{2})$/i.test(value);
const normalized = (value: string) => value.trim().replace(' ', 'T');

function auditDate(value: string) {
  const iso = normalized(value);
  return new Date(hasOffset(iso) ? iso : `${iso}Z`);
}

export function formatAuditDateTime(value: string | null) {
  if (!value) return '—';
  return auditDate(value).toLocaleString('en-US', {
    timeZone: AGENCY_TIME_ZONE, month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}

export function formatAuditDate(value: string | null) {
  if (!value) return '—';
  return auditDate(value).toLocaleDateString('en-US', {
    timeZone: AGENCY_TIME_ZONE, month: 'short', day: 'numeric', year: 'numeric',
  });
}

// For legacy unzoned schedule strings, UTC here is only a calendar container:
// keep their wall-clock fields unchanged. Offset-bearing API values are instants.
export function parseScheduleDateTime(value: string) {
  const iso = normalized(value);
  return new Date(hasOffset(iso) ? iso : `${iso}Z`);
}

function scheduleZone(value: string) { return hasOffset(normalized(value)) ? AGENCY_TIME_ZONE : 'UTC'; }

export function formatScheduleTime(value: string) {
  return parseScheduleDateTime(value).toLocaleTimeString('en-US', {
    timeZone: scheduleZone(value), hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

export function formatScheduleDate(value: string) {
  return parseScheduleDateTime(value).toLocaleDateString('en-US', {
    timeZone: scheduleZone(value), weekday: 'short', month: 'short', day: 'numeric',
  });
}

export function agencyDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: AGENCY_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function agencyGreeting(value = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: AGENCY_TIME_ZONE, hour: '2-digit', hourCycle: 'h23',
  }).format(value));
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

export function scheduleInputParts(value: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: scheduleZone(value),
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23' }).formatToParts(parseScheduleDateTime(value));
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}
