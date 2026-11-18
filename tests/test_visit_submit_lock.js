const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const js = ts.transpileModule(fs.readFileSync('components/visit-submit-btn.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2017 },
}).outputText;

function harness(props = {}) {
  const states = [], refs = [], mod = { exports: {} }, calls = [];
  let cursor, refCursor, tree, finish;
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports,
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return {
        useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value; }]; },
        useRef(initial) { const i = refCursor++; return refs[i] ||= { current: initial }; },
      };
      if (name === 'next/navigation') return { useRouter: () => ({ refresh() {} }) };
      if (name === 'next/link') return { default: 'a' };
      if (name.endsWith('queries/timesheets')) return { submitVisit: id => { calls.push(id); return new Promise(resolve => { finish = resolve; }); } };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  function render() { cursor = refCursor = 0; tree = mod.exports.VisitSubmitBtn({ visitId: 10, evvStatus: 'Verified', ...props }); }
  function nodes(node = tree) {
    if (Array.isArray(node)) return node.flatMap(child => nodes(child ?? null));
    if (!node || typeof node !== 'object') return [];
    return [node, ...nodes(node.props?.children ?? null)];
  }
  render();
  return { calls, render, button: () => nodes().find(n => n.type === 'button'), links: () => nodes().filter(n => n.type === 'a'),
    finish: result => finish(result) };
}

test('accepted and submitted visits have disabled submission actions', async () => {
  for (const status of ['Accepted', 'Submitted', 'Pending']) {
    const h = harness({ submissionStatus: status, submissionCount: 1 });
    assert.equal(h.button().props.disabled, true);
    await h.button().props.onClick();
    assert.equal(h.calls.length, 0);
    assert.equal(h.links().length, 0);
  }
});

test('rejected visits disable Submit and link to Retry in History', async () => {
  const h = harness({ submissionStatus: 'Rejected', submissionCount: 1 });
  assert.equal(h.button().props.disabled, true);
  assert.equal(h.links()[0].props.href, '/evv?aggregator=sandata&tab=history');
  await h.button().props.onClick(); assert.equal(h.calls.length, 0);
});

test('history locks a visit even when its integration status was reset to Ready', () => {
  const h = harness({ submissionStatus: 'Ready', submissionCount: 1 });
  assert.equal(h.button().props.disabled, true);
});

test('a new visit submits once and stays disabled after the request completes', async () => {
  const h = harness({ submissionStatus: 'Ready' });
  const click = h.button().props.onClick;
  const first = click(); const second = click(); h.render();
  assert.equal(h.calls.length, 1);
  assert.equal(h.button().props.disabled, true);
  h.finish({ success: true, visit_id: 10, status: 'Accepted', transaction_id: 'new' });
  await Promise.all([first, second]); h.render();
  assert.equal(h.button().props.disabled, true);
  assert.equal(h.button().props.children, 'Accepted');
});
