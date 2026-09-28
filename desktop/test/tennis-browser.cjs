'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');const {chromium}=require('playwright-core');
(async()=>{
 assert(fs.existsSync(path.resolve(__dirname,'../src/modules/tennis/adapter.cjs')),'tennis browser adapter missing');
 const {TennisAdapter}=require('../src/modules/tennis/adapter.cjs'),{installRoutes}=require('./tennis-fixture.cjs');
 const edge=await chromium.launch({channel:'msedge',headless:true});const context=await edge.newContext();const state=await installRoutes(context);const browser={context,launch:async()=>{},credentials:{}};
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tennis-browser-'));const a=new TennisAdapter({browser,qrDir:dir});
 try{
  assert.equal(await a.connect({username:'test',password:'local-only'}),'alice');assert.equal(state.portalSearch,'场馆预约');assert.equal((await a.orders()).length,0);
  const c={venue:'胡晓明网球场',date:'2026-10-02',time:'18:00-19:00',court:'2'};
  assert.equal(await a.prepare({...c,time:'19:00-20:00'}),false);
  assert.equal(await a.prepare(c),true);const order=await a.submit(c);assert.equal(order.orderId,'o1');assert.equal(state.submissions,1);assert.equal(state.selected,'2/18:00-19:00');assert.equal(state.terms,true);
  const stale=await context.newPage();await stale.goto('https://cwc2.jdcw.sjtu.edu.cn/qr?method=unrelated');state.paymentMethod='';state.confirmed=false;
  const payment=await a.payment({...order,candidate:c,date:c.date});assert(fs.existsSync(path.join(dir,payment.qrFile)));assert(payment.qrData.startsWith('data:image/png;base64,'));assert(payment.expiresAt>Date.now());assert.equal(state.paymentMethod,'wechat');assert.equal(state.confirmed,true);assert.notEqual(a.page,stale,'must not capture QR from an unrelated payment tab');
  await a.checkOwner('alice');state.owner='bob';await assert.rejects(()=>a.checkOwner('alice'),/账号/);
  const ssoContext=await edge.newContext();const ssoState=await installRoutes(ssoContext,{loginRequired:true});const sso=new TennisAdapter({browser:{context:ssoContext,launch:async()=>{},credentials:{}},qrDir:dir});
  const click=sso.clickText.bind(sso);sso.clickText=async(page,name,signal)=>{const clicked=await click(page,name,signal);if(clicked&&name==='校内人员登录')await page.getByText('体育场馆预约',{exact:true}).waitFor();return clicked;};
  assert.equal(await sso.connect({}),'alice');assert.equal(ssoState.loggedIn,true);await ssoContext.close();
  const freeContext=await edge.newContext();await installRoutes(freeContext,{free:true});const free=new TennisAdapter({browser:{context:freeContext,launch:async()=>{},credentials:{}},qrDir:dir});await free.connect({});await free.prepare(c);const freeOrder=await free.submit(c);const completed=await free.payment({...freeOrder,date:c.date,candidate:c});assert.equal(completed.paid,true);await freeContext.close();
  console.log('PASS: portal search, live page bridge, slot selection, consent submission, school payment, WeChat confirmation, saved QR, account change, immediate SSO redirect.');
 }finally{await edge.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
