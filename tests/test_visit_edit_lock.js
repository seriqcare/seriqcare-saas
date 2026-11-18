const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function harness(extra = {}) {
  const state = [], mod = { exports: {} };
  let cursor = 0, tree;
  const jsx = (type, props) => ({ type, props });
  const source = ts.transpileModule(fs.readFileSync('components/visit-detail-modal.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2017 },
  }).outputText;
  vm.runInNewContext(source, {
    module: mod, exports: mod.exports,
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return { useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = value; }]; } };
      if (name.endsWith('auth-context')) return {};
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  function render() { cursor = 0; tree = mod.exports.VisitRowActions({ visit: { id: 10, evv_status: 'Verified', ...extra } }); }
  function nodes(node = tree) {
    if (Array.isArray(node)) return node.flatMap(child => nodes(child ?? null));
    if (!node || typeof node !== 'object') return [];
    return [node, ...nodes(node.props?.children ?? null)];
  }
  render();
  return { render, nodes, button: text => nodes().find(node => node.type === 'button' && node.props.children === text) };
}

test('accepted and submitted visits cannot open an edit modal but remain viewable', () => {
  for (const extra of [{ sandata_status: 'Accepted' }, { hhax_status: 'Submitted' }, { edit_locked: true, sandata_status: 'Ready' }]) {
    const h = harness(extra);
    assert.equal(h.button('Edit').props.disabled, true);
    h.button('Edit').props.onClick(); h.render();
    assert.ok(!h.nodes().some(node => node.type?.name === 'FixModal'));
    h.button('View').props.onClick(); h.render();
    assert.ok(h.nodes().some(node => node.type?.name === 'ViewModal'));
  }
});

test('rejected visits remain editable for correction before retry', () => {
  const h = harness({ sandata_status: 'Rejected' });
  assert.equal(h.button('Edit').props.disabled, false);
});
