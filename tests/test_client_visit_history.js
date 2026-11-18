const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

test('client Visits tab renders history without a second metric panel', async () => {
  const state = [], effects = [];
  let cursor = 0, effectLoaded = false;
  const mod = { exports: {} }, jsx = (type, props) => ({ type, props });
  const source = ts.transpileModule(fs.readFileSync('components/client-tabs.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2017 },
  }).outputText;
  vm.runInNewContext(`${source}\nexports.Visits = VisitsTab;`, {
    module: mod, exports: mod.exports,
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return {
        useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = value; }]; },
        useEffect(fn) { if (!effectLoaded) { effects.push(fn); effectLoaded = true; } },
      };
      if (name.endsWith('auth-context')) return { useAuth: () => ({ user: { token: 'token' } }) };
      if (name.endsWith('queries/clients')) return { getClientVisits: async () => [{ id: 1, service_date: '2026-11-17', total_hours: 0.5, service_description: 'Test service', evv_status: 'Verified' }] };
      if (name.endsWith('client-tab-refresh')) return { useClientTabRevision: () => 0 };
      if (name === 'next/link') return { default: 'a' };
      if (name === 'next/navigation') return {};
      if (name.endsWith('client-record-editor')) return {};
      if (name.endsWith('.css')) return { default: {} };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  mod.exports.Visits({ clientId: 12 });
  effects.forEach(fn => fn());
  await new Promise(resolve => setImmediate(resolve));
  cursor = 0;
  const tree = mod.exports.Visits({ clientId: 12 });
  function text(node) {
    if (Array.isArray(node)) return node.map(text).join('');
    if (node && typeof node === 'object') return text(node.props?.children);
    return node == null || typeof node === 'boolean' ? '' : String(node);
  }
  assert.match(text(tree), /Visit History/);
  assert.match(text(tree), /Test service/);
  assert.doesNotMatch(text(tree), /Visit Statistics|Approved Visits|Total Hours|Total Visits/);
});
