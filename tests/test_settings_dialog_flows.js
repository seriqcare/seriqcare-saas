const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./helpers/settings_harness');

test('agency information uses a summary, read-only email, and cancel discards drafts', async () => {
  const h = await harness('app/settings/page.tsx', 'TestSettings', { privateExport: true, tab: 'general', respond: () => ({ ok: true, status: 200, json: async () => ({ agencyName: 'Registered Agency', email: 'registered@example.com', phone: '717-555-0100' }) }) });
  assert.equal(h.nodes().filter(n => n.type === 'input').length, 0);
  h.button('Edit').props.onClick(); h.render();
  assert.equal(h.dialog().props.title, 'Edit agency information');
  assert.equal(h.nodes().find(n => n.type === 'input' && n.props.type === 'email').props.disabled, true);
  h.nodes().find(n => n.type === 'input' && n.props.value === 'Registered Agency').props.onChange({ target: { value: 'Unsaved name' } }); h.render();
  h.dialog().props.onClose(); h.render();
  h.button('Edit').props.onClick(); h.render();
  assert.ok(h.nodes().some(n => n.type === 'input' && n.props.value === 'Registered Agency'));
  assert.equal(h.requests.filter(r => r.method === 'PUT').length, 0);
});

test('agency save does not treat a 404 as success and refreshes summary only after saving', async () => {
  let fail = true;
  const h = await harness('app/settings/page.tsx', 'TestSettings', { privateExport: true, tab: 'general', respond: (url, init) => init.method === 'PUT' ? { ok: !fail, status: fail ? 404 : 200, json: async () => ({ detail: 'Agency not found.' }) } : { ok: true, status: 200, json: async () => ({ agencyName: 'Registered Agency', email: 'registered@example.com' }) } });
  h.button('Edit').props.onClick(); h.render();
  h.nodes().find(n => n.type === 'input' && n.props.value === 'Registered Agency').props.onChange({ target: { value: 'Saved name' } }); h.render();
  h.dialog().props.onSubmit({ preventDefault() {} }); await h.flush();
  assert.equal(h.dialog().props.error, 'Agency not found.');
  fail = false;
  const submit = h.dialog().props.onSubmit;
  submit({ preventDefault() {} }); submit({ preventDefault() {} }); await h.flush();
  assert.equal(h.dialog(), undefined);
  assert.equal(h.requests.filter(r => r.method === 'PUT').length, 2);
  h.button('Edit').props.onClick(); h.render();
  assert.ok(h.nodes().some(n => n.type === 'input' && n.props.value === 'Saved name'));
});

test('billing identity cancel discards edits; successful save uses the agency API', async () => {
  const h = await harness('components/billing-identity-settings.tsx', 'BillingIdentitySettings');
  h.button('Edit').props.onClick(); h.render();
  h.nodes().find(n => n.type === 'input' && n.props.value === '1234567890').props.onChange({ target: { value: '9999999999' } }); h.render();
  h.dialog().props.onClose(); h.render();
  assert.equal(h.requests.filter(r => r.method === 'PUT').length, 0);
  h.button('Edit').props.onClick(); h.render();
  assert.ok(h.nodes().some(n => n.type === 'input' && n.props.value === '1234567890'));
  h.dialog().props.onSubmit({ preventDefault() {} }); await h.flush();
  const write = h.requests.find(r => r.method === 'PUT');
  assert.equal(JSON.parse(write.body).billing_identity.npi, '1234567890');
  assert.equal(h.dialog(), undefined);
  assert.equal(h.refreshes, 1);
});

test('service rates open in a dialog and cancel never creates a rate', async () => {
  const h = await harness('components/service-rates-settings.tsx', 'ServiceRatesSettings');
  h.button('+ Add Rate').props.onClick(); h.render();
  assert.equal(h.dialog().props.title, 'Add service rate');
  h.dialog().props.onClose(); h.render();
  assert.equal(h.dialog(), undefined);
  assert.equal(h.requests.filter(r => r.method === 'POST').length, 0);
});

function rateResponse(rates) {
  return { ok: true, status: 200, json: async () => ({ services: [{ id: 5, hcpcs_code: 'S5130', description: 'Homemaker', unit_type: '15min' }], rates }) };
}
const rate = { id: 12, service_code_id: 5, hcpcs_code: 'S5130', description: 'Homemaker', unit_type: '15min', rate_per_unit: 12.5, effective_from: '2026-11-01', effective_to: null };

test('deleting a rate requires confirmation; cancel never sends DELETE', async () => {
  const h = await harness('components/service-rates-settings.tsx', 'ServiceRatesSettings', { respond: () => rateResponse([rate]) });
  h.button('Delete').props.onClick(); h.render();
  assert.equal(h.dialog().props.title, 'Delete service rate?');
  assert.equal(h.dialog().props.destructive, true);
  assert.equal(h.requests.filter(r => r.method === 'DELETE').length, 0);
  h.dialog().props.onClose(); h.render();
  assert.equal(h.requests.filter(r => r.method === 'DELETE').length, 0);
  assert.ok(h.button('Delete'));
});

test('confirmed deletion refreshes immediately and is not sent twice', async () => {
  let removed = false;
  const h = await harness('components/service-rates-settings.tsx', 'ServiceRatesSettings', { respond: (url, init) => {
    if (init.method === 'DELETE') { removed = true; return { ok: true, status: 204 }; }
    return rateResponse(removed ? [] : [rate]);
  } });
  h.button('Delete').props.onClick(); h.render();
  const submit = h.dialog().props.onSubmit;
  submit({ preventDefault() {} }); submit({ preventDefault() {} }); await h.flush();
  const writes = h.requests.filter(r => r.method === 'DELETE');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].url, '/api/settings/service-rates/12');
  assert.equal(h.dialog(), undefined);
  assert.equal(h.button('Delete'), undefined);
  assert.equal(h.refreshes, 1);
});

test('failed deletion keeps the rate and confirmation available', async () => {
  const h = await harness('components/service-rates-settings.tsx', 'ServiceRatesSettings', { respond: (url, init) => init.method === 'DELETE' ? { ok: false, status: 500, json: async () => ({ detail: 'Could not delete rate.' }) } : rateResponse([rate]) });
  h.button('Delete').props.onClick(); h.render();
  h.dialog().props.onSubmit({ preventDefault() {} }); await h.flush();
  assert.equal(h.dialog().props.error, 'Could not delete rate.');
  assert.ok(h.button('Delete'));
  assert.equal(h.refreshes, 0);
});

test('security summaries hide password fields; cancel clears secrets before reopening', async () => {
  const h = await harness('app/settings/page.tsx', 'TestSettings', { privateExport: true });
  assert.equal(h.nodes().filter(n => n.type === 'input' && n.props.type === 'password').length, 0);
  h.button('Change password').props.onClick(); h.render();
  h.nodes().find(n => n.type === 'input' && n.props.autoComplete === 'current-password').props.onChange({ target: { value: 'private-secret' } }); h.render();
  h.dialog().props.onClose(); h.render();
  h.button('Change password').props.onClick(); h.render();
  assert.ok(h.nodes().filter(n => n.type === 'input' && n.props.type === 'password').every(n => n.props.value === ''));
  assert.equal(h.requests.filter(r => r.method === 'POST').length, 0);
});

test('mobile reset keeps failed form available, and closes and clears on success', async () => {
  let fail = true;
  const h = await harness('app/settings/page.tsx', 'TestSettings', { privateExport: true, respond: (url, init) => init.method === 'POST' ? { ok: !fail, status: fail ? 400 : 204, json: async () => ({ detail: 'Reset failed.' }) } : null });
  h.button('Reset mobile password').props.onClick(); h.render();
  h.nodes().find(n => n.type === 'select' && n.props.required).props.onChange({ target: { value: 'maryp' } }); h.render();
  h.nodes().filter(n => n.type === 'input' && n.props.autoComplete === 'new-password').forEach(n => n.props.onChange({ target: { value: 'new-password-123' } })); h.render();
  h.dialog().props.onSubmit({ preventDefault() {} }); await h.flush();
  assert.equal(h.dialog().props.error, 'Reset failed.');
  fail = false;
  const submit = h.dialog().props.onSubmit;
  submit({ preventDefault() {} }); submit({ preventDefault() {} }); await h.flush();
  assert.equal(h.requests.filter(r => r.method === 'POST').length, 2);
  assert.equal(h.dialog(), undefined);
  h.button('Reset mobile password').props.onClick(); h.render();
  assert.ok(h.nodes().filter(n => n.type === 'input' && n.props.type === 'password').every(n => n.props.value === ''));
});
