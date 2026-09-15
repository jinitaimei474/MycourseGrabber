const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const c=fs.existsSync(__dirname+'/../core.js')?require('../core.js'):{};
test('topic URL uses topic id, not reply number; rejects foreign origins',()=>{
  assert.deepEqual(c.parseTarget('123'),{id:123});
  assert.deepEqual(c.parseTarget('https://shuiyuan.sjtu.edu.cn/t/topic/123/45?u=x'),{id:123});
  assert.deepEqual(c.parseTarget('/t/123/45'),{id:123});
  assert.deepEqual(c.parseTarget('一个帖子'),{title:'一个帖子'});
  assert.throws(()=>c.parseTarget('https://evil.example/t/123'));
  assert.throws(()=>c.parseTarget('0'));
});
test('Beijing inclusive day and exact timestamp boundaries, invalid calendar dates',()=>{
  const f=c.makeFilter(' @Alice，bob ','2026-09-01','2026-09-01');
  assert.equal(c.matches({username:'ALICE',created_at:'2026-08-31T16:00:00Z'},f),true);
  assert.equal(c.matches({username:'alice2',created_at:'2026-09-01T00:00:00Z'},f),false);
  assert.equal(c.matches({username:'bob',created_at:'2026-09-01T15:59:59.999Z'},f),true);
  assert.equal(c.matches({username:'bob',created_at:'2026-09-01T16:00:00Z'},f),false);
  assert.throws(()=>c.makeFilter('全部','2026-02-30',''));
  assert.throws(()=>c.makeFilter('全部','2026-09-02','2026-09-01'));
  assert.equal(c.makeFilter('全部','','').users.length,0);
});
const post=(id,username='alice')=>({id,topic_id:123,post_number:id,username,created_at:'2026-09-01T01:02:03.000Z',raw:'正文\n第二行',cooked:'<p>正文</p>'});
test('crawl visits entire stream, de-duplicates and filters users, keeps timestamps',async()=>{
  const ids=Array.from({length:47},(_,i)=>i+1),paths=[];
  const client={get:async path=>{paths.push(path);if(!path.includes('/posts.json'))return {id:123,title:'题名',post_stream:{stream:ids,posts:[post(1)]}};
    const selected=new URL(path,'https://example.test').searchParams.getAll('post_ids[]').map(Number);
    return {post_stream:{posts:[...selected.map(id=>post(id,id%2?'alice':'bob')),post(selected[0])]}};}};
  const r=await c.crawl(client,123,c.makeFilter('alice','',''));
  assert.equal(r.complete,true);assert.equal(r.posts.length,24);assert.equal(r.scanned,47);
  assert.equal(paths.length,4);assert.deepEqual(r.missing_ids,[]);
  assert.equal(r.posts[0].created_at,'2026-09-01T01:02:03.000Z');assert.match(c.toText(r),/2026-09-01 09:02:03/);
});
test('missing posts are explicit; request failure retains earlier results',async()=>{
  let calls=0;
  const result=await c.crawl({get:async()=>++calls===1?{id:123,title:'x',post_stream:{stream:[1,2],posts:[post(1)]}}:{post_stream:{posts:[]}}},123,c.makeFilter('全部','',''));
  assert.equal(result.complete,false);assert.deepEqual(result.missing_ids,[2]);
  calls=0;
  const failed=await c.crawl({get:async()=>{if(++calls===1)return {id:123,title:'x',post_stream:{stream:[1,2],posts:[post(1)]}};throw Error('网络失败');}},123,c.makeFilter('全部','',''));
  assert.equal(failed.complete,false);assert.equal(failed.posts.length,1);assert.match(failed.error,/网络失败/);
});
test('abort preserves partial results and stops further batches',async()=>{
  const controller=new AbortController();let calls=0;
  const r=await c.crawl({get:async()=>{calls++;controller.abort();return {id:123,title:'x',post_stream:{stream:[1,2],posts:[post(1)]}};}},123,c.makeFilter('全部','',''),{signal:controller.signal});
  assert.equal(calls,1);assert.equal(r.complete,false);assert.equal(r.cancelled,true);
});
test('client retries 429 with bounded waits and refuses HTML login response',async()=>{
  let calls=0;const waits=[];
  const client=c.createClient({fetchImpl:async()=>++calls===1?new Response('{}',{status:429,headers:{'Retry-After':'2'}}):new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}}),sleep:async ms=>waits.push(ms),interval:0});
  assert.equal((await client.get('/t/123.json')).ok,true);assert.ok(waits.includes(2000));
  const bad=c.createClient({fetchImpl:async()=>new Response('<html>登录</html>',{headers:{'Content-Type':'text/html'}}),interval:0});
  await assert.rejects(bad.get('/t/123.json'),/登录|JSON/);
  await assert.rejects(bad.get('https://evil.example/'),/地址/);
});
test('search encodes title, uses title restriction and exposes more results',async()=>{
  let path='';const r=await c.search({get:async p=>{path=p;return {topics:[{id:123,title:'x'}],grouped_search_result:{more_full_page_results:true}};}},'一个帖子',2);
  const q=new URL(path,'https://example.test').searchParams;
  assert.equal(q.get('page'),'2');assert.match(q.get('q'),/in:title/);assert.equal(r.more,true);assert.equal(r.topics[0].id,123);
});
