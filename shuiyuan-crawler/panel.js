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
