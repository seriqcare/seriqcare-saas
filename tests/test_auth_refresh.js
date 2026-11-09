const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise actual provider callbacks with browser and React boundaries stubbed.
function harness(host = 'localhost', apiBase = 'http://127.0.0.1:8000') {
  let now = 1_000_000, context, apiStatus = 200;
  let refreshResponse = { ok: false, status: 401 };
  const effects = [], intervals = [], redirects = [], calls = [];
  const cookies = new Map(), storage = new Map(), events = new Map();
  const document = {
    visibilityState: 'visible',
    get cookie() { return [...cookies].map(([k, v]) => `${k}=${v}`).join('; '); },
    set cookie(value) {
      const [pair] = value.split(';');
      const pos = pair.indexOf('='), key = pair.slice(0, pos);
      if (value.includes('max-age=0')) cookies.delete(key);
      else cookies.set(key, pair.slice(pos + 1));
    },
    addEventListener: (name, fn) => events.set(name, fn),
    removeEventListener: name => events.delete(name),
  };
  const tokenData = { access_token: 'fresh-token', username: 'test', role: 'agency_admin' };
  const react = {
    createContext: () => ({ Provider: 'provider' }), useCallback: fn => fn,
    useContext: () => context, useEffect: fn => effects.push(fn),
    useMemo: fn => fn(), useRef: value => ({ current: value }),
    useState: value => [value, () => {}],
  };
  class FakeDate extends Date { static now() { return now; } }
  const module = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync('components/auth-context.tsx', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(js, {
    module, exports: module.exports,
    require: name => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => { context = props.value; } };
      if (name === 'next/navigation') return {
        usePathname: () => '/clients', useRouter: () => ({ replace: path => redirects.push(path) }),
      };
      throw new Error(`Unexpected import: ${name}`);
    },
    process: { env: { NEXT_PUBLIC_API_BASE_URL: apiBase } },
    window: {
      location: { hostname: host },
      sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
      addEventListener: (name, fn) => events.set(name, fn),
      removeEventListener: name => events.delete(name),
    },
    document, URL, Headers, AbortController, console, Date: FakeDate,
    BroadcastChannel: class { postMessage() {} close() {} },
    setTimeout: () => 1, clearTimeout: () => {},
    setInterval: fn => { intervals.push(fn); return intervals.length; }, clearInterval: () => {},
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/api/auth/refresh')) {
        if (refreshResponse instanceof Error) throw refreshResponse;
        return { ...refreshResponse, json: async () => tokenData };
      }
      if (url.endsWith('/api/auth/login')) return { ok: true, json: async () => tokenData };
      return { ok: apiStatus === 200, status: apiStatus };
    },
  });
  module.exports.AuthProvider({ children: null });
  effects.forEach(fn => fn());
  return {
    get auth() { return context; }, cookies, calls, redirects,
    refresh: value => { refreshResponse = value; }, apiStatus: value => { apiStatus = value; },
    advance: ms => { now += ms; intervals.forEach(fn => fn()); },
    event: name => events.get(name)?.(),
  };
}
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
async function signedIn() {
  const h = harness();
  await settle();
  assert.equal((await h.auth.signIn('user', 'password', h.auth.apiBases[0])).ok, true);
  h.calls.length = 0;
  return h;
}

test('local API follows browser hostname while remote APIs retain their host', () => {
  assert.equal(harness('localhost').auth.apiBases[0], 'http://localhost:8000');
  assert.equal(harness('127.0.0.1', 'http://localhost:8000').auth.apiBases[0], 'http://127.0.0.1:8000');
  assert.equal(harness('localhost', 'https://api.example.com').auth.apiBases[0], 'https://api.example.com');
});
for (const failure of [{ ok: false, status: 503 }, { ok: false, status: 429 }, new Error('network timeout')]) {
  test(`API 401 followed by ${failure.status ?? failure.message} preserves session`, async () => {
    const h = await signedIn();
    h.refresh(failure); h.apiStatus(401);
    assert.equal((await h.auth.apiFetch('/api/clients')).status, 401);
    assert.equal(h.cookies.get('seriqcare-session'), '1');
    assert.equal(h.cookies.get('seriqcare-at'), 'fresh-token');
    assert.deepEqual(h.redirects, []);
    h.apiStatus(200);
    await h.auth.apiFetch('/api/clients');
    assert.equal(h.calls.at(-1).init.headers.get('Authorization'), 'Bearer fresh-token');
  });
}
test('confirmed refresh 401 clears session and redirects', async () => {
  const h = await signedIn(); h.apiStatus(401);
  await h.auth.apiFetch('/api/clients');
  assert.equal(h.cookies.has('seriqcare-session'), false);
  assert.equal(h.cookies.has('seriqcare-at'), false);
  assert.deepEqual(h.redirects, ['/login']);
});
test('renewal starts from login, retries in 30 seconds, and resets after recovery', async () => {
  const h = await signedIn(); h.refresh({ ok: false, status: 503 });
  h.advance(8 * 60 * 1000); await settle();
  assert.equal(h.calls.length, 0);
  h.advance(30_000); await settle();
  assert.equal(h.calls.length, 1);
  assert.equal(h.cookies.get('seriqcare-session'), '1');
  h.refresh({ ok: true, status: 200 });
  h.advance(30_000); await settle();
  assert.equal(h.calls.length, 2);
  h.advance(30_000); await settle();
  assert.equal(h.calls.length, 2);
});
for (const event of ['online', 'visibilitychange']) {
  test(`${event} retries overdue renewal`, async () => {
    const h = await signedIn(); h.refresh({ ok: false, status: 503 });
    h.advance(9 * 60 * 1000); await settle();
    h.refresh({ ok: true, status: 200 }); h.event(event); await settle();
    assert.equal(h.calls.length, 2);
    assert.equal(h.cookies.get('seriqcare-session'), '1');
  });
}
test('successful refresh retries an authenticated GET', async () => {
  const h = await signedIn(); h.refresh({ ok: true, status: 200 }); h.apiStatus(401);
  await h.auth.apiFetch('/api/clients');
  assert.equal(h.calls.filter(call => call.url.endsWith('/api/clients')).length, 2);
  assert.deepEqual(h.redirects, []);
});
