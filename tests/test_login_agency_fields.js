const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function harness(file) {
  const state = [], submissions = [];
  let cursor = 0, tree;
  const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return {
        useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
        useEffect() {}, useRef: initial => ({ current: initial }), useCallback: fn => fn, useMemo: fn => fn(),
      };
      if (name.endsWith('auth-context')) return { useAuth: () => ({ user: null, isLoading: false }) };
      if (name.endsWith('use-login-flow')) return { useLoginFlow: () => ({ phase: 'idle', submit: async (...values) => { submissions.push(values); return { ok: true }; } }) };
      if (name.endsWith('use-active-visit')) return { useActiveVisit: () => ({ activeVisit: null, activeVisitStatus: 'ready' }) };
      if (name === 'next/navigation') return { useRouter: () => ({ replace() {} }) };
      if (name === 'next/link') return { default: 'a' };
      if (name.endsWith('turnstile-widget')) return { default: 'captcha', turnstileEnabled: false };
      if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  function render() { cursor = 0; tree = module.exports.default(); }
  function nodes(node = tree) {
    if (Array.isArray(node)) return node.flatMap(value => nodes(value ?? null));
    if (!node || typeof node !== 'object') return [];
    return [node, ...nodes(node.props?.children ?? null)];
  }
  render();
  return {
    submissions,
    find: fn => nodes().find(fn),
    fill(identifier, value) {
      const input = nodes().find(node => node.type === 'input' && (node.props.id === identifier || node.props.placeholder === identifier));
      assert.ok(input, `input ${identifier} exists`);
      input.props.onChange({ target: { value } }); render();
    },
    async submit() { await nodes().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); render(); },
  };
}

for (const [page, file, agency, username, password] of [
  ['web', 'app/login/page.tsx', 'agency-code', 'email', 'password'],
  ['clock', 'app/clock/page.tsx', 'Agency Code', 'Username', 'Password'],
]) {
  test(`${page} requires agency code and sends it with the login credentials`, async () => {
    const h = harness(file);
    const field = h.find(node => node.type === 'input' && (node.props.id === agency || node.props.placeholder === agency));
    assert.equal(field.props.required, true);
    assert.equal(h.find(node => node.type === 'button' && node.props.type === 'submit').props.disabled, true);
    h.fill(agency, 'ACME'); h.fill(username, 'first.user'); h.fill(password, 'test-password');
    await h.submit();
    assert.deepEqual(h.submissions[0].slice(0,3), ['ACME','first.user','test-password']);
  });
}
