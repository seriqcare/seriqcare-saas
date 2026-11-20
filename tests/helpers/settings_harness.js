const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

exports.text = function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node && typeof node === 'object') return text(node.props?.children);
  return node == null || typeof node === 'boolean' ? '' : String(node);
};
exports.harness = async function (file, exportName, { tab = 'security', privateExport = false, respond } = {}) {
  const states = [], effects = [], pendingEffects = [], requests = [];
  let cursor = 0, effectCursor = 0, tree, refreshes = 0;
  const router = { refresh() { refreshes++; } };
  const params = { get: name => name === 'tab' ? tab : null };
  const user = { role: 'agency_admin', agency_id: 4, username: 'admin', email: 'admin@example.com', agency_tier: 'evv', agency_aggregator: 'sandata' };
  const apiFetch = async (url, init = {}) => {
    requests.push({ url, ...init });
    if (respond) { const value = respond(url, init); if (value) return value; }
    const data = url.includes('mobile-users') ? [{ employee_id: 5, name: 'Mary', employee_code: 'EMP5', username: 'maryp' }] : url.includes('service-rates') ? { services: [{ id: 5, hcpcs_code: 'S5130', description: 'Homemaker', unit_type: '15min' }], rates: [] } : { billing_identity: { npi: '1234567890', taxonomy: '', ein: '12-3456789', medicaid: '' } };
    return { ok: true, status: 200, json: async () => data };
  };
  const hooks = {
    Suspense: 'Suspense',
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in states)) states[i] = { current: initial }; return states[i]; },
    useCallback(fn, deps) { const i = cursor++; if (!(i in states) || deps.some((d, j) => d !== states[i].deps[j])) states[i] = { fn, deps }; return states[i].fn; },
    useEffect(fn, deps) { const i = effectCursor++; if (!effects[i] || deps.some((d, j) => d !== effects[i].deps[j])) { effects[i]?.cleanup?.(); effects[i] = { deps }; pendingEffects.push(() => { effects[i].cleanup = fn(); }); } },
  };
  const mod = { exports: {} };
  const jsx = (type, props) => ({ type, props });
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2017 } }).outputText;
  vm.runInNewContext(js + (privateExport ? `\nexports.${exportName} = SettingsPageContent;` : ''), {
    module: mod, exports: mod.exports, process: { env: {} }, URLSearchParams,
    window: { location: { search: `?tab=${tab}` }, setTimeout: () => 1, clearTimeout() {} }, setTimeout: () => 1,
    localStorage: { getItem: () => null, setItem() {} },
    require(name) {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'next/navigation') return { useRouter: () => router, useSearchParams: () => params };
      if (name.endsWith('auth-context')) return { useAuth: () => ({ apiFetch, user }) };
      if (name.endsWith('aggregator-off-banner')) return { AGGREGATOR_SANDATA_KEY: 'sandata', AGGREGATOR_HHAX_KEY: 'hhax' };
      if (name.endsWith('settings-dialog')) return { SettingsDialog: 'SettingsDialog' };
      if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
      return new Proxy({}, { get: (_, key) => key });
    },
  });
  function render() { cursor = effectCursor = 0; tree = mod.exports[exportName](); pendingEffects.splice(0).forEach(fn => fn()); }
  function nodes(node = tree) {
    if (Array.isArray(node)) return node.flatMap(n => nodes(n ?? null));
    if (!node || typeof node !== 'object') return [];
    return [node, ...nodes(node.props?.children ?? null)];
  }
  async function flush() { await new Promise(resolve => setImmediate(resolve)); render(); }
  render(); await flush();
  return { render, nodes, flush, requests, get refreshes() { return refreshes; },
    dialog: () => nodes().find(n => n.type === 'SettingsDialog'),
    button: name => nodes().find(n => n.type === 'button' && exports.text(n) === name),
  };
};
