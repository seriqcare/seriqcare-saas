const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function compile(file, requireModule, globals = {}) {
  const mod = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2017 } }).outputText;
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: requireModule, Error, ...globals });
  return mod.exports;
}
function content(node) {
  if (Array.isArray(node)) return node.map(content).join('');
  if (node && typeof node === 'object') return content(node.props?.children);
  return node == null || typeof node === 'boolean' ? '' : String(node);
}
async function harness({ kind = 'billing', failDownload = false, loseCreateResponse = false } = {}) {
  const states = [], effects = [], pendingEffects = [], requests = [], downloads = [];
  let cursor = 0, effectCursor = 0, tree, exported = false, refreshes = 0, failures = failDownload ? 1 : 0, lost = loseCreateResponse;
  const batch = { id: 22, kind, provider: 'universal', visit_count: 1, total_amount: 120, total_units: 4, total_hours: 1,
    period_start: '2026-11-01', period_end: '2026-11-30', created_at: '2026-11-18T12:00:00', created_by_name: 'test.admin' };
  const apiFetch = async (url, init = {}) => {
    requests.push({ url, ...init });
    if (init.method === 'POST') {
      exported = true;
      if (lost) { lost = false; throw new Error('Network timeout'); }
      return { ok: true, json: async () => batch };
    }
    if (url.includes('/readiness')) return { ok: true, json: async () => ({ period_start: '2026-11-01', period_end: '2026-11-30',
      stats: { total: 2, ready: exported ? 0 : 1, blocked: 1, exported: exported ? 1 : 0, ready_amount: exported ? 0 : 120, period_amount: 120 },
      items: [{ visit_id: 10, service_date: '2026-11-18', client_name: 'Own client', caregiver_name: 'Own caregiver', service_code: 'S5130', units: 4, hours: 1, amount: 120, rate: 30, status: exported ? 'Exported' : 'Ready for Export', reasons: [] },
        { visit_id: 11, service_date: '2026-11-18', client_name: 'Needs setup', caregiver_name: 'Own caregiver', service_code: 'S5130', units: 4, hours: 1, amount: 0, rate: null, status: 'Approved', reasons: ['Service billing rate missing for the visit date'] }] }) };
    return { ok: true, json: async () => ({ items: exported ? [batch] : [], total: exported ? 1 : 0 }) };
  };
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in states)) states[i] = { current: initial }; return states[i]; },
    useEffect(fn, deps) { const i = effectCursor++; if (!effects[i] || deps.some((d, j) => d !== effects[i].deps[j])) { effects[i]?.cleanup?.(); effects[i] = { deps }; pendingEffects.push(() => { effects[i].cleanup = fn(); }); } },
  };
  const exportQueries = compile('lib/queries/exports.ts', () => ({}));
  const providers = compile('lib/payroll/providers.ts', () => ({}));
  const router = { refresh() { refreshes++; } };
  const component = compile('components/export-workspace.tsx', name => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'next/navigation') return { useRouter: () => router };
    if (name.endsWith('settings-dialog')) return { SettingsDialog: 'SettingsDialog' };
    if (name.endsWith('auth-context')) return { useAuth: () => ({ apiFetch }) };
    if (name.endsWith('queries/exports')) return exportQueries;
    if (name.endsWith('providers')) return providers;
    if (name.endsWith('authenticated-download')) return { authenticatedDownload: async url => { downloads.push(url); if (failures > 0) { failures--; throw Error('Download failed'); } } };
    if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
    throw Error(name);
  }, { document: { visibilityState: 'visible' }, localStorage: { getItem: () => null }, crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000022' },
    window: { setInterval: () => 1, clearInterval() {}, addEventListener() {}, removeEventListener() {}, setTimeout: () => 1, clearTimeout() {} } });
  function render() { cursor = effectCursor = 0; tree = component.ExportWorkspace({ kind, period: kind === 'billing' ? 'this_month' : 'pay_current' }); pendingEffects.splice(0).forEach(fn => fn()); }
  function nodes(node = tree) {
    if (Array.isArray(node)) return node.flatMap(n => nodes(n ?? null));
    if (!node || typeof node !== 'object') return [];
    return [node, ...nodes(node.props?.children ?? null)];
  }
  async function flush() { await new Promise(resolve => setImmediate(resolve)); render(); }
  render(); await flush();
  return { requests, downloads, render, flush, nodes, button: label => nodes().find(n => n.type === 'button' && content(n) === label),
    get refreshes() { return refreshes; } };
}

test('billing exports only after the user clicks and refreshes to exported state', async () => {
  const h = await harness();
  assert.equal(h.requests.filter(r => r.method === 'POST').length, 0);
  const button = h.button('Export Billing Data');
  button.props.onClick(); button.props.onClick(); await h.flush(); await h.flush();
  const posts = h.requests.filter(r => r.method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(JSON.parse(posts[0].body).kind, 'billing');
  assert.equal(h.downloads[0], '/api/exports/22/download');
  assert.equal(h.button('Export Billing Data').props.disabled, true);
});

test('billing replaces the attention metric with a monthly total while retaining the attention tab', async () => {
  const h = await harness();
  const metrics = h.nodes().filter(n => n.props?.className === 'metric');
  assert.ok(metrics.some(n => content(n).includes('Month Amount') && content(n).includes('$120.00')));
  assert.ok(!metrics.some(n => content(n).includes('Needs Attention')));
  assert.ok(h.button('Needs Attention'));
});

test('a failed download retries the existing file without creating another batch', async () => {
  const h = await harness({ failDownload: true });
  h.button('Export Billing Data').props.onClick(); await h.flush(); await h.flush();
  h.button('Retry download').props.onClick(); await h.flush();
  assert.equal(h.requests.filter(r => r.method === 'POST').length, 1);
  assert.equal(h.downloads.length, 2);
  assert.ok(h.downloads.every(url => url === '/api/exports/22/download'));
});

test('an uncertain POST response retries with the same idempotency key', async () => {
  const h = await harness({ loseCreateResponse: true });
  h.button('Export Billing Data').props.onClick(); await h.flush(); await h.flush();
  h.button('Retry export').props.onClick(); await h.flush();
  const posts = h.requests.filter(r => r.method === 'POST');
  assert.equal(posts.length, 2);
  assert.equal(JSON.parse(posts[0].body).request_id, JSON.parse(posts[1].body).request_id);
});

test('payroll uses its own backend eligibility and export kind', async () => {
  const h = await harness({ kind: 'payroll' });
  assert.ok(h.requests.some(r => r.url.includes('readiness?kind=payroll&period=pay_current')));
  h.button('Export Payroll').props.onClick(); await h.flush();
  const post = h.requests.find(r => r.method === 'POST');
  assert.equal(JSON.parse(post.body).kind, 'payroll');
  assert.equal(JSON.parse(post.body).provider, 'universal');
});

test('history download reuses the saved snapshot without creating a new export', async () => {
  const h = await harness();
  h.button('Export Billing Data').props.onClick(); await h.flush(); await h.flush();
  h.button('Export History').props.onClick(); h.render(); await h.flush();
  h.button('Download CSV').props.onClick(); await h.flush();
  assert.equal(h.requests.filter(r => r.method === 'POST').length, 1);
  assert.equal(h.downloads.length, 2);
});
