const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const js = ts.transpileModule(fs.readFileSync('components/evv-aggregator-panel.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2017 },
}).outputText;

function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object') return [];
  return [node, ...nodes(node.props?.children)];
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node && typeof node === 'object') return text(node.props?.children);
  return node == null || typeof node === 'boolean' ? '' : String(node);
}
function render(extra = {}) {
  const mod = { exports: {} }, jsx = (type, props) => ({ type, props });
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, URLSearchParams,
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return { useState: initial => [initial, () => {}], useEffect() {} };
      if (name === 'next/link') return { default: 'a' };
      if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
      if (name.endsWith('auth-context')) return { useAuth: () => ({ apiFetch() {} }) };
      if (name.endsWith('queries/aggregator')) return {};
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return mod.exports.EvvAggregatorPanel({ initialQueue: [], initialHistory: [], historyTotal: 0,
    mode: 'simulate', aggregator: 'sandata', initialTab: 'history', ...extra });
}

test('history link target opens the history empty state instead of the queue', () => {
  const tree = render();
  assert.match(text(tree), /No submissions recorded for this agency yet/);
  assert.doesNotMatch(text(tree), /No visits are ready for submission/);
  assert.doesNotMatch(text(tree), /All verified visits have been submitted/);
});

test('empty queue does not imply that submissions have occurred', () => {
  const tree = render({ initialTab: 'queue' });
  assert.match(text(tree), /No visits are ready for submission/);
  assert.doesNotMatch(text(tree), /All verified visits have been submitted/);
});

test('history pagination preserves the aggregator and history tab', () => {
  const first = render({ historyTotal: 51, initialHistory: [{ id: 1, visit_id: 1, status: 'Accepted' }] });
  const next = nodes(first).find(node => node.props?.['aria-label'] === 'Next history page');
  const query = new URL(next.props.href, 'http://localhost').searchParams;
  assert.equal(query.get('aggregator'), 'sandata');
  assert.equal(query.get('tab'), 'history');
  assert.equal(query.get('history_page'), '2');
  assert.ok(!nodes(first).some(node => node.props?.['aria-label'] === 'Previous history page'));

  const last = render({ historyTotal: 51, historyPage: 11, initialHistory: [{ id: 51, visit_id: 51, status: 'Accepted' }] });
  assert.ok(nodes(last).some(node => node.props?.['aria-label'] === 'Previous history page'));
  assert.ok(!nodes(last).some(node => node.props?.['aria-label'] === 'Next history page'));
  assert.match(text(last), /Showing 51–51 of 51 submissions/);
});

test('older rejected attempts cannot be retried after the visit was accepted', () => {
  const rejected = { id: 1, visit_id: 10, status: 'Rejected', aggregator: 'sandata', can_retry: true };
  const tree = render({ historyTotal: 2, initialHistory: [rejected, { id: 2, visit_id: 10, status: 'Accepted', aggregator: 'sandata' }] });
  assert.ok(!nodes(tree).some(node => node.type?.name === 'RetryBtn'));
  const unlocked = render({ historyTotal: 1, initialHistory: [rejected] });
  assert.ok(nodes(unlocked).some(node => node.type?.name === 'RetryBtn'));
  const lockedByServer = render({ historyTotal: 1, initialHistory: [{ ...rejected, can_retry: false }] });
  assert.ok(!nodes(lockedByServer).some(node => node.type?.name === 'RetryBtn'));
});

async function renderPage(fail = false) {
  const mod = { exports: {} }, jsx = (type, props) => ({ type, props });
  const source = ts.transpileModule(fs.readFileSync('app/evv/page.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2017 },
  }).outputText;
  vm.runInNewContext(source, {
    module: mod, exports: mod.exports, URLSearchParams,
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'next/link') return { default: 'a' };
      if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
      if (name.endsWith('protected-layout')) return { ProtectedLayout: 'Layout' };
      if (name.endsWith('topbar')) return { HeaderUser: 'User' };
      if (name.endsWith('evv-aggregator-panel')) return { EvvAggregatorPanel: 'Panel' };
      if (name.endsWith('aggregator-tabs')) return { AggregatorTabs: 'Tabs' };
      if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
      if (name.endsWith('queries/aggregator')) return {
        getAggregatorQueue: async () => { if (fail) throw new Error('API unavailable'); return { total: 0, mode: 'simulate', items: [] }; },
        getAggregatorSubmissions: async () => ({ total: 0, items: [] }),
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return mod.exports.default({ searchParams: Promise.resolve({ aggregator: 'sandata', tab: 'history' }) });
}

test('EVV page passes the history selection to the panel and uses real zero totals', async () => {
  const tree = await renderPage();
  const panel = nodes(tree).find(node => node.type === 'Panel');
  assert.equal(panel.props.initialTab, 'history');
  assert.equal(panel.props.historyTotal, 0);
  assert.ok(nodes(tree).some(node => node.props?.className === 'metrics'));
});

test('a data request failure renders recovery actions instead of crashing or inventing counts', async () => {
  const tree = await renderPage(true);
  assert.match(text(tree), /Unable to load submission data/);
  assert.match(text(tree), /Reload history/);
  assert.ok(!nodes(tree).some(node => node.props?.className === 'metrics'));
});
