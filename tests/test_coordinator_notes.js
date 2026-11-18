const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const js = ts.transpileModule(fs.readFileSync('components/client-tabs.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2017 },
}).outputText;

async function harness(store = { note: '' }) {
  const states = [], effects = [], pending = [], requests = [];
  let cursor, effectCursor, tree, failure = '';
  const mod = { exports: {} };
  const apiFetch = async () => ({ ok: true, json: async () => ({ items: [] }) });
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(`${js}\nexports.TestCarePlan = CarePlanTabInner;`, {
    module: mod, exports: mod.exports, Error,
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return {
        useState(initial) {
          const index = cursor++;
          if (!(index in states)) states[index] = initial;
          return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
        },
        useEffect(fn, deps) {
          const index = effectCursor++;
          if (!effects[index] || deps.some((value, i) => value !== effects[index][i])) {
            effects[index] = deps;
            pending.push(fn);
          }
        },
      };
      if (name === 'next/navigation') return { useRouter: () => ({ refresh() {} }) };
      if (name === 'next/link') return { default: 'a' };
      if (name.endsWith('auth-context')) return { useAuth: () => ({ user: { token: 'token' }, apiFetch }) };
      if (name.endsWith('client-record-editor')) return { ClientRecordEditor: 'RecordEditor' };
      if (name.endsWith('client-tab-refresh')) return { useClientTabRevision: () => 0, notifyClientDataChanged() {} };
      if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
      if (name.endsWith('queries/clients')) return {
        getClientDetail: async () => ({ care_plan_notes: store.note }),
        updateClient: async (id, payload) => {
          requests.push({ id, payload });
          if (failure) throw new Error(failure);
          store.note = payload.care_plan_notes;
        },
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  function render() {
    cursor = effectCursor = 0;
    tree = mod.exports.TestCarePlan({ clientId: 10 });
    pending.splice(0).forEach(fn => fn());
  }
  function nodes(node = tree) {
    if (!node) return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (typeof node !== 'object') return [];
    return [node, ...nodes(node.props?.children ?? null)];
  }
  const section = () => nodes().find(node => node.props?.title === 'Coordinator Notes');
  render();
  await new Promise(resolve => setImmediate(resolve));
  render();
  return {
    requests, section, nodes,
    edit() { section().props.onEdit(); render(); },
    fill(value) {
      const input = nodes(section()).find(node => node.type === 'textarea');
      assert.ok(input);
      input.props.onChange({ target: { value } }); render();
    },
    async save() { await section().props.onSave(); render(); },
    cancel() { section().props.onCancel(); render(); },
    fail(message) { failure = message; },
  };
}

test('Coordinator Notes saves through the client update and survives reopening', async () => {
  const store = { note: '' };
  const page = await harness(store);
  page.edit();
  page.fill('Follow up Monday.\nCall the guardian.');
  await page.save();
  assert.equal(page.requests[0].id, 10);
  assert.equal(page.requests[0].payload.care_plan_notes, 'Follow up Monday.\nCall the guardian.');
  assert.equal(page.section().props.editing, false);
  const reopened = await harness(store);
  assert.equal(reopened.section().props.children.props.children, store.note);
});

test('clearing Coordinator Notes sends an empty string', async () => {
  const store = { note: 'Old note' };
  const page = await harness(store);
  page.edit(); page.fill(''); await page.save();
  assert.equal(page.requests[0].payload.care_plan_notes, '');
  assert.equal(store.note, '');
});

test('a failed save preserves the draft and displays the error', async () => {
  const store = { note: 'Saved' };
  const page = await harness(store);
  page.edit(); page.fill('Draft'); page.fail('Unable to save'); await page.save();
  assert.equal(page.section().props.editing, true);
  assert.equal(store.note, 'Saved');
  assert.equal(page.nodes(page.section()).find(node => node.type === 'textarea').props.value, 'Draft');
  assert.ok(page.nodes().some(node => node.props?.role === 'alert' && node.props.children === 'Unable to save'));
});

test('Cancel restores the saved note without issuing an update', async () => {
  const page = await harness({ note: 'Saved' });
  page.edit(); page.fill('Unsaved'); page.cancel(); page.edit();
  assert.equal(page.nodes(page.section()).find(node => node.type === 'textarea').props.value, 'Saved');
  assert.equal(page.requests.length, 0);
});
