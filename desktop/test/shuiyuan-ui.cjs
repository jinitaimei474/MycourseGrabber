const {_electron:electron}=require('playwright-core'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const dataDir=fs.mkdtempSync(path.resolve('../artifacts/shuiyuan-ui-'));const env={...process.env,SJTU_ASSISTANT_DATA_DIR:dataDir};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[path.resolve('.')],env});
 try{
  const page=await app.firstWindow();await page.waitForSelector('#connect');
  await app.evaluate(async({app,dialog})=>{
   const req=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');const {chromium}=req('playwright-core'),{installRoutes}=req('./test/shuiyuan-fixture.cjs');const {BrowserSession}=req('./src/services/browser.cjs');
   BrowserSession.prototype.launch=async function(){if(this.context)return;this.testEdge=await chromium.launch({channel:'msedge',headless:true});this.context=await this.testEdge.newContext();await installRoutes(this.context);this.page=await this.context.newPage();};
   BrowserSession.prototype.close=async function(){await this.testEdge?.close();};
   dialog.showSaveDialog=async()=>({canceled:false,filePath:req('node:path').join(app.getPath('userData'),'export.json')});
  });
  await page.locator('[data-module="shuiyuan"]').click();await page.locator('#sy-connect').click();await page.waitForFunction(()=>document.getElementById('sy-connection').textContent.includes('@test-user'));
  await page.locator('#sy-mode').selectOption('owner');await page.locator('#sy-query').fill('alice');await page.locator('#sy-category').selectOption('1');await page.locator('#sy-tag').fill('选课');await page.locator('#sy-search').click();
  await page.locator('.sy-topic-check').waitFor();assert.equal(await page.locator('.sy-topic-check').count(),1);await page.locator('#sy-more').click();await page.waitForFunction(()=>document.querySelectorAll('.sy-topic-check').length===2);
  await page.locator('#sy-all').check();await page.locator('#sy-users').fill('bob');await page.locator('#sy-crawl').click();
  await page.waitForFunction(()=>document.getElementById('sy-summary').textContent.includes('完整结果'),{},{timeout:30000});assert.match(await page.locator('#sy-summary').innerText(),/22 条/);
  assert.equal(await page.locator('#sy-preview img').count(),0);assert.match(await page.locator('#sy-preview').innerText(),/2026-09-21/);
  await page.locator('#sy-json').click();await page.waitForFunction(()=>document.getElementById('sy-status').textContent.includes('导出已保存'));
  const exported=JSON.parse(fs.readFileSync(path.join(dataDir,'export.json'),'utf8'));assert(exported.complete);assert.equal(exported.topics.length,2);assert(exported.topics[0].posts.every(p=>p.username==='bob'));
  await page.screenshot({path:path.resolve('../artifacts/shuiyuan-desktop-ui.png'),fullPage:true});
  await page.locator('#sy-users').fill('全部');await page.locator('#sy-crawl').click();await page.waitForFunction(()=>document.getElementById('sy-status').textContent.includes('已读取 1/45'));
  await assert.rejects(()=>page.evaluate(()=>window.assistant.invoke('search',{query:'x'})),/停止/);
  await page.locator('#sy-stop').click();await page.waitForFunction(()=>document.getElementById('sy-summary').textContent.includes('已停止'));
  await page.locator('[data-module="courses"]').click();await page.locator('#connect').waitFor();assert.equal(await page.evaluate(()=>typeof window.require),'undefined');
  console.log('PASS: Electron Shuiyuan navigation, connect, owner/category/tag search, pagination, multi-select, filtered crawl, safe preview, file export, stop and module exclusion.');
 }finally{try{await (await app.firstWindow()).evaluate(()=>window.assistant.invoke('shuiyuanStop'));}catch{}await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
