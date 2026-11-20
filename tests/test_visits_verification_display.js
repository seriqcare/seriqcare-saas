const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node && typeof node === 'object') return text(node.props?.children);
  return node == null || typeof node === 'boolean' ? '' : String(node);
}
async function page(summary, inspect = false) {
  const mod = { exports: {} }, calls = [];
  const js = ts.transpileModule(fs.readFileSync('app/visits/page.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2017 } }).outputText;
  vm.runInNewContext(js, { module: mod, exports: mod.exports, URLSearchParams,
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name.endsWith('queries/timesheets')) return { getVisits: async (...args) => { calls.push(args); return ({ total: 12, items: [], stats: { total_hours: 2, pending_approval: 1, approved: 2 }, summary }); } };
      return new Proxy({}, { get: (_, key) => key });
    },
  });
  const tree = await mod.exports.default({ searchParams: Promise.resolve({ page: '2', status: 'Verified', week: 'last4', historyPage: '3' }) });
  return inspect ? { tree, calls } : text(tree);
}

test('verification card uses full-period backend totals even on an empty filtered table page', async () => {
  const rendered = await page({ total: 3, due: 2, verified_due: 2, in_progress: 1, exempt: 0, verified: 2 });
  assert.ok(rendered.includes('Visit Verification Rate'));
  assert.ok(rendered.includes('100%'));
  assert.ok(rendered.includes('Active and exempt visits excluded.'));
  assert.ok(!rendered.includes('95%'));
  for (const removed of ['EVV Status Breakdown', 'EVV Alerts', 'Sandata Connection', 'HHAeXchange Connection', 'regulatory manual-edit compliance score']) assert.ok(!rendered.includes(removed));
});

test('no due visits displays no fabricated percentage', async () => {
  const rendered = await page({ total: 1, due: 0, verified_due: 0, in_progress: 1, exempt: 0 });
  assert.ok(!rendered.includes('100%'));
  assert.ok(rendered.includes('0 / 0 visits verified'));
});


function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object') return [];
  return [node, ...nodes(node.props?.children)];
}
test('Visits uses four records, moves source controls into the toolbar and preserves history pagination', async () => {
  const { tree, calls } = await page({ due: 0 }, true);
  assert.equal(calls[0][0], 2);
  assert.equal(calls[0][1], 4);
  const all = nodes(tree);
  const toolbar = all.find(n => n.props?.className === 'top-actions');
  assert.ok(nodes(toolbar).some(n => n.type === 'AggregatorTabs' && n.props.compact));
  const compactSummary = nodes(toolbar).find(n => n.type === 'details');
  assert.ok(compactSummary);
  assert.ok(text(compactSummary).includes('Visit summary'));
  assert.ok(text(compactSummary).includes('Visit Verification Rate'));
  assert.ok(text(compactSummary).includes('Quick Actions'));
  assert.ok(!all.some(n => n.type === 'button' && text(n) === 'Export'));
  const history = all.find(n => n.type === 'AggregatorSubmissionHistory');
  assert.equal(history.props.page, 3);
  assert.equal(history.props.query.page, '2');
  const pageLinks = all.filter(n => n.type === 'default' && n.props?.href?.includes('page='));
  assert.ok(pageLinks.length >= 2);
  for (const link of pageLinks) {
    assert.equal(new URLSearchParams(link.props.href.split('?')[1]).get('historyPage'), '3');
  }
});
