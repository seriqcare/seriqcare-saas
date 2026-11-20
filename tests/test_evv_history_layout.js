const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

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
function load(path, overrides = {}) {
  const mod = { exports: {} }, jsx = (type, props) => ({ type, props });
  const js = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(js, { module: mod, exports: mod.exports, URLSearchParams,
    require(name) {
      if (name in overrides) return overrides[name];
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return { useState: value => [value, () => {}], useEffect() {} };
      if (name === 'next/link') return { default: 'a' };
      if (name.endsWith('auth-context')) return { useAuth: () => ({ apiFetch() { throw new Error('Unexpected mutation'); } }) };
      if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
      return new Proxy({}, { get: (_, key) => key });
    },
  });
  return mod.exports;
}

test('EVV page fetches five submissions and places source controls in the top right', async () => {
  const calls = [];
  const page = load('app/evv/page.tsx', { '@/lib/queries/aggregator': {
    getAggregatorQueue: async () => ({ total: 0, mode: 'simulate', items: [] }),
    getAggregatorSubmissions: async (...args) => { calls.push(args); return { total: 11, items: [] }; },
  } });
  const tree = await page.default({ searchParams: Promise.resolve({ aggregator: 'sandata', tab: 'history', history_page: '2' }) });
  assert.deepEqual(calls[0], [2, 5, '', 'sandata']);
  const all = nodes(tree), toolbar = all.find(n => n.props?.className === 'top-actions');
  assert.ok(nodes(toolbar).some(n => n.type === 'AggregatorTabs' && n.props.compact));
  assert.ok(!all.some(n => n.type === 'HeaderUser'));
  const panel = all.find(n => n.type === 'EvvAggregatorPanel');
  assert.equal(panel.props.historyPage, 2);
  assert.equal(panel.props.initialTab, 'history');
  assert.ok(all.some(n => n.type === 'section' && n.props['aria-label'] === 'ESC Code Reference'));
  assert.ok(!all.some(n => n.type === 'details' || n.type === 'summary'));
});

test('history uses five-record pages, numbered navigation and persistent footer on the final page', () => {
  const { EvvAggregatorPanel } = load('components/evv-aggregator-panel.tsx');
  const records = Array.from({ length: 11 }, (_, i) => ({ id: i + 1, visit_id: i + 1, status: 'Accepted' }));
  const seen = [];
  for (const page of [1, 2, 3]) {
    const tree = EvvAggregatorPanel({ initialQueue: [], initialHistory: records.slice((page - 1) * 5, page * 5),
      historyTotal: 11, mode: 'simulate', aggregator: 'sandata', initialTab: 'history', historyPage: page });
    const all = nodes(tree), rows = all.filter(n => n.type === 'tr' && n.props.children?.[0]?.type === 'td');
    assert.equal(rows.length, page === 3 ? 1 : 5);
    seen.push(...rows.map(n => Number(text(n.props.children[0]))));
    const links = all.filter(n => n.type === 'a' && n.props['aria-label']?.startsWith('History page '));
    assert.deepEqual(links.map(n => text(n)), ['1', '2', '3']);
    assert.equal(text(links.find(n => n.props['aria-current'] === 'page')), String(page));
    assert.ok(all.some(n => n.props?.className === 'historyTableArea'));
    assert.ok(all.some(n => n.props?.className?.includes('historyFooter')));
    for (const link of links) assert.equal(new URLSearchParams(link.props.href.split('?')[1]).get('aggregator'), 'sandata');
  }
  assert.deepEqual(seen, records.map(n => n.id));
  const empty = EvvAggregatorPanel({ initialQueue: [], initialHistory: [], historyTotal: 0, mode: 'simulate', aggregator: 'sandata', initialTab: 'history' });
  assert.ok(nodes(empty).some(n => n.props?.className?.includes('historyFooter')));
});
