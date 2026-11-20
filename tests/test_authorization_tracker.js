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
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object') return [];
  return [node, ...nodes(node.props?.children)];
}
function harness(items, error) {
  let states = [], cursor = 0, tree;
  const mod = { exports: {} }, jsx = (type, props) => ({ type, props });
  const js = ts.transpileModule(fs.readFileSync('components/authorization-tracker.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(js, { module: mod, exports: mod.exports,
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return { useState(initial) { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = value; }]; }, useEffect() {}, useRef: () => ({ current: null }) };
      if (name === 'next/link') return { default: 'a' };
      if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
      throw new Error(name);
    },
  });
  const render = () => { cursor = 0; tree = mod.exports.AuthorizationTracker({ items, error }); };
  render();
  return {
    nodes: () => nodes(tree), text: () => text(tree),
    click(label) {
      const button = nodes(tree).find(n => n.type === 'button' && n.props['aria-label'] === label);
      assert.ok(button && !button.props.disabled);
      button.props.onClick(); render();
    },
    update(next) { items = next; render(); },
  };
}
const items = Array.from({ length: 7 }, (_, i) => ({ auth_id: i + 1, client_id: i + 1, client_name: `Client ${i + 1}`,
  service_code: 'S5130', authorized_units: 100, used_units: 9, days_until_expiry: 24 }));

test('tracker paginates three compact rows without omitting authorizations', () => {
  const h = harness(items), seen = [];
  for (const page of [1, 2, 3]) {
    const rows = h.nodes().filter(n => n.type === 'tr' && n.props.children?.[0]?.type === 'td');
    assert.equal(rows.length, page === 3 ? 1 : 3);
    seen.push(...rows.map(row => text(row.props.children[0]).match(/Client \d+/)[0]));
    if (page < 3) h.click('Next authorizations');
  }
  assert.deepEqual(seen, items.map(row => row.client_name));
  assert.ok(h.nodes().find(n => n.props?.['aria-label'] === 'Next authorizations').props.disabled);
  h.click('Previous authorizations');
  assert.match(h.text(), /Client 4/);
});

test('tracker displays used and remaining separately, including overuse and expiry', () => {
  const h = harness([{ ...items[0], used_units: 120, days_until_expiry: -2, unassigned_visits: 1 }]);
  assert.match(h.text(), /120/);
  assert.match(h.text(), /-20/);
  assert.match(h.text(), /2d overdue/);
  assert.match(h.text(), /1 visit needs assignment/);
  assert.ok(h.nodes().some(n => n.type === 'a' && n.props.href === '/clients/1'));
  const progress = h.nodes().find(n => n.type === 'progress');
  assert.equal(progress.props.max, 100);
  assert.equal(progress.props.value, 100);
  assert.match(progress.props['aria-label'], /120 of 100/);
});

test('refresh clamps pagination when authorizations disappear and updates remaining units', () => {
  const h = harness(items);
  h.click('Next authorizations'); h.click('Next authorizations');
  h.update([{ ...items[0], used_units: 25 }]);
  assert.match(h.text(), /75/);
  assert.match(h.text(), /1 of 1/);
  assert.ok(h.nodes().find(n => n.props?.['aria-label'] === 'Previous authorizations').props.disabled);
});

test('failed and empty tracker reads retain distinct states', () => {
  assert.match(harness([], 'Unavailable').text(), /Unavailable/);
  assert.doesNotMatch(harness([], 'Unavailable').text(), /No active authorizations/);
  assert.match(harness([]).text(), /No active authorizations/);
});

test('caregiver directory renders created date separately from hire date', async () => {
  const mod = { exports: {} }, jsx = (type, props) => ({ type, props });
  const js = ts.transpileModule(fs.readFileSync('app/caregivers/page.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(js, { module: mod, exports: mod.exports,
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name.endsWith('queries/caregivers')) return { getCaregivers: async () => ({ total: 1,
        stats: { active: 1, on_leave: 0, inactive: 0, total_hours_this_week: 0 },
        items: [{ id: 1, name: 'Test Caregiver', role: 'DSP', hire_date: '2020-01-01', created_at: '2026-11-19T10:00:00',
          hours_this_week: 0, clients_assigned: 0, visits_this_week: 0 }],
      }) };
      return new Proxy({}, { get: (_, key) => key });
    },
  });
  const tree = await mod.exports.default({ searchParams: Promise.resolve({}) });
  assert.match(text(tree), /Created Date/);
  assert.match(text(tree), /Nov 19, 2026/);
  assert.match(text(tree), /Since 2020-01/);
});
