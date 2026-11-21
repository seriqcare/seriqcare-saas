const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function harness(extra = {}, aggregator = '') {
  const states = [], refs = [], mod = { exports: {} };
  let cursor, refCursor, tree;
  const jsx = (type, props) => ({ type, props });
  const js = ts.transpileModule(fs.readFileSync('components/visit-record-actions.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(js, { module: mod, exports: mod.exports, window: { innerWidth: 1200, innerHeight: 700 },
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return {
        useState(initial) { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = value; }]; },
        useRef(initial) { const index = refCursor++; return refs[index] ||= { current: initial }; },
      };
      if (name.endsWith('visit-detail-modal')) return { ViewModal: 'ViewModal', FixModal: 'FixModal' };
      if (name.endsWith('visit-submit-btn')) return { VisitSubmitBtn: 'SubmitAction' };
      if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
      throw new Error(name);
    },
  });
  function nodes(node = tree) {
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (!node || typeof node !== 'object') return [];
    return [node, ...nodes(node.props?.children ?? null)];
  }
  function render() { cursor = refCursor = 0; tree = mod.exports.VisitRecordActions({ visit: { id: 10, evv_status: 'Verified', ...extra }, aggregator }); }
  render();
  return { render, nodes, refs, button: label => nodes().find(n => n.type === 'button' && n.props.children === label) };
}

test('View stays visible while secondary actions use a native popover', () => {
  const h = harness();
  assert.ok(h.button('View'));
  const trigger = h.nodes().find(n => n.props?.popoverTarget);
  const menu = h.nodes().find(n => n.props?.popover === 'auto');
  assert.equal(trigger.props.popoverTarget, menu.props.id);
  assert.ok(h.button('Edit visit'));
  h.button('View').props.onClick(); h.render();
  assert.ok(h.nodes().some(n => n.type === 'ViewModal'));
});

test('accepted, submitted and historically locked visits remain read-only', () => {
  for (const extra of [{ sandata_status: 'Accepted' }, { hhax_status: 'Submitted' }, { edit_locked: true, sandata_status: 'Ready' }]) {
    const h = harness(extra);
    assert.ok(h.button('Edit visit').props.disabled);
    h.button('Edit visit').props.onClick(); h.render();
    assert.ok(!h.nodes().some(n => n.type === 'FixModal'));
    h.button('View').props.onClick(); h.render();
    assert.ok(h.nodes().some(n => n.type === 'ViewModal'));
  }
});

test('corrections remain available for rejected visits and submission safeguards receive the original status', () => {
  const h = harness({ evv_status: 'Failed', sandata_status: 'Rejected', sandata_submission_count: 2 });
  assert.ok(!h.button('Edit visit').props.disabled);
  assert.ok(h.button('Fix EVV issues'));
  const submission = h.nodes().find(n => n.type === 'SubmitAction');
  assert.equal(submission.props.submissionStatus, 'Rejected');
  assert.equal(submission.props.submissionCount, 2);
  h.button('Fix EVV issues').props.onClick(); h.render();
  assert.ok(h.nodes().some(n => n.type === 'FixModal' && !n.props.editMode));
  assert.ok(!harness({}, 'hhax').nodes().some(n => n.type === 'SubmitAction'));
});

test('the action popover is positioned above the trigger near the viewport bottom', () => {
  const h = harness();
  h.refs[0].current = { getBoundingClientRect: () => ({ top: 650, bottom: 678, right: 1180 }) };
  h.refs[1].current = { offsetHeight: 160, offsetWidth: 180 };
  h.nodes().find(n => n.props?.popoverTarget).props.onClick(); h.render();
  const menu = h.nodes().find(n => n.props?.popover === 'auto');
  assert.equal(menu.props.style.top, 484);
  assert.equal(menu.props.style.left, 1000);
});
