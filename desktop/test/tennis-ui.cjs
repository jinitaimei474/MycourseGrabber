'use strict';
const {fixtureDate}=require('./tennis-fixture.cjs');
const {_electron:electron}=require('playwright-core'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const dataDir=fs.mkdtempSync(path.resolve('../artifacts/tennis-ui-'));const env={...process.env,SJTU_ASSISTANT_DATA_DIR:dataDir};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[path.resolve('.')],env});
 try{
  const page=await app.firstWindow();await page.waitForSelector('#connect');
  await app.evaluate(async({app,dialog,shell,Notification})=>{
   const req=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');const {chromium}=req('playwright-core'),{installRoutes}=req('./test/tennis-fixture.cjs'),{BrowserSession}=req('./src/services/browser.cjs');
   BrowserSession.prototype.launch=async function(){if(this.context)return;this.testEdge=await chromium.launch({channel:'msedge',headless:true});this.context=await this.testEdge.newContext();await installRoutes(this.context);this.page=await this.context.newPage();};
   BrowserSession.prototype.close=async function(){await this.testEdge?.close();};shell.beep=()=>{};Notification.prototype.show=()=>{};
   dialog.showSaveDialog=async()=>({canceled:false,filePath:req('node:path').join(app.getPath('userData'),'qr-export.png')});
  });
  await page.locator('[data-module="tennis"]').click();assert.equal(await page.locator('#password').getAttribute('type'),'password');
  await page.locator('#tn-venue').selectOption('胡晓明网球场');await page.locator('#tn-date').fill(fixtureDate);await page.locator('#tn-time').selectOption('18:00-19:00');await page.locator('#tn-court').fill('2');await page.locator('#tn-add').click();await page.locator('#tn-release').click();
  assert.equal(await page.locator('#tn-start').inputValue(),new Date(Date.parse(fixtureDate+'T00:00:00Z')-7*86400000).toISOString().slice(0,10)+'T12:00');
  await page.locator('#username').fill('alice');await page.locator('#password').fill('not-saved');await page.locator('#tn-connect').click();await page.waitForFunction(()=>document.getElementById('tn-connection').textContent.includes('alice'));
  await page.locator('#tn-now').click();await page.locator('#tn-start-run').click();
  await page.waitForFunction(()=>document.getElementById('tn-status').textContent.includes('二维码已保存'),{},{timeout:30000});await page.locator('#tn-qr').waitFor();
  assert.match(await page.locator('#tn-records').innerText(),/待付款/);assert.match(await page.locator('#tn-countdown').innerText(),/分/);
  assert(!fs.readFileSync(path.join(dataDir,'tennis.json'),'utf8').includes('not-saved'));assert.equal(fs.readdirSync(path.join(dataDir,'tennis-qr')).length,1);
  await page.getByRole('button',{name:'保存二维码',exact:true}).click();await page.waitForFunction(()=>document.getElementById('tn-status').textContent.includes('所选位置'));assert(fs.existsSync(path.join(dataDir,'qr-export.png')));
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.resolve('../artifacts/tennis-desktop-ui.png'),fullPage:true});
  await page.locator('#tn-start-run').click();await page.waitForFunction(()=>document.getElementById('tn-status').textContent.includes('已有订单'));assert.equal(fs.readdirSync(path.join(dataDir,'tennis-qr')).length,1);
  await page.locator('[data-module="courses"]').click();await page.locator('#connect').waitFor();await page.locator('[data-module="shuiyuan"]').click();await page.locator('#sy-connect').waitFor();
  console.log('PASS: real Electron tennis candidate settings, noon schedule, booking/payment QR, PNG export, persisted secret exclusion, duplicate prevention and navigation.');
 }finally{try{await (await app.firstWindow()).evaluate(()=>window.assistant.invoke('tennisStop'));}catch{}await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
