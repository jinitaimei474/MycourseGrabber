'use strict';
const {_electron:electron}=require('playwright-core'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const dir=fs.mkdtempSync(path.resolve('../artifacts/credentials-ui-')),env={...process.env,SJTU_ASSISTANT_DATA_DIR:dir};delete env.ELECTRON_RUN_AS_NODE;
 const launch=()=>electron.launch(process.env.SJTU_PACKAGE_EXECUTABLE?{executablePath:path.resolve(process.env.SJTU_PACKAGE_EXECUTABLE),args:[],env}:{args:[path.resolve('.')],env});
 let app;const secret='fixture-secret-credential-2026!';
 async function open(){app=await launch();const page=await app.firstWindow();await page.locator('#remember-account').waitFor({timeout:3000});await page.waitForFunction(()=>!document.getElementById('username').disabled);return page;}
 try{
  let page=await open();await page.locator('#username').fill('fixture-user');await page.locator('#password').fill(secret);await app.close();app=null;
  page=await open();assert.equal(await page.locator('#password').inputValue(),'');assert(!fs.existsSync(path.join(dir,'credentials.json')));
  await page.locator('#username').fill('fixture-user');await page.locator('#password').fill(secret);await page.locator('#remember-account').click();await page.waitForFunction(()=>document.getElementById('credential-status').textContent.includes('已记住'));
  assert(!fs.readFileSync(path.join(dir,'credentials.json'),'utf8').includes(secret));assert(!fs.readFileSync(path.join(dir,'credentials.json'),'utf8').includes('fixture-user'));await app.close();app=null;
  page=await open();assert.equal(await page.locator('#username').inputValue(),'fixture-user');assert.equal(await page.locator('#password').inputValue(),secret);assert.equal(await page.locator('#password').getAttribute('type'),'password');
  await app.evaluate(({app})=>{const req=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');const {BrowserSession}=req('./src/services/browser.cjs'),{TennisAdapter}=req('./src/modules/tennis/adapter.cjs'),{ShuiyuanService}=req('./src/modules/shuiyuan/service.cjs');
   global.credentialChecks=[];BrowserSession.prototype.ensureCourse=async function(){global.credentialChecks.push({...this.credentials});return {owner:'fixture-user'};};BrowserSession.prototype.categories=async()=>[];
   TennisAdapter.prototype.connect=async function(value){global.credentialChecks.push({...value});return 'fixture-user'};
   ShuiyuanService.prototype.connect=async function(){global.credentialChecks.push({...this.browser.credentials});this.connected=true;this.note('fixture-connected');};
  });
  await page.locator('#connect').click();await page.waitForFunction(()=>document.getElementById('connection-text').textContent.includes('自主选课已连接'));
  await page.locator('[data-module="tennis"]').click();assert(await page.locator('#username').isVisible());await page.locator('#tn-connect').click();await page.waitForFunction(()=>document.getElementById('tn-connection').textContent.includes('fixture-user'));
  await page.locator('[data-module="shuiyuan"]').click();await page.locator('#sy-connect').click();await page.waitForFunction(()=>!document.getElementById('sy-connect').disabled);
  const seen=await app.evaluate(()=>global.credentialChecks);assert.equal(seen.length,3);assert(seen.every(x=>x.username==='fixture-user'&&x.password===secret));
  const snapshot=await page.evaluate(()=>window.assistant.invoke('snapshot'));assert(!JSON.stringify(snapshot).includes(secret));
  await app.evaluate(({app})=>{const req=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');req('./src/services/browser.cjs').BrowserSession.prototype.ensureCourse=async function(){throw Error('login failure '+this.credentials.password);};});
  const failure=await page.evaluate(async()=>{try{await window.assistant.invoke('connect',{username:'fixture-user',password:'sensitive-payload-'.repeat(40)});}catch(e){return e.message;}});
  assert(!failure.includes('sensitive-payload-'),'long credentials must be redacted before truncating errors');assert(!JSON.stringify(await page.evaluate(()=>window.assistant.invoke('snapshot'))).includes('sensitive-payload-'));
  await page.locator('#password').fill('edited-but-not-saved');await page.evaluate(()=>window.assistant.invoke('snapshot'));assert.equal(await page.locator('#password').inputValue(),'edited-but-not-saved');
  await page.locator('#forget-account').click();await page.waitForFunction(()=>document.getElementById('password').value==='');assert.equal(await page.locator('#username').inputValue(),'');assert(!fs.existsSync(path.join(dir,'credentials.json')));await app.close();app=null;
  page=await open();assert.equal(await page.locator('#username').inputValue(),'');assert.equal(await page.locator('#password').inputValue(),'');await page.screenshot({path:path.resolve('../artifacts/credentials-ui.png'),fullPage:true});
  console.log('PASS: real Windows encryption, opt-in storage, four cold starts, shared module credentials, redacted snapshots, no render overwrite, forget persists.');
 }finally{await app?.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
