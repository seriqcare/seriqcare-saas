export const SCHEDULE_VISITS_PER_PAGE = 5;

export function paginateScheduleVisits<T>(entries: T[], requestedPage?: string) {
  const totalPages = Math.max(1, Math.ceil(entries.length / SCHEDULE_VISITS_PER_PAGE));
  const parsed = requestedPage && /^\d+$/.test(requestedPage) ? Number(requestedPage) : 1;
  const page = Math.min(totalPages, Math.max(1, Number.isSafeInteger(parsed) ? parsed : 1));
  const start = (page - 1) * SCHEDULE_VISITS_PER_PAGE;
  return {
    entries: entries.slice(start, start + SCHEDULE_VISITS_PER_PAGE),
    page, totalPages,
    from: entries.length ? start + 1 : 0,
    to: Math.min(start + SCHEDULE_VISITS_PER_PAGE, entries.length),
  };
}
