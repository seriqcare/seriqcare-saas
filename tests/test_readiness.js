const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function compile(path, globals, customRequire = require) {
  const js = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, {
    module, exports: module.exports, require: customRequire,
    AbortController, DOMException, TypeError, ...globals,
  });
  return module.exports;
}

function harness(fetch) {
  let now = 0;
  const delays = [];
  const cancelled = new Set();
  let nextId = 0;
  const globals = {
    performance: { now: () => now },
    fetch,
    setTimeout: (callback, ms) => {
      const id = ++nextId;
      delays.push(ms);
      setImmediate(() => {
        if (!cancelled.has(id)) {
          now += ms;
          callback();
        }
      });
      return id;
    },
    clearTimeout: id => cancelled.add(id),
  };
  return { ...compile('lib\\readiness.ts', globals), delays, now: () => now };
}

test('immediate and transient readiness use 5-second delays and return successful base', async () => {
  let calls = 0;
  const h = harness(async () => ({ ok: ++calls === 3, status: calls === 1 ? 502 : 503 }));
  assert.equal(await h.waitForReadiness(['a', 'b'], new AbortController().signal), 'a');
  assert.equal(calls, 3);
  assert.equal(h.now(), 10000);
  assert.equal(h.delays.filter(d => d === 5000).length, 2);
});

test('immediately ready does not wait or retry', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return { ok: true, status: 200 }; });
  assert.equal(await h.waitForReadiness(['a'], new AbortController().signal), 'a');
  assert.equal(calls, 1);
  assert.equal(h.now(), 0);
});

test('504 responses are retried', async () => {
  let calls = 0;
  const h = harness(async () => ({ ok: ++calls === 2, status: 504 }));
  await h.waitForReadiness(['a'], new AbortController().signal);
  assert.equal(calls, 2);
  assert.equal(h.now(), 5000);
});

test('network failures and 12-second timeouts retry until exact deadline', async () => {
  let calls = 0;
  const h = harness((url, init) => {
    calls++;
    if (calls === 1) return Promise.reject(new TypeError('network'));
    return new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')));
    });
  });
  await assert.rejects(h.waitForReadiness(['a'], new AbortController().signal), { message: h.READINESS_DEADLINE_MESSAGE });
  assert.equal(h.now(), 150000);
  assert.ok(calls > 1);
  assert.ok(h.delays.every(ms => ms <= 12000));
});

test('nonretryable status stops immediately', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return { ok: false, status: 401 }; });
  await assert.rejects(h.waitForReadiness(['a'], new AbortController().signal), /HTTP 401/);
  assert.equal(calls, 1);
});

test('cancellation aborts a pending request', async () => {
  const controller = new AbortController();
  const h = harness((url, init) => new Promise((resolve, reject) =>
    init.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')))));
  const pending = h.waitForReadiness(['a'], controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('cancellation stops a pending retry pause', async () => {
  const controller = new AbortController();
  let calls = 0;
  const h = harness(async () => { calls++; return { ok: false, status: 503 }; });
  const pending = h.waitForReadiness(['a'], controller.signal);
  await Promise.resolve();
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('concurrent submissions cannot duplicate a login POST', async () => {
  let resolveReady;
  let posts = 0;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const hooks = {
    useRef: value => ({ current: value }),
    useState: value => [value, () => {}],
    useEffect: () => {},
    useCallback: fn => fn,
  };
  const customRequire = name => {
    if (name === 'react') return hooks;
    if (name === '@/components/auth-context') return { useAuth: () => ({
      apiBases: ['a'], signIn: async () => { posts++; return { ok: true }; },
    }) };
    if (name === '@/lib/readiness') return { waitForReadiness: () => ready };
    return require(name);
  };
  const { useLoginFlow } = compile('components\\use-login-flow.ts', {}, customRequire);
  const flow = useLoginFlow();
  const first = flow.submit('user', 'password');
  assert.equal(await flow.submit('user', 'password'), null);
  resolveReady('a');
  assert.equal((await first).ok, true);
  assert.equal(posts, 1);
});

test('failed readiness does not submit login', async () => {
  let posts = 0;
  const hooks = {
    useRef: value => ({ current: value }), useState: value => [value, () => {}],
    useEffect: () => {}, useCallback: fn => fn,
  };
  const customRequire = name => {
    if (name === 'react') return hooks;
    if (name === '@/components/auth-context') return { useAuth: () => ({
      apiBases: ['a'], signIn: async () => { posts++; },
    }) };
    if (name === '@/lib/readiness') return { waitForReadiness: async () => { throw new Error('not ready'); } };
    return require(name);
  };
  const { useLoginFlow } = compile('components\\use-login-flow.ts', {}, customRequire);
  assert.equal((await useLoginFlow().submit('user', 'password')).ok, false);
  assert.equal(posts, 0);
});

test('network failures do not replay query writes', async () => {
  const cases = [
    ['lib\\queries\\billing.ts', 'generateClaim', [1]],
    ['lib\\queries\\schedule.ts', 'createSchedule', [{}]],
    ['lib\\queries\\schedule.ts', 'updateSchedule', [1, {}]],
    ['lib\\queries\\clients.ts', 'saveClientCareTasks', [1, []]],
    ['lib\\queries\\clients.ts', 'setClientCareTaskCompletion', [1, 2, {}, 'token']],
    ['lib\\queries\\timesheets.ts', 'fixVisit', [1, 'reason']],
    ['lib\\queries\\timesheets.ts', 'submitVisit', [1]],
    ['lib\\queries\\timesheets.ts', 'updateTimesheet', [1, {}]],
  ];
  for (const [path, name, args] of cases) {
    let calls = 0;
    const fetch = async () => { calls++; throw new TypeError('network'); };
    const customRequire = name => name === './server-auth'
      ? { getAuthHeaders: async () => ({}) } : require(name);
    const mod = compile(path, { fetch, process, console }, customRequire);
    try { await mod[name](...args); } catch { /* Some APIs report failures by throwing. */ }
    assert.equal(calls, 1, `${name} must submit only once`);
  }
});

test('401 refresh retries reads but not writes', async () => {
  for (const method of ['GET', 'PATCH']) {
    let requests = 0;
    let refreshes = 0;
    const fetch = async url => {
      if (url.endsWith('/api/auth/refresh')) {
        refreshes++;
        return { ok: true, json: async () => ({ access_token: 'token', username: 'test' }) };
      }
      requests++;
      return { status: requests === 1 ? 401 : 200 };
    };
    const hooks = {
      createContext: () => ({ Provider: {} }),
      useRef: value => ({ current: value }), useState: value => [value, () => {}],
      useEffect: () => {}, useCallback: fn => fn, useMemo: fn => fn(),
    };
    const customRequire = name => {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return { jsx: (component, props) => props };
      if (name === 'next/navigation') return { usePathname: () => '/', useRouter: () => ({ replace: () => {} }) };
      return require(name);
    };
    const globals = {
      fetch, process, Headers, setTimeout, clearTimeout, console,
      window: { location: { hostname: 'localhost' } }, document: { cookie: '' },
    };
    const { AuthProvider } = compile('components\\auth-context.tsx', globals, customRequire);
    const { value } = AuthProvider({ children: null });
    const response = await value.apiFetch('/api/test', { method });
    assert.equal(refreshes, 1);
    assert.equal(requests, method === 'GET' ? 2 : 1);
    assert.equal(response.status, method === 'GET' ? 200 : 401);
  }
});
