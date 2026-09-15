const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = path.join(__dirname, '../course-timer.user.js');
const core = fs.existsSync(script) ? require(script) : {};

const config = (extra = {}) => ({ startAt: 10000, intervalMs: 5000, maxAttempts: 3,
  durationMs: 60000, dryRun: false, target: { jxbId: 'class-a', kchId: 'course-a' }, ...extra });
function harness(states = ['available'], result = 'success') {
  let time = 0, reads = 0, submits = 0;
  const effects = [];
  const env = { now: () => time, sleep: async ms => { time += ms; } };
  const adapter = {
    inspect: () => ({ state: 'available' }),
    refresh: async () => { effects.push(['refresh', time]); return { state: states[Math.min(reads++, states.length - 1)] }; },
    submit: async () => { submits++; effects.push(['submit', time]); return { state: result }; }
  };
  return { env, adapter, effects, get submits() { return submits; } };
}
test('Beijing input means UTC+8 regardless of machine timezone', () => {
  assert.equal(core.parseBeijing('2026-09-15T13:00:00'), Date.UTC(2026, 8, 15, 5));
});
test('invalid calendar dates and ambiguous strings are rejected', () => {
  for (const value of ['2026-02-30T13:00:00', 'tomorrow', '', '2026-09-15T25:00:00']) {
    assert.throws(() => core.parseBeijing(value));
  }
});
test('unknown responses and preflight success are never final success', () => {
  const final = '/xsxk/zzxkyzbjk_xkBcZyZzxkYzb.html?gnmkdm=N253512';
  for (const flag of ['1', '3', '6']) assert.equal(core.classifyResponse(final, 200, {flag}), 'success');
  assert.equal(core.classifyResponse('/xsxk/zzxkyzb_cxXkTitleMsg.html', 200, {flag: '1'}), 'unrelated');
  assert.equal(core.classifyResponse(final, 200, {flag: '-1'}), 'full');
  assert.equal(core.classifyResponse(final, 503, {flag: '1'}), 'unknown');
  assert.equal(core.classifyResponse(final, 200, '<html>login</html>'), 'unknown');
});
test('default dry run does not refresh or submit or wait', async () => {
  const h = harness();
  const c = config(); delete c.dryRun;
  assert.equal((await core.run(c, h.adapter, h.env)).state, 'dry-run');
  assert.deepEqual(h.effects, []);
  assert.equal(h.env.now(), 0);
});
test('waits until scheduled time; polls full class then submits exactly once', async () => {
  const h = harness(['full', 'available']);
  assert.equal((await core.run(config(), h.adapter, h.env)).state, 'success');
  assert.deepEqual(h.effects, [['refresh', 10000], ['refresh', 15000], ['submit', 15000]]);
});
test('capacity polling stops at configured attempt limit', async () => {
  const h = harness(['full']);
  assert.equal((await core.run(config(), h.adapter, h.env)).state, 'exhausted');
  assert.equal(h.effects.length, 3);
  assert.equal(h.submits, 0);
});
test('ambiguous or failed submission is never retried', async () => {
  for (const state of ['unknown', 'blocked', 'full']) {
    const h = harness(['available'], state);
    assert.equal((await core.run(config(), h.adapter, h.env)).state, state);
    assert.equal(h.submits, 1);
  }
});
test('already selected class is not submitted', async () => {
  const h = harness(['selected']);
  assert.equal((await core.run(config(), h.adapter, h.env)).state, 'selected');
  assert.equal(h.submits, 0);
});
test('cancellation while waiting prevents all website activity', async () => {
  const h = harness(); const controller = new AbortController();
  h.env.sleep = async () => controller.abort(); h.env.signal = controller.signal;
  await assert.rejects(() => core.run(config(), h.adapter, h.env), /停止/);
  assert.deepEqual(h.effects, []);
});
test('late wakeup refuses to submit and reports missed start', async () => {
  const h = harness(); h.env.now = () => 20000;
  await assert.rejects(() => core.run(config(), h.adapter, h.env), /错过/);
  assert.equal(h.submits, 0);
});
test('unsafe polling values and missing target fail before any website activity', async () => {
  for (const extra of [{intervalMs: 1}, {maxAttempts: 0}, {durationMs: Infinity}, {target: {}}, {dryRun: 'false'}]) {
    const h = harness();
    await assert.rejects(() => core.run(config(extra), h.adapter, h.env));
    assert.deepEqual(h.effects, []);
  }
});
test('expired duration after refresh prevents a late submission', async () => {
  const h = harness();
  h.adapter.refresh = async () => { await h.env.sleep(61000); return {state: 'available'}; };
  assert.equal((await core.run(config(), h.adapter, h.env)).state, 'expired');
  assert.equal(h.submits, 0);
});
test('works when the legacy site reverses filter and some callbacks and changes trim', () => {
  const realm = vm.createContext({module: {exports: {}}, URL, setTimeout, clearTimeout});
  vm.runInContext(`Array.prototype.filter=function(f){const out=[];for(let i=0;i<this.length;i++)if(f(i,this[i]))out.push(this[i]);return out};
    Array.prototype.some=function(f){for(let i=0;i<this.length;i++)if(f(i,this[i]))return true;return false};
    String.prototype.trim=function(){return this.replace(/\\s+/g,'')};`, realm);
  vm.runInContext(fs.readFileSync(script, 'utf8'), realm);
  const cells = {'.jxb_id': 'class-a', '.kch_id': 'course-a', '.jxbmc': 'Class A', '.jsxmzc': 'Teacher A',
    '.sksj': 'Monday 1-2', '.rsxx .jxbrs': '20', '.rsxx .jxbrl': '30', '.jxbzls': '1', '.do_jxb_id': 'dynamic-a'};
  const row = { querySelector: selector => selector === '.an button'
    ? {disabled:false, getAttribute:()=>"chooseCourseZzxk('class-a')"}
    : cells[selector] ? {textContent:cells[selector]} : null };
  const doc = {getElementById:()=>null, querySelectorAll: selector => selector === '#contentBox tr.body_tr' ? [row] : []};
  const items = realm.module.exports.scan(doc);
  assert.equal(items.length, 1);
  assert.equal(items[0].className, 'Class A');
  assert.equal(items[0].teacher, 'Teacher A');
  assert.equal(items[0].state, 'available');
});
