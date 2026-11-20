const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const js = ts.transpileModule(fs.readFileSync('components/aggregator-submission-history.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2017 },
}).outputText;

function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node && typeof node === 'object') return text(node.props?.children);
  return node == null || typeof node === 'boolean' ? '' : String(node);
}

async function render(data, fail = false, props = {}) {
  const calls = [], mod = { exports: {} };
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, URLSearchParams,
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'next/link') return { default: 'a' };
      if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
      if (name.endsWith('queries/aggregator')) return { getAggregatorSubmissions: async (...args) => {
        calls.push(args);
        if (fail) throw new Error('Unavailable');
        return data;
      } };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return { tree: await mod.exports.AggregatorSubmissionHistory(props), calls };
}

test('new agency sees an empty history rather than fabricated submissions', async () => {
  const result = await render({ total: 0, items: [] });
  assert.deepEqual(result.calls[0], [1, 4, '', 'sandata']);
  assert.match(text(result.tree), /No Sandata submissions for this agency yet/);
  assert.doesNotMatch(text(result.tree), /TXN-/);
});

test('history renders actual API records and links to the full history', async () => {
  const result = await render({ total: 1, items: [{ id: 23, transaction_id: 'ACTUAL-23', submission_type: 'Visit',
    submitted_at: '2026-11-16 10:00:00', client_name: 'Own Agency Client', status: 'Rejected', response_message: 'Missing required data' }] });
  const content = text(result.tree);
  assert.match(content, /ACTUAL-23/);
  assert.match(content, /Own Agency Client/);
  assert.match(content, /Missing required data/);
  assert.match(content, /View full history/);
  assert.ok(JSON.stringify(result.tree).includes('/evv?aggregator=sandata&tab=history'));
  assert.doesNotMatch(content, /TXN-202603/);
});

test('a failed history request shows an error instead of empty or sample data', async () => {
  const result = await render(null, true);
  assert.match(text(result.tree), /Unable to load submission history/);
  assert.doesNotMatch(text(result.tree), /No Sandata submissions/);
});


function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object') return [];
  return [node, ...nodes(node.props?.children)];
}
test('history pages contain four records and preserve the visit page and filters', async () => {
  const all = Array.from({ length: 10 }, (_, index) => ({ id: index + 1, transaction_id: `REAL-${index + 1}` }));
  const seen = [];
  for (const page of [1, 2, 3]) {
    const result = await render({ total: 10, items: all.slice((page - 1) * 4, page * 4) }, false,
      { page, query: { page: '2', week: 'last4', status: 'Accepted', aggregator: 'sandata' } });
    assert.deepEqual(result.calls[0], [page, 4, '', 'sandata']);
    const rows = nodes(result.tree).filter(n => n.type === 'tr' && n.props.children?.[0]?.type === 'td');
    assert.ok(rows.length <= 4);
    seen.push(...rows.map(n => text(n.props.children[0])));
    for (const link of nodes(result.tree).filter(n => n.type === 'a' && n.props?.['aria-label']?.includes('history page'))) {
      const params = new URLSearchParams(link.props.href.split('?')[1]);
      assert.equal(params.get('page'), '2');
      assert.equal(params.get('week'), 'last4');
      assert.equal(params.get('status'), 'Accepted');
      assert.equal(params.get('aggregator'), 'sandata');
    }
  }
  assert.deepEqual(seen, all.map(row => row.transaction_id));
});


test('history uses numbered pages and chevrons with stable first/last disabled controls', async () => {
  const first = await render({ total: 40, items: [{ id: 1 }] });
  const firstNodes = nodes(first.tree);
  assert.deepEqual(firstNodes.filter(n => n.props?.['aria-label']?.startsWith('History page ')).map(n => text(n)), ['1', '2', '3', '4', '5']);
  assert.ok(firstNodes.some(n => n.props?.['aria-disabled'] === 'true'));
  const last = await render({ total: 40, items: [{ id: 40 }] }, false, { page: 10 });
  const lastNodes = nodes(last.tree);
  assert.deepEqual(lastNodes.filter(n => n.props?.['aria-label']?.startsWith('History page ')).map(n => text(n)), ['6', '7', '8', '9', '10']);
  assert.equal(text(lastNodes.find(n => n.props?.['aria-current'] === 'page')), '10');
  assert.ok(lastNodes.some(n => n.props?.['aria-disabled'] === 'true'));
});
