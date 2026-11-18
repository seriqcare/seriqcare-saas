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

async function harness(kind, valid = true) {
  const files = { reset: 'app/reset-password/page.tsx', forgot: 'app/forgot-password/page.tsx', wizard: 'components/create-agency-wizard.tsx' };
  const account = { agency_id: 4, agency_code: 'ACME', agency_name: 'My Agency', email: 'admin@agency.com' };
  const states = [], effects = [], pending = [], requests = [];
  let cursor, effectCursor, tree;
  const jsx = (type, props) => ({ type, props });
  const mod = { exports: {} };
  const fetch = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    if (url.endsWith('password-reset-context')) return { ok: valid, json: async () => valid ? account : { detail: 'Link expired' } };
    return { ok: true, status: 204, json: async () => ({ id: 4, agency_code: 'ACME', admin_user: { username: 'admin', email: account.email }, email_sent: true }) };
  };
  let js = ts.transpileModule(fs.readFileSync(files[kind], 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2017 },
  }).outputText;
  if (kind === 'reset') js += '\nexports.TestForm = ResetPasswordForm;';
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, fetch, Error, AbortController, process: { env: {} },
    document: { activeElement: null, body: { style: {} } },
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return {
        useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
        useRef: initial => ({ current: initial }),
        useEffect(fn, deps) { const i = effectCursor++; if (!effects[i] || deps.some((value, n) => value !== effects[i][n])) { effects[i] = deps; pending.push(fn); } },
      };
      if (name === 'next/navigation') return { useSearchParams: () => ({ get: key => ({ token: 'secure-token', agency_id: '99', email: 'attacker@example.com' })[key] }) };
      if (name === 'next/link') return { default: 'a' };
      if (name.endsWith('turnstile-widget')) return { default: 'captcha', turnstileEnabled: false };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  function render() {
    cursor = effectCursor = 0;
    tree = kind === 'reset' ? mod.exports.TestForm() : kind === 'wizard'
      ? mod.exports.CreateAgencyWizard({ apiFetch: fetch, onClose() {}, onCreated() {} }) : mod.exports.default();
    pending.splice(0).forEach(fn => fn());
  }
  function nodes(node = tree) {
    if (Array.isArray(node)) return node.flatMap(child => nodes(child ?? null));
    if (!node || typeof node !== 'object') return [];
    return [node, ...nodes(node.props?.children ?? null)];
  }
  render(); await new Promise(resolve => setImmediate(resolve)); render();
  return {
    requests, nodes, account, text: () => text(tree),
    fill(label, value) {
      let input = nodes().find(node => node.type === 'input' && node.props.id === label);
      if (!input) input = nodes(nodes().find(node => node.type === 'label' && text(node).startsWith(label))).find(node => node.type === 'input');
      assert.ok(input, `input ${label}`);
      assert.ok(!input.props.readOnly);
      input.props.onChange({ target: { value } }); render();
    },
    async submit() { await nodes().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); render(); },
  };
}

test('password setup displays token-verified agency ID, code and email, ignoring URL overrides', async () => {
  const h = await harness('reset');
  for (const [id, expected] of [['agency-id', 4], ['agency-code', 'ACME'], ['account-email', 'admin@agency.com']]) {
    const input = h.nodes().find(node => node.props?.id === id);
    assert.equal(input.props.value, expected);
    assert.equal(input.props.readOnly, true);
  }
  h.fill('password', 'secure-password'); h.fill('confirm', 'secure-password'); await h.submit();
  const reset = h.requests.find(r => r.url.endsWith('/reset-password'));
  assert.equal(reset.body.agency_id, 4);
  assert.equal(reset.body.agency_code, 'ACME');
  assert.equal(reset.body.email, 'admin@agency.com');
  assert.equal(reset.body.token, 'secure-token');
  assert.match(h.text(), /Password updated/);
});

test('invalid setup links do not expose an account or allow password submission', async () => {
  const h = await harness('reset', false);
  assert.match(h.text(), /Link expired/);
  assert.ok(!h.nodes().some(node => node.type === 'form'));
  assert.ok(!h.nodes().some(node => node.props?.id === 'account-email'));
});

test('mismatched passwords stay in the editor without issuing a reset', async () => {
  const h = await harness('reset');
  h.fill('password', 'secure-password'); h.fill('confirm', 'different-password'); await h.submit();
  assert.match(h.text(), /Passwords do not match/);
  assert.equal(h.requests.length, 1);
});

test('forgot password includes agency code alongside email', async () => {
  const h = await harness('forgot');
  h.fill('agency-code', ' acme '); h.fill('email', 'admin@agency.com'); await h.submit();
  assert.equal(h.requests[0].body.agency_code, 'ACME');
  assert.equal(h.requests[0].body.email, 'admin@agency.com');
  assert.match(h.text(), /Check your email/);
});

test('agency creation confirmation displays agency code and numeric ID with correct login instructions', async () => {
  const h = await harness('wizard');
  h.fill('Agency name', 'My Agency'); h.fill('Agency code', 'acme'); await h.submit();
  await h.submit();
  h.fill('Contact name', 'Admin'); h.fill('Contact email', 'admin@agency.com'); h.fill('Admin username', 'admin');
  await h.submit(); await h.submit();
  assert.match(h.text(), /Your agency is ready/);
  assert.match(h.text(), /Agency CodeACME/);
  assert.match(h.text(), /Agency ID: 4/);
  assert.match(h.text(), /Use this code when signing in/);
  assert.doesNotMatch(h.text(), /Use this ID when signing in/);
});
