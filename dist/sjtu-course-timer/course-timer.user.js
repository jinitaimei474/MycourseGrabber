// ==UserScript==
// @name         交大选课定时助手（多课程版）
// @namespace    local.sjtu.course-timer
// @version      0.3.0
// @description  并发检查多课程余量，逐笔核对选课，全部成功或到设定结束时间时结束。
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
    if (!Array.isArray(c.targets) || !c.targets.length) throw new Error('请先添加课程');
    const courses = new Set();
    for (const target of c.targets) {
      if (!target?.jxbId || !target?.kchId || courses.has(target.kchId)) throw new Error('每门课程只能指定一个教学班，不能重复添加');
      courses.add(target.kchId);
    }
    if (!Number.isFinite(c.startAt) || !Number.isFinite(c.endAt) || c.endAt <= c.startAt) throw new Error('结束时间必须晚于开始时间');
    if (c.dryRun !== undefined && typeof c.dryRun !== 'boolean') throw new Error('只读模式必须是布尔值');
    if (!Number.isInteger(c.intervalMs) || c.intervalMs < 5000 || c.intervalMs > 60000) throw new Error('检查间隔须为 5–60 秒');
  }
  async function run(c, adapter, env = {}) {
    validate(c);
    const now = env.now || Date.now;
    const pause = env.sleep || (ms => sleep(ms, env.signal));
    const guard = () => { if (env.signal?.aborted) throw new Error('已停止'); };
    const report = env.onStatus || (() => {});
    const courses = c.targets.map(target => ({ target, state: 'pending', attempts: 0, message: '等待检查' }));
    const update = () => env.onUpdate?.(courses.map(item => ({...item})));
    const allDone = () => matching(courses, item => item.state !== 'success').length === 0;
    const result = state => ({state, courses});
    guard();
    if (c.dryRun !== false) {
      for (const item of courses) {
        try { item.inspection = adapter.inspect(item.target); item.message = '已读取当前页面'; }
        catch (error) { item.message = `当前页面未能核实，运行时将重新查询：${error.message}`; }
      }
      update(); return result('dry-run');
    }
    while (now() < c.startAt) {
      guard(); report(`等待开始：还有 ${Math.ceil((c.startAt - now()) / 1000)} 秒`);
      await pause(Math.min(1000, c.startAt - now()));
    }
    guard();
    const setState = (item, state) => {
      if (state === 'success' || state === 'selected') { item.state = 'success'; item.message = '已成功选上'; }
      else if (state === 'unknown') { item.state = 'uncertain'; item.message = '提交结果不明；先核对已选列表'; }
      else { item.state = 'waiting'; item.message = state === 'full' ? '满员，继续等待名额' : '暂不可选，等待页面状态恢复'; }
    };
    async function select(item) {
      item.state = 'waiting';
      if (env.signal?.aborted || now() >= c.endAt) { item.message = '已停止或到达结束时间，未提交'; update(); return; }
      item.message = '正在核对教学班，提交前再次刷新'; update();
      let submitting = false;
      try {
        await adapter.prepare(item.target, env.signal, c.endAt);
        guard(); if (now() >= c.endAt) return;
        let state = (await adapter.refresh(item.target, env.signal, c.endAt)).state;
        guard(); if (now() >= c.endAt) return;
        if (state === 'available') {
          submitting = true;
          report(`正在选择 ${item.target.className || item.target.jxbId}；若学校显示确认弹窗，请处理`);
          state = (await adapter.submit(item.target, env.signal, c.endAt)).state;
        }
        setState(item, state);
      } catch (error) {
        item.state = submitting ? 'uncertain' : 'waiting'; item.message = error.message;
      }
      update();
    }
    while (now() < c.endAt) {
      guard();
      if (allDone()) return result('success');
      for (const item of courses) {
        if (item.state !== 'success') {
          try {
            if (adapter.isSelected?.(item.target) || adapter.inspect(item.target).state === 'selected') { item.state = 'success'; item.message = '已在页面核实为已选'; }
          } catch {}
        }
        if (item.state === 'uncertain' && env.takeRetry?.(item.target)) { item.state = 'pending'; item.message = '已人工核对，允许重试'; }
      }
      const pending = matching(courses, item => item.state !== 'uncertain' && item.state !== 'success');
      let cursor = 0, submissions = Promise.resolve();
      report(`本轮并发检查 ${pending.length} 门课程（最多 4 个查询同时进行）`);
      async function worker() {
        while (cursor < pending.length && !env.signal?.aborted && now() < c.endAt) {
          const item = pending[cursor++];
          try {
            item.attempts++; item.state = 'checking'; item.message = '正在向服务器查询余量'; update();
            const found = await adapter.probe(item.target, env.signal, c.endAt);
            if (env.signal?.aborted || now() >= c.endAt) { item.state = 'waiting'; item.message = '已停止或到达结束时间'; update(); return; }
            if (found.count !== undefined) item.message = `已选/容量：${found.count}/${found.capacity}`;
            if (found.state === 'available') {
              item.state = 'queued'; item.message = `发现余量，等待页面核对后提交${found.count !== undefined ? `（${found.count}/${found.capacity}）` : ''}`;
              // Only read-only queries overlap. Original website operations share
              // DOM/global state and must own the page until their response arrives.
              submissions = submissions.then(() => select(item));
            } else setState(item, found.state);
          } catch (error) {
            item.state = 'waiting'; item.message = error.message;
          }
          update();
        }
      }
      await Promise.all(Array.from({length: Math.min(4, pending.length)}, () => worker()));
      await submissions;
      guard();
      update();
      if (allDone()) return result('success');
      if (now() >= c.endAt) break;
      report(`继续等待，${matching(courses, x => x.state === 'success').length}/${courses.length} 门已成功`);
      await pause(Math.min(c.intervalMs, c.endAt - now()));
    }
    guard(); return result('expired');
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
    const course = clean(doc.getElementById(`kcmc_${kchId}`)?.textContent || '');
    return { jxbId, kchId, className: text(row, '.jxbmc'), teacher: text(row, '.jsxmzc'),
      time: text(row, '.sksj'), course, keyword: /^\(([^)]+)\)/.exec(course)?.[1] || '',
      tabId: doc.querySelectorAll('#nav_tab li.active a')[0]?.id || '',
      count: countText, capacity: capText, state, context: context(doc) };
  }
  function scan(doc) {
    return matching(Array.from(doc.querySelectorAll('#contentBox tr.body_tr')).map(row => readRow(doc, row)),
      item => item.jxbId && item.kchId && item.className);
  }
  function createAdapter(win) {
    const doc = win.document, $ = win.jQuery;
    function inspect(target, details = true) {
      if (context(doc) !== target.context) throw new Error('选课类别、轮次或学期已变化，请重新读取教学班');
      const matches = matching(doc.querySelectorAll('#contentBox tr.body_tr'), row => text(row, '.jxb_id') === target.jxbId);
      if (matches.length !== 1) throw new Error('目标教学班不在当前页面或出现重复，请重新查询');
      const item = readRow(doc, matches[0]);
      if (item.kchId !== target.kchId || item.className !== target.className || (details && (item.teacher !== target.teacher || item.time !== target.time))) {
        throw new Error('教学班信息已变化，请重新核对');
      }
      return item;
    }
    function ready(target, details = true) {
      inspect(target, details);
      if (win.location.hostname !== 'i.sjtu.edu.cn' || !value(doc, 'xkxnm') || value(doc, 'iskxk') !== '1') throw new Error('登录状态或选课时段无效，请检查页面');
      if (!$ || typeof win.loadJxbxxZzxk !== 'function') throw new Error('页面核心脚本未就绪');
      if ($.active > 0) throw new Error('页面仍在处理其他请求，请稍后重试');
      if (hasModal()) throw new Error('页面有弹窗，处理后自动继续');
    }
    function hasModal() {
      return matching(doc.querySelectorAll('.modal, .bootbox, [role="dialog"]'), el => win.getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0).length > 0;
    }
    function checkpoint(signal, endAt = Infinity) {
      if (signal?.aborted) throw new Error('已停止');
      if (Date.now() >= endAt) throw new Error('已到结束时间');
    }
    function capture(target) {
      inspect(target, false);
      const heading = matching(doc.querySelectorAll('.panel-heading'), el => el.querySelector('input[name="kch_id"]')?.value === target.kchId)[0];
      if (!heading || !$?.param) throw new Error('缺少课程查询参数，请重新查询后读取');
      // Same payload as the captured school loadJxbxxZzxk implementation.
      // Freeze the encoded payload now, before another course changes category.
      const params = {...$('#searchBox').searchBox('getConditions')};
      const fields = 'rwlx xkly bklx_id sfkkjyxdxnxq kzkcgs xqh_id jg_id zyh_id zyfx_id txbsfrl njdm_id bh_id xbm xslbdm mzm xz ccdm xsbj sfkknj gnjkxdnj sfkkzy kzybkxy sfznkx zdkxms sfkxq bhbcyxkjxb sfkcfx bbhzxjxb kkbk kkbkdj bklbkcj xkxnm xkxqm xkxskcgskg rlkz cdrlkz cxcykclxxskg rlzlkz kklxdm jxbzcxskg zxgbxkkg xklc xkkz_id'.split(' ');
      for (const field of fields) params[field] = value(doc, field === 'jg_id' ? 'jg_id_1' : field);
      params.kch_id = target.kchId;
      params.cxbj = heading.querySelector('input[name="cxbj"]')?.value || '';
      params.fxbj = heading.querySelector('input[name="fxbj"]')?.value || '';
      return {...target, queryBody: $.param(params)};
    }
    async function probe(target, signal, endAt = Infinity) {
      checkpoint(signal, endAt);
      if (win.location.hostname !== 'i.sjtu.edu.cn' || value(doc, 'iskxk') !== '1') throw new Error('登录状态或选课时段无效，请检查页面');
      if (context(doc).split('|').slice(0, 2).join('|') !== target.context.split('|').slice(0, 2).join('|')) throw new Error('学期已变化，请重新添加课程');
      const params = new URLSearchParams(target.queryBody || '');
      if (params.get('kch_id') !== target.kchId || ['xkxnm','xkxqm','xkkz_id','kklxdm','xklc'].map(key => params.get(key)).join('|') !== target.context) {
        throw new Error('课程查询参数缺失或不匹配，请重新读取并添加课程');
      }
      const data = await new Promise((resolve, reject) => {
        const xhr = new win.XMLHttpRequest();
        let finished = false, timer;
        const finish = (error, data) => {
          if (finished) return; finished = true;
          clearTimeout(timer); signal?.removeEventListener('abort', abort);
          xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = null;
          if (error) { xhr.abort(); reject(error); } else resolve(data);
        };
        const abort = () => finish(new Error('已停止'));
        xhr.onload = () => {
          try {
            checkpoint(signal, endAt);
            if (xhr.status !== 200) throw new Error(`余量查询失败（HTTP ${xhr.status}）`);
            const data = JSON.parse(xhr.responseText);
            if (!Array.isArray(data)) throw new Error('余量响应无效或登录已过期');
            finish(null, data);
          } catch (error) { finish(error); }
        };
        xhr.onerror = () => finish(new Error('余量查询网络异常，下一轮重试'));
        xhr.onabort = () => finish(new Error('余量查询已取消'));
        xhr.ontimeout = () => finish(new Error('余量查询超时，下一轮重试'));
        signal?.addEventListener('abort', abort, {once:true});
        timer = setTimeout(() => finish(new Error(Date.now() >= endAt ? '已到结束时间' : '余量查询超时，下一轮重试')), Math.min(15000, Math.max(0, endAt - Date.now())));
        try {
          checkpoint(signal, endAt);
          xhr.open('POST', REFRESH_PATH, true);
          xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
          xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
          xhr.send(target.queryBody);
        } catch (error) { finish(error); }
      });
      const rows = matching(data, row => row && row.jxb_id === target.jxbId);
      if (rows.length !== 1 || !/^\d+$/.test(String(rows[0].yxzrs)) || !/^\d+$/.test(String(rows[0].jxbrl))) throw new Error('响应中缺少目标教学班或有效人数，请核对课程');
      const count = Number(rows[0].yxzrs), capacity = Number(rows[0].jxbrl);
      return {state: capacity > count ? 'available' : 'full', count, capacity};
    }
    async function waitUntil(predicate, signal, endAt) {
      const timeout = Date.now() + 15000;
      for (;;) {
        checkpoint(signal, endAt);
        if (hasModal()) throw new Error('页面有弹窗，处理后自动继续');
        if (predicate()) return;
        if (Date.now() >= timeout) throw new Error('页面查询未完成或没有找到目标教学班，请检查登录及筛选条件');
        await sleep(100, signal);
      }
    }
    async function prepare(target, signal, endAt = Infinity) {
      checkpoint(signal, endAt);
      if (!$ || typeof win.loadJxbxxZzxk !== 'function') throw new Error('页面核心脚本未就绪');
      const currentTerm = context(doc).split('|').slice(0, 2).join('|');
      if (currentTerm !== target.context.split('|').slice(0, 2).join('|')) throw new Error('学期已变化，请重新添加课程');
      await waitUntil(() => $.active === 0, signal, endAt);
      if (context(doc) !== target.context) {
        const tab = doc.getElementById(target.tabId);
        if (!tab || !target.tabId.startsWith('tab_kklx_')) throw new Error('找不到目标课程类别，请重新添加');
        // Respect the original site's minimum interval between category switches.
        const delay = Math.max(0, 5100 - (Date.now() - (Number(win.tabChangeTime) || 0)));
        if (delay) await sleep(Math.min(delay, Math.max(0, endAt - Date.now())), signal);
        checkpoint(signal, endAt); tab.click();
        await sleep(250, signal);
        await waitUntil(() => $.active === 0 && context(doc) === target.context, signal, endAt);
      }
      const hasRow = () => matching(doc.querySelectorAll('#contentBox tr.body_tr'), row => text(row, '.jxb_id') === target.jxbId).length === 1;
      if (!hasRow()) {
        const input = doc.querySelector('#searchBox input[name="searchInput"]');
        const query = doc.querySelector('#searchBox button[name="query"]');
        if (!input || !query || !target.keyword) throw new Error('缺少课程查询入口或课程号，请重新添加');
        checkpoint(signal, endAt); input.value = target.keyword; query.click();
        await waitUntil(() => $.active === 0 && hasRow(), signal, endAt);
      }
      checkpoint(signal, endAt);
      inspect(target, false);
    }
    function observe(path, target, action, signal, endAt = Infinity) {
      checkpoint(signal, endAt);
      const row = matching(doc.querySelectorAll('#contentBox tr.body_tr'), row => text(row, '.jxb_id') === target.jxbId)[0];
      const expectedOperation = row ? text(row, '.do_jxb_id') : '';
      return new Promise((resolve, reject) => {
        let finished = false;
        const finish = (err, result) => {
          if (finished) return; finished = true;
          clearInterval(watchdog); $(doc).off('ajaxComplete', listener);
          signal?.removeEventListener('abort', abort);
          err ? reject(err) : resolve(result);
        };
        const abort = () => finish(new Error('已停止；已发出的请求仍可能完成，请核对已选列表'));
        const listener = (_event, xhr, settings) => {
          if (new URL(settings.url, win.location.href).pathname !== path) return;
          const params = typeof settings.data === 'string' ? new URLSearchParams(settings.data) : new URLSearchParams(settings.data || {});
          if (params.get('kch_id') !== target.kchId) return;
          if (path === SAVE_PATH && (!expectedOperation || params.get('jxb_ids') !== expectedOperation)) return;
          let data = xhr.responseJSON;
          if (data === undefined) { try { data = JSON.parse(xhr.responseText); } catch {} }
          finish(null, { status: xhr.status, data, url: settings.url });
        };
        let lastActivity = Date.now(), wasModal = false;
        const watchdog = setInterval(() => {
          const now = Date.now();
          if (now >= endAt) { finish(new Error('已到结束时间；请核对已经开始的选课流程')); return; }
          const modal = hasModal();
          // A normal confirmation is part of the original site's submission
          // chain. Keep listening while the user decides; never confirm for them.
          if (modal || wasModal) lastActivity = now;
          wasModal = modal;
          if (!modal && now - lastActivity >= 15000) finish(new Error('响应未确认，请核对已选列表'));
        }, 100);
        $(doc).on('ajaxComplete', listener);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) return abort();
        try { checkpoint(signal, endAt); action(); } catch (err) { finish(err); }
      });
    }
    return {
      inspect,
      prepare,
      capture,
      probe,
      isSelected(target) {
        return context(doc).split('|').slice(0, 2).join('|') === target.context.split('|').slice(0, 2).join('|')
          && matching(doc.querySelectorAll('#choosedBox input[name="right_jxb_id"]'), el => el.value === target.jxbId).length > 0;
      },
      async refresh(target, signal, endAt = Infinity) {
        checkpoint(signal, endAt); ready(target, false);
        if (inspect(target, false).state === 'selected') return { state: 'selected' };
        const heading = matching(doc.querySelectorAll('.panel-heading'), el => el.querySelector('input[name="kch_id"]')?.value === target.kchId)[0];
        const marker = heading?.querySelector('input[name="czzt"]');
        if (!marker) throw new Error('找不到原页面的课程刷新入口');
        const response = await observe(REFRESH_PATH, target, () => { marker.value = '0'; win.loadJxbxxZzxk(heading); }, signal, endAt);
        if (response.status !== 200 || !Array.isArray(response.data) || !matching(response.data, row => row.jxb_id === target.jxbId).length) {
          throw new Error('余量响应无效或登录已过期，请重新查询');
        }
        // The site's callback updates the DOM on its own 1 ms timer.
        await sleep(50, signal);
        if (hasModal()) throw new Error('学校页面有弹窗，处理后自动继续');
        return inspect(target);
      },
      async submit(target, signal, endAt = Infinity) {
        checkpoint(signal, endAt); ready(target);
        const latest = inspect(target);
        if (latest.state !== 'available') return { state: latest.state };
        // No confirmation dialogs or validation checks are bypassed.
        const row = matching(doc.querySelectorAll('#contentBox tr.body_tr'), row => text(row, '.jxb_id') === target.jxbId)[0];
        const response = await observe(SAVE_PATH, target, () => row.querySelector('.an button').click(), signal, endAt);
        return { state: classifyResponse(response.url, response.status, response.data) };
      }
    };
  }
  function mount(win) {
    const doc = win.document;
    if (!doc.getElementById('xkxnm') || doc.getElementById('sjtu-course-timer')) return;
    const host = doc.createElement('div'); host.id = 'sjtu-course-timer';
    host.style.cssText = 'position:fixed;right:55px;bottom:20px;z-index:9999;width:410px;max-width:90vw;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host{font:14px/1.5 system-ui,sans-serif;color:#263142}*{box-sizing:border-box}
      section{background:#fff;border:1px solid #d9dfe7;border-radius:12px;box-shadow:0 10px 38px #0003;overflow:hidden}
      header{background:#790b0b;color:white;padding:12px 16px;display:flex;justify-content:space-between;align-items:center}
      h2{font-size:16px;margin:0}main{padding:14px;max-height:78vh;overflow:auto}p{margin:0 0 10px;color:#536174;font-size:12px}
      label{display:block;margin:9px 0 4px}select,input:not([type=checkbox]){width:100%;padding:8px;border:1px solid #cbd3df;border-radius:6px;font:inherit}
      button{cursor:pointer;border:1px solid #cbd3df;border-radius:6px;padding:7px 10px;background:#f6f8fb;font:inherit;color:#263142}
      button:disabled{opacity:.5;cursor:default}.primary{background:#790b0b;color:white;border-color:#790b0b}
      .row{display:flex;gap:8px;margin-top:10px}.row>*{flex:1}.small{font-size:12px}#detail{white-space:pre-wrap;margin:8px 0}
      #status{background:#f2f5f9;border-radius:6px;padding:10px;margin-top:12px;white-space:pre-wrap;max-height:120px;overflow:auto}
      #queue{max-height:200px;overflow:auto}.course{border:1px solid #d9dfe7;border-radius:6px;padding:8px;margin-top:6px;white-space:pre-wrap}.course p{margin:4px 0}.course button{font-size:12px;padding:3px 7px}
      header button{padding:0 7px;background:transparent;color:white;border-color:#ffffff70}input[type=checkbox]{vertical-align:middle}
    </style><section><header><h2>交大选课定时助手 · 并发检查 v0.3</h2><button id="fold" type="button">收起</button></header><main>
      <p>查询并展开课程后添加到任务，可换类别继续添加。后台可以运行，但休眠和计时限流可能延迟检查。</p>
      <button id="scan" type="button">读取当前教学班</button>
      <label for="target">当前教学班（Ctrl / Shift 多选）</label><select id="target" multiple size="4"></select>
      <p id="detail"></p><button id="add" type="button">添加所选教学班到任务</button>
      <label>课程任务列表</label><div id="queue">尚未添加课程。</div>
      <label for="start">开始时间（北京时间）</label><input id="start" type="datetime-local" step="1">
      <label for="end">结束时间（北京时间）</label><input id="end" type="datetime-local" step="1">
      <label>每轮完成后的等待间隔（秒）<input id="interval" type="number" min="5" max="60" value="5"></label>
      <label class="small"><input id="dry" type="checkbox" checked> 仅检查，不刷新余量、不提交选课</label>
      <div class="row"><button id="startBtn" class="primary" type="button">执行检查</button><button id="stop" type="button" disabled>停止</button></div>
      <div id="status" role="status">尚未启动任何任务。</div>
      <p style="margin-top:9px">全部成功或到结束时间时结束。满员继续；弹窗等待处理，结果不明需核对。运行期间请勿手动操作原页面查询和选课。刷新、关闭页面或点击停止可取消任务。</p>
    </main></section>`;
    doc.body.appendChild(host);
    const el = id => shadow.getElementById(id);
    const adapter = createAdapter(win);
    let targets = [], queue = [], progress = [], controller = null;
    const retries = new Set();
    const status = msg => { el('status').textContent = msg; };
    const states = { 'dry-run': '只读检查完成，未发出请求、未提交。', success: '所有目标课程已选上，请核对右侧已选列表。', expired: '已到结束时间，不再发起新选课操作；请核对任务列表和网站已选列表。' };
    const labels = { available: '有余量', full: '已满', selected: '已选', blocked: '暂不可选', pending: '待开始', checking: '查询中', queued: '等待提交', waiting: '等待中', uncertain: '待人工核对', success: '已成功' };
    function renderQueue() {
      el('queue').replaceChildren();
      if (!queue.length) { el('queue').textContent = '尚未添加课程。'; return; }
      for (const target of queue) {
        const item = matching(progress, x => x.target.jxbId === target.jxbId)[0];
        const card = doc.createElement('div'); card.className = 'course';
        const title = doc.createElement('strong'); title.textContent = `${target.className} ${target.teacher}`; card.appendChild(title);
        const msg = doc.createElement('p');
        msg.textContent = item ? `${labels[item.state]} · 已检查 ${item.attempts} 次\n${item.message}${item.inspection ? `；当前状态：${labels[item.inspection.state] || '待核对'}` : ''}` : `${target.time}\n尚未启动`;
        card.appendChild(msg);
        if (!controller) {
          const remove = doc.createElement('button'); remove.textContent = '移除'; remove.onclick = () => { queue = matching(queue, x => x.jxbId !== target.jxbId); renderQueue(); }; card.appendChild(remove);
        } else if (item?.state === 'uncertain') {
          const retry = doc.createElement('button'); retry.textContent = retries.has(target.jxbId) ? '等待重试' : '已核对未选上，允许重试';
          retry.disabled = retries.has(target.jxbId);
          retry.onclick = () => { retries.add(target.jxbId); renderQueue(); }; card.appendChild(retry);
        }
        el('queue').appendChild(card);
      }
    }
    el('start').value = new Date(Date.now() + 28800000 + 60000).toISOString().slice(0, 19);
    el('end').value = new Date(Date.now() + 28800000 + 3600000).toISOString().slice(0, 19);
    el('fold').onclick = () => { const main = shadow.querySelector('main'); main.hidden = !main.hidden; el('fold').textContent = main.hidden ? '展开' : '收起'; };
    el('scan').onclick = () => {
      try { targets = scan(doc).map(target => adapter.capture(target)); }
      catch (error) { targets = []; el('target').replaceChildren(); status(error.message); return; }
      el('target').replaceChildren();
      for (const [index, t] of targets.entries()) el('target').add(new Option(`${t.className} ${t.teacher} [${t.count}/${t.capacity}]`, String(index)));
      el('detail').textContent = ''; status(`读取到 ${targets.length} 个教学班；任务列表已有 ${queue.length} 门。`);
    };
    el('add').onclick = () => {
      const problems = [];
      for (const option of el('target').selectedOptions) {
        const target = targets[Number(option.value)];
        if (matching(queue, x => x.kchId === target.kchId).length) { problems.push(`${target.className}：该课程已经在任务中`); continue; }
        queue.push({...target});
      }
      renderQueue(); status(`任务中共 ${queue.length} 门课程。${problems.length ? '\n' + problems.join('\n') : ''}`);
    };
    el('target').onchange = () => {
      const t = el('target').value === '' ? null : targets[Number(el('target').value)];
      el('detail').textContent = t ? `${t.course}\n${t.className} ${t.teacher}\n${t.time}\n已选/容量：${t.count}/${t.capacity}` : '';
    };
    el('dry').onchange = () => { el('startBtn').textContent = el('dry').checked ? '执行检查' : '启动定时选课'; };
    const controls = ['scan', 'target', 'add', 'start', 'end', 'interval', 'dry', 'startBtn'];
    el('stop').onclick = () => controller?.abort();
    win.SJTUCourseTimer.stop = () => controller?.abort();
    el('startBtn').onclick = async () => {
      if (controller) return;
      try {
        const config = { targets: queue.slice(), startAt: parseBeijing(el('start').value), endAt: parseBeijing(el('end').value),
          intervalMs: Number(el('interval').value) * 1000, dryRun: el('dry').checked };
        validate(config);
        if (!config.dryRun && config.endAt <= Date.now()) throw new Error('结束时间已经过去，请重新设置');
        controller = new AbortController(); retries.clear(); progress = []; renderQueue(); controls.forEach(id => { el(id).disabled = true; }); el('stop').disabled = false;
        const result = await run(config, adapter, { signal: controller.signal, onStatus: status,
          onUpdate: items => { progress = items; renderQueue(); },
          takeRetry: target => retries.delete(target.jxbId) });
        progress = result.courses;
        status(`${states[result.state] || result.state}\n已成功 ${matching(progress, x => x.state === 'success').length}/${queue.length} 门。`);
      } catch (err) { status(err.message); }
      finally { controller = null; renderQueue(); controls.forEach(id => { el(id).disabled = false; }); el('stop').disabled = true; }
    };
    win.addEventListener('pagehide', () => controller?.abort());
  }
  return { parseBeijing, classifyResponse, run, scan, createAdapter, mount };
});
