const {chromium}=require('playwright-core');const assert=require('node:assert/strict');const {ShuiyuanService}=require('../src/modules/shuiyuan/service.cjs');const {installRoutes}=require('./shuiyuan-fixture.cjs');
(async()=>{
 const edge=await chromium.launch({channel:'msedge',headless:true});const context=await edge.newContext();let username='alice';const requests=[];const fixture={requests,username:()=>username};await installRoutes(context,fixture);
 try{
  const coursePage=await context.newPage();const browser={context,page:coursePage,launch:async()=>{}};const service=new ShuiyuanService({browser,interval:0});
  await service.connect();assert.equal(service.connected,true);assert.notEqual(service.page,coursePage);assert.equal(browser.page,coursePage);assert.equal(service.tags.length,2);
  await service.search({mode:'owner',query:'alice',category:'1',tag:'选课'});assert.deepEqual(service.topics.map(t=>t.id),[101]);assert(service.more);
  await service.search({more:true});assert.deepEqual(service.topics.map(t=>t.id),[101,103]);assert(!service.more);
  await service.crawl({ids:[101],users:'alice',start:'2026-09-21',end:'2026-09-21'});assert.equal(service.result.complete,true);assert.equal(service.result.topics[0].posts.length,22);assert.equal(service.result.topics[0].scanned,45);
  assert.match(service.export('txt'),/课程交流/);assert(JSON.parse(service.export('json')).topics[0].posts.every(p=>p.created_at&&p.created_at_beijing));
  await assert.rejects(()=>service.fetch('https://evil.example/'),/不允许/);await assert.rejects(()=>service.crawl({ids:[999],users:'全部'}),/选择/);
  const stop=new AbortController();service.on('update',()=>{if(service.progress?.scanned===1)stop.abort();});await service.crawl({ids:[101,103],users:'全部'},stop.signal);assert(service.result.cancelled);assert(!service.result.complete);assert.equal(service.result.topics.length,1);assert.equal(service.result.topics[0].posts.length,1);
  const activeStop=new AbortController();let activeBatch=false;fixture.delayBatch=3000;fixture.onRequest=url=>{if(url.pathname.endsWith('/posts.json')){activeBatch=true;setTimeout(()=>activeStop.abort(),50);}};
  const began=Date.now();await service.crawl({ids:[101],users:'全部'},activeStop.signal);assert(activeBatch);assert(Date.now()-began<2500,'stop waited for the server instead of aborting fetch');assert(service.result.cancelled);assert.equal(service.result.topics[0].posts.length,1);fixture.onRequest=null;
  username='new-user';await assert.rejects(()=>service.search({mode:'id',query:'101'}),/账号已变化/);assert.equal(service.result,null);assert.deepEqual(service.topics,[]);assert.equal(service.connected,false);
  assert(requests.every(p=>!p.includes('password')));console.log('PASS: Edge transport, metadata, owner/category/tag filters, pagination, 45-post capture, timezone, stop, exports, account isolation.');
 }finally{await edge.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
