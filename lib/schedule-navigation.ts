// Show the saved shift without retaining filters that would hide it.
export function scheduleUrlAfterSave(search: string, date: string, clientId: number, employeeId?: number): string {
  const params = new URLSearchParams(search);
  params.set('date', date);
  params.delete('action');
  params.delete('page');
  params.delete('search');
  if (params.has('client') && params.get('client') !== String(clientId)) params.delete('client');
  if (params.has('caregiver') && params.get('caregiver') !== String(employeeId ?? '')) params.delete('caregiver');
  return `/schedule?${params}`;
}
