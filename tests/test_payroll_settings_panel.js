const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function compile(path, requireModule) {
  const mod = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2017 },
  }).outputText;
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: requireModule, Intl, process: { env: {} }, CustomEvent: class {},
    localStorage: { getItem: () => null }, window: { setTimeout: () => 1, clearTimeout() {}, dispatchEvent() {} } });
  return mod.exports;
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node && typeof node === 'object') return text(node.props?.children);
  return node == null || typeof node === 'boolean' ? '' : String(node);
}
function sample() {
  return { groups: [
    { id: 7, name: 'Default Casual', caregiver_count: 12, items: [{ id: 8, name: 'Base rate', pay_type: 'Hourly', rate: 25, effective_date: '2026-03-14', sort_order: 0, is_base_rate: true }] },
    { id: 9, name: 'Pay Group 2', caregiver_count: 0, items: [{ id: 10, name: 'Base rate', pay_type: 'Hourly', rate: 0, effective_date: '1900-01-01', sort_order: 0, is_base_rate: true }] },
  ], pay_period: { frequency: 'weekly', week_starts_on: 'monday', semi_monthly_days: [] }, current_period_start: '2026-11-16', current_period_end: '2026-11-22' };
}
async function harness() {
  const states = [], effects = [], pendingEffects = [], requests = [];
  let cursor = 0, effectCursor = 0, tree, failure = '', refreshes = 0;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in states)) states[i] = { current: initial }; return states[i]; },
    useEffect(fn, deps) { const i = effectCursor++; if (!effects[i] || deps.some((d, j) => d !== effects[i][j])) { effects[i] = deps; pendingEffects.push(fn); } },
  };
  const apiFetch = async (url, init = {}) => {
    requests.push({ url, ...init });
    return { ok: !failure, json: async () => failure ? { detail: failure } : init.method === 'PUT' ? { ...sample(), ...JSON.parse(init.body) } : sample() };
  };
  const helpers = compile('lib/payroll/settings-display.ts', () => ({}));
  const providers = compile('lib/payroll/providers.ts', () => ({}));
  const payroll = compile('lib/queries/payroll.ts', () => ({}));
  const mod = compile('components/payroll-settings-panel.tsx', name => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'next/navigation') return { useRouter: () => ({ refresh() { refreshes++; } }) };
    if (name.endsWith('auth-context')) return { useAuth: () => ({ apiFetch }) };
    if (name.endsWith('queries/payroll')) return payroll;
    if (name.endsWith('settings-display')) return helpers;
    if (name.endsWith('providers')) return providers;
    if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
    throw Error(name);
  });
  function render() { cursor = effectCursor = 0; tree = mod.PayrollSettingsPanel(); pendingEffects.splice(0).forEach(fn => fn()); }
  function nodes(node = tree) {
    if (Array.isArray(node)) return node.flatMap(child => nodes(child ?? null));
    if (!node || typeof node !== 'object') return [];
    return [node, ...nodes(node.props?.children ?? null)];
  }
  render(); await new Promise(resolve => setImmediate(resolve)); render();
  return { render, nodes, requests, fail(message) { failure = message; }, get refreshes() { return refreshes; },
    dialog: () => nodes().find(n => n.type?.name === 'PayrollDialog'),
    button: label => nodes().find(n => n.type === 'button' && (text(n) === label || n.props['aria-label'] === label)),
    async flush() { await new Promise(resolve => setImmediate(resolve)); render(); },
  };
}

test('payroll summary uses saved groups and opens review for the actual invalid rate', async () => {
  const h = await harness();
  assert.ok(text(h.nodes()).includes('1 pay group needs review.'));
  h.button('Review').props.onClick(); h.render();
  assert.equal(h.dialog().props.title, 'Edit rate rule');
  const fields = h.nodes().find(n => n.type?.name === 'RuleFields');
  assert.equal(fields.props.item.id, 10);
  assert.equal(h.requests.length, 1);
});

test('cancel discards group edits and never sends a save request', async () => {
  const h = await harness();
  h.button('Edit Default Casual').props.onClick({ stopPropagation() {} }); h.render();
  h.nodes().find(n => n.type === 'input' && n.props.value === 'Default Casual').props.onChange({ target: { value: 'Changed draft' } }); h.render();
  h.dialog().props.onClose(); h.render();
  h.button('Edit Default Casual').props.onClick({ stopPropagation() {} }); h.render();
  assert.ok(h.nodes().some(n => n.type === 'input' && n.props.value === 'Default Casual'));
  assert.equal(h.requests.filter(r => r.method === 'PUT').length, 0);
});

test('saving a rate preserves other groups, refreshes immediately and prevents duplicate writes', async () => {
  const h = await harness();
  h.button('Edit Base rate').props.onClick(); h.render();
  h.nodes().find(n => n.type?.name === 'RuleFields').props.onChange({ rate: 30 }); h.render();
  const submit = h.dialog().props.onSubmit;
  submit({ preventDefault() {} }); submit({ preventDefault() {} }); await h.flush();
  const writes = h.requests.filter(r => r.method === 'PUT');
  assert.equal(writes.length, 1);
  const body = JSON.parse(writes[0].body);
  assert.equal(body.groups[0].items[0].rate, 30);
  assert.equal(body.groups[1].items[0].rate, 0);
  assert.equal(h.refreshes, 1);
  assert.equal(h.dialog(), undefined);
});

test('failed save keeps the edit dialog and draft available for correction', async () => {
  const h = await harness();
  h.button('Edit Base rate').props.onClick(); h.render(); h.fail('Rate could not be saved.');
  h.dialog().props.onSubmit({ preventDefault() {} }); await h.flush();
  assert.ok(h.dialog());
  assert.equal(h.dialog().props.error, 'Rate could not be saved.');
  assert.equal(h.refreshes, 0);
});
