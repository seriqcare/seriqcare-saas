const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { NextRequest } = require('next/server');

const compiled = ts.transpileModule(fs.readFileSync('middleware.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const compiledModule = { exports: {} };
vm.runInNewContext(compiled, {
  module: compiledModule, exports: compiledModule.exports, require, URL,
});
const { middleware } = compiledModule.exports;

for (const signedIn of [false, true]) {
  for (const path of ['/clock', '/clock/', '/clock.webmanifest']) {
    test(`${path} stays in the clock app with signedIn=${signedIn}`, () => {
      const response = middleware(new NextRequest(`http://localhost:3001${path}`, {
        headers: signedIn ? { cookie: 'seriqcare-session=1' } : {},
      }));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('location'), null);
    });
  }
}

test('the dashboard still requires a session', () => {
  const response = middleware(new NextRequest('http://localhost:3001/'));
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get('location')).pathname, '/login');
});

test('signed-in users still leave the web login page for the dashboard', () => {
  const response = middleware(new NextRequest('http://localhost:3001/login', {
    headers: { cookie: 'seriqcare-session=1' },
  }));
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get('location')).pathname, '/');
});
