(function(){
 'use strict';const $=id=>document.getElementById(id);let state=null,selected=new Set(),topicsKey='',metadataKey='',previewKey='',localFacetsKey='',localResultKey='',localProject='',localDirty=false,localSpec={};
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 async function command(action,payload){try{await window.assistant.invoke(action,payload);}catch(error){$('sy-status').textContent=error.message;}}
 function selection(){
   $('sy-selected').textContent=`已选 ${selected.size} / 50`;
   const ids=(state?.shuiyuan?.topics||[]).map(t=>t.id);$('sy-all').checked=!!ids.length&&ids.every(id=>selected.has(id));$('sy-all').indeterminate=selected.size>0&&!$('sy-all').checked;
   $('sy-crawl').disabled=!!state?.busy||!state?.shuiyuan?.connected||!state?.shuiyuan?.project||!selected.size;
 }
 function render(snapshot){
   state=snapshot;const s=snapshot.shuiyuan;if(!s)return;
   for(const id of ['sy-project','sy-connect','sy-mode','sy-query','sy-category','sy-tag','sy-users','sy-start','sy-end','sy-search','sy-more','sy-all'])$(id).disabled=snapshot.busy;
   $('sy-project-open').disabled=snapshot.busy||!s.project;
   $('sy-project-path').textContent=s.project?.folder||'采集前选择文件夹。帖子、Markdown、HTML 和图片会自动保存到项目中。';
   $('sy-project-count').textContent=s.project?`项目已有 ${s.project.topic_count} 个主题${s.saved?` · 本次新增 ${s.saved.added} 条，更新 ${s.saved.updated} 条，未变 ${s.saved.unchanged} 条`:''}`:'';
   renderLocal(s,snapshot.busy);
   $('sy-stop').disabled=!snapshot.busy||snapshot.operationModule!=='shuiyuan';
   $('sy-show').disabled=!s.connected;$('sy-search').disabled=snapshot.busy||!s.connected;
   $('sy-connection').textContent=s.connected?`已连接 · @${s.username}`:'首次使用，在专用 Edge 中登录；以后复用登录状态。';
   $('sy-status').textContent=s.message;$('sy-count').textContent=`${s.topics.length} 个主题`;$('sy-more').hidden=!s.more;
   const mk=JSON.stringify([s.username,s.categories,s.tags]);
   if(metadataKey!==mk){const value=$('sy-category').value;metadataKey=mk;$('sy-category').replaceChildren(new Option('全部类别',''));for(const c of s.categories)$('sy-category').add(new Option(c.name,String(c.id)));$('sy-category').value=value;$('sy-tags').replaceChildren(...s.tags.map(name=>new Option(name,name)));}
   const tk=JSON.stringify([s.username,s.topics,snapshot.busy]);
   if(topicsKey!==tk){topicsKey=tk;const ids=new Set(s.topics.map(t=>t.id));selected=new Set([...selected].filter(id=>ids.has(id)));$('sy-topics').replaceChildren();
     for(const t of s.topics){const card=el('label',undefined,'forum-topic'),box=el('input');box.type='checkbox';box.className='sy-topic-check';box.checked=selected.has(t.id);box.disabled=snapshot.busy;
       box.onchange=()=>{if(box.checked){if(selected.size>=50){box.checked=false;$('sy-status').textContent='每次最多选择 50 个帖子';return;}selected.add(t.id);}else selected.delete(t.id);selection();};
       const body=el('div');body.append(el('h3',t.title),el('p',`#${t.id} · 帖主 ${t.owner?'@'+t.owner:'未返回'} · ${t.posts_count} 楼`),el('p',t.category),el('p',t.archived?`已归档 ${t.archived.post_count} 条 · 将自动更新`:'尚未归档 · 首次采集'));
       const tags=el('div',undefined,'forum-tags');for(const tag of t.tags)tags.append(el('span',tag));body.append(tags);card.append(box,body);$('sy-topics').append(card);
     }
     if(!s.topics.length){const empty=el('div',undefined,'empty');empty.append(el('div','≋','empty-symbol'),el('h3','把散落的讨论，收进一处'),el('p',s.connected?'输入关键词或选择类别、标签后查找。':'先连接水源，再选择想要的帖子。'));$('sy-topics').append(empty);}
   }
   selection();const p=s.progress;$('sy-progress').max=p?.expected||1;$('sy-progress').value=p?.scanned||0;
   const r=s.result;$('sy-txt').disabled=$('sy-json').disabled=snapshot.busy||!r;
   $('sy-summary').textContent=r?`${r.complete?'完整结果':r.cancelled?'已停止 · 部分结果':'未完成 · 部分结果'} · ${r.processed}/${r.requested} 个主题 · ${r.count} 条发言${r.error?' · '+r.error:''}`:'正文及图片自动保存到项目；下方可额外导出本次筛选结果。';
   const pk=JSON.stringify(r?.preview||[]);if(pk!==previewKey){previewKey=pk;$('sy-preview').replaceChildren();for(const post of r?.preview||[]){const item=el('article');item.append(el('h3',post.topic),el('p',`@${post.username} · #${post.post_number} · ${post.time}`),el('pre',post.content));$('sy-preview').append(item);}if(r?.count>30)$('sy-preview').append(el('p','仅预览前 30 条，导出包含全部已采集内容。','helper'));}
 }
 function renderLocal(s,busy){
   const fields=['query','author','category','tag','start','end'];
   if(localProject!==(s.project?.folder||'')){localProject=s.project?.folder||'';localSpec={};localDirty=false;for(const name of fields)$('sy-local-'+name).value='';}
   const facets=s.localFacets||{authors:[],categories:[],tags:[]},key=JSON.stringify(facets);
   if(key!==localFacetsKey){localFacetsKey=key;const value=$('sy-local-category').value;$('sy-local-category').replaceChildren(new Option('全部类别',''),...facets.categories.map(c=>new Option(c.name||c.id,c.id)));$('sy-local-category').value=value;$('sy-local-authors').replaceChildren(...facets.authors.map(n=>new Option(n,n)));$('sy-local-tags').replaceChildren(...facets.tags.map(n=>new Option(n,n)));}
   for(const name of fields)$('sy-local-'+name).disabled=busy||!s.project;
   $('sy-local-search').disabled=busy||!s.project;
   const r=s.localResult;$('sy-local-prev').disabled=busy||localDirty||!r||r.offset===0;$('sy-local-next').disabled=busy||localDirty||!r?.more;
   $('sy-local-summary').textContent=localDirty?'筛选条件已修改，请点击搜索资料库。':r?`找到 ${r.total} 条发言${r.total?` · 当前 ${r.offset+1}–${r.offset+r.results.length} 条`:''}`:s.project?'可输入关键词，或仅按作者、时间、类别和标签筛选。重新采集后请重新搜索。':'选择项目后即可搜索历史内容。';
   const rk=JSON.stringify([r,busy]);if(rk===localResultKey)return;localResultKey=rk;$('sy-local-results').replaceChildren();
   for(const p of r?.results||[]){const item=el('article',undefined,'forum-local-result'),open=el('button',`打开第 ${p.post_number} 楼 ↗`,'secondary');open.disabled=busy;open.onclick=()=>command('shuiyuanLocalOpen',{topic_id:p.topic_id,post_id:p.post_id});item.append(el('h3',p.title),el('p',`@${p.username} · ${p.time} · ${p.category}`,'helper'),el('pre',p.snippet),open);$('sy-local-results').append(item);}
 }
 function localSearch(offset=0){if(offset===0){localSpec={query:$('sy-local-query').value,authors:$('sy-local-author').value,category:$('sy-local-category').value,tag:$('sy-local-tag').value,start:$('sy-local-start').value.trim(),end:$('sy-local-end').value.trim()};}localDirty=false;command('shuiyuanLocalSearch',{...localSpec,offset});}
 $('sy-local-search').onclick=()=>localSearch();$('sy-local-prev').onclick=()=>localSearch(Math.max(0,state.shuiyuan.localResult.offset-30));$('sy-local-next').onclick=()=>localSearch(state.shuiyuan.localResult.offset+30);
 for(const name of ['query','author','category','tag','start','end']){$('sy-local-'+name).oninput=()=>{localDirty=true;renderLocal(state.shuiyuan,state.busy);};$('sy-local-'+name).onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing&&!$('sy-local-search').disabled)localSearch();};}
 $('sy-connect').onclick=()=>command('shuiyuanConnect',window.credentialsUI.read());$('sy-show').onclick=()=>command('shuiyuanShow');
 $('sy-project').onclick=()=>command('shuiyuanProject');$('sy-project-open').onclick=()=>command('shuiyuanOpenProject');
 $('sy-mode').onchange=()=>{$('sy-query').placeholder=$('sy-mode').value==='owner'?'输入帖主的用户名，例如 @alice':'输入帖子名称、编号或链接';};
 $('sy-search').onclick=()=>{selected.clear();selection();command('shuiyuanSearch',{mode:$('sy-mode').value,query:$('sy-query').value,category:$('sy-category').value,tag:$('sy-tag').value});};
 $('sy-more').onclick=()=>command('shuiyuanSearch',{more:true});
 $('sy-all').onchange=()=>{selected=$('sy-all').checked?new Set(state.shuiyuan.topics.slice(0,50).map(t=>t.id)):new Set();topicsKey='';render(state);};
 $('sy-crawl').onclick=()=>command('shuiyuanCrawl',{ids:[...selected],users:$('sy-users').value,start:$('sy-start').value.trim(),end:$('sy-end').value.trim()});
 $('sy-stop').onclick=()=>command('shuiyuanStop');$('sy-txt').onclick=()=>command('shuiyuanExport',{format:'txt'});$('sy-json').onclick=()=>command('shuiyuanExport',{format:'json'});
 window.shuiyuanUI={render};
})();
