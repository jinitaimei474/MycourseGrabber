'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {TennisStore}=require('../src/modules/tennis/store.cjs');
const futureDate=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
function setup(options={}){
 const {TennisService}=require('../src/modules/tennis/service.cjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tennis-service-'));const store=new TennisStore(path.join(dir,'tennis.json'));
 const c={venue:'东区网球场',date:futureDate,time:'18:00-19:00',court:''};store.configure({candidates:[c,{...c,venue:'胡晓明网球场'}],startAt:Date.now()-100,endAt:Date.now()+10000,intervalMs:1000});
 const calls=[];const adapter={owner:'alice',connect:async()=> 'alice',checkOwner:async()=>{},orders:async()=>[],prepare:async c=>c.venue==='胡晓明网球场',submit:async c=>{calls.push(c);return {orderId:'o1',amount:'5'};},payment:async()=>({qrFile:'q.png',expiresAt:Date.now()+600000}),...options};
 const service=new TennisService({store,adapter});return {service,store,calls,c};
}
test('unavailable primary falls back; QR is unpaid and prevents a second same-day submit',async()=>{
 assert(fs.existsSync(path.resolve(__dirname,'../src/modules/tennis/service.cjs')),'tennis service missing');const {service,store,calls,c}=setup();await service.connect({});await service.run();
 assert.equal(calls.length,1);assert.equal(calls[0].venue,'胡晓明网球场');assert.equal(store.get('alice',c.date).state,'awaiting_payment');await service.run();assert.equal(calls.length,1);
});
test('lost submission response persists uncertainty and never falls through to alternatives',async()=>{
 let calls=0;const {service,store,c}=setup({prepare:async()=>true,submit:async()=>{calls++;throw Error('response lost');}});await service.connect({});await service.run();assert.equal(calls,1);assert.equal(store.get('alice',c.date).state,'uncertain');await service.run();assert.equal(calls,1);
});
test('known rejection allows fallback without leaving a false lock',async()=>{
 let count=0;const {service,store,c}=setup({prepare:async()=>true,submit:async()=>++count===1?{rejected:true,message:'场地已被预约'}:{orderId:'o2'}});await service.connect({});await service.run();assert.equal(count,2);assert.equal(store.get('alice',c.date).orderId,'o2');
});
test('existing online order blocks submission and account mismatch stops before submit',async()=>{
 const x=setup({orders:async()=>[{date:futureDate,orderId:'prior',state:'success'}]});await x.service.connect({});await x.service.run();assert.equal(x.calls.length,0);
 const y=setup({checkOwner:async()=>{throw Error('账号已变化');}});await y.service.connect({});await y.service.run();assert.equal(y.calls.length,0);
});
test('stop while waiting makes no reservation',async()=>{
 const x=setup();x.store.configure({...x.store.data.config,startAt:Date.now()+5000,endAt:Date.now()+10000});await x.service.connect({});const run=x.service.run();x.service.stop();await run;assert.equal(x.calls.length,0);assert.equal(x.service.view().running,false);
});
test('payment failure keeps order pending and can resume without submitting again',async()=>{
 const x=setup({payment:async()=>{throw Error('请手动处理验证');}});await x.service.connect({});await x.service.run();assert.equal(x.store.get('alice',x.c.date).state,'awaiting_payment');
 x.service.adapter.payment=async()=>({qrFile:'q.png',expiresAt:Date.now()+600000});await x.service.resume(x.c.date);assert.equal(x.calls.length,1);assert.equal(x.store.get('alice',x.c.date).qrFile,'q.png');
});
test('server-confirmed payment clears the payment prompt and QR image',async()=>{
 const x=setup({payment:async()=>({qrFile:'q.png',qrData:'data:image/png;base64,test',expiresAt:Date.now()+600000})});await x.service.connect({});await x.service.run();assert(x.service.view().qrData);
 x.service.adapter.orders=async()=>[{date:x.c.date,orderId:'o1',state:'success'}];await x.service.check();assert.equal(x.service.view().qrData,'');assert.equal(x.store.get('alice',x.c.date).state,'success');
});
test('monitor publishes fresh snapshots without submitting and stale or unknown selections are rejected',async()=>{
 const x=setup();await x.service.connect({});assert.equal(typeof x.service.monitor,'function');
 const row={id:'s1',...x.c,court:'2',price:'5'};x.service.adapter.scan=async()=>({slots:[row],warnings:[]});
 const filters={date:x.c.date,venues:[x.c.venue],after:'18:00',before:'22:00',intervalMs:3000};
 const first=new Promise(resolve=>x.service.on('update',()=>{if(x.service.view().availability?.slots.length)resolve();}));const running=x.service.monitor(filters);await first;x.service.stop();await running;
 assert.equal(x.calls.length,0);assert.deepEqual(x.service.availableCandidates(['s1']),[{...x.c,court:'2'}]);assert.throws(()=>x.service.availableCandidates(['forged']),/变化|刷新/);
 x.service.availability.updatedAt=1;assert.throws(()=>x.service.availableCandidates(['s1']),/过期|刷新/);
});
test('failed monitor refresh clears old availability instead of presenting it as current',async()=>{
 const x=setup();await x.service.connect({});assert.equal(typeof x.service.monitor,'function');x.service.adapter.scan=async()=>{throw Error('登录失效');};
 await x.service.monitor({date:x.c.date,venues:[x.c.venue],after:'18:00',before:'22:00',intervalMs:3000});assert.equal(x.service.view().availability.slots.length,0);assert.match(x.service.view().availability.error,/登录失效/);assert.equal(x.calls.length,0);
});
