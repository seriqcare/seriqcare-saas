const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.transpileModule(fs.readFileSync('app/clients/new/page.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node && typeof node === 'object') return text(node.props?.children);
  return node == null || typeof node === 'boolean' ? '' : String(node);
}

function harness(storage = new Map(), username = 'coordinator', kind = 'clients') {
  const states = [], effects = [], requests = [], navigation = [];
  let cursor = 0, mounted = false, tree;
  const jsx = (type, props) => ({ type, props });
  const mod = { exports: {} };
  const pageSource = kind === 'clients' ? source : ts.transpileModule(fs.readFileSync('app/caregivers/new/page.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(pageSource, {
    module: mod, exports: mod.exports,
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return {
        useState(initial) {
          const index = cursor++;
          if (!(index in states)) states[index] = initial;
          return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
        },
        useEffect(fn) { if (!mounted) effects.push(fn); },
        useRef(initial) { const index = cursor++; if (!(index in states)) states[index] = { current: initial }; return states[index]; },
      };
      if (name === 'next/navigation') return { useRouter: () => ({ push(path) { navigation.push(path); }, refresh() { navigation.push('refresh'); } }) };
      if (name === '../actions') return {
        refreshClientsAfterSave: async () => { navigation.push('invalidate clients'); },
        refreshCaregiversAfterSave: async () => { navigation.push('invalidate caregivers'); },
      };
      if (name.endsWith('auth-context')) return { useAuth: () => ({
        user: { agency_id: 7, username },
        apiFetch: async (url, init) => {
          if (url.endsWith('/intake-options')) return { ok: true, json: async () => ({
            services: [{ id: 1, code: 'W7076', description: 'Companion Care', unit_type: '15 min' }],
            providers: [{ id: 2, name: 'Agency provider' }], waivers: [{ id: 3, code: 'OBRA', name: 'OBRA' }],
          }) };
          requests.push({ url, payload: JSON.parse(init.body) });
          return { status: 201, json: async () => ({ message: 'Client saved.' }) };
        },
      }) };
      if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
      return { default: name, ProtectedLayout: 'layout' };
    },
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    requestAnimationFrame: fn => fn(), setTimeout() {},
  });
  function render() { cursor = 0; tree = mod.exports.default(); }
  function nodes(node = tree) {
    if (Array.isArray(node)) return node.flatMap(item => nodes(item));
    if (!node || typeof node !== 'object') return [];
    return [node, ...nodes(node.props?.children ?? null)];
  }
  render();
  effects.forEach(fn => fn());
  mounted = true;
  render();
  return {
    storage, requests, navigation,
    async ready() { await new Promise(resolve => setImmediate(resolve)); render(); },
    find: predicate => nodes().find(predicate),
    async click(label) {
      const button = nodes().find(n => n.type === 'button' && text(n) === label);
      assert.ok(button, `button ${label} exists`);
      assert.ok(!button.props.disabled, `button ${label} is enabled`);
      await button.props.onClick(); render();
    },
    fill(label, value) {
      const field = nodes().find(n => n.props?.className === 'form-field' && text(n.props.children[0]).trim().replace(/\s*\*$/, '') === label);
      assert.ok(field, `field ${label} exists`);
      const input = nodes(field).find(n => ['input', 'select', 'textarea'].includes(n.type));
      input.props.onChange({ target: { value } }); render();
    },
    visibleStep() { return nodes().filter(n => n.props?.id?.startsWith('sec-') && !n.props.hidden).map(n => n.props.id); },
  };
}

function fillPersonal(h) {
  for (const [label, value] of Object.entries({ 'First Name': 'Evelyn', 'Last Name': 'Carter', 'Date of Birth': '1950-01-01', 'Street Address': '123 Main St', City: 'Philadelphia', 'ZIP Code': '19103' })) h.fill(label, value);
}

test('wizard blocks skipping required fields and retains entries when going back', async () => {
  const h = harness();
  assert.deepEqual(h.visibleStep(), ['sec-personal']);
  await h.click('Continue to Insurance & Payer');
  assert.ok(h.find(n => n.props?.role === 'alert' && text(n).includes('First name')));
  fillPersonal(h);
  await h.click('Continue to Insurance & Payer');
  assert.deepEqual(h.visibleStep(), ['sec-insurance']);
  await h.click('Continue to Service Authorization');
  assert.deepEqual(h.visibleStep(), ['sec-insurance']);
  await h.click('Back');
  assert.equal(h.find(n => n.type === 'input' && n.props.value === 'Evelyn').props.value, 'Evelyn');
});

test('draft restores across page visits and is scoped to its user', async () => {
  const storage = new Map();
  const h = harness(storage);
  fillPersonal(h);
  await h.click('Save Draft');
  const restored = harness(storage);
  assert.ok(restored.find(n => n.type === 'input' && n.props.value === 'Evelyn'));
  const otherUser = harness(storage, 'another-user');
  assert.equal(otherUser.find(n => n.type === 'input' && n.props.value === 'Evelyn'), undefined);
});

test('completing all steps submits once and clears the saved draft', async () => {
  const h = harness();
  await h.ready();
  fillPersonal(h);
  h.fill('Middle Name', 'Jane');
  h.fill('Primary Language', 'Spanish');
  h.fill('Contact Name', 'Guardian');
  h.fill('Relationship', 'Other');
  await h.click('Continue to Insurance & Payer');
  h.fill('Waiver Program', '3');
  h.fill('Managed Care Plan', 'Community HealthChoices (CHC)');
  h.fill('Medicaid ID (MA Number)', '1234567890');
  await h.click('Continue to Service Authorization');
  h.fill('Service Code', '1');
  h.fill('Authorized Units', '100');
  h.fill('Authorization Number', 'AUTH-TEST');
  h.fill('Notes', 'Authorization details');
  h.fill('Authorization Start', '2026-11-13');
  h.fill('Authorization End', '2026-11-12');
  await h.click('Continue to Care Plan');
  assert.deepEqual(h.visibleStep(), ['sec-auth']);
  h.fill('Authorization End', '2026-12-13');
  await h.click('Continue to Care Plan');
  h.fill('Care Coordinator', 'Coordinator');
  h.fill('Plan Start Date', '2026-11-01');
  h.fill('Review Date', '2026-12-01');
  h.fill('Initial Goals & Notes', 'Support daily activities');
  await h.click('Continue to Documents');
  assert.deepEqual(h.visibleStep(), ['sec-documents']);
  await h.click('Save Draft');
  await h.click('Save & Add Client');
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].payload.first_name, 'Evelyn');
  assert.equal(h.requests[0].payload.medicaid_id, '1234567890');
  assert.equal(h.requests[0].payload.procedure_code, 'W7076');
  for (const [key, value] of Object.entries({ middle_name: 'Jane', primary_language: 'Spanish', emergency_contact_name: 'Guardian', emergency_contact_relationship: 'Other', waiver_id: 3, managed_care_plan: 'Community HealthChoices (CHC)', service_code_id: 1, provider_id: 2, authorized_units: 100, auth_number: 'AUTH-TEST', auth_notes: 'Authorization details', care_coordinator: 'Coordinator', care_plan_start_date: '2026-11-01', care_plan_review_date: '2026-12-01', care_plan_notes: 'Support daily activities' })) assert.equal(h.requests[0].payload[key], value, key);
  assert.equal(h.storage.size, 0);
  assert.deepEqual(h.navigation, ['invalidate clients', '/clients']);
});

test('client list reads bypass cached data after a client is created', async () => {
  const mod = { exports: {} };
  const calls = [];
  let rows = [{ id: 1, name: 'Existing client' }];
  const js = ts.transpileModule(fs.readFileSync('lib/queries/clients.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
  }).outputText;
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports,
    require: () => ({ getAuthHeaders: async () => ({ Authorization: 'Bearer test' }) }),
    process: { env: {} }, URLSearchParams, AbortController, setTimeout, clearTimeout, console,
    fetch: async (_url, options) => {
      calls.push(options);
      return { ok: true, json: async () => ({ items: rows }) };
    },
  });
  assert.equal((await mod.exports.getClients()).items.length, 1);
  rows = [...rows, { id: 2, name: 'New client' }];
  assert.equal((await mod.exports.getClients()).items.length, 2);
  assert.ok(calls.every(options => options.cache === 'no-store' && !options.next?.revalidate));
});

test('successful saves invalidate the Clients route', async () => {
  const mod = { exports: {} };
  const paths = [];
  const js = ts.transpileModule(fs.readFileSync('app/clients/actions.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports,
    require: () => ({ revalidatePath: path => paths.push(path) }),
  });
  await mod.exports.refreshClientsAfterSave();
  assert.deepEqual(paths, ['/clients']);
});

function fillCaregiverPersonal(h) {
  h.fill('First Name', 'Sarah');
  h.fill('Last Name', 'Mills');
  h.fill('Phone', '5551234567');
}

async function reachCaregiverEvv(h) {
  fillCaregiverPersonal(h);
  await h.click('Continue to Employment Details');
  h.fill('Employee Code', 'EMP006');
  h.fill('Hire Date', '2026-11-13');
  await h.click('Continue to EVV & Credentials');
}

test('caregiver wizard validates steps and preserves entries going back', async () => {
  const h = harness(new Map(), 'coordinator', 'caregivers');
  assert.deepEqual(h.visibleStep(), ['sec-personal']);
  await h.click('Continue to Employment Details');
  assert.deepEqual(h.visibleStep(), ['sec-personal']);
  fillCaregiverPersonal(h);
  await h.click('Continue to Employment Details');
  await h.click('Continue to EVV & Credentials');
  assert.deepEqual(h.visibleStep(), ['sec-employment']);
  await h.click('Back');
  assert.ok(h.find(n => n.type === 'input' && n.props.value === 'Sarah'));
});

test('caregiver drafts restore details without persisting EVV secrets or passwords', async () => {
  const storage = new Map();
  const h = harness(storage, 'coordinator', 'caregivers');
  fillCaregiverPersonal(h);
  h.fill('Middle Name', 'Jane');
  h.fill('SSN — Last 5 Digits', '12345');
  h.fill('Employee EVV PIN', '4321');
  h.fill('Username', 'sarah.mills');
  h.fill('Initial Password', 'secret-password');
  h.fill('Confirm Password', 'secret-password');
  await h.click('Save Draft');
  const draft = JSON.parse([...storage.values()][0]).form;
  for (const key of ['ssnLast5', 'employeePin', 'initialPassword', 'confirmPassword']) assert.equal(draft[key], undefined);
  const restored = harness(storage, 'coordinator', 'caregivers');
  assert.ok(restored.find(n => n.type === 'input' && n.props.value === 'Jane'));
  assert.equal(restored.find(n => n.props?.placeholder === 'XXXXX').props.value, '');
  const otherUser = harness(storage, 'another-user', 'caregivers');
  assert.equal(otherUser.find(n => n.type === 'input' && n.props.value === 'Sarah'), undefined);
});

test('caregiver saves validate optional login and refresh the directory before returning', async () => {
  const h = harness(new Map(), 'coordinator', 'caregivers');
  await reachCaregiverEvv(h);
  h.fill('SSN — Last 5 Digits', '1234');
  h.fill('Employee EVV PIN', '4321');
  await h.click('Continue to Documents');
  assert.deepEqual(h.visibleStep(), ['sec-evv']);
  h.fill('SSN — Last 5 Digits', '12345');
  await h.click('Continue to Documents');
  await h.click('Continue to Login Account');
  h.fill('Username', 'sarah.mills');
  h.fill('Initial Password', 'test-password');
  h.fill('Confirm Password', 'mismatched-password');
  await h.click('Save Caregiver');
  assert.equal(h.requests.length, 0);
  assert.ok(h.find(n => n.props?.role === 'alert' && text(n).includes('Passwords do not match')));
  h.fill('Confirm Password', 'test-password');
  await h.click('Save Draft');
  await h.click('Save Caregiver');
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, '/api/caregivers');
  assert.equal(h.requests[0].payload.employee_code, 'EMP006');
  assert.equal(h.requests[0].payload.username, 'sarah.mills');
  assert.equal(h.requests[0].payload.initial_password, 'test-password');
  assert.equal(h.storage.size, 0);
  assert.deepEqual(h.navigation, ['invalidate caregivers', '/caregivers']);
});

test('caregiver login account can be skipped', async () => {
  const h = harness(new Map(), 'coordinator', 'caregivers');
  await reachCaregiverEvv(h);
  h.fill('SSN — Last 5 Digits', '12345');
  h.fill('Employee EVV PIN', '4321');
  await h.click('Continue to Documents');
  await h.click('Continue to Login Account');
  await h.click('Save Caregiver');
  assert.equal(h.requests[0].payload.username, null);
  assert.equal(h.requests[0].payload.initial_password, null);
});
