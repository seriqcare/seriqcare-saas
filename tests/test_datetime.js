const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { spawnSync } = require('node:child_process');

const compiled = ts.transpileModule(fs.readFileSync('lib/datetime.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(compiled, { module: mod, exports: mod.exports });
const dates = mod.exports;

test('UTC audit times display Eastern winter/summer offsets and the correct date near midnight', () => {
  assert.match(dates.formatAuditDateTime('2026-11-20T22:46:00Z'), /5:46 PM EST/);
  assert.match(dates.formatAuditDateTime('2026-11-20T22:46:00'), /5:46 PM EST/);
  assert.match(dates.formatAuditDateTime('2026-07-20T22:46:00Z'), /6:46 PM EDT/);
  assert.match(dates.formatAuditDateTime('2026-11-21T02:27:00Z'), /Nov 20, 9:27 PM EST/);
});

test('schedule display and editing preserve Eastern wall times and convert explicit instants', () => {
  for (const value of ['2026-11-20 09:00:00', '2026-11-20T09:00:00-05:00', '2026-11-20T14:00:00Z']) {
    assert.equal(dates.formatScheduleTime(value), '9:00 AM');
    assert.equal(dates.scheduleInputParts(value).date, '2026-11-20');
    assert.equal(dates.scheduleInputParts(value).time, '09:00');
  }
  assert.equal(dates.formatScheduleTime('2026-07-20T13:00:00Z'), '9:00 AM');
  assert.equal(dates.agencyDateKey(new Date('2026-11-21T02:00:00Z')), '2026-11-20');
  const elapsed = dates.parseScheduleDateTime('2026-03-08T03:30:00-04:00') - dates.parseScheduleDateTime('2026-03-08T01:30:00-05:00');
  assert.equal(elapsed, 3600000);
});

test('server and browser timezones do not change the displayed agency time or edit inputs', () => {
  const script = `const m={exports:{}};require('node:vm').runInNewContext(${JSON.stringify(compiled)},{module:m,exports:m.exports});const d=m.exports;console.log(JSON.stringify([d.formatAuditDateTime('2026-11-20T22:46:00Z'),d.formatScheduleTime('2026-11-20T09:00:00-05:00'),d.scheduleInputParts('2026-11-20T14:00:00Z')]));`;
  const output = ['UTC', 'America/Los_Angeles', 'America/New_York'].map(TZ => {
    const result = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  });
  assert.equal(output[0], output[1]);
  assert.equal(output[1], output[2]);
});
