const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const exists=require('node:fs').existsSync;
const {Archive}=exists(path.join(__dirname,'../src/modules/shuiyuan/archive.cjs'))?require('../src/modules/shuiyuan/archive.cjs'):{};
const render=exists(path.join(__dirname,'../src/modules/shuiyuan/presentation.cjs'))?require('../src/modules/shuiyuan/presentation.cjs'):{};
const post=(id,text='正文')=>({post_id:id,post_number:id,username:'alice',created_at:'2026-10-01T00:00:00Z',created_at_beijing:'2026-10-01 08:00:00 +08:00',updated_at:null,raw:text,cooked:`<p>${text}</p>`,url:`https://shuiyuan.sjtu.edu.cn/t/123/${id}`});
const result=(posts,extra={})=>({topic_id:123,title:'标题',category:'校园',tags:['经验'],owner:'alice',url:'https://shuiyuan.sjtu.edu.cn/t/123',posts,complete:true,expected:3,scanned:3,filter:{users:[],start:'',end:''},missing_ids:[],invalid_ids:[],error:'',...extra});
async function dir(t){const base=path.resolve(__dirname,'../../artifacts');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'sy-archive-'));t.after(()=>{if(!path.resolve(root).startsWith(base+path.sep))throw Error('Unsafe test cleanup');return fs.rm(root,{recursive:true,force:true});});return root;}
test('archive persists Markdown/HTML/JSON and recognizes the same topic across reopen and rename',async t=>{
 const root=await dir(t),a=await Archive.open(root);const first=await a.save(result([post(1)]));assert.equal(first.added,1);
 const b=await Archive.open(a.root);assert.equal(b.summary().topics[0].topic_id,123);
 const again=await b.save(result([post(1)],{title:'改名'}));assert.equal(again.added,0);assert.equal(again.unchanged,1);
 const home=path.join(root,'shuiyuan-archive');assert.match(await fs.readFile(path.join(home,'topics/123/post.md'),'utf8'),/改名/);assert.match(await fs.readFile(path.join(home,'topics/123/post.html'),'utf8'),/08:00:00/);
 assert.match(await fs.readFile(path.join(home,'index.html'),'utf8'),/topics\/123\/post.html/);assert.equal((await fs.readdir(path.join(home,'topics'))).length,1);
});
test('upsert updates edits and merges narrower/partial runs without erasing old posts',async t=>{
 const a=await Archive.open(await dir(t));await a.save(result([post(1),post(2)]));
 const edit=await a.save(result([post(2,'修改后'),post(3)],{complete:false,error:'网络断开',filter:{users:['alice'],start:'2026-10-01',end:''}}));
 assert.equal(edit.updated,1);assert.equal(edit.added,1);assert.equal(edit.total,3);const data=await a.readTopic(123);assert.equal(data.posts.length,3);assert.equal(data.last_run.complete,false);assert.equal(data.posts.find(p=>p.post_id===2).text,'修改后');assert(data.posts[0].content_hash);
 await a.save(result([],{filter:{users:['bob'],start:'',end:''}}));assert.equal((await a.readTopic(123)).posts.length,3);
});
test('corrupt existing data and unmanaged folder are never silently overwritten',async t=>{
 const root=await dir(t);await fs.mkdir(path.join(root,'shuiyuan-archive'));await fs.writeFile(path.join(root,'shuiyuan-archive/notes.md'),'my notes');await assert.rejects(()=>Archive.open(root),/资料库|标识/);
 const other=await dir(t),a=await Archive.open(other);await a.save(result([post(1)]));const data=path.join(other,'shuiyuan-archive/topics/123/topic.json');await fs.writeFile(data,'broken');
 await assert.rejects(()=>a.save(result([post(2)])),/损坏|读取/);assert.equal(await fs.readFile(data,'utf8'),'broken');await assert.rejects(()=>a.readTopic('../notes'),/编号/);
});
test('managed path junction is rejected before writes',async t=>{
 const root=await dir(t),outside=await dir(t),a=await Archive.open(root);await fs.mkdir(path.join(root,'shuiyuan-archive/topics'),{recursive:true});
 await fs.symlink(outside,path.join(root,'shuiyuan-archive/topics/123'),'junction');await assert.rejects(()=>a.save(result([post(1)])),/链接|路径/);assert.deepEqual(await fs.readdir(outside),[]);
});
test('HTML cleans active content and Markdown preserves quotes, table, code and image',()=>{
 const p=post(1);p.cooked='<script>alert(1)</script><p onclick="bad()">你好 <strong>世界</strong></p><blockquote>引用</blockquote><table><thead><tr><th>A</th></tr></thead><tbody><tr><td>B</td></tr></tbody></table><pre><code class="lang-js">const x = 1;</code></pre><img src="/uploads/a.png" onerror="bad()"><a href="javascript:alert(1)">坏链接</a><iframe src="https://evil.test"></iframe>';
 const doc=render.renderTopic({...result([p]),last_run:{complete:true},assets:{}});
 assert(!doc.html.includes('<script'));assert(!doc.html.includes('onclick'));assert(!doc.html.includes('javascript:'));assert(!doc.html.includes('<iframe'));assert.match(doc.html,/Content-Security-Policy/);
 assert.match(doc.md,/\*\*世界\*\*/);assert.match(doc.md,/> 引用/);assert.match(doc.md,/\| A \|/);assert.match(doc.md,/```js/);assert.match(doc.md,/https:\/\/shuiyuan.sjtu.edu.cn\/uploads\/a.png/);
});
test('images save locally, are reused, and failures preserve content with explicit warnings',async t=>{
 const a=await Archive.open(await dir(t));let calls=0;const p=post(1);p.cooked='<p>图</p><img src="/uploads/a.png"><img src="https://external.test/b.png">';
 const fetchImage=async()=>{calls++;return {bytes:Buffer.from('89504e470d0a1a0a00000000','hex'),type:'image/png'};};
 const first=await a.save(result([p]),{fetchImage});assert.equal(calls,1);assert(first.warnings.length>0);
 const data=await a.readTopic(123);assert.match(Object.values(data.assets)[0],/^assets\/[a-f0-9]+\.png$/);
 await a.save(result([p]),{fetchImage});assert.equal(calls,1);
 const text=await fs.readFile(path.join(a.root,'topics/123/post.md'),'utf8');assert.match(text,/assets\//);
});
test('downloaded lightbox original remains visible when the thumbnail is unavailable',()=>{
 const p=post(1);p.cooked='<a class="lightbox" href="/uploads/original.png"><img src="/uploads/thumb.png"></a>';
 const asset='assets/'+'a'.repeat(64)+'.png';const view=render.renderTopic({...result([p]),assets:{'https://shuiyuan.sjtu.edu.cn/uploads/original.png':asset}});
 assert(view.html.includes(`src="${asset}"`));assert(!view.md.includes('thumb.png'));assert(view.md.includes(`](${asset})`));
});
test('existing projects rebuild search, edits refresh results and jumps validate actual archived IDs',async t=>{
 const root=await dir(t),a=await Archive.open(root);t.after(()=>a.close());await a.save(result([post(1,'图书馆自习'),post(2,'课程复习')]));
 assert.equal((await a.search({query:'自习'})).total,1);await a.save(result([post(1,'图书馆借书')]));assert.equal((await a.search({query:'自习'})).total,0);assert.equal((await a.search({query:'复习'})).total,1);
 const b=await Archive.open(root);t.after(()=>b.close());assert.equal((await b.search({query:'借书'})).total,1);assert((await b.facets()).authors.includes('alice'));
 const target=await b.postPath(123,1);assert.equal(target.hash,'post-1');assert(target.file.endsWith('post.html'));await assert.rejects(()=>b.postPath(123,999),/不在/);await assert.rejects(()=>b.postPath('../123',1),/编号/);
});
