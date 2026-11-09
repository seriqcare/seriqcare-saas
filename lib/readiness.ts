export const READINESS_DEADLINE_MESSAGE =
  'The server or database is still waking up or unavailable. Please try login again shortly.';

const DEADLINE_MS = 150_000;
const REQUEST_TIMEOUT_MS = 12_000;
const RETRY_DELAY_MS = 5_000;

function cancelled(): DOMException {
  return new DOMException('Readiness cancelled', 'AbortError');
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(cancelled());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(cancelled());
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function waitForReadiness(bases: string[], signal: AbortSignal): Promise<string> {
  const deadline = performance.now() + DEADLINE_MS;
  let attempt = 0;
  while (performance.now() < deadline) {
    if (signal.aborted) throw cancelled();
    const base = bases[attempt % bases.length];
    const remaining = deadline - performance.now();
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), Math.min(REQUEST_TIMEOUT_MS, remaining));
    let response: Response | undefined;
    try {
      response = await fetch(`${base}/api/ready`, {
        method: 'GET', cache: 'no-store', signal: controller.signal,
      });
    } catch (error) {
      if (signal.aborted) throw cancelled();
      if (!(error instanceof TypeError) && !(error instanceof DOMException && error.name === 'AbortError')) throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
    if (signal.aborted) throw cancelled();
    if (performance.now() >= deadline) break;
    if (response?.ok) return base;
    if (response && ![502, 503, 504].includes(response.status)) {
      throw new Error(`Readiness check failed (HTTP ${response.status}).`);
    }
    attempt += 1;
    const wait = deadline - performance.now();
    if (wait <= 0) break;
    await pause(Math.min(RETRY_DELAY_MS, wait), signal);
  }
  throw new Error(READINESS_DEADLINE_MESSAGE);
}
