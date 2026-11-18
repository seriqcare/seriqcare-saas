const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function harness() {
  const state = [], refs = [], effects = [], pending = [], events = new Map();
  let cursor, refCursor, effectCursor, tree, now = 100000, dirty = false, visible = true, agencyId = 4;
  const mod = { exports: {} }, jsx = (type, props, key) => ({ type, props, key });
  const source = ts.transpileModule(fs.readFileSync('components/client-tabs.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2017 },
  }).outputText;
  vm.runInNewContext(`${source}\nexports.Workspace = ClientTabsWorkspace;`, {
    module: mod, exports: mod.exports,
    Date: class extends Date { static now() { return now; } },
    document: {
      get visibilityState() { return visible ? 'visible' : 'hidden'; },
      getElementById: () => ({ querySelector: () => dirty ? {} : null }),
      addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name),
    },
    window: {
      setInterval: fn => { events.set('interval', fn); return 1; }, clearInterval() {},
      addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name),
    },
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return {
        useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
        useRef(initial) { const i = refCursor++; return refs[i] ||= { current: initial }; },
        useEffect(fn, deps) { const i = effectCursor++; if (!effects[i] || deps.some((value, n) => value !== effects[i].deps[n])) { effects[i]?.cleanup?.(); effects[i] = { deps }; pending.push(() => { effects[i].cleanup = fn(); }); } },
      };
      if (name === 'next/navigation') return { useRouter: () => ({ refresh() {} }) };
      if (name === 'next/link') return { default: 'a' };
      if (name.endsWith('auth-context')) return { useAuth: () => ({ user: { username: 'admin', role: 'agency_admin', agency_id: agencyId } }) };
      if (name.endsWith('client-tab-refresh')) return { ClientTabRevisionProvider: 'Revision', useClientTabRevision: () => 0, notifyClientDataChanged() {} };
      if (name.endsWith('client-record-editor')) return { ClientRecordEditor: 'Editor' };
      if (name.endsWith('queries/clients')) return {};
      if (name.endsWith('.css')) return { default: {} };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  function nodes(node = tree) {
    if (Array.isArray(node)) return node.flatMap(child => nodes(child ?? null));
    if (!node || typeof node !== 'object') return [];
    return [node, ...nodes(node.props?.children ?? null)];
  }
  function render() {
    cursor = refCursor = effectCursor = 0;
    tree = mod.exports.Workspace({ client: {}, clientId: 12 });
    pending.splice(0).forEach(fn => fn());
  }
  const button = id => nodes().find(node => node.props?.id === `client-tab-${id}`);
  render();
  return {
    panel: id => nodes().find(node => node.props?.id === `client-panel-${id}`),
    revision(id) { return this.panel(id).props.children.props.value; },
    hover(id) { button(id).props.onMouseEnter(); render(); },
    select(id) { button(id).props.onClick(); render(); },
    advance(ms) { now += ms; events.get('interval')(); render(); },
    dirty(value) { dirty = value; },
    visible(value) { visible = value; },
    update(clientId = 12) { events.get('client-data-changed')({ detail: { clientId } }); render(); },
    scopedKey(clientId, nextAgency = 4) {
      agencyId = nextAgency;
      // ClientTabs adds an identity/client key around the retained workspace.
      const result = mod.exports.ClientTabs({ client: {}, clientId });
      return result.key;
    },
  };
}

test('hover prepares a hidden pane and switching away retains its stable identity', () => {
  const h = harness();
  assert.equal(h.panel('visits'), undefined);
  h.hover('visits');
  assert.equal(h.panel('visits').props.hidden, true);
  const key = h.panel('visits').key;
  h.select('visits');
  assert.equal(h.panel('visits').props.hidden, false);
  h.select('careplan'); h.select('visits');
  assert.equal(h.panel('visits').key, key);
  assert.equal(h.panel('careplan').props.hidden, true);
  assert.equal(h.revision('visits'), 0, 'quick return does not refetch or remount');
});

test('stale active data refreshes without replacing the retained pane', () => {
  const h = harness(); h.select('visits');
  const key = h.panel('visits').key;
  h.advance(30001);
  assert.equal(h.revision('visits'), 1);
  assert.equal(h.panel('visits').key, key);
});

test('background refresh preserves unsaved forms and pauses while hidden', () => {
  const h = harness(); h.select('careplan'); h.dirty(true); h.advance(60000);
  assert.equal(h.revision('careplan'), 0);
  h.dirty(false); h.visible(false); h.advance(60000);
  assert.equal(h.revision('careplan'), 0);
  h.visible(true); h.advance(30001);
  assert.equal(h.revision('careplan'), 1);
});

test('a successful write invalidates only the matching client workspace', () => {
  const h = harness(); h.select('visits'); h.update(99);
  assert.equal(h.revision('visits'), 0);
  h.update();
  assert.equal(h.revision('visits'), 1);
});

test('changing clients discards retained panes through a different workspace key', () => {
  const h = harness();
  assert.notEqual(h.scopedKey(12), h.scopedKey(13));
  assert.notEqual(h.scopedKey(12, 4), h.scopedKey(12, 5));
});
