const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function harness() {
  let cleanup, tick, refreshes = 0, editing = false, pending = false;
  const listeners = new Map();
  const document = {
    visibilityState: 'visible',
    querySelector: () => editing ? {} : null,
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
  };
  const mod = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync('components/live-visit-refresh.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
  }).outputText;
  vm.runInNewContext(source, {
    module: mod, exports: mod.exports, document,
    window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
    setInterval: (fn, ms) => { assert.equal(ms, 30000); tick = fn; return 1; },
    clearInterval: () => { tick = null; },
    require: name => name === 'react' ? {
      useEffect: fn => { cleanup = fn(); },
      useTransition: () => [pending, fn => fn()],
    } : { useRouter: () => ({ refresh: () => refreshes++ }) },
  });
  const render = () => { cleanup?.(); mod.exports.LiveVisitRefresh(); };
  render();
  return {
    document, listeners,
    count: () => refreshes,
    tick: () => tick?.(),
    editing: value => { editing = value; },
    pending: value => { pending = value; render(); },
    cleanup: () => cleanup(),
  };
}

test('live visit pages refresh periodically and when the tab becomes visible', () => {
  const h = harness();
  h.tick();
  h.listeners.get('focus')();
  h.listeners.get('visibilitychange')();
  assert.equal(h.count(), 3);
});

test('background tabs and active edits do not trigger refreshes', () => {
  const h = harness();
  h.document.visibilityState = 'hidden'; h.tick();
  h.document.visibilityState = 'visible'; h.editing(true); h.tick();
  h.editing(false); h.pending(true); h.tick();
  assert.equal(h.count(), 0);
  h.pending(false); h.tick();
  assert.equal(h.count(), 1);
});

test('unmount cleans up refresh timers and listeners', () => {
  const h = harness();
  h.cleanup(); h.tick();
  assert.equal(h.listeners.size, 0);
  assert.equal(h.count(), 0);
});
