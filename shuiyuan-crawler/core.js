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
