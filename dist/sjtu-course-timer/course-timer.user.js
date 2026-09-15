// ==UserScript==
// @name         交大选课定时助手（初版）
// @namespace    local.sjtu.course-timer
// @version      0.1.0
// @description  复用登录页面，定时检查指定教学班，有余量时操作原有选课按钮。
// @match        https://i.sjtu.edu.cn/xsxk/zzxkyzb_cxZzxkYzbIndex.html*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (!root.SJTUCourseTimer) {
    root.SJTUCourseTimer = api;
    if (location.hostname === 'i.sjtu.edu.cn') api.mount(root);
  }
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const SAVE_PATH = '/xsxk/zzxkyzbjk_xkBcZyZzxkYzb.html';
  const REFRESH_PATH = '/xsxk/zzxkyzbjk_cxJxbWithKchZzxkYzb.html';
  function parseBeijing(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
    if (!m) throw new Error('请填写完整的北京时间');
    const text = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}`;
    const at = Date.parse(`${text}+08:00`);
    if (!Number.isFinite(at) || new Date(at + 28800000).toISOString().slice(0, 19) !== text) {
      throw new Error('日期或时间无效');
    }
    return at;
  }
  function classifyResponse(url, status, data) {
    if (new URL(url, 'https://i.sjtu.edu.cn').pathname !== SAVE_PATH) return 'unrelated';
    if (status !== 200 || !data || typeof data !== 'object') return 'unknown';
    if (['1', '3', '6'].includes(String(data.flag))) return 'success';
    if (String(data.flag) === '-1') return 'full';
    return data.flag === undefined ? 'unknown' : 'blocked';
  }
  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new Error('已停止')); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    });
  }
  function validate(c) {
    if (!c.target?.jxbId || !c.target?.kchId) throw new Error('请先指定一个教学班');
    if (!Number.isFinite(c.startAt)) throw new Error('开始时间无效');
    if (c.dryRun !== undefined && typeof c.dryRun !== 'boolean') throw new Error('只读模式必须是布尔值');
    for (const [key, min, max] of [['intervalMs', 5000, 60000], ['maxAttempts', 1, 100], ['durationMs', 1000, 1800000]]) {
      if (!Number.isInteger(c[key]) || c[key] < min || c[key] > max) throw new Error(`${key} 超出允许范围 ${min}–${max}`);
    }
  }
  async function run(c, adapter, env = {}) {
    validate(c);
    const now = env.now || Date.now;
    const pause = env.sleep || (ms => sleep(ms, env.signal));
    const guard = () => { if (env.signal?.aborted) throw new Error('已停止'); };
    const report = env.onStatus || (() => {});
    guard();
    if (c.dryRun !== false) return { state: 'dry-run', inspection: adapter.inspect(c.target) };
    while (now() < c.startAt) {
      guard(); report(`等待开始：还有 ${Math.ceil((c.startAt - now()) / 1000)} 秒`);
      await pause(Math.min(1000, c.startAt - now()));
    }
    guard();
    if (now() - c.startAt > 5000) throw new Error('已错过开始时间超过 5 秒，请重新设置');
    const deadline = c.startAt + c.durationMs;
    for (let attempt = 1; attempt <= c.maxAttempts; attempt++) {
      guard();
      if (now() >= deadline) return { state: 'expired' };
      report(`第 ${attempt}/${c.maxAttempts} 次检查余量`);
      const item = await adapter.refresh(c.target, env.signal);
      guard();
      if (now() >= deadline) return { state: 'expired' };
      if (item.state === 'selected') return { state: 'selected' };
      if (item.state === 'available') {
        report('有余量，正在通过原有选课按钮提交');
        // Only one submission per run. A lost response must never trigger a duplicate.
        return await adapter.submit(c.target, env.signal);
      }
      if (item.state !== 'full') return item;
      if (attempt < c.maxAttempts) await pause(Math.min(c.intervalMs, Math.max(0, deadline - now())));
    }
    return { state: 'exhausted' };
  }
  // The site's legacy utility library replaces filter/some with index-first
  // callbacks and trim with an all-whitespace remover. Avoid those methods.
  const clean = str => String(str).replace(/^\s+|\s+$/g, '');
  const text = (el, selector) => clean(el.querySelector(selector)?.textContent || '');
  function matching(items, predicate) {
    const result = [];
    for (const item of items) if (predicate(item)) result.push(item);
    return result;
  }
  const value = (doc, id) => doc.getElementById(id)?.value || '';
  function context(doc) {
    return ['xkxnm', 'xkxqm', 'xkkz_id', 'kklxdm', 'xklc'].map(id => value(doc, id)).join('|');
  }
  function readRow(doc, row) {
    const kchId = text(row, '.kch_id');
    const jxbId = text(row, '.jxb_id');
    const button = row.querySelector('.an button');
    const selected = matching(doc.querySelectorAll('#choosedBox input[name="right_jxb_id"]'), el => el.value === jxbId).length > 0
      || /^(退选|已选)$/.test(text(row, '.an'));
    const countText = text(row, '.rsxx .jxbrs'), capText = text(row, '.rsxx .jxbrl');
    const validNumbers = /^\d+$/.test(countText) && /^\d+$/.test(capText);
    const direct = /^chooseCourseZzxk\s*\(/.test(button?.getAttribute('onclick') || '');
    let state = 'blocked';
    if (selected) state = 'selected';
    else if (direct && text(row, '.jxbzls') === '1' && text(row, '.do_jxb_id') && !button.disabled && validNumbers) {
      state = Number(capText) > Number(countText) ? 'available' : 'full';
    }
    return { jxbId, kchId, className: text(row, '.jxbmc'), teacher: text(row, '.jsxmzc'),
      time: text(row, '.sksj'), course: clean(doc.getElementById(`kcmc_${kchId}`)?.textContent || ''),
      count: countText, capacity: capText, state, context: context(doc) };
  }
  function scan(doc) {
    return matching(Array.from(doc.querySelectorAll('#contentBox tr.body_tr')).map(row => readRow(doc, row)),
      item => item.jxbId && item.kchId && item.className);
  }
  function createAdapter(win) {
    const doc = win.document, $ = win.jQuery;
    function inspect(target) {
      if (context(doc) !== target.context) throw new Error('选课类别、轮次或学期已变化，请重新读取教学班');
      const matches = matching(doc.querySelectorAll('#contentBox tr.body_tr'), row => text(row, '.jxb_id') === target.jxbId);
      if (matches.length !== 1) throw new Error('目标教学班不在当前页面或出现重复，请重新查询');
      const item = readRow(doc, matches[0]);
      if (item.kchId !== target.kchId || item.className !== target.className || item.teacher !== target.teacher || item.time !== target.time) {
        throw new Error('教学班信息已变化，请重新核对');
      }
      return item;
    }
    function ready(target) {
      inspect(target);
      if (win.location.hostname !== 'i.sjtu.edu.cn' || !value(doc, 'xkxnm') || value(doc, 'iskxk') !== '1') throw new Error('登录状态或选课时段无效，请检查页面');
      if (doc.visibilityState !== 'visible') throw new Error('请将选课标签页保持在前台后重新开始');
      if (!$ || typeof win.loadJxbxxZzxk !== 'function') throw new Error('页面核心脚本未就绪');
      if ($.active > 0) throw new Error('页面仍在处理其他请求，请稍后重试');
      if (hasModal()) throw new Error('页面有弹窗，请先处理');
    }
    function hasModal() {
      return matching(doc.querySelectorAll('.modal, .bootbox, [role="dialog"]'), el => win.getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0).length > 0;
    }
    function observe(path, target, action, signal) {
      return new Promise((resolve, reject) => {
        let finished = false;
        const finish = (err, result) => {
          if (finished) return; finished = true;
          clearTimeout(timer); clearInterval(modals); $(doc).off('ajaxComplete', listener);
          signal?.removeEventListener('abort', abort);
          err ? reject(err) : resolve(result);
        };
        const abort = () => finish(new Error('已停止；已发出的请求仍可能完成，请核对已选列表'));
        const listener = (_event, xhr, settings) => {
          if (new URL(settings.url, win.location.href).pathname !== path) return;
          const params = typeof settings.data === 'string' ? new URLSearchParams(settings.data) : new URLSearchParams(settings.data || {});
          if (params.get('kch_id') !== target.kchId) return;
          let data = xhr.responseJSON;
          if (data === undefined) { try { data = JSON.parse(xhr.responseText); } catch {} }
          finish(null, { status: xhr.status, data, url: settings.url });
        };
        const timer = setTimeout(() => finish(new Error('响应超时；结果未确认，已停止，请核对已选列表')), 15000);
        const modals = setInterval(() => { if (hasModal()) finish(new Error('学校页面要求人工处理弹窗，已停止')); }, 100);
        $(doc).on('ajaxComplete', listener);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) return abort();
        try { action(); } catch (err) { finish(err); }
      });
    }
    return {
      inspect,
      async refresh(target, signal) {
        ready(target);
        if (inspect(target).state === 'selected') return { state: 'selected' };
        const heading = matching(doc.querySelectorAll('.panel-heading'), el => el.querySelector('input[name="kch_id"]')?.value === target.kchId)[0];
        const marker = heading?.querySelector('input[name="czzt"]');
        if (!marker) throw new Error('找不到原页面的课程刷新入口');
        const response = await observe(REFRESH_PATH, target, () => { marker.value = '0'; win.loadJxbxxZzxk(heading); }, signal);
        if (response.status !== 200 || !Array.isArray(response.data) || !matching(response.data, row => row.jxb_id === target.jxbId).length) {
          throw new Error('余量响应无效或登录已过期，请重新查询');
        }
        // The site's callback updates the DOM on its own 1 ms timer.
        await sleep(50, signal);
        if (hasModal()) throw new Error('学校页面要求人工处理弹窗，已停止');
        return inspect(target);
      },
      async submit(target, signal) {
        ready(target);
        const latest = inspect(target);
        if (latest.state !== 'available') return { state: latest.state };
        // No confirmation dialogs or validation checks are bypassed.
        const row = matching(doc.querySelectorAll('#contentBox tr.body_tr'), row => text(row, '.jxb_id') === target.jxbId)[0];
        const response = await observe(SAVE_PATH, target, () => row.querySelector('.an button').click(), signal);
        return { state: classifyResponse(response.url, response.status, response.data) };
      }
    };
  }
  function mount(win) {
    const doc = win.document;
    if (!doc.getElementById('xkxnm') || doc.getElementById('sjtu-course-timer')) return;
    const host = doc.createElement('div'); host.id = 'sjtu-course-timer';
    host.style.cssText = 'position:fixed;right:55px;bottom:20px;z-index:9999;width:370px;max-width:90vw;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host{font:14px/1.5 system-ui,sans-serif;color:#263142}*{box-sizing:border-box}
      section{background:#fff;border:1px solid #d9dfe7;border-radius:12px;box-shadow:0 10px 38px #0003;overflow:hidden}
      header{background:#790b0b;color:white;padding:12px 16px;display:flex;justify-content:space-between;align-items:center}
      h2{font-size:16px;margin:0}main{padding:14px}p{margin:0 0 10px;color:#536174;font-size:12px}
      label{display:block;margin:9px 0 4px}select,input:not([type=checkbox]){width:100%;padding:8px;border:1px solid #cbd3df;border-radius:6px;font:inherit}
      button{cursor:pointer;border:1px solid #cbd3df;border-radius:6px;padding:7px 10px;background:#f6f8fb;font:inherit;color:#263142}
      button:disabled{opacity:.5;cursor:default}.primary{background:#790b0b;color:white;border-color:#790b0b}
      .row{display:flex;gap:8px;margin-top:10px}.row>*{flex:1}.small{font-size:12px}#detail{white-space:pre-wrap;margin:8px 0}
      #status{background:#f2f5f9;border-radius:6px;padding:10px;margin-top:12px;white-space:pre-wrap;max-height:120px;overflow:auto}
      header button{padding:0 7px;background:transparent;color:white;border-color:#ffffff70}input[type=checkbox]{vertical-align:middle}
    </style><section><header><h2>交大选课定时助手 · 初版</h2><button id="fold" type="button">收起</button></header><main>
      <p>先在原页面查询并展开课程，再读取教学班。任务期间保持此标签页在前台。</p>
      <button id="scan" type="button">读取当前教学班</button>
      <label for="target">目标教学班</label><select id="target"><option value="">请先读取并选择</option></select>
      <p id="detail"></p><label for="start">开始时间（北京时间）</label><input id="start" type="datetime-local" step="1">
      <div class="row"><label>检查间隔（秒）<input id="interval" type="number" min="5" max="60" value="5"></label><label>最多检查次数<input id="attempts" type="number" min="1" max="100" value="60"></label></div>
      <label class="small"><input id="dry" type="checkbox" checked> 仅检查，不刷新余量、不提交选课</label>
      <div class="row"><button id="startBtn" class="primary" type="button">执行检查</button><button id="stop" type="button" disabled>停止</button></div>
      <div id="status" role="status">尚未启动任何任务。</div>
      <p style="margin-top:9px">提交最多一次；满员时继续检查余量。遇到弹窗或结果不明即停止。刷新或关闭页面会取消任务。</p>
    </main></section>`;
    doc.body.appendChild(host);
    const el = id => shadow.getElementById(id);
    const adapter = createAdapter(win);
    let targets = [], controller = null;
    const status = msg => { el('status').textContent = msg; };
    const states = { 'dry-run': '只读检查完成，未发出请求、未提交。', success: '服务器已确认选课成功，请核对右侧已选列表。',
      selected: '这个教学班已经在已选列表中，无需重复选课。', full: '提交时名额已满，本次任务已停止，请查看页面提示。',
      blocked: '教学班状态不支持自动提交，或学校校验未通过。请查看原页面。', unknown: '提交结果未确认，已停止；请先检查已选列表。',
      exhausted: '已达到检查次数上限，未提交。', expired: '已达到最长运行时限，未提交。' };
    const labels = { available: '有余量', full: '已满', selected: '已选', blocked: '暂不支持自动提交' };
    el('start').value = new Date(Date.now() + 28800000 + 60000).toISOString().slice(0, 19);
    el('fold').onclick = () => { const main = shadow.querySelector('main'); main.hidden = !main.hidden; el('fold').textContent = main.hidden ? '展开' : '收起'; };
    el('scan').onclick = () => {
      targets = scan(doc); el('target').replaceChildren(new Option('请选择一个教学班', ''));
      for (const [index, t] of targets.entries()) el('target').add(new Option(`${t.className} ${t.teacher} [${t.count}/${t.capacity}]`, String(index)));
      el('detail').textContent = ''; status(`读取到 ${targets.length} 个教学班；尚未启动任务。`);
    };
    el('target').onchange = () => {
      const t = el('target').value === '' ? null : targets[Number(el('target').value)];
      el('detail').textContent = t ? `${t.course}\n${t.className} ${t.teacher}\n${t.time}\n已选/容量：${t.count}/${t.capacity}` : '';
    };
    el('dry').onchange = () => { el('startBtn').textContent = el('dry').checked ? '执行检查' : '启动定时选课'; };
    const controls = ['scan', 'target', 'start', 'interval', 'attempts', 'dry', 'startBtn'];
    el('stop').onclick = () => controller?.abort();
    el('startBtn').onclick = async () => {
      if (controller) return;
      try {
        const target = el('target').value === '' ? null : targets[Number(el('target').value)];
        const config = { target, startAt: parseBeijing(el('start').value), intervalMs: Number(el('interval').value) * 1000,
          maxAttempts: Number(el('attempts').value), durationMs: 1800000, dryRun: el('dry').checked };
        validate(config);
        if (!config.dryRun && config.startAt <= Date.now()) throw new Error('正式模式请设置未来的开始时间');
        controller = new AbortController(); controls.forEach(id => { el(id).disabled = true; }); el('stop').disabled = false;
        const result = await run(config, adapter, { signal: controller.signal, onStatus: status });
        status((states[result.state] || result.state) + (result.inspection ? `\n当前状态：${labels[result.inspection.state] || '待核对'}；已选/容量 ${result.inspection.count}/${result.inspection.capacity}` : ''));
      } catch (err) { status(err.message); }
      finally { controller = null; controls.forEach(id => { el(id).disabled = false; }); el('stop').disabled = true; }
    };
    win.addEventListener('pagehide', () => controller?.abort());
  }
  return { parseBeijing, classifyResponse, run, scan, createAdapter, mount };
});
