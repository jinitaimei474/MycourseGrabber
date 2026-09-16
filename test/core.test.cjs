const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script = require('node:path').join(__dirname,'../course-timer.user.js');
const core = require(script);
const a={jxbId:'a',kchId:'course-a',className:'A'}, b={jxbId:'b',kchId:'course-b',className:'B'};
const config=extra=>({startAt:10000,endAt:40000,intervalMs:5000,targets:[a,b],dryRun:false,...extra});
function harness(states={},outcomes={}) {
  let time=0;const effects=[],reads={},writes={};
  const env={now:()=>time,sleep:async ms=>{time+=ms;}};
  const adapter={inspect:t=>({state:'available',...t}),prepare:async t=>{effects.push(['prepare',t.jxbId,time]);},
    refresh:async t=>{const id=t.jxbId;effects.push(['refresh',id,time]);const list=states[id]||['available'];const n=reads[id]||0;reads[id]=n+1;return {state:list[Math.min(n,list.length-1)]};},
    submit:async t=>{const id=t.jxbId;effects.push(['submit',id,time]);const list=outcomes[id]||['success'];const n=writes[id]||0;writes[id]=n+1;return {state:list[Math.min(n,list.length-1)]};}};
  return {env,adapter,effects,writes};
}
test('Beijing input is UTC+8 and invalid dates fail',()=>{
  assert.equal(core.parseBeijing('2026-09-15T13:00:00'),Date.UTC(2026,8,15,5));
  for(const v of ['2026-02-30T13:00:00','tomorrow','','2026-09-15T25:00:00'])assert.throws(()=>core.parseBeijing(v));
});
test('only final submission flags 1/3/6 mean success',()=>{
  const url='/xsxk/zzxkyzbjk_xkBcZyZzxkYzb.html';
  for(const flag of ['1','3','6'])assert.equal(core.classifyResponse(url,200,{flag}),'success');
  assert.equal(core.classifyResponse('/xsxk/zzxkyzb_cxXkTitleMsg.html',200,{flag:'1'}),'unrelated');
  assert.equal(core.classifyResponse(url,200,{flag:'-1'}),'full');assert.equal(core.classifyResponse(url,503,{flag:'1'}),'unknown');
  assert.equal(core.classifyResponse(url,200,'<html>login</html>'),'unknown');
});
test('default dry run checks all targets without waiting or network',async()=>{
  const h=harness(),c=config();delete c.dryRun;const r=await core.run(c,h.adapter,h.env);
  assert.equal(r.state,'dry-run');assert.equal(r.courses.length,2);assert.deepEqual(h.effects,[]);assert.equal(h.env.now(),0);
});
test('each round checks every course without a per-course sleep and skips successful ones',async()=>{
  const h=harness({a:['full','available']});const r=await core.run(config(),h.adapter,h.env);
  assert.equal(r.state,'success');assert.deepEqual(h.writes,{b:1,a:1});
  assert.deepEqual(h.effects.filter(x=>x[0]==='prepare'),[['prepare','a',10000],['prepare','b',10000],['prepare','a',15000]]);
});
test('full courses still search and refresh on every round',async()=>{
  const h=harness({a:['full']});await core.run(config({targets:[a],endAt:20000}),h.adapter,h.env);
  assert.deepEqual(h.effects,[['prepare','a',10000],['refresh','a',10000],['prepare','a',15000],['refresh','a',15000]]);
  assert.deepEqual(h.writes,{});
});
test('page query and submission operations never overlap across courses',async()=>{
  const h=harness();let pageOps=0,maxPageOps=0;
  h.adapter.prepare=async()=>{pageOps++;maxPageOps=Math.max(maxPageOps,pageOps);await new Promise(resolve=>setTimeout(resolve,5));};
  const submit=h.adapter.submit;h.adapter.submit=async t=>{const result=await submit(t);pageOps--;return result;};
  const targets=Array.from({length:7},(_,i)=>({jxbId:String(i),kchId:'c'+i}));
  assert.equal((await core.run(config({targets}),h.adapter,h.env)).state,'success');
  assert.equal(maxPageOps,1);assert.equal(Object.keys(h.writes).length,7);
});
test('one rejected search does not suppress another course and cannot cause a blind submit',async()=>{
  const h=harness();h.adapter.prepare=async t=>{if(t===a)throw new Error('network');};
  const r=await core.run(config(),h.adapter,h.env);assert.equal(r.state,'expired');assert.deepEqual(h.writes,{b:1});assert.equal(r.courses[0].state,'waiting');
});
test('queued courses recheck deadline and refresh before submitting',async()=>{
  const h=harness();const submit=h.adapter.submit;h.adapter.submit=async t=>{const r=await submit(t);await h.env.sleep(40000);return r;};
  const r=await core.run(config(),h.adapter,h.env);assert.equal(r.state,'expired');assert.deepEqual(h.writes,{a:1});
  assert.deepEqual(h.effects.filter(x=>x[0]==='refresh').map(x=>x[1]),['a']);
});
test('no attempt or 30 minute cutoff; runs until absolute end',async()=>{
  const h=harness({a:['full']});const r=await core.run(config({targets:[a],endAt:2020000}),h.adapter,h.env);
  assert.equal(r.state,'expired');assert.equal(h.env.now(),2020000);assert.ok(h.effects.length>200);assert.deepEqual(h.writes,{});
});
test('full submission retries later without terminating other courses',async()=>{
  const h=harness({},{a:['full','success']});assert.equal((await core.run(config(),h.adapter,h.env)).state,'success');assert.deepEqual(h.writes,{a:2,b:1});
});
test('unknown submission held while other courses continue until deadline',async()=>{
  const h=harness({},{a:['unknown']});const r=await core.run(config(),h.adapter,h.env);
  assert.equal(r.state,'expired');assert.deepEqual(h.writes,{a:1,b:1});assert.equal(r.courses[0].state,'uncertain');assert.equal(r.courses[1].state,'success');
});
test('manual verification permits retry of an uncertain course',async()=>{
  const h=harness({},{a:['unknown','success']});h.env.takeRetry=()=>true;
  assert.equal((await core.run(config(),h.adapter,h.env)).state,'success');assert.equal(h.writes.a,2);
});
test('uncertain course recognized as selected is not submitted again',async()=>{
  const h=harness({},{a:['unknown']});h.adapter.inspect=t=>({state:t===a&&h.writes.a?'selected':'available'});
  assert.equal((await core.run(config(),h.adapter,h.env)).state,'success');assert.equal(h.writes.a,1);
});
test('already selected full course completes without probing or submitting again',async()=>{
  const h=harness({a:['full']});h.adapter.inspect=t=>({state:t===a?'selected':'available'});
  const r=await core.run(config(),h.adapter,h.env);assert.equal(r.state,'success');assert.deepEqual(h.writes,{b:1});assert.equal(h.effects.filter(e=>e[1]==='a').length,0);
});
test('selected course outside the current category is recognized by the chosen list',async()=>{
  const h=harness({a:['full']});h.adapter.inspect=()=>{throw new Error('different category');};h.adapter.isSelected=t=>t===a;
  const r=await core.run(config(),h.adapter,h.env);assert.equal(r.state,'success');assert.deepEqual(h.writes,{b:1});
});
test('query error waits and recovers',async()=>{
  const h=harness();let first=true;const refresh=h.adapter.refresh;
  h.adapter.refresh=async t=>{if(t===a&&first){first=false;throw new Error('network');}return refresh(t);};
  assert.equal((await core.run(config(),h.adapter,h.env)).state,'success');assert.equal(h.writes.b,1);
});
test('cancel while waiting prevents website activity',async()=>{
  const h=harness(),c=new AbortController();h.env.signal=c.signal;h.env.sleep=async()=>c.abort();
  await assert.rejects(()=>core.run(config(),h.adapter,h.env),/停止/);assert.deepEqual(h.effects,[]);
});
test('late wakeup runs before end but never after end',async()=>{
  const h=harness();h.env.now=()=>50000;
  assert.equal((await core.run(config({endAt:60000,targets:[a]}),h.adapter,h.env)).state,'success');
  const late=harness();late.env.now=()=>60000;assert.equal((await core.run(config({endAt:60000}),late.adapter,late.env)).state,'expired');assert.deepEqual(late.effects,[]);
});
test('deadline after prepare or refresh prevents following operations',async()=>{
  for(const step of ['prepare','refresh']){const h=harness();h.adapter[step]=async()=>{await h.env.sleep(40000);return {state:'available'};};
    assert.equal((await core.run(config(),h.adapter,h.env)).state,'expired');assert.deepEqual(h.writes,{});if(step==='prepare')assert.equal(h.effects.filter(x=>x[0]==='refresh').length,0);}
});
test('duplicate courses and invalid configurations rejected before activity',async()=>{
  for(const extra of [{targets:[]},{targets:[a,a]},{targets:[a,{...b,kchId:a.kchId}]},{endAt:10000},{endAt:Infinity},{intervalMs:1},{dryRun:'false'}]){
    const h=harness();await assert.rejects(()=>core.run(config(extra),h.adapter,h.env));assert.deepEqual(h.effects,[]);}
});
test('legacy array/string overrides do not break scanning',()=>{
  const realm=vm.createContext({module:{exports:{}},URL,setTimeout,clearTimeout});
  vm.runInContext(`Array.prototype.filter=function(f){const a=[];for(let i=0;i<this.length;i++)if(f(i,this[i]))a.push(this[i]);return a};Array.prototype.some=function(f){for(let i=0;i<this.length;i++)if(f(i,this[i]))return true;return false};String.prototype.trim=function(){return this.replace(/\\s+/g,'')};`,realm);
  vm.runInContext(fs.readFileSync(script,'utf8'),realm);
  const cells={'.jxb_id':'a','.kch_id':'course-a','.jxbmc':'Class A','.jsxmzc':'Teacher A','.sksj':'Monday 1-2','.rsxx .jxbrs':'20','.rsxx .jxbrl':'30','.jxbzls':'1','.do_jxb_id':'dynamic-a'};
  const row={querySelector:s=>s==='.an button'?{disabled:false,getAttribute:()=>"chooseCourseZzxk('a')"}:cells[s]?{textContent:cells[s]}:null};
  const doc={getElementById:()=>null,querySelectorAll:s=>s==='#contentBox tr.body_tr'?[row]:[]};
  const items=realm.module.exports.scan(doc);assert.equal(items.length,1);assert.equal(items[0].className,'Class A');assert.equal(items[0].state,'available');
});
