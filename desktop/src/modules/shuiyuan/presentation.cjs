'use strict';
const sanitize=require('sanitize-html'),Turndown=require('turndown'),{gfm}=require('turndown-plugin-gfm');
const ORIGIN='https://shuiyuan.sjtu.edu.cn';
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
function webURL(value){if(typeof value!=='string'||!value.trim())return '';try{const u=new URL(value,ORIGIN);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}}
function localAsset(value){return typeof value==='string'&&/^assets\/[a-f0-9]{64}\.(?:png|jpg|gif|webp|avif)$/.test(value)?value:null;}
function cleanHTML(html,assets={},images){
 const links=[];
 return sanitize(String(html||''),{
  onOpenTag:(tag,a)=>{if(tag==='a')links.push(/(?:^|\s)lightbox(?:\s|$)/.test(a.class||'')?webURL(a.href):'');},
  onCloseTag:tag=>{if(tag==='a')links.pop();},
  allowedTags:[...sanitize.defaults.allowedTags,'img','details','summary','figure','figcaption','video','audio','source','math','semantics','annotation','mrow','mi','mo','mn','msup','msub','mfrac','msqrt','mtext','mtable','mtr','mtd','mover','munder','munderover','msubsup','mspace'],
  allowedAttributes:{'*':['class','title'],a:['href'],img:['src','alt','width','height'],code:['class'],ol:['start'],li:['value'],td:['colspan','rowspan'],th:['colspan','rowspan'],details:['open'],video:['src','controls','poster'],audio:['src','controls'],source:['src','type'],math:['display','xmlns'],annotation:['encoding'],mspace:['width']},
  allowedSchemes:['https','http'],allowProtocolRelative:false,
  transformTags:{
   a:(tag,a)=>{const href=webURL(a.href);if(/(?:^|\s)lightbox(?:\s|$)/.test(a.class||'')&&href)images?.add(href);return {tagName:'a',attribs:{...a,href:localAsset(assets[href])||href}};},
   img:(tag,a)=>{const src=webURL(a.src);if(src)images?.add(src);return {tagName:'img',attribs:{...a,src:localAsset(assets[links.at(-1)])||localAsset(assets[src])||src,alt:a.alt||''}};},
   video:(tag,a)=>({tagName:tag,attribs:{...a,src:webURL(a.src),poster:webURL(a.poster),controls:''}}),
   audio:(tag,a)=>({tagName:tag,attribs:{...a,src:webURL(a.src),controls:''}}),
   source:(tag,a)=>({tagName:tag,attribs:{...a,src:webURL(a.src)}})
  }
 });
}
function imageURLs(posts){const images=new Set();for(const post of posts)cleanHTML(post.cooked,{},images);return [...images];}
function markdown(html){const td=new Turndown({headingStyle:'atx',codeBlockStyle:'fenced',bulletListMarker:'-'});td.use(gfm);td.keep(['details','summary','math','video','audio']);
 td.addRule('fenced-code',{filter:node=>node.nodeName==='PRE',replacement:(content,node)=>{const code=node.firstChild?.nodeName==='CODE'?node.firstChild:node;const lang=(code.getAttribute?.('class')||'').match(/(?:lang|language)-([\w+-]+)/)?.[1]||'';const text=code.textContent||'';const fence='`'.repeat(Math.max(3,...(text.match(/`+/g)||[]).map(s=>s.length+1)));return `\n\n${fence}${lang}\n${text.replace(/\n$/,'')}\n${fence}\n\n`;}});
 return td.turndown(html);
}
function plainText(html){
 const spaced=String(html||'').replace(/<br\b[^>]*>|<\/(?:p|div|li|h[1-6]|blockquote|pre|tr|td|th|section|article|summary|details)\s*>/gi,'\n');
 return sanitize(spaced,{allowedTags:[],allowedAttributes:{}}).replace(/&#(?:x([\da-f]+)|(\d+));|&(?:amp|lt|gt|quot|apos|nbsp);/gi,(s,hex,decimal)=>{if(hex||decimal){const n=parseInt(hex||decimal,hex?16:10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'�';}return ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '})[s.toLowerCase()];}).trim();
}
const CSS=`:root{color-scheme:light dark;--bg:#f5f7f5;--paper:#fff;--text:#253b35;--muted:#64766e;--line:#dbe4de;--accent:#30664e}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.8 system-ui,'Microsoft YaHei',sans-serif}main{max-width:980px;margin:40px auto;padding:0 22px}header{margin-bottom:28px}h1{font-size:30px;line-height:1.4;overflow-wrap:anywhere}a{color:var(--accent);overflow-wrap:anywhere}article{background:var(--paper);border:1px solid var(--line);border-radius:12px;margin:24px 0;padding:26px;overflow-wrap:anywhere}article>header{border-bottom:1px solid var(--line);padding-bottom:12px;color:var(--muted);font-size:14px}article h2{font-size:18px;margin:0}.body img{max-width:100%;height:auto}.body img.emoji{width:1.3em;height:1.3em;vertical-align:middle}.body blockquote,.body aside.quote{margin:16px 0;padding:12px 18px;background:#819d8314;border-left:4px solid #8fa997}.body pre{background:#23352e;color:#edf5ec;border-radius:8px;padding:16px;overflow:auto;white-space:pre}.body code{font-family:Consolas,monospace}.body table{display:block;overflow:auto;border-collapse:collapse;max-width:100%}.body td,.body th{border:1px solid var(--line);padding:8px 12px}.body details{padding:12px;border:1px solid var(--line);border-radius:6px}.body video,.body audio{max-width:100%}.body .meta,.body .informations{font-size:12px;color:var(--muted)}.notice{color:var(--muted);background:#849e7914;padding:14px 18px;border-radius:8px}.tags span{display:inline-block;margin:3px;padding:2px 9px;border:1px solid var(--line);border-radius:5px;font-size:13px}.toc{padding-left:24px}.toc li{margin:12px 0}@media(prefers-color-scheme:dark){:root{--bg:#17231e;--paper:#22312a;--text:#e1ebe3;--muted:#a3b4a8;--line:#435349;--accent:#a0d4b4}}@media print{body{background:white;color:black}article{break-inside:avoid}main{max-width:none;margin:0}}`;
function page(title,body){return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' https: http:; style-src 'unsafe-inline'; media-src https: http:; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>${escape(title)}</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`;}
function renderTopic(data){
 const run=data.last_run||data,warning=run.complete?'最近一次范围内采集完整':'最近一次采集未完成，已保留历史内容';
 const note=`${warning}。本档案是历次采集的并集，共 ${data.posts.length} 条；未返回的旧楼层不会自动删除。`;
 const media=(data.resource_warnings||[]).length?`有 ${data.resource_warnings.length} 个图片资源未能离线保存，仍保留原链接。`:'';
 const html=[`<header><a href="../../index.html">← 资料库目录</a><h1>${escape(data.title)}</h1><p>${escape(data.category)} · 帖主 @${escape(data.owner)} · <a href="${escape(webURL(data.url))}">查看原帖</a></p><div class="tags">${(data.tags||[]).map(t=>`<span>${escape(t)}</span>`).join('')}</div><p class="notice">${escape(note)} ${escape(media)}</p></header>`];
 const md=[`# ${escape(data.title)}`,`[查看原帖](${webURL(data.url)})`, `类别：${escape(data.category)} | 帖主：@${escape(data.owner)} | 标签：${(data.tags||[]).map(escape).join('、')}`,`> ${note} ${media}`,''];
 for(const p of data.posts){
  const cooked=cleanHTML(p.cooked||`<pre>${escape(p.raw||'')}</pre>`,data.assets||{});const stamp=p.created_at_beijing||p.created_at;
  html.push(`<article id="post-${Number(p.post_id)}"><header><h2>#${Number(p.post_number)} · @${escape(p.username)}</h2><time>${escape(stamp)}</time>${p.updated_at?` · 编辑于 ${escape(p.updated_at)}`:''} · <a href="${escape(webURL(p.url))}">原楼层</a></header><div class="body">${cooked}</div></article>`);
  md.push(`## #${p.post_number} · @${escape(p.username)}`,`发帖时间：${stamp}${p.updated_at?' | 最后编辑：'+p.updated_at:''}`,`[原楼层](${webURL(p.url)})`,'',markdown(cooked),'','---','');
 }
 return {html:page(data.title,html.join('\n')),md:md.join('\n')};
}
function renderIndex(topics){return page('水源本地资料库',`<header><h1>水源本地资料库</h1><p class="notice">共 ${topics.length} 个主题。每帖提供 HTML、Markdown 和结构化数据；更新按帖子和楼层编号合并。可以使用浏览器查找当前目录的标题。</p></header><ul class="toc">${topics.map(t=>`<li><a href="topics/${t.topic_id}/post.html">${escape(t.title)}</a> · <a href="topics/${t.topic_id}/post.md">Markdown</a><br>${escape(t.category)} · ${t.post_count} 条 · 最近采集 ${escape(t.last_saved_at)}${t.complete?'':' · 上次未完成'}</li>`).join('')}</ul>`);}
module.exports={escape,webURL,localAsset,cleanHTML,imageURLs,plainText,renderTopic,renderIndex};
