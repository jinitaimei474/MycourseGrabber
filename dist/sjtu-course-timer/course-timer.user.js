// ==UserScript==
// @name         交大选课定时助手（搜索任务版）
// @namespace    local.sjtu.course-timer
// @version      0.6.0
// @description  搜索课程和教师，点击加入最多10门课程任务，每轮逐门刷新选课。
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
  const LIST_PATH = '/xsxk/zzxkyzb_cxZzxkYzbPartDisplay.html';
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
    if (c.targets.length > 10) throw new Error('任务列表最多添加 10 门不同课程');
    const courses = new Set();
    for (const target of c.targets) {
      if (!target?.jxbId || !target?.kchId || courses.has(target.kchId)) throw new Error('每门课程只能指定一个教学班，不能重复添加');
      courses.add(target.kchId);
      const options = choices(target), ids = new Set();
      if (!Array.isArray(options) || !options.length) throw new Error('每门课程至少选择一个教学班');
      for (const option of options) {
        if (!option?.jxbId || option.kchId !== target.kchId || ids.has(option.jxbId)) throw new Error('备选教学班必须属于同一课程且不能重复');
        ids.add(option.jxbId);
      }
    }
    if (!Number.isFinite(c.startAt) || !Number.isFinite(c.endAt) || c.endAt <= c.startAt) throw new Error('结束时间必须晚于开始时间');
    if (c.dryRun !== undefined && typeof c.dryRun !== 'boolean') throw new Error('只读模式必须是布尔值');
    if (!Number.isInteger(c.intervalMs) || c.intervalMs < 5000 || c.intervalMs > 60000) throw new Error('检查间隔须为 5–60 秒');
    if (c.reloadEveryMs !== undefined && c.reloadEveryMs !== 0 && (!Number.isInteger(c.reloadEveryMs) || c.reloadEveryMs < 60000 || c.reloadEveryMs > 7200000)) throw new Error('整页刷新间隔须为 1–120 分钟，或设为 0 关闭');
  }
  function choices(target) { return target.candidates === undefined ? [target] : target.candidates; }
  function createTaskStore(storage, owner) {
    const key = 'sjtu-course-timer-task-v1';
    const targetCopy = target => {
      const copy = {};
      for (const field of ['jxbId','kchId','className','teacher','time','course','keyword','tabId','context']) if (typeof target[field] === 'string') copy[field] = target[field];
      return copy;
    };
    return {
      save(snapshot) {
        if (!owner || !storage) throw new Error('无法确认当前账户或保存任务，不能自动刷新');
        const config = {};
        for (const field of ['startAt','endAt','intervalMs','dryRun','reloadEveryMs']) config[field] = snapshot.config[field];
        config.targets = snapshot.config.targets.map(target => ({...targetCopy(target), candidates:choices(target).map(targetCopy)}));
        validate(config);
        const courses = (snapshot.courses || []).map(item => ({state:['success','uncertain'].includes(item.state)?item.state:'pending',attempts:item.attempts || 0,message:item.message || ''}));
        storage.setItem(key, JSON.stringify({version:1,owner,config,courses,autoResume:snapshot.autoResume === true,savedAt:Date.now()}));
      },
      read() {
        try {
          const saved = JSON.parse(storage?.getItem(key) || 'null');
          if (!saved) return null;
          if (saved.version !== 1 || !owner || saved.owner !== owner) { storage.removeItem(key); return null; }
          validate(saved.config);
          if (!Array.isArray(saved.courses) || saved.courses.length > saved.config.targets.length) throw new Error('任务记录无效');
          return saved;
        } catch { return null; }
      },
      clear() { storage?.removeItem(key); }
    };
  }
  async function run(c, adapter, env = {}) {
    validate(c);
    const now = env.now || Date.now;
    const pause = env.sleep || (ms => sleep(ms, env.signal));
    const guard = () => { if (env.signal?.aborted) throw new Error('已停止'); };
    const report = env.onStatus || (() => {});
    const courses = c.targets.map((target,index) => ({target,state:['success','uncertain'].includes(env.initialCourses?.[index]?.state)?env.initialCourses[index].state:'pending',attempts:env.initialCourses?.[index]?.attempts || 0,message:env.initialCourses?.[index]?.state==='uncertain'?'上次提交结果待核对，恢复后不自动重试':'等待检查'}));
    const update = () => env.onUpdate?.(courses.map(item => ({...item})));
    const allDone = () => matching(courses, item => item.state !== 'success').length === 0;
    const result = state => ({state, courses});
    const reloadAt = now() + (c.reloadEveryMs || Infinity);
    async function maybeReload() {
      guard();
      if (!c.reloadEveryMs || c.dryRun !== false || now() < reloadAt || now() >= c.endAt) return false;
      if (!adapter.canReload?.()) { report('已到整页刷新时间，等待当前请求或确认弹窗处理完成'); return false; }
      if (typeof env.reload !== 'function') throw new Error('自动刷新恢复入口不可用');
      await env.reload({config:c,courses}); return true;
    }
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
      if (await maybeReload()) return result('reloading');
      await pause(Math.min(1000, c.startAt - now()));
    }
    guard();
    const setState = (item, state) => {
      if (state === 'success' || state === 'selected') { item.state = 'success'; item.message = '已成功选上'; }
      else if (state === 'unknown') { item.state = 'uncertain'; item.message = '提交结果不明；先核对已选列表'; }
      else { item.state = 'waiting'; item.message = state === 'full' ? '满员，继续等待名额' : '暂不可选，等待页面状态恢复'; }
    };
    async function select(item) {
      for (const target of choices(item.target)) {
        item.state = 'checking';
        if (env.signal?.aborted || now() >= c.endAt) { item.message = '已停止或到达结束时间，未提交'; update(); return; }
        item.message = `正在页面查询 ${target.keyword || ''}：${target.className || target.jxbId} ${target.teacher || ''}`; report(item.message); update();
        let submitting = false;
        try {
          await adapter.prepare(target, env.signal, c.endAt);
          guard(); if (now() >= c.endAt) { item.state = 'waiting'; item.message = '已到结束时间，未提交'; return; }
          const refreshed = await adapter.refresh(target, env.signal, c.endAt);
          item.lastCheckedAt = now();
          item.count = refreshed.count; item.capacity = refreshed.capacity;
          let state = refreshed.state;
          guard(); if (now() >= c.endAt) { item.state = 'waiting'; item.message = '已到结束时间，未提交'; return; }
          if (state === 'available') {
            await env.beforeSubmit?.(item, courses);
            guard(); if (now() >= c.endAt) return;
            submitting = true;
            report(`正在选择 ${target.className || target.jxbId}；若学校显示确认弹窗，请处理`);
            state = (await adapter.submit(target, env.signal, c.endAt)).state;
          }
          setState(item, state);
          if (item.state === 'success') { item.selectedTarget = target; item.message = `已选上：${target.className || target.jxbId} ${target.teacher || ''}`; }
        } catch (error) {
          item.state = submitting ? 'uncertain' : 'waiting'; item.message = error.message;
        }
        update();
        if (item.state === 'success' || item.state === 'uncertain' || env.signal?.aborted || now() >= c.endAt) return;
      }
    }
    while (now() < c.endAt) {
      guard();
      if (allDone()) return result('success');
      if (await maybeReload()) return result('reloading');
      for (const item of courses) {
        if (item.state !== 'success') {
          for (const target of choices(item.target)) {
            try {
              if (adapter.isSelected?.(target) || adapter.inspect(target).state === 'selected') { item.state = 'success'; item.selectedTarget = target; item.message = `已在页面核实：${target.className || target.jxbId} 已选`; break; }
            } catch {}
          }
        }
        if (item.state === 'uncertain' && env.takeRetry?.(item.target)) { item.state = 'pending'; item.message = '已人工核对，允许重试'; }
      }
      const pending = matching(courses, item => item.state !== 'uncertain' && item.state !== 'success');
      report(`本轮在页面查询 ${pending.length} 门课程`);
      for (const item of pending) {
        guard(); if (now() >= c.endAt) break;
        item.attempts++;
        await select(item);
        if (!allDone() && await maybeReload()) return result('reloading');
      }
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
      if (win.location.hostname !== 'i.sjtu.edu.cn' || value(doc, 'iskxk') !== '1') throw new Error('登录状态或选课时段无效，请检查页面');
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
      const getRow = () => matching(doc.querySelectorAll('#contentBox tr.body_tr'), row => text(row, '.jxb_id') === target.jxbId)[0];
      const oldRow = getRow();
      const input = doc.querySelector('#searchBox input[name="searchInput"]');
      const query = doc.querySelector('#searchBox button[name="query"]');
      if (!input || !query || !target.keyword) throw new Error('缺少课程查询入口或课程号，请重新添加');
      if (query.disabled) throw new Error('页面查询按钮不可用，等待下一轮');
      // Query every time, including when the old target row is still displayed.
      // Require both its matching response and newly rendered DOM, never an old row.
      let action = () => {
        checkpoint(signal, endAt); input.value = target.keyword; query.click();
      };
      for (let page = 0; ; page++) {
        const response = await observe(LIST_PATH, target, action, signal, endAt);
        if (response.status !== 200 || !Array.isArray(response.data?.tmpList)) throw new Error('页面查询失败，本轮不选课；请检查登录及筛选条件');
        if (matching(response.data.tmpList, row => row.jxb_id === target.jxbId && row.kch_id === target.kchId).length) break;
        await waitUntil(() => $.active === 0, signal, endAt);
        if (!response.data.tmpList.length || value(doc, 'isEnd') !== 'false' || typeof win.loadCoursesByPaged !== 'function' || page >= 19) {
          throw new Error('页面查询未返回目标教学班，本轮不选课；请检查筛选条件或缩小查询范围');
        }
        if (context(doc) !== target.context) throw new Error('查询期间类别已改变，请重新查询');
        action = () => win.loadCoursesByPaged();
      }
      await waitUntil(() => $.active === 0 && getRow() && getRow() !== oldRow, signal, endAt);
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
          if (path === LIST_PATH) {
            const parts = target.context.split('|');
            const words = clean(target.keyword).split(/\s+/);
            for (let i = 0; i < words.length; i++) if (params.get(`filter_list[${i}]`) !== words[i]) return;
            if (params.get('kklxdm') !== parts[3] || params.get('xkkz_id') !== parts[2]) return;
          } else if (params.get('kch_id') !== target.kchId) return;
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
    async function refresh(target, signal, endAt = Infinity, details = true) {
        checkpoint(signal, endAt); ready(target, false);
        if (inspect(target, false).state === 'selected') return { state: 'selected' };
        const heading = matching(doc.querySelectorAll('.panel-heading'), el => el.querySelector('input[name="kch_id"]')?.value === target.kchId)[0];
        const marker = heading?.querySelector('input[name="czzt"]');
        if (!marker) throw new Error('找不到原页面的课程刷新入口');
        const response = await observe(REFRESH_PATH, target, () => { marker.value = '0'; win.loadJxbxxZzxk(heading); }, signal, endAt);
        if (response.status !== 200 || !Array.isArray(response.data) || !matching(response.data, row => row.jxb_id === target.jxbId).length) {
          throw new Error('余量响应无效或登录已过期，请重新查询');
        }
        // The original callback sets czzt=1 only after updating the row data.
        await waitUntil(() => $.active === 0 && marker.value === '1' && marker.isConnected, signal, endAt);
        if (hasModal()) throw new Error('学校页面有弹窗，处理后自动继续');
        if (heading.querySelector('.expand_close')?.classList.contains('expand1')) {
          checkpoint(signal, endAt);
          // With czzt=1 the original function only expands the updated rows;
          // it does not send another request or change the selection.
          win.loadJxbxxZzxk(heading);
        }
        return inspect(target, details);
    }
    return {
      inspect,
      prepare,
      canReload() { return !!$ && $.active === 0 && !hasModal(); },
      async search(keyword, signal, endAt = Infinity) {
        keyword = clean(keyword).replace(/\s+/g, ' ');
        if (!keyword) throw new Error('请输入课程名称、课号或教师姓名');
        checkpoint(signal, endAt);
        if (win.location.hostname !== 'i.sjtu.edu.cn' || value(doc, 'iskxk') !== '1' || !$) throw new Error('请先登录并进入有效的选课类别');
        await waitUntil(() => $.active === 0, signal, endAt);
        const input = doc.querySelector('#searchBox input[name="searchInput"]'), query = doc.querySelector('#searchBox button[name="query"]');
        if (!input || !query || query.disabled) throw new Error('原页面查询入口不可用');
        const request = {keyword, context: context(doc)};
        let action = () => { input.value = keyword; query.click(); };
        for (let page = 0; ; page++) {
          checkpoint(signal, endAt);
          const oldRows = new Set(doc.querySelectorAll('#contentBox tr.body_tr'));
          const response = await observe(LIST_PATH, request, action, signal, endAt);
          if (response.status !== 200 || !Array.isArray(response.data?.tmpList)) throw new Error(`查询“${keyword}”失败，请检查登录及筛选条件`);
          if (!response.data.tmpList.length) { if (page === 0) return []; break; }
          await waitUntil(() => $.active === 0 && matching(doc.querySelectorAll('#contentBox tr.body_tr'), row => !oldRows.has(row)).length > 0, signal, endAt);
          if (context(doc) !== request.context) throw new Error('查询期间类别已改变，请重新查询');
          if (value(doc, 'isEnd') !== 'false' || typeof win.loadCoursesByPaged !== 'function') break;
          if (page >= 19) throw new Error('匹配结果过多，请使用更具体的课号或课程名');
          action = () => win.loadCoursesByPaged();
        }
        // Initial list rows may lack teacher/time data until their course loads.
        const loaded = new Set();
        for (const target of scan(doc)) {
          if (loaded.has(target.kchId)) continue;
          await refresh(target, signal, endAt, false); loaded.add(target.kchId);
        }
        return scan(doc);
      },
      isSelected(target) {
        return context(doc).split('|').slice(0, 2).join('|') === target.context.split('|').slice(0, 2).join('|')
          && matching(doc.querySelectorAll('#choosedBox input[name="right_jxb_id"]'), el => el.value === target.jxbId).length > 0;
      },
      refresh,
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
    host.style.cssText = 'position:fixed;right:35px;bottom:15px;z-index:9999;width:460px;max-width:94vw;';
    const shadow = host.attachShadow({mode:'open'});
    shadow.innerHTML = `<style>
      :host{font:14px/1.5 system-ui,sans-serif;color:#263142}*{box-sizing:border-box}
      section{background:white;border:1px solid #d9dfe7;border-radius:12px;box-shadow:0 10px 38px #0003;overflow:hidden}
      header{background:#790b0b;color:white;padding:12px;display:flex;justify-content:space-between;align-items:center}
      h2{font-size:16px;margin:0}main{padding:14px;max-height:80vh;overflow:auto}p{margin:6px 0;color:#536174;font-size:12px}
      label{display:block;margin:8px 0 4px}textarea,input:not([type=checkbox]){width:100%;padding:8px;border:1px solid #cbd3df;border-radius:6px;font:inherit}
      button{cursor:pointer;border:1px solid #cbd3df;border-radius:6px;padding:6px 9px;background:#f6f8fb;font:inherit;color:#263142}
      button:disabled{opacity:.5;cursor:default}.primary{background:#790b0b;color:white;border-color:#790b0b}
      .row{display:flex;gap:6px;margin:8px 0}.row>*{flex:1}#results,#queue{max-height:230px;overflow:auto}
      .card{border:1px solid #d9dfe7;border-radius:6px;padding:8px;margin:6px 0;white-space:pre-wrap}.card button{font-size:12px}
      #teachers{max-height:95px;overflow:auto}#teachers label{display:inline-block;margin:3px 10px 3px 0;font-size:12px}
      #status{padding:10px;background:#f2f5f9;border-radius:6px;white-space:pre-wrap;margin-top:10px;max-height:130px;overflow:auto}
      header button{background:transparent;color:white;border-color:#ffffff70}input[type=checkbox]{vertical-align:middle}
    </style><section><header><h2>交大选课助手 · 长时任务 v0.6</h2><button id="fold">收起</button></header><main>
      <label for="queries">课程名称 / 课号（多个用逗号或换行分隔）</label>
      <textarea id="queries" rows="2" placeholder="例如：EE2905，电工学"></textarea>
      <label for="teacherQuery">教师姓名（可选，多人用逗号分隔）</label>
      <input id="teacherQuery" placeholder="例如：张老师，李老师；也可只填教师查询">
      <p>在原网页选好课程类别。不同关键词分别查询并合并结果；同门课可添加多个教师的班作为备选，任一选上即完成该门。</p>
      <div class="row"><button id="searchBtn" class="primary">查询课程</button><button id="scan">读取当前页面</button></div>
      <label>教师筛选（可多选）</label><div id="teachers"></div>
      <p id="resultCount">查询后，点击教学班旁的“加入任务”。</p><div id="results"></div>
      <label id="queueCount">任务列表：0 / 10 门</label><div id="queue"></div>
      <label for="start">开始时间（北京时间）</label><input id="start" type="datetime-local" step="1">
      <label for="end">结束时间（北京时间）</label><input id="end" type="datetime-local" step="1">
      <label>每轮完成后的等待间隔（秒）<input id="interval" type="number" min="5" max="60" value="5"></label>
      <label>定时整页刷新（分钟，0 为关闭）<input id="reloadMinutes" type="number" min="0" max="120" value="0"></label>
      <p id="reloadHint"></p>
      <label><input id="dry" type="checkbox" checked> 仅检查任务，不刷新、不提交选课</label>
      <div class="row"><button id="startBtn" class="primary">检查全部任务</button><button id="stop" disabled>停止</button></div>
      <div id="status" role="status">尚未启动。先查询并将教学班加入任务列表。</div>
      <p>逐门查询和选课，全部成功或到结束时间终止。确认弹窗需你处理。扩展定时整页刷新前会保存任务并自动恢复；若跳到登录页，请手动登录。关闭标签页会丢失本标签页的任务备份。</p>
    </main></section>`;
    doc.body.appendChild(host);
    const el = id => shadow.getElementById(id), adapter = createAdapter(win);
    let targets = [], queue = [], progress = [], controller = null;
    let taskStore = null, reloading = false, bootTimer = null;
    const remembered = new Map();
    const taskKey = target => `${String(target.context || '').split('|').slice(0,2).join('|')}|${target.kchId}`;
    const remember = items => { for (const item of items) remembered.set(taskKey(item.target), {state:item.state || 'pending',attempts:item.attempts || 0,message:item.message || '等待检查'}); };
    try { const owner = value(doc,'xh_id') || value(doc,'xh'); if (owner && win.sessionStorage) taskStore = createTaskStore(win.sessionStorage,owner); } catch {}
    const autoLoad = win.__SJTUCourseTimerAutoLoad === true && !!taskStore;
    let selectedTeachers = new Set();
    const retries = new Set();
    const status = message => { el('status').textContent = message; };
    const terms = raw => [...new Set(matching(String(raw).split(/[\n,，;；]+/).map(clean), word => !!word))];
    const controls = ['queries','teacherQuery','searchBtn','scan','start','end','interval','reloadMinutes','dry','startBtn'];
    const labels = {available:'有余量',full:'已满',selected:'已选',blocked:'待核对',pending:'待开始',checking:'查询中',waiting:'等待中',uncertain:'待人工核对',success:'已成功'};
    function busy() {
      for (const id of controls) el(id).disabled = !!controller || bootTimer !== null;
      el('reloadMinutes').disabled = !autoLoad || !!controller || bootTimer !== null;
      el('stop').disabled = !controller && bootTimer === null;
      for (const input of el('teachers').querySelectorAll('input')) input.disabled = !!controller || bootTimer !== null;
      renderQueue(); renderResults();
    }
    function add(target) {
      if (controller || bootTimer !== null) return;
      if (!target.keyword) { status('没有读取到课号，请展开原网页课程后重新读取。'); return; }
      let group = matching(queue, item => item.kchId === target.kchId)[0];
      if (group && choices(group)[0].context.split('|').slice(0,2).join('|') !== target.context.split('|').slice(0,2).join('|')) { status('不能把不同学期的教学班加入同一任务。'); return; }
      if (!group && queue.length >= 10) { status('最多添加 10 门不同课程；可先移除不需要的课程。'); return; }
      if (group) {
        if (!matching(group.candidates, item => item.jxbId === target.jxbId).length) group.candidates.push({...target});
      } else queue.push({...target,candidates:[{...target}]});
      progress = []; renderQueue(); renderResults(); status(`已加入任务：${queue.length} / 10 门课程。可继续查询并添加。`);
    }
    function renderResults() {
      el('results').replaceChildren();
      const visible = matching(targets, target => selectedTeachers.has(target.teacher || '教师待加载'));
      el('resultCount').textContent = `显示 ${visible.length} / ${targets.length} 个教学班；点击加入，支持跨查询累计。`;
      for (const target of visible) {
        const group = matching(queue, item => item.kchId === target.kchId)[0];
        const added = group && matching(choices(group), item => item.jxbId === target.jxbId).length;
        const card = doc.createElement('div'); card.className = 'card';
        const title = doc.createElement('strong'); title.textContent = `${target.course}\n${target.className}`;
        const detail = doc.createElement('p'); detail.textContent = `${target.teacher || '教师待加载'}\n${target.time}\n已选/容量：${target.count || '?'}/${target.capacity || '?'} · ${labels[target.state] || '待核对'}`;
        const button = doc.createElement('button'); button.dataset.add = target.jxbId; button.textContent = added ? '已加入' : '加入任务';
        button.disabled = !!controller || bootTimer !== null || !!added || (!group && queue.length >= 10); button.onclick = () => add(target);
        card.append(title,detail,button); el('results').appendChild(card);
      }
    }
    function setResults(items) {
      const unique = new Map();
      for (const item of items) unique.set(`${item.context}|${item.kchId}|${item.jxbId}`,item);
      targets = [...unique.values()]; selectedTeachers = new Set(targets.map(item => item.teacher || '教师待加载'));
      el('teachers').replaceChildren();
      for (const teacher of selectedTeachers) {
        const label = doc.createElement('label'), checkbox = doc.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = true; checkbox.disabled = !!controller || bootTimer !== null;
        checkbox.onchange = () => { if (checkbox.checked) selectedTeachers.add(teacher); else selectedTeachers.delete(teacher); renderResults(); };
        label.append(checkbox,doc.createTextNode(teacher)); el('teachers').appendChild(label);
      }
      renderResults();
    }
    function renderQueue() {
      el('queueCount').textContent = `任务列表：${queue.length} / 10 门`;
      el('queue').replaceChildren();
      for (const group of queue) {
        const item = matching(progress, x => x.target.kchId === group.kchId)[0];
        const card = doc.createElement('div'); card.className = 'card';
        const title = doc.createElement('strong'); title.textContent = `${group.course || group.keyword} · ${choices(group).length} 个备选班`; card.appendChild(title);
        for (const target of choices(group)) {
          const line = doc.createElement('p'); line.textContent = `${target.className} ${target.teacher}\n${target.time} `;
          const remove = doc.createElement('button'); remove.dataset.remove = target.jxbId; remove.textContent = '移除'; remove.disabled = !!controller || bootTimer !== null;
          remove.onclick = () => {
            if (controller || bootTimer !== null) return;
            const remaining = matching(group.candidates, x => x.jxbId !== target.jxbId);
            queue = remaining.length ? queue.map(x => x === group ? {...remaining[0],candidates:remaining} : x) : matching(queue, x => x !== group);
            progress = []; renderQueue(); renderResults();
          };
          line.appendChild(remove); card.appendChild(line);
        }
        const message = doc.createElement('p');
        message.textContent = item ? `${labels[item.state]} · 已检查 ${item.attempts} 轮\n${item.message}` : '尚未启动';
        if (item?.lastCheckedAt) message.textContent += `\n上次页面刷新：${new Date(item.lastCheckedAt+28800000).toISOString().slice(11,19)}；已选/容量：${item.count ?? '?'}/${item.capacity ?? '?'}`;
        card.appendChild(message);
        if (controller && item?.state === 'uncertain') {
          const retry = doc.createElement('button'); retry.textContent = retries.has(group.kchId) ? '等待重试' : '已核对未选上，允许重试'; retry.disabled = retries.has(group.kchId);
          retry.onclick = () => { retries.add(group.kchId); renderQueue(); }; card.appendChild(retry);
        }
        el('queue').appendChild(card);
      }
    }
    el('start').value = new Date(Date.now()+28800000+60000).toISOString().slice(0,19);
    el('end').value = new Date(Date.now()+28800000+3600000).toISOString().slice(0,19);
    el('reloadMinutes').value = autoLoad ? '60' : '0';
    el('reloadHint').textContent = autoLoad ? '默认 60 分钟是针对“约两小时过期”的预防设置，并非学校公布的有效期。刷新会保存并恢复任务；不能保证延长服务器登录期限。' : '自动整页刷新需安装/更新本地扩展。仅控制台粘贴的脚本刷新后会消失，因此此模式不启用自动刷新。';
    el('fold').onclick = () => { const main=shadow.querySelector('main'); main.hidden=!main.hidden; el('fold').textContent=main.hidden?'展开':'收起'; };
    el('scan').onclick = () => { if (controller || bootTimer !== null) return; setResults(scan(doc)); status('已读取当前页面；已有任务保留。'); };
    el('searchBtn').onclick = async () => {
      if (controller || bootTimer !== null) return;
      const teachers = terms(el('teacherQuery').value), inputTerms = terms(el('queries').value), keywords = inputTerms.length ? inputTerms : teachers;
      if (!keywords.length) { status('请输入课程名称、课号或教师姓名。'); return; }
      if (keywords.length > 20) { status('单次最多输入 20 个查询词，请分批查询。'); return; }
      controller = new AbortController(); const signal=controller.signal; busy(); setResults([]);
      const found = [], errors = [];
      try {
        for (const keyword of keywords) {
          if (signal.aborted) break;
          status(`正在查询：${keyword}；查询只加载信息，不选课。`);
          try {
            const items = await adapter.search(keyword,signal,Date.now()+120000);
            for (const target of items) if (!teachers.length || matching(teachers,name => target.teacher.includes(name)).length) found.push(target);
            setResults(found);
          } catch (error) { errors.push(`${keyword}：${error.message}`); }
        }
        status(`${signal.aborted?'查询已停止':'查询完成'}，得到 ${targets.length} 个教学班；点击加入任务。${errors.length?'\n'+errors.join('\n'):''}`);
      } finally { controller=null; busy(); }
    };
    el('dry').onchange = () => { el('startBtn').textContent=el('dry').checked?'检查全部任务':'启动全部任务'; };
    const stop = () => { if (bootTimer !== null) { clearTimeout(bootTimer); bootTimer=null; status('已取消自动恢复，可核对任务后手动启动。'); busy(); } controller?.abort(); };
    el('stop').onclick = stop; win.SJTUCourseTimer.stop = stop;
    el('startBtn').onclick = async () => {
      if (controller || bootTimer !== null) return;
      try {
        const config={targets:queue.map(group=>({...group,candidates:group.candidates.slice()})),startAt:parseBeijing(el('start').value),endAt:parseBeijing(el('end').value),intervalMs:Number(el('interval').value)*1000,dryRun:el('dry').checked,reloadEveryMs:Number(el('reloadMinutes').value)*60000};
        validate(config); if (!config.dryRun && config.endAt<=Date.now()) throw new Error('结束时间已经过去，请重新设置');
        if (config.reloadEveryMs && !autoLoad) throw new Error('定时整页刷新需要扩展自动加载和可用的任务存储');
        const initialCourses = config.targets.map(target=>remembered.get(taskKey(target)) || {state:'pending',attempts:0}); reloading = false;
        if (!config.dryRun && config.reloadEveryMs) taskStore.save({config,courses:initialCourses || [],autoResume:false});
        controller=new AbortController(); retries.clear(); progress=[]; busy();
        const result=await run(config,adapter,{signal:controller.signal,initialCourses,onStatus:status,
          onUpdate:items=>{remember(items);progress=items;renderQueue();if (!config.dryRun && config.reloadEveryMs && !reloading) taskStore.save({config,courses:items,autoResume:false});},
          beforeSubmit:(item,items)=>{if (config.reloadEveryMs) taskStore.save({config,courses:items.map(current=>current===item?{...current,state:'uncertain'}:current),autoResume:false});},
          reload:snapshot=>{taskStore.save({...snapshot,autoResume:true});reloading=true;status('任务已保存，正在整页刷新；扩展加载后将恢复任务。');win.location.reload();},
          takeRetry:target=>retries.delete(target.kchId)});
        progress=result.courses;
        const messages={'dry-run':'只读检查完成，未发出请求、未提交。',success:'全部课程已成功，请核对网站已选列表。',expired:'已到结束时间，请核对网站已选列表。',reloading:'已保存任务，等待整页刷新和自动恢复。'};
        status(`${messages[result.state] || result.state}\n已成功 ${matching(progress,x=>x.state==='success').length}/${queue.length} 门。`);
      } catch(error) { status(error.message); }
      finally { controller=null; busy(); }
    };
    win.addEventListener('pagehide',()=>controller?.abort());
    const saved = taskStore?.read();
    if (saved) {
      queue = saved.config.targets;
      remember(queue.map((target,index)=>({target,...saved.courses[index]})));
      progress=queue.map(target=>({target,...remembered.get(taskKey(target))}));
      for (const id of ['start','end']) el(id).value=new Date(saved.config[id+'At']+28800000).toISOString().slice(0,19);
      el('interval').value=String(saved.config.intervalMs/1000);el('reloadMinutes').value=autoLoad?String((saved.config.reloadEveryMs || 0)/60000):'0';
      el('dry').checked=saved.config.dryRun;el('dry').onchange();
      let canResume = true;
      try { taskStore.save({...saved,autoResume:false}); status('已恢复本标签页的任务，请核对后启动。'); }
      catch (error) { canResume = false; status(`任务已恢复，但无法保存任务：${error.message}。已取消自动启动。`); }
      if (canResume && autoLoad && saved.autoResume && !saved.config.dryRun && saved.config.endAt>Date.now()) {
        status('定时刷新后正在等待选课页面加载，随后自动恢复；可点击停止取消。');
        const until=Date.now()+30000;
        const resume = () => {
          bootTimer=null;
          if (saved.config.endAt<=Date.now()) { status('已到结束时间，未自动恢复选课。'); busy(); return; }
          if ((saved.config.startAt>Date.now() || value(doc,'iskxk')==='1') && typeof win.loadJxbxxZzxk==='function' && adapter.canReload()) { busy(); el('startBtn').onclick(); }
          else if (Date.now()<until) { bootTimer=setTimeout(resume,250); busy(); }
          else { status('页面未就绪或需要重新登录。任务已保留，请登录并核对后手动启动。'); busy(); }
        };
        bootTimer=setTimeout(resume,1000);
      }
    }
    busy();
  }

  return { parseBeijing, classifyResponse, run, scan, createAdapter, createTaskStore, mount };
});
