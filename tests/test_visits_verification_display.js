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
async function page(summary, inspect = false, items = []) {
  const mod = { exports: {} }, calls = [];
  const js = ts.transpileModule(fs.readFileSync('app/visits/page.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2017 } }).outputText;
  vm.runInNewContext(js, { module: mod, exports: mod.exports, URLSearchParams,
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name.endsWith('queries/timesheets')) return { getVisits: async (...args) => { calls.push(args); return ({ total: 12, items, stats: { total_hours: 2, pending_approval: 1, approved: 2 }, summary }); } };
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


test('visit records have seven columns, visible date, combined statuses, and GPS details delegated to View', async () => {
  const visit = { id: 1035, employee_name: 'Noah Caregiver', client_name: 'Bulb Hannah',
    service_date: '2026-11-20', clock_in: '6:04 PM', clock_out: null, in_progress: true, total_hours: 0,
    clock_in_lat: 40.021, clock_in_lon: -76.7641, clock_out_lat: null, clock_out_lon: null,
    evv_status: 'Pending', sandata_status: 'Draft' };
  const { tree } = await page({ due: 0 }, true, [visit]);
  const all = nodes(tree);
  assert.deepEqual(all.filter(n => n.type === 'th').map(text), ['Visit', 'Client', 'Caregiver', 'Time', 'Hours', 'Status', 'Actions']);
  const row = all.find(n => n.type === 'tr' && n.props.children?.[0]?.type === 'td');
  assert.equal(row.props.children.length, 7);
  assert.match(text(row.props.children[0]), /#01035.*Nov 20, 2026/);
  assert.match(text(row), /Bulb Hannah/);
  assert.match(text(row), /Noah Caregiver/);
  assert.match(text(row), /In progress/);
  assert.match(text(row), /Sandata: Draft/);
  assert.doesNotMatch(text(row), /40.021|-76.7641/);
  assert.ok(all.some(n => n.type === 'VisitRecordActions' && n.props.visit.id === 1035));
  assert.ok(!all.some(n => n.props?.['aria-label']?.startsWith('GPS missing')));
  const missing = await page({ due: 1 }, true, [{ ...visit, clock_out: '7:00 PM', in_progress: false }]);
  assert.ok(nodes(missing.tree).some(n => n.props?.['aria-label']?.startsWith('GPS missing')));
});
