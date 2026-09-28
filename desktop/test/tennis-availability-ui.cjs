'use strict';
const {_electron:electron}=require('playwright-core'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const dataDir=fs.mkdtempSync(path.resolve('../artifacts/tennis-live-ui-'));const env={...process.env,SJTU_ASSISTANT_DATA_DIR:dataDir};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[path.resolve('.')],env});
 try{
  const page=await app.firstWindow();await page.waitForSelector('#connect');
  await app.evaluate(async({app,shell,Notification})=>{
   const req=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');const {chromium}=req('playwright-core'),{installRoutes}=req('./test/tennis-fixture.cjs'),{BrowserSession}=req('./src/services/browser.cjs');
   BrowserSession.prototype.launch=async function(){if(this.context)return;this.testEdge=await chromium.launch({channel:'msedge',headless:true});this.context=await this.testEdge.newContext();globalThis.tennisFixture=await installRoutes(this.context,{notice:true});this.page=await this.context.newPage();};
   BrowserSession.prototype.close=async function(){await this.testEdge?.close();};shell.beep=()=>{};Notification.prototype.show=()=>{};
  });
  await page.locator('[data-module="tennis"]').click();await page.locator('#tn-connect').click();await page.waitForFunction(()=>document.getElementById('tn-connection').textContent.includes('alice'));
  await page.locator('#tn-live-date').fill('2026-10-02');await page.locator('#tn-live-venue').selectOption('胡晓明网球场');await page.locator('#tn-live-interval').fill('3');await page.locator('#tn-live-start').click();
  await page.waitForFunction(()=>document.querySelectorAll('.tennis-slot').length===2);
  assert.match(await page.locator('#tn-live-slots').innerText(),/18:00-19:00[\s\S]*20:00-21:00/);
  assert.equal(await app.evaluate(()=>globalThis.tennisFixture.submissions),0);
  assert(await page.locator('#tn-live-date').isDisabled());assert(await page.locator('#tn-connect').isDisabled());
  await page.locator('.tennis-slot input').nth(1).check();
  await app.evaluate(()=>{globalThis.tennisFixture.extraSlot=false;});
  await page.waitForFunction(()=>document.querySelectorAll('.tennis-slot').length===1);
  assert.match(await page.locator('#tn-live-book').innerText(),/（0）/);
  await app.evaluate(()=>{globalThis.tennisFixture.extraSlot=true;});
  await page.waitForFunction(()=>document.querySelectorAll('.tennis-slot').length===2);
  await page.locator('.tennis-slot input').nth(0).check();await page.locator('.tennis-slot input').nth(1).check();
  assert.match(await page.locator('#tn-live-book').innerText(),/（2）/);
  await page.screenshot({path:path.resolve('../artifacts/tennis-live-ui.png'),fullPage:true});
  // The backend rejects other operations while monitoring; the handoff is exclusive.
  const denied=await page.evaluate(()=>window.assistant.invoke('tennisConfigure',{}).then(()=>false,()=>true));assert(denied);
  await page.locator('#tn-live-book').click();
  await page.waitForFunction(()=>document.getElementById('tn-status').textContent.includes('二维码已保存'),{},{timeout:30000});
  const state=await page.evaluate(()=>window.assistant.invoke('snapshot'));
  assert.equal(state.tennis.mode,'');assert.equal(state.busy,false);assert.equal(state.tennis.config.candidates.length,2);
  const fixture=await app.evaluate(()=>globalThis.tennisFixture);assert.equal(fixture.submissions,1);assert.equal(fixture.selected,'2/18:00-19:00');assert(fixture.noticeClosed>=2);assert(fixture.confirmed);
  await page.locator('#tn-live-start').click();await page.waitForFunction(()=>document.querySelectorAll('.tennis-slot').length===2);
  await page.locator('.tennis-slot button').first().click();await page.waitForFunction(()=>document.getElementById('tn-status').textContent.includes('已有订单'));
  assert.equal(await app.evaluate(()=>globalThis.tennisFixture.submissions),1);
  console.log('PASS: live list updates/removes selections, monitoring submits no orders, multiple picks hand off exclusively to one booking/QR, false popup closes and duplicate booking stays blocked.');
 }finally{try{await (await app.firstWindow()).evaluate(()=>window.assistant.invoke('tennisStop'));}catch{}await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
