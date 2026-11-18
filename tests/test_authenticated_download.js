const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function harness() {
  const mod = { exports: {} }, anchors = [], revoked = [];
  const source = ts.transpileModule(fs.readFileSync('lib/authenticated-download.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
  }).outputText;
  vm.runInNewContext(source, {
    module: mod, exports: mod.exports, Error,
    URL: { createObjectURL: () => 'blob:download', revokeObjectURL: url => revoked.push(url) },
    window: { setTimeout: fn => fn() },
    document: { body: { appendChild() {} }, createElement: () => {
      const a = { click() { a.clicked = true; }, remove() { a.removed = true; } }; anchors.push(a); return a;
    } },
  });
  return { download: mod.exports.authenticatedDownload, anchors, revoked };
}

test('CSV downloads through authenticated fetch and creates a local file without opening the backend', async () => {
  const h = harness(), requests = [];
  const apiFetch = async (url, init) => {
    requests.push({ url, init });
    return { ok: true, blob: async () => ({ type: 'text/csv' }) };
  };
  await h.download('/api/billing/export?period=this_month', 'billing-this_month.csv', apiFetch);
  assert.equal(requests[0].url, '/api/billing/export?period=this_month');
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(h.anchors[0].href, 'blob:download');
  assert.equal(h.anchors[0].download, 'billing-this_month.csv');
  assert.equal(h.anchors[0].clicked, true);
  assert.equal(h.anchors[0].removed, true);
  assert.deepEqual(h.revoked, ['blob:download']);
});

test('unauthorized export displays the server error and never downloads its JSON as CSV', async () => {
  const h = harness();
  await assert.rejects(h.download('/api/billing/export', 'billing.csv', async () => ({
    ok: false, status: 401, json: async () => ({ detail: 'Not authenticated' }),
  })), /Not authenticated/);
  assert.equal(h.anchors.length, 0);
});
