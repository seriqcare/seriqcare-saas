const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function compile(path, globals = {}, customRequire = require) {
  const module = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(js, { module, exports: module.exports, require: customRequire, URLSearchParams, Error, ...globals });
  return module.exports;
}

const { scheduleUrlAfterSave } = compile('lib/schedule-navigation.ts');
const { paginateScheduleVisits } = compile('lib/schedule-pagination.ts');

test('visit pages contain five records with no duplicates or omissions', () => {
  const visits = Array.from({ length: 12 }, (_, index) => ({ id: index + 1 }));
  const pages = ['1', '2', '3'].map(page => paginateScheduleVisits(visits, page));
  assert.deepEqual(pages.map(page => page.entries.length), [5, 5, 2]);
  assert.deepEqual(pages.flatMap(page => page.entries.map(visit => visit.id)), visits.map(visit => visit.id));
  assert.deepEqual(pages.map(page => [page.from, page.to]), [[1, 5], [6, 10], [11, 12]]);
});

test('visit pagination handles empty data, invalid pages and smaller filtered lists', () => {
  const empty = paginateScheduleVisits([], '2');
  assert.equal(empty.from, 0); assert.equal(empty.to, 0); assert.equal(empty.page, 1);
  const visits = Array.from({ length: 6 }, (_, index) => index);
  for (const invalid of [undefined, '-1', '0', '2.5', 'invalid']) assert.equal(paginateScheduleVisits(visits, invalid).page, 1);
  assert.equal(paginateScheduleVisits(visits, '999').page, 2);
  assert.equal(paginateScheduleVisits(visits.slice(0, 3), '2').page, 1);
});

test('saving a shift resets visit pagination for the saved period', () => {
  const target = new URL(scheduleUrlAfterSave('?mode=week&page=5', '2026-11-14', 1), 'http://localhost');
  assert.equal(target.searchParams.has('page'), false);
});

test('saved shifts open their calendar period and remove conflicting filters', () => {
  const target = new URL(scheduleUrlAfterSave('?mode=month&date=2026-10-01&search=Old+Client&client=9&caregiver=8&action=assign-caregiver', '2026-11-14', 1, 2), 'http://localhost');
  assert.equal(target.pathname, '/schedule');
  assert.equal(target.searchParams.get('date'), '2026-11-14');
  assert.equal(target.searchParams.get('mode'), 'month');
  for (const name of ['search', 'client', 'caregiver', 'action']) assert.equal(target.searchParams.has(name), false);
});

test('matching client and caregiver filters stay selected', () => {
  const target = new URL(scheduleUrlAfterSave('?client=1&caregiver=2', '2026-11-14', 1, 2), 'http://localhost');
  assert.equal(target.searchParams.get('client'), '1');
  assert.equal(target.searchParams.get('caregiver'), '2');
  assert.equal(new URL(scheduleUrlAfterSave('?caregiver=2', '2026-11-14', 1), 'http://localhost').searchParams.has('caregiver'), false);
});

test('schedule save invalidates the calendar and affected assignment summaries', async () => {
  const paths = [];
  const action = compile('app/schedule/actions.ts', {}, () => ({ revalidatePath: (...args) => paths.push(args.join(':')) }));
  await action.refreshScheduleAfterSave();
  assert.deepEqual(paths, ['/schedule', '/clients', '/caregivers', '/caregivers/[id]:page']);
});

function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node && typeof node === 'object') return text(node.props?.children);
  return node == null || typeof node === 'boolean' ? '' : String(node);
}

function harness({ edit = false, failSave = false, failRefresh = false } = {}) {
  const states = [], effects = [], pending = [], events = [];
  let cursor = 0, effectCursor = 0, tree;
  const jsx = (type, props) => ({ type, props });
  const props = {
    defaultDate: '2026-11-14',
    clients: [{ id: 1, name: 'Test Client' }], caregivers: [{ id: 2, name: 'Test Caregiver' }],
    serviceCodes: [{ id: 3, code: 'W7076', description: 'Companion' }],
    ...(edit ? { shift: { id: 4, client_id: 1, employee_id: 2, service_code: 'W7076', scheduled_start: '2026-11-14T09:00:00', scheduled_end: '2026-11-14T11:00:00', status: 'Scheduled' } } : {}),
  };
  const component = compile('components/new-shift-modal.tsx', { window: { location: { search: '?mode=week&date=2026-11-01' } } }, name => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react') return {
      useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = initial;
        return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
      },
      useEffect(fn, deps) {
        const index = effectCursor++;
        if (!effects[index] || deps.some((value, i) => value !== effects[index][i])) { effects[index] = deps; pending.push(fn); }
      },
    };
    if (name === 'next/navigation') return { useRouter: () => ({
      refresh: () => events.push('refresh'),
      replace: url => events.push(`navigate:${url}`),
    }) };
    if (name.endsWith('auth-context')) return { useAuth: () => ({ user: { token: 'test' } }) };
    if (name === '@/lib/schedule-navigation') return { scheduleUrlAfterSave };
    if (name === '@/lib/datetime') return compile('lib/datetime.ts');
    if (name === '@/app/schedule/actions') return { refreshScheduleAfterSave: async () => { events.push('invalidate'); if (failRefresh) throw new Error('refresh failed'); } };
    if (name === '@/lib/queries/schedule') {
      const save = async () => { events.push(edit ? 'update' : 'create'); if (failSave) throw new Error('Save failed'); return { success: true, id: 4 }; };
      return { createSchedule: save, updateSchedule: save };
    }
    throw new Error(`Unexpected import ${name}`);
  });
  function render() {
    do {
      cursor = 0; effectCursor = 0;
      tree = component.NewShiftButton(props);
      const work = pending.splice(0);
      if (!work.length) break;
      work.forEach(fn => fn());
    } while (true);
  }
  function nodes(node = tree) {
    if (Array.isArray(node)) return node.flatMap(item => nodes(item));
    if (!node || typeof node !== 'object') return [];
    return [node, ...nodes(node.props?.children ?? null)];
  }
  render();
  return {
    events,
    find: predicate => nodes().find(predicate),
    async click(label) {
      const button = nodes().find(node => node.type === 'button' && text(node) === label);
      assert.ok(button, `button ${label} exists`);
      assert.ok(!button.props.disabled, `button ${label} is enabled`);
      await button.props.onClick(); render();
    },
    fill(label, value) {
      const field = nodes().find(node => node.props?.className === 'form-field' && text(node.props.children[0]).replace(/\s*\*$/, '').trim() === label);
      assert.ok(field, `field ${label} exists`);
      nodes(field).find(node => ['input', 'select'].includes(node.type)).props.onChange({ target: { value } }); render();
    },
  };
}

test('new shifts refresh before navigating and close without a manual page reload', async () => {
  const h = harness();
  await h.click('New Shift');
  h.fill('Client', '1'); h.fill('Caregiver', '2'); h.fill('Service Type', 'W7076');
  await h.click('Save Shift');
  assert.deepEqual(h.events, ['create', 'invalidate', 'navigate:/schedule?mode=week&date=2026-11-14']);
  assert.equal(h.find(node => node.type === 'button' && text(node) === 'Save Shift'), undefined);
});

test('edited shifts invalidate the same data before displaying the saved date', async () => {
  const h = harness({ edit: true });
  await h.click('Edit Shift');
  await h.click('Save Changes');
  assert.deepEqual(h.events, ['update', 'invalidate', 'navigate:/schedule?mode=week&date=2026-11-14']);
});

test('failed writes keep the modal open without refreshing or navigating', async () => {
  const h = harness({ failSave: true });
  await h.click('New Shift');
  h.fill('Client', '1'); h.fill('Service Type', 'W7076');
  await h.click('Save Shift');
  assert.deepEqual(h.events, ['create']);
  assert.ok(h.find(node => text(node) === 'Save failed'));
  assert.ok(h.find(node => node.type === 'button' && text(node) === 'Save Shift'));
});

test('a refresh failure never replays a successful schedule write', async () => {
  const h = harness({ failRefresh: true });
  await h.click('New Shift');
  h.fill('Client', '1'); h.fill('Service Type', 'W7076');
  await h.click('Save Shift');
  assert.deepEqual(h.events, ['create', 'invalidate', 'refresh', 'navigate:/schedule?mode=week&date=2026-11-14']);
});
