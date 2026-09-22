const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../l3_workbench/static/learning-core.js');

const flush = () => new Promise(resolve => setImmediate(resolve));

// Run the real page script with controlled HTTP responses and timers. Hooks only
// expose closure state; monitor, initialization and click handlers are unchanged.
function page() {
  const elements = new Map(), timers = [], requests = [], posts = [];
  const context = new Proxy({}, {get: () => () => {}});
  const element = () => ({
    textContent: '', hidden: false, disabled: false, value: '0',
    classList: {toggle() {}, add() {}},
    getContext: () => context, replaceChildren() {}, append() {},
  });
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const sandbox = {
    FlyLearning: core,
    document: {getElementById: getElement, createElement: element},
    setTimeout(callback, ms) { timers.push({callback, ms}); return timers.length; },
    clearTimeout() {}, AbortSignal, Date, JSON, Blob, URL,
    fetch(url, options) {
      if (options?.body) posts.push(JSON.parse(options.body));
      return new Promise((resolve, reject) => requests.push({
        url, options, reject,
        respond(data, status = 200) {
          resolve({ok: status >= 200 && status < 300, status, json: async () => data});
        },
      }));
    },
  };
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(__dirname, '../l3_workbench/static/learning.js'), 'utf8');
  assert.match(source, /\}\)\(\);\s*$/);
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, `
    globalThis.testHooks = {
      monitor, getDemo: () => demo,
      setDemo: value => demo = value,
      setBusy: value => demoBusy = value,
    };
  })();`), sandbox);
  return {
    hooks: sandbox.testHooks, el: getElement, posts,
    request() {
      assert.ok(requests.length, 'expected an HTTP request');
      return requests.shift();
    },
    async tick(ms) {
      const index = timers.findIndex(timer => timer.ms === ms);
      assert.notEqual(index, -1, `expected a ${ms} ms timer`);
      timers.splice(index, 1)[0].callback();
      await flush();
    },
  };
}

function record(runId = '20260917-120000-abcdef') {
  return {trial: new core.LearningSession(0).preview(), runId,
    status: 'running', finished: false, path: []};
}

function state(record, overrides = {}) {
  return {run_id: record.runId, config: {mode: 'auto', targets: [record.trial.target]},
    status: 'running', arrived: false, ack_id: 1, pending: false, token: 'test',
    frame_version: 1, sample: {t: 1, x: 18, y: 10, distance_mm: 3}, ...overrides};
}

test('late arrived response cannot pause or overwrite a replacement demo', async () => {
  const p = page(), old = record();
  p.hooks.setDemo(old);
  const monitor = p.hooks.monitor(old);
  await p.tick(500);
  const pending = p.request();
  old.finished = true;
  old.status = 'replaced';
  const replacement = record('20260917-120001-fedcba');
  replacement.status = 'initializing';
  p.hooks.setDemo(replacement);
  p.el('demoStatus').textContent = 'new demo initializing';
  pending.respond(state(old, {arrived: true}));
  await monitor;
  assert.deepEqual(p.posts, []);
  assert.equal(p.el('demoStatus').textContent, 'new demo initializing');
  assert.equal(old.status, 'replaced');
  assert.equal(old.path.length, 0);
});

test('late network failure cannot turn an ended demo into an error', async () => {
  const p = page(), old = record();
  p.hooks.setDemo(old);
  const monitor = p.hooks.monitor(old);
  await p.tick(500);
  const pending = p.request();
  old.finished = true;
  old.status = 'stopped';
  p.el('demoStatus').textContent = 'ended';
  pending.reject(new Error('late network failure'));
  await monitor;
  assert.equal(old.status, 'stopped');
  assert.equal(p.el('demoStatus').textContent, 'ended');
});

test('in-flight telemetry is ignored while a demo control operation is busy', async () => {
  const p = page(), old = record();
  p.hooks.setDemo(old);
  const monitor = p.hooks.monitor(old);
  await p.tick(500);
  p.hooks.setBusy(true);
  p.request().respond(state(old, {arrived: true}));
  await flush();
  assert.deepEqual(p.posts, []);
  assert.equal(old.path.length, 0);
  assert.equal(old.status, 'running');
  old.finished = true;
  await p.tick(500);
  await monitor;
});

test('same-target foreign reset acknowledgement cannot start the foreign run', async () => {
  const p = page();
  const start = p.el('demo').onclick();
  p.request().respond(state(record()));
  await flush();
  p.request().respond({command_id: 10});
  await flush();
  const created = p.hooks.getDemo();
  p.request().respond(state(created, {run_id: '20260917-120002-fedcba', ack_id: 11, status: 'paused'}));
  await start;
  assert.deepEqual(p.posts.map(post => post.op), ['reset']);
  assert.equal(created.status, 'error');
  assert.match(p.el('demoStatus').textContent, /其他页面覆盖/);
  assert.equal(created.runId, null);
});

test('control command carries run identity and reports rejection after external reset', async () => {
  const p = page(), old = record();
  p.hooks.setDemo(old);
  const pause = p.el('pauseDemo').onclick();
  p.request().respond(state(old));
  await flush();
  assert.deepEqual(p.posts, [{op: 'pause', expected_run_id: old.runId}]);
  p.request().respond({error: '实验已改变'}, 400);
  await pause;
  assert.equal(old.status, 'error');
  assert.match(p.el('demoStatus').textContent, /实验已改变/);
});

test('pause acknowledgement from a different run is rejected even for the same target', async () => {
  const p = page(), old = record();
  p.hooks.setDemo(old);
  const pause = p.el('pauseDemo').onclick();
  p.request().respond(state(old));
  await flush();
  p.request().respond({command_id: 20});
  await flush();
  p.request().respond(state(old, {run_id: '20260917-120002-fedcba', ack_id: 21, status: 'paused'}));
  await pause;
  assert.equal(old.status, 'error');
  assert.match(p.el('demoStatus').textContent, /实验已改变/);
});

test('automatic arrival pause locks controls and targets the current run', async () => {
  const p = page(), old = record();
  p.hooks.setDemo(old);
  const monitor = p.hooks.monitor(old);
  await p.tick(500);
  p.request().respond(state(old, {arrived: true}));
  await flush();
  assert.equal(p.el('demo').disabled, true);
  assert.equal(p.el('endDemo').disabled, true);
  assert.deepEqual(p.posts, [{op: 'pause', expected_run_id: old.runId}]);
  p.request().respond({command_id: 30});
  await monitor;
  assert.equal(old.status, 'arrived');
  assert.equal(old.finished, true);
  assert.equal(p.el('demo').disabled, false);
});

test('JSON export saves authenticated content and exposes a persistent download link', async () => {
  const p = page();
  const exporting = p.el('exportJSON').onclick();
  assert.equal(p.el('exportJSON').disabled, true);
  assert.equal(p.el('exportCSV').disabled, true);
  assert.equal(p.el('exportLink').hidden, true);
  p.request().respond(state(record(), {token: 'export-session-token'}));
  await flush();
  const request = p.request();
  assert.equal(request.url, '/api/learning/export');
  assert.equal(request.options.headers['X-Session-Token'], 'export-session-token');
  const payload = p.posts.at(-1);
  assert.equal(payload.format, 'json');
  const data = JSON.parse(payload.content);
  assert.equal(data.version, 1);
  assert.equal(data.weights.length, 65);
  assert.equal(data.history.length, 0);
  assert.equal(data.tests[0].count, 200);
  const url = '/api/learning/download/0123456789abcdef0123456789abcdef/records.json';
  request.respond({url, path: 'outputs/l3-learning/example/records.json'});
  await exporting;
  assert.equal(p.el('exportLink').href, url);
  assert.equal(p.el('exportLink').hidden, false);
  assert.equal(p.el('exportResult').hidden, false);
  assert.equal(p.el('exportJSON').disabled, false);
  assert.equal(p.el('exportCSV').disabled, false);
  assert.match(p.el('exportMessage').textContent, /已保存/);
});

test('CSV export preserves a real training record and newline separators', async () => {
  const p = page();
  const training = p.el('one').onclick();
  await p.tick(0);
  await training;
  p.el('exportCSV').onclick();
  p.request().respond(state(record()));
  await flush();
  const request = p.request();
  const payload = p.posts.at(-1);
  assert.equal(payload.format, 'csv');
  const lines = payload.content.split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], 'round,label,action,reward,probability_triangle,image_seed,left_option,right_option');
  assert.equal(lines[1].split(',')[0], '1');
  assert.equal(lines[1].split(',').length, 8);
  request.respond({url: '/api/learning/download/0123456789abcdef0123456789abcdef/training.csv', path: 'outputs/l3-learning/example/training.csv'});
  await flush();
  assert.equal(p.el('exportLink').hidden, false);
  assert.match(p.el('exportLink').textContent, /CSV/);
});

test('failed export hides any previous download link and allows retry', async () => {
  const p = page();
  p.el('exportLink').hidden = false;
  p.el('exportLink').href = '/old-download';
  const exporting = p.el('exportJSON').onclick();
  assert.equal(p.el('exportLink').hidden, true);
  p.request().respond(state(record()));
  await flush();
  p.request().respond({error: '磁盘空间不足'}, 400);
  await exporting;
  assert.equal(p.el('exportLink').hidden, true);
  assert.match(p.el('exportMessage').textContent, /导出失败：磁盘空间不足/);
  assert.equal(p.el('exportJSON').disabled, false);
  assert.equal(p.el('exportCSV').disabled, false);
});
