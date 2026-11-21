const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const compile = path => ts.transpileModule(fs.readFileSync(path, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node && typeof node === 'object') return text(node.props?.children);
  return node == null || typeof node === 'boolean' ? '' : String(node);
}
function harness(status = 200) {
  let instant = '2026-11-21T02:15:00Z', cursor = 0, mounted = false, tree;
  const states = [], effects = [], timers = [], calls = [];
  class ClockDate extends Date {
    constructor(...args) { if (!args.length) super(instant); else super(...args); }
    static now() { return new Date(instant).getTime(); }
  }
  const dates = { exports: {} };
  vm.runInNewContext(compile('lib/datetime.ts'), { module: dates, exports: dates.exports, Date: ClockDate });
  const mod = { exports: {} }, jsx = (type, props) => ({ type, props });
  const user = { agency_id: 4, employee_id: 102, username: 'test', display_name: 'Test Caregiver' };
  vm.runInNewContext(compile('app/clock/page.tsx'), { module: mod, exports: mod.exports, Date: ClockDate,
    window: { setInterval(fn) { timers.push(fn); return timers.length; }, clearInterval() {}, addEventListener() {}, removeEventListener() {} },
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return {
        useState(initial) { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
        useRef(initial) { const index = cursor++; return states[index] ||= { current: initial }; },
        useEffect(fn) { if (!mounted) effects.push(fn); }, useCallback: fn => fn, useMemo: fn => fn(),
      };
      if (name === '@/lib/datetime') return dates.exports;
      if (name.endsWith('auth-context')) return { useAuth: () => ({ user, apiFetch: async url => {
        calls.push(url);
        return { ok: !url.includes('/schedules/') || status === 200, json: async () => [] };
      } }) };
      if (name.endsWith('use-active-visit')) return { useActiveVisit: () => ({ activeVisit: null, activeVisitStatus: 'ready' }) };
      if (name.endsWith('use-login-flow')) return { useLoginFlow: () => ({ phase: 'idle' }) };
      if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
      if (name.endsWith('turnstile-widget')) return {};
      throw new Error(name);
    },
  });
  function render() { cursor = 0; tree = mod.exports.default(); }
  render(); effects.forEach(fn => fn()); mounted = true;
  return { calls, text: () => text(tree),
    async settle() { await new Promise(resolve => setImmediate(resolve)); render(); },
    async tick(value) { instant = value; timers.forEach(fn => fn()); await this.settle(); },
  };
}

test('Clock labels today in Eastern time after UTC midnight', async () => {
  const h = harness(); await h.settle();
  assert.match(h.text(), /Good evening, Test Caregiver/);
  assert.match(h.text(), /Fri, Nov 20/);
  assert.match(h.text(), /Eastern time \(ET\)/);
  assert.match(h.text(), /No schedules available for today/);
});

test('Clock reloads schedules at Eastern midnight, not UTC midnight', async () => {
  const h = harness(); await h.settle();
  const count = () => h.calls.filter(url => url === '/api/schedules/today').length;
  assert.equal(count(), 1);
  await h.tick('2026-11-21T03:00:00Z');
  assert.equal(count(), 1);
  await h.tick('2026-11-21T05:01:00Z');
  assert.equal(count(), 2);
  assert.match(h.text(), /Sat, Nov 21/);
});

test('a schedule request failure is not presented as an empty schedule', async () => {
  const h = harness(503); await h.settle();
  assert.match(h.text(), /Unable to load schedules/);
  assert.match(h.text(), /Retry/);
  assert.doesNotMatch(h.text(), /No schedules available for today/);
});
