'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const modelPath='../src/modules/tennis/model.cjs',storePath='../src/modules/tennis/store.cjs';
const candidate={venue:'东区网球场',date:'2026-10-02',time:'18:00-19:00',court:''};
const config=()=>({candidates:[candidate,{...candidate,venue:'胡晓明网球场',time:'19:00-20:00'}],startAt:Date.parse('2026-09-25T12:00:00+08:00'),endAt:Date.parse('2026-09-25T12:05:00+08:00'),intervalMs:3000});
test('tennis validates real dates, single hourly slots and preserves candidate priority',()=>{
 assert(fs.existsSync(path.resolve(__dirname,modelPath)),'tennis model missing');const {validateConfig}=require(modelPath);
 assert.deepEqual(validateConfig(config()).candidates,config().candidates);
 for(const change of [{date:'2026-02-30'},{time:'18:00-20:00'},{venue:'其他场馆'},{court:'-1'},{date:'x'}])assert.throws(()=>validateConfig({...config(),candidates:[{...candidate,...change}]}));
 assert.throws(()=>validateConfig({...config(),intervalMs:100}));
 assert.throws(()=>validateConfig({...config(),endAt:0}));
});
test('release is Beijing noon seven days before including month and year rollover',()=>{
 const {releaseAt}=require(modelPath);assert.equal(releaseAt('2026-10-02'),Date.parse('2026-09-25T12:00:00+08:00'));assert.equal(releaseAt('2027-01-03'),Date.parse('2026-12-27T12:00:00+08:00'));
});
test('uncertain and unpaid locks survive restart, isolate accounts and omit secrets',()=>{
 const {TennisStore}=require(storePath);const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tennis-'));const file=path.join(dir,'tennis.json');
 const a=new TennisStore(file);a.configure({...config(),password:'must-not-persist'});a.mark('alice',candidate.date,{state:'submitting',candidate,password:'must-not-persist'});
 const b=new TennisStore(file);assert.equal(b.get('alice',candidate.date).state,'uncertain');assert.equal(b.get('bob',candidate.date),null);
 b.mark('alice',candidate.date,{state:'awaiting_payment',orderId:'123',candidate});assert.equal(new TennisStore(file).get('alice',candidate.date).orderId,'123');
 assert(!fs.readFileSync(file,'utf8').includes('must-not-persist'));assert.equal(b.view('bob').records.length,0);
});
test('unknown order states remain blocking; only explicit cancellations free dates',()=>{
 const {orderRecord}=require(modelPath);assert.equal(orderRecord({pOrderid:'1',scDate:'2026-10-02',orderstateid:'0'}).state,'awaiting_payment');
 assert.equal(orderRecord({pOrderid:'1',scDate:'2026-10-02',orderstateid:'1'}).state,'success');
 assert.equal(orderRecord({pOrderid:'1',scDate:'2026-10-02',orderstateid:'8'}).state,'cancelled');
 assert.equal(orderRecord({pOrderid:'1',scDate:'2026-10-02',orderstateid:'mystery'}).state,'uncertain');
});
test('payment deadline uses earlier of website absolute deadline and countdown',()=>{
 const {paymentExpiry}=require(modelPath);const now=Date.parse('2026-09-25T12:00:00+08:00');assert.equal(paymentExpiry('请在2026-09-25 12:05:00之前缴费。剩余时间:598秒',now),now+300000);assert.equal(paymentExpiry('剩余时间:60秒',now),now+60000);assert.equal(paymentExpiry('微信支付',now),null);
});
test('corrupt persistence blocks writes rather than silently discarding daily locks',()=>{
 const {TennisStore}=require(storePath);const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tennis-corrupt-')),file=path.join(dir,'tennis.json');fs.writeFileSync(file,'broken');const store=new TennisStore(file);assert.throws(()=>store.configure(config()),/无法读取/);assert.equal(fs.readFileSync(file,'utf8'),'broken');
});
