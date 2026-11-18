const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const js = ts.transpileModule(fs.readFileSync('components/aggregator-submission-history.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2017 },
}).outputText;

function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node && typeof node === 'object') return text(node.props?.children);
  return node == null || typeof node === 'boolean' ? '' : String(node);
}

async function render(data, fail = false) {
  const calls = [], mod = { exports: {} };
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports,
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'next/link') return { default: 'a' };
      if (name.endsWith('queries/aggregator')) return { getAggregatorSubmissions: async (...args) => {
        calls.push(args);
        if (fail) throw new Error('Unavailable');
        return data;
      } };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return { tree: await mod.exports.AggregatorSubmissionHistory(), calls };
}

test('new agency sees an empty history rather than fabricated submissions', async () => {
  const result = await render({ total: 0, items: [] });
  assert.deepEqual(result.calls[0], [1, 5, '', 'sandata']);
  assert.match(text(result.tree), /No Sandata submissions for this agency yet/);
  assert.doesNotMatch(text(result.tree), /TXN-/);
});

test('history renders actual API records and links to the full history', async () => {
  const result = await render({ total: 1, items: [{ id: 23, transaction_id: 'ACTUAL-23', submission_type: 'Visit',
    submitted_at: '2026-11-16 10:00:00', client_name: 'Own Agency Client', status: 'Rejected', response_message: 'Missing required data' }] });
  const content = text(result.tree);
  assert.match(content, /ACTUAL-23/);
  assert.match(content, /Own Agency Client/);
  assert.match(content, /Missing required data/);
  assert.match(content, /View full history/);
  assert.ok(JSON.stringify(result.tree).includes('/evv?aggregator=sandata&tab=history'));
  assert.doesNotMatch(content, /TXN-202603/);
});

test('a failed history request shows an error instead of empty or sample data', async () => {
  const result = await render(null, true);
  assert.match(text(result.tree), /Unable to load submission history/);
  assert.doesNotMatch(text(result.tree), /No Sandata submissions/);
});
