// ==UserScript==
// @name 水源帖子导出
// @namespace local.shuiyuan.crawler
// @version 1.0.0
// @description 按主题、用户和北京时间范围导出发帖内容及时间
// @match https://shuiyuan.sjtu.edu.cn/*
// @grant none
// @run-at document-idle
// ==/UserScript==

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShuiyuanCrawler = api;
})(globalThis, function () {
  'use strict';
  const ORIGIN = 'https://shuiyuan.sjtu.edu.cn';
  const validId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
  function parseTarget(input) {
    const value = String(input || '').trim();
    if (!value) throw Error('请输入帖子网址、编号或标题');
    if (/^\d+$/.test(value)) {
      if (!validId(value)) throw Error('帖子编号无效');
      return {id: Number(value)};
    }
    if (/^(?:\w+:|\/|shuiyuan\.sjtu\.edu\.cn)/i.test(value)) {
      const url = new URL(value.startsWith('shuiyuan.') ? 'https://' + value : value, ORIGIN);
      if (url.origin !== ORIGIN || url.username || url.password) throw Error('只支持水源论坛的网址');
      const m = url.pathname.match(/^\/t\/(\d+)(?:\/\d+)?(?:\.json)?\/?$/) || url.pathname.match(/^\/t\/[^/]+\/(\d+)(?:\/\d+)?(?:\.json)?\/?$/);
      if (!m || !validId(m[1])) throw Error('无法识别帖子网址，请复制 /t/ 开头的主题链接');
      return {id: Number(m[1])};
    }
    return {title: value};
  }
  function parseDate(value, end) {
    if (!value) return end ? Infinity : -Infinity;
    const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!m) throw Error('时间格式应为 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss（北京时间）');
    const normalized = `${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}`;
    const time = Date.parse(normalized + '+08:00');
    if (!Number.isFinite(time) || new Date(time + 28800000).toISOString().slice(0, 19) !== normalized) throw Error('日期或时间无效');
    return time + (end && !m[4] ? 86399999 : 0);
  }
  function makeFilter(users, start, end) {
    const text = String(users || '').trim();
    const names = !text || /^(全部|所有|all|\*)$/i.test(text) ? [] : [...new Set(text.split(/[\s,，;；]+/).map(s => s.replace(/^@/, '').toLowerCase()).filter(Boolean))];
    const from = parseDate(start, false), to = parseDate(end, true);
    if (from > to) throw Error('开始时间不能晚于结束时间');
    return {users: names, from, to, start: start || '', end: end || '', timezone: 'Asia/Shanghai'};
  }
  function matches(post, filter) {
    const time = Date.parse(post.created_at);
    return Number.isFinite(time) && time >= filter.from && time <= filter.to && (!filter.users.length || filter.users.includes(String(post.username || '').toLowerCase()));
  }
  function beijing(value) {
    const date = Date.parse(value);
    return Number.isFinite(date) ? new Date(date + 28800000).toISOString().replace('T', ' ').replace('Z', ' +08:00') : '';
  }
  function abortCheck(signal) { if (signal?.aborted) throw new DOMException('已停止', 'AbortError'); }
  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      abortCheck(signal);
      const stop = () => { clearTimeout(timer); reject(new DOMException('已停止', 'AbortError')); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
      signal?.addEventListener('abort', stop, {once: true});
    });
  }
  function createClient({fetchImpl = globalThis.fetch.bind(globalThis), sleep: wait = sleep, interval = 1000, onWait = () => {}} = {}) {
    let lastRequest = 0;
    return {async get(path, {signal} = {}) {
      if (!/^\/(?:t\/\d+(?:\/posts)?\.json|search\.json)(?:\?|$)/.test(path)) throw Error('请求地址不在允许范围');
      for (let attempt = 0; attempt < 4; attempt++) {
        abortCheck(signal);
        const delay = Math.max(0, interval - (Date.now() - lastRequest));
        if (delay) await wait(delay, signal);
        abortCheck(signal);
        lastRequest = Date.now();
        const timeout = AbortSignal.timeout(30000);
        const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
        const response = await fetchImpl(ORIGIN + path, {method: 'GET', credentials: 'same-origin', headers: {'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest'}, signal: combined});
        if (response.url && new URL(response.url).origin !== ORIGIN) throw Error('登录已失效，请在水源页面重新登录');
        if (response.status === 429 || response.status >= 500) {
          if (attempt === 3) throw Error(`服务器暂不可用（HTTP ${response.status}），已保留部分结果`);
          const retry = response.headers.get('Retry-After');
          const seconds = retry && /^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
          const pause = Number.isFinite(seconds) ? Math.max(1000, seconds) : 2000 * 2 ** attempt;
          if (pause > 300000) throw Error('服务器要求等待超过 5 分钟，请稍后重试');
          onWait(`服务器限流或繁忙，${Math.ceil(pause / 1000)} 秒后重试（${attempt + 1}/3）`);
          await wait(pause, signal); continue;
        }
        if ([401, 403].includes(response.status)) throw Error(`未登录或无权访问（HTTP ${response.status}）`);
        if (!response.ok) throw Error(`读取失败（HTTP ${response.status}），帖子可能不存在或当前账号无权访问`);
        if (!response.headers.get('Content-Type')?.includes('json')) throw Error('接口未返回 JSON，请检查是否需要重新登录');
        const data = await response.json();
        if (data.errors) throw Error(Array.isArray(data.errors) ? data.errors.join('；') : String(data.errors));
        return data;
      }
    }};
  }
  async function search(client, title, page = 1, options = {}) {
    const params = new URLSearchParams({q: `${title} in:title`, page: String(page)});
    const data = await client.get('/search.json?' + params, options);
    if (!Array.isArray(data.topics)) throw Error('搜索接口结构异常');
    return {topics: data.topics, more: Boolean(data.grouped_search_result?.more_full_page_results)};
  }
  async function crawl(client, id, filter, {signal, onProgress = () => {}} = {}) {
    if (!validId(id)) throw Error('帖子编号无效');
    const result = {topic_id: Number(id), title: '', url: `${ORIGIN}/t/${id}`, started_at: new Date().toISOString(), filter: {...filter, from: Number.isFinite(filter.from) ? filter.from : null, to: Number.isFinite(filter.to) ? filter.to : null}, complete: false, cancelled: false, expected: 0, scanned: 0, missing_ids: [], invalid_ids: [], error: '', posts: []};
    const seen = new Set(); let ids = [], wanted;
    function consume(posts) {
      if (!Array.isArray(posts)) throw Error('帖子正文接口结构异常');
      for (const p of posts) {
        if (!wanted.has(p.id) || seen.has(p.id)) continue;
        if (p.topic_id != null && Number(p.topic_id) !== Number(id)) throw Error('接口返回的主题编号不一致');
        seen.add(p.id);
        if (!Number.isFinite(Date.parse(p.created_at)) || !p.username || (!Object.hasOwn(p, 'raw') && typeof p.cooked !== 'string')) { result.invalid_ids.push(p.id); continue; }
        if (matches(p, filter)) result.posts.push({post_id: p.id, post_number: p.post_number, username: p.username, name: p.name || '', created_at: p.created_at, created_at_beijing: beijing(p.created_at), updated_at: p.updated_at || null, url: `${ORIGIN}/t/${id}/${p.post_number}`, raw: typeof p.raw === 'string' ? p.raw : null, cooked: p.cooked || ''});
      }
      result.scanned = seen.size;
      onProgress({scanned: seen.size, expected: ids.length, matched: result.posts.length});
    }
    try {
      abortCheck(signal);
      const data = await client.get(`/t/${id}.json?include_raw=true`, {signal});
      if (Number(data.id) !== Number(id) || !Array.isArray(data.post_stream?.stream)) throw Error('主题接口结构异常');
      result.title = data.title;
      ids = [...new Set(data.post_stream.stream)];
      if (ids.some(n => !validId(n))) throw Error('楼层索引无效');
      wanted = new Set(ids); result.expected = ids.length;
      consume(data.post_stream.posts);
      const remaining = ids.filter(n => !seen.has(n));
      for (let i = 0; i < remaining.length; i += 20) {
        abortCheck(signal);
        const params = new URLSearchParams({include_raw: 'true'});
        for (const postId of remaining.slice(i, i + 20)) params.append('post_ids[]', postId);
        const data = await client.get(`/t/${id}/posts.json?${params}`, {signal});
        consume(data.post_stream?.posts);
      }
      abortCheck(signal);
      result.complete = seen.size === ids.length && !result.invalid_ids.length;
    } catch (error) {
      result.cancelled = Boolean(signal?.aborted || error.name === 'AbortError');
      result.error = result.cancelled ? '用户停止' : error.message;
    }
    result.missing_ids = ids.filter(n => !seen.has(n));
    result.posts.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.post_number - b.post_number);
    result.finished_at = new Date().toISOString();
    return result;
  }
  function toText(result, htmlToText = s => s.replace(/<[^>]*>/g, '')) {
    const lines = [result.title, result.url, `状态：${result.complete ? '完整' : '未完成'}；读取 ${result.scanned}/${result.expected}，匹配 ${result.posts.length}`, `用户：${result.filter.users.join(', ') || '全部'}；北京时间：${result.filter.start || '不限'} 至 ${result.filter.end || '不限'}`, `错误：${result.error || '无'}；缺失楼层 ID：${result.missing_ids.join(', ') || '无'}；异常楼层 ID：${result.invalid_ids.join(', ') || '无'}`, ''];
    for (const p of result.posts) lines.push(`===== #${p.post_number} · @${p.username} · ${p.created_at_beijing} =====`, p.url, p.raw ?? htmlToText(p.cooked), '');
    return lines.join('\n');
  }
  return {ORIGIN, parseTarget, makeFilter, matches, beijing, createClient, search, crawl, toText};
});

(function () {
  'use strict';
  if (window.location.origin !== 'https://shuiyuan.sjtu.edu.cn' || document.getElementById('shuiyuan-crawler-panel')) return;
  const core = globalThis.ShuiyuanCrawler;
  const host = document.createElement('div'); host.id = 'shuiyuan-crawler-panel';
  host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483646;color-scheme:light;';
  const shadow = host.attachShadow({mode: 'open'});
  shadow.innerHTML = `
    <style>
      *{box-sizing:border-box} :host{font:14px/1.5 system-ui,"Microsoft YaHei",sans-serif;color:#16312c}
      section{width:min(410px,calc(100vw - 36px));background:#fff;border:1px solid #c7dad2;border-radius:16px;box-shadow:0 12px 48px #0003;overflow:hidden}
      header{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;background:#105646;color:white}strong{font-size:16px}
      #body{padding:16px;max-height:75vh;overflow:auto}label{display:block;margin:10px 0 5px;font-weight:600}
      input,select{width:100%;font:inherit;border:1px solid #b5c7c0;border-radius:7px;padding:8px;background:white;color:#16312c}
      button{font:inherit;cursor:pointer;border:1px solid #afc6bc;border-radius:7px;background:#f1f7f4;color:#164d3c;padding:7px 12px}
      button:disabled{opacity:.45;cursor:default}button.primary{background:#105646;color:white;border-color:#105646}
      header button{padding:3px 9px;background:transparent;color:white;border-color:#ffffff66}
      .row{display:flex;gap:8px;margin-top:10px}.row>*{flex:1;min-width:0}small{display:block;color:#5c7069;font-size:12px;margin-top:4px}
      #status{white-space:pre-wrap;margin:12px 0 8px;font-size:13px}progress{width:100%;height:8px;accent-color:#15765b}
      pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:150px;overflow:auto;background:#f3f7f5;border-radius:7px;padding:10px;font:12px/1.6 system-ui;margin:10px 0 0}
      [hidden]{display:none!important}input:focus,select:focus,button:focus-visible{outline:2px solid #229677;outline-offset:2px}
    </style>
    <section aria-label="水源帖子导出"><header><strong>水源 · 帖子导出</strong><button id="fold" aria-expanded="true">收起</button></header>
    <div id="body"><small>导出指定主题内的主楼与回复，使用当前登录账号。</small>
      <label for="target">帖子网址 / 编号 / 标题</label><input id="target" placeholder="粘贴链接、输入编号或标题">
      <div class="row"><button id="current">使用当前帖子</button><button id="find">查找帖子</button></div>
      <div id="choices" hidden><label for="topics">选择搜索结果</label><select id="topics"><option value="">请选择帖子</option></select><button id="more" hidden>加载更多结果</button></div>
      <label for="users">爬取用户</label><input id="users" value="全部" placeholder="全部，或 @alice, bob"><small>填写 @ 后的用户名（不是昵称）；多个账号用逗号分隔。</small>
      <label for="start">开始时间 · 北京时间</label><input id="start" placeholder="2026-09-01 或 2026-09-01 08:00:00">
      <label for="end">结束时间 · 北京时间</label><input id="end" placeholder="2026-09-14 或 2026-09-14 18:00:00"><small>留空表示不限；仅填结束日期时包含当天全天。</small>
      <div class="row"><button id="run" class="primary">开始爬取</button><button id="stop" disabled>停止</button></div>
      <div id="status" role="status" aria-live="polite">等待输入。结果仅在本页内存中，刷新前请下载。</div><progress id="progress" max="1" value="0"></progress>
      <div class="row"><button id="txt" disabled>下载 TXT</button><button id="json" disabled>下载 JSON</button></div>
      <pre id="preview" hidden></pre>
    </div></section>`;
  document.body.append(host);
  const $ = id => shadow.getElementById(id);
  let controller = null, result = null, query = '', page = 0, targetForSearch = '';
  const client = core.createClient({onWait: text => { $('status').textContent = text; }});
  function setBusy(busy) {
    for (const id of ['target', 'users', 'start', 'end', 'current', 'find', 'topics', 'more', 'run']) $(id).disabled = busy;
    $('stop').disabled = !busy;
  }
  function htmlToText(html) {
    // A detached template is inert: exported HTML never enters the live page.
    const template = document.createElement('template'); template.innerHTML = html;
    template.content.querySelectorAll('script,style').forEach(el => el.remove());
    template.content.querySelectorAll('img').forEach(el => el.replaceWith(document.createTextNode(el.getAttribute('alt') || '[图片]')));
    template.content.querySelectorAll('a[href]').forEach(el => el.append(document.createTextNode(` (${el.getAttribute('href')})`)));
    template.content.querySelectorAll('p,div,br,li,blockquote,pre,h1,h2,h3,tr').forEach(el => el.append(document.createTextNode('\n')));
    return template.content.textContent.trim();
  }
  function showResult() {
    $('txt').disabled = $('json').disabled = !result;
    if (!result) { $('preview').hidden = true; return; }
    $('status').textContent = `${result.complete ? '爬取完成' : result.cancelled ? '已停止，结果不完整' : '结果不完整'}：读取 ${result.scanned}/${result.expected} 条，匹配 ${result.posts.length} 条。` + (result.error ? '\n' + result.error : '') + (result.missing_ids.length ? `\n${result.missing_ids.length} 条未返回（可能已删除或权限变化）。` : '') + (result.invalid_ids.length ? `\n${result.invalid_ids.length} 条缺少正文、作者或时间。` : '');
    $('preview').hidden = false;
    $('preview').textContent = core.toText({...result, posts: result.posts.slice(0, 3)}, htmlToText).slice(0, 5000) + (result.posts.length > 3 ? '\n……下载文件查看全部内容' : '');
  }
  async function findTopic(more = false) {
    try {
      const target = core.parseTarget($('target').value);
      if (target.id) { $('choices').hidden = true; $('status').textContent = `已识别帖子 #${target.id}，可开始爬取。`; return; }
      controller = new AbortController(); setBusy(true);
      if (!more) { query = target.title; page = 0; targetForSearch = $('target').value.trim(); $('topics').replaceChildren(new Option('请选择帖子', '')); }
      $('status').textContent = '正在搜索标题……';
      const data = await core.search(client, query, page + 1, {signal: controller.signal}); page++;
      const existing = new Set([...$('topics').options].map(o => o.value));
      for (const topic of data.topics) if (!existing.has(String(topic.id))) { $('topics').add(new Option(`${topic.title} (#${topic.id} · ${topic.posts_count ?? '?'} 楼)`, String(topic.id))); existing.add(String(topic.id)); }
      $('choices').hidden = false; $('more').hidden = !data.more;
      $('status').textContent = `找到 ${$('topics').options.length - 1} 个候选帖子，请选择后开始。` + (data.more ? '可加载更多。' : '（搜索范围受论坛索引限制）');
    } catch (e) { $('status').textContent = controller?.signal.aborted ? '搜索已停止' : e.message; }
    finally { controller = null; setBusy(false); }
  }
  $('fold').onclick = () => { $('body').hidden = !$('body').hidden; $('fold').textContent = $('body').hidden ? '展开' : '收起'; $('fold').setAttribute('aria-expanded', String(!$('body').hidden)); };
  $('current').onclick = () => { try { const target = core.parseTarget(window.location.href); $('target').value = String(target.id); $('choices').hidden = true; $('status').textContent = `已填入当前帖子 #${target.id}`; } catch { $('status').textContent = '请先打开一个具体帖子，再点击此按钮。'; } };
  $('find').onclick = () => findTopic(); $('more').onclick = () => findTopic(true);
  $('target').oninput = () => { $('choices').hidden = true; targetForSearch = ''; };
  $('stop').onclick = () => { controller?.abort(); $('status').textContent = '正在停止……'; };
  $('run').onclick = async () => {
    try {
      const target = core.parseTarget($('target').value);
      const filter = core.makeFilter($('users').value, $('start').value.trim(), $('end').value.trim());
      let id = target.id;
      if (!id) {
        if (targetForSearch !== $('target').value.trim() || !$('topics').value) { await findTopic(); return; }
        id = Number($('topics').value);
      }
      controller = new AbortController(); setBusy(true); result = null; showResult();
      $('progress').value = 0; $('status').textContent = '正在读取主题和楼层索引……';
      result = await core.crawl(client, id, filter, {signal: controller.signal, onProgress: p => {
        $('progress').max = p.expected || 1; $('progress').value = p.scanned;
        $('status').textContent = `读取 ${p.scanned}/${p.expected} 条，已匹配 ${p.matched} 条……`;
      }});
      showResult();
    } catch (e) { $('status').textContent = e.message; }
    finally { controller = null; setBusy(false); }
  };
  function download(format) {
    if (!result) return;
    const text = format === 'json' ? JSON.stringify(result, null, 2) : core.toText(result, htmlToText);
    const blob = new Blob([format === 'txt' ? '\uFEFF' : '', text], {type: format === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8'});
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `水源-${result.topic_id}-${result.complete ? '完整' : '未完成'}-${new Date().toISOString().replace(/[:.]/g, '-')}.${format}`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  $('txt').onclick = () => download('txt'); $('json').onclick = () => download('json');
})();
