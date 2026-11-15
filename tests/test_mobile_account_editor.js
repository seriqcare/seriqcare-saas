const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const js = ts.transpileModule(fs.readFileSync('components/caregiver-mobile-account.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2017 },
}).outputText;

function content(node) {
  if (Array.isArray(node)) return node.map(content).join('');
  if (node && typeof node === 'object') return content(node.props?.children);
  return node == null || typeof node === 'boolean' ? '' : String(node);
}

function harness(initialAccount = null) {
  const states = [], requests = [], saved = [];
  const effects = [], pendingEffects = [], timers = new Map();
  let effectCursor = 0, nextTimer = 0;
  let cursor = 0, tree, account = initialAccount, failure = '';
  const mod = { exports: {} };
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports,
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return { useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = initial;
        return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
      }, useEffect(fn, deps) {
        const index = effectCursor++;
        if (!effects[index] || deps.some((value, i) => value !== effects[index].deps[i])) {
          effects[index]?.cleanup?.();
          effects[index] = { deps };
          pendingEffects.push(() => { effects[index].cleanup = fn(); });
        }
      } };
      if (name.endsWith('auth-context')) return { useAuth: () => ({ apiFetch: async (url, init) => {
        const body = JSON.parse(init.body);
        requests.push({ url, body });
        return { ok: !failure, json: async () => failure ? { detail: failure } : {
          username: body.username, display_name: body.display_name, email: body.email,
          is_active: body.is_active, has_password: !!body.new_password || !!account?.has_password,
        } };
      } }) };
      if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
      if (name === 'next/link') return { default: 'a' };
      throw new Error(`Unexpected import ${name}`);
    },
    setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  function render() {
    cursor = 0;
    effectCursor = 0;
    tree = mod.exports.CaregiverMobileAccount({ employeeId: 5, employeeName: 'Sarah Mills',
      account, loading: false, loadError: '', onSaved: value => { account = value; saved.push(value); } });
    pendingEffects.splice(0).forEach(fn => fn());
  }
  function nodes(node = tree) {
    if (Array.isArray(node)) return node.flatMap(value => nodes(value));
    if (!node || typeof node !== 'object') return [];
    return [node, ...nodes(node.props?.children ?? null)];
  }
  render();
  return {
    requests, saved,
    expireToast() { for (const [id, timer] of [...timers]) { if (timer.ms === 3500) { timers.delete(id); timer.fn(); } } render(); },
    find: predicate => nodes().find(predicate),
    fail: message => { failure = message; },
    click(label) {
      const button = nodes().find(node => node.type === 'button' && content(node) === label);
      assert.ok(button, `button ${label} exists`);
      assert.ok(!button.props.disabled);
      button.props.onClick(); render();
    },
    fill(name, value) {
      const input = nodes().find(node => node.props?.name === name);
      assert.ok(input, `field ${name} exists`);
      input.props.onChange({ target: { value } }); render();
    },
    async submit() { await tree.props.onSubmit({ preventDefault() {} }); render(); },
  };
}

const existing = { username: 'sarah.mobile', display_name: 'Sarah Mills', email: 'staff@example.com', is_active: true, has_password: true };

test('Add Account saves details without password fields and links to Settings', async () => {
  const h = harness();
  h.click('Add Account');
  h.fill('username', 'new.mobile');
  assert.equal(h.find(node => node.type === 'input' && node.props.type === 'password'), undefined);
  assert.ok(h.find(node => node.props?.href === '/settings?tab=security#mobile-app-users'));
  await h.submit();
  assert.equal(h.requests[0].url, '/api/caregivers/5/mobile-account');
  assert.equal(h.requests[0].body.username, 'new.mobile');
  assert.equal(h.requests[0].body.new_password, undefined);
  assert.equal(h.saved[0].has_password, false);
  assert.ok(h.find(node => node.type === 'button' && content(node) === 'Edit'));
  assert.ok(h.find(node => node.type === 'div' && content(node) === 'new.mobile'));
});

test('editing account details without a password preserves the existing password', async () => {
  const h = harness(existing);
  h.click('Edit');
  h.fill('display_name', 'Updated Name');
  await h.submit();
  assert.equal(h.requests[0].body.new_password, undefined);
  assert.equal(h.saved[0].display_name, 'Updated Name');
  assert.equal(h.saved[0].has_password, true);
  assert.ok(h.find(node => node.props?.role === 'status' && content(node).includes('Mobile account updated.')));
  h.expireToast();
  assert.equal(h.find(node => node.props?.role === 'status'), undefined);
});

test('failed saves show the server error and keep the editor open', async () => {
  const h = harness(existing);
  h.click('Edit');
  h.fail('This mobile username is already in use.');
  await h.submit();
  assert.equal(h.saved.length, 0);
  assert.ok(h.find(node => node.props?.role === 'alert' && content(node).includes('already in use')));
  assert.ok(h.find(node => node.type === 'button' && content(node) === 'Save'));
});

test('cancel discards account detail edits', () => {
  const h = harness(existing);
  h.click('Edit');
  h.fill('username', 'discarded');
  h.click('Cancel');
  assert.equal(h.requests.length, 0);
  h.click('Edit');
  assert.equal(h.find(node => node.props?.name === 'username').props.value, existing.username);
  assert.equal(h.find(node => node.props?.name === 'new_password'), undefined);
});
