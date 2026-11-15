const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.transpileModule(fs.readFileSync('components/use-active-visit.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
}).outputText;

function harness(initialOwner = '1:5:first-user') {
  const slots = [], pendingEffects = [], requests = [], listeners = new Map();
  const storage = new Map([['seriqcare_active_visit', JSON.stringify({ visit_id: 999, client_name: 'Different user' })]]);
  let cursor = 0, owner = initialOwner, result;
  const same = (a, b) => a && a.length === b.length && a.every((value, i) => value === b[i]);
  const module = { exports: {} };
  const apiFetch = url => new Promise((resolve, reject) => requests.push({ url, resolve, reject }));
  vm.runInNewContext(source, {
    module, exports: module.exports,
    sessionStorage: { removeItem: key => storage.delete(key) },
    window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
    document: { visibilityState: 'visible', addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
    require: () => ({
      useState(initial) {
        const i = cursor++;
        if (!(i in slots)) slots[i] = initial;
        return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
      },
      useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
      useCallback(fn, deps) {
        const i = cursor++;
        if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, fn };
        return slots[i].fn;
      },
      useEffect(fn, deps) {
        const i = cursor++;
        if (!slots[i] || !same(slots[i].deps, deps)) {
          slots[i]?.cleanup?.();
          slots[i] = { deps };
          pendingEffects.push(() => { slots[i].cleanup = fn(); });
        }
      },
    }),
  });
  function render() {
    do {
      cursor = 0;
      result = module.exports.useActiveVisit(owner, apiFetch);
      const effects = pendingEffects.splice(0);
      if (!effects.length) break;
      effects.forEach(fn => fn());
    } while (true);
  }
  render();
  return {
    requests, storage,
    value: () => result,
    switchUser(value) { owner = value; render(); },
    async resolve(index, visit) { requests[index].resolve({ ok: true, json: async () => visit }); await this.settle(); },
    async fail(index) { requests[index].reject(new Error('Network error')); await this.settle(); },
    async settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); render(); },
    confirmed(visit) { result.setConfirmedActiveVisit(visit); render(); },
    focus() { listeners.get('focus')?.(); render(); },
  };
}

const visit = { visit_id: 10, schedule_id: 20, client_name: 'Actual Client', clocked_in: '2026-11-14T09:00:00-05:00' };

test('legacy browser cache cannot make a caregiver appear clocked in', async () => {
  const h = harness('2:15:maryp');
  assert.equal(h.storage.size, 0);
  assert.equal(h.value().activeVisit, null);
  assert.equal(h.value().activeVisitStatus, 'checking');
  assert.equal(h.requests[0].url, '/api/visits/active');
  await h.resolve(0, null);
  assert.equal(h.value().activeVisit, null);
  assert.equal(h.value().activeVisitStatus, 'ready');
});

test('a saved active visit is restored from the server with its actual clock-in time', async () => {
  const h = harness();
  await h.resolve(0, visit);
  assert.equal(h.value().activeVisit.visit_id, visit.visit_id);
  assert.equal(h.value().activeVisit.clocked_in, visit.clocked_in);
});

test('switching accounts clears active state and ignores the previous users response', async () => {
  const h = harness();
  h.switchUser('2:15:maryp');
  assert.equal(h.value().activeVisit, null);
  await h.resolve(0, visit);
  assert.equal(h.value().activeVisit, null);
  await h.resolve(1, null);
  assert.equal(h.value().activeVisit, null);
  assert.equal(h.value().activeVisitStatus, 'ready');
});

test('failed checks show unavailable status instead of assuming a clock state', async () => {
  const h = harness();
  await h.fail(0);
  assert.equal(h.value().activeVisitStatus, 'error');
  assert.equal(h.value().activeVisit, null);
});

test('returning to the clock page reconciles a visit closed elsewhere', async () => {
  const h = harness();
  await h.resolve(0, visit);
  h.focus();
  await h.resolve(1, null);
  assert.equal(h.value().activeVisit, null);
});

test('an old server check cannot overwrite a just-confirmed clock-in or clock-out', async () => {
  const h = harness();
  h.confirmed(visit);
  await h.resolve(0, null);
  assert.equal(h.value().activeVisit.visit_id, visit.visit_id);
  h.focus();
  h.confirmed(null);
  await h.resolve(1, visit);
  assert.equal(h.value().activeVisit, null);
});
