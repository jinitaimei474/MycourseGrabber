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
   dialog.showOpenDialog=async()=>({canceled:false,filePaths:[app.getPath('userData')]});
  });
  await page.locator('[data-module="shuiyuan"]').click();await page.locator('#sy-connect').click();await page.waitForFunction(()=>document.getElementById('sy-connection').textContent.includes('@test-user'));
  assert(await page.locator('#sy-crawl').isDisabled());await page.locator('#sy-project').click();await page.waitForFunction(()=>document.getElementById('sy-project-path').textContent.includes('shuiyuan-archive'));
  await page.locator('#sy-mode').selectOption('owner');await page.locator('#sy-query').fill('alice');await page.locator('#sy-category').selectOption('1');await page.locator('#sy-tag').fill('选课');await page.locator('#sy-search').click();
  await page.locator('.sy-topic-check').waitFor();assert.equal(await page.locator('.sy-topic-check').count(),1);await page.locator('#sy-more').click();await page.waitForFunction(()=>document.querySelectorAll('.sy-topic-check').length===2);
  await page.locator('#sy-all').check();await page.locator('#sy-users').fill('bob');await page.locator('#sy-crawl').click();
  await page.waitForFunction(()=>document.getElementById('sy-summary').textContent.includes('完整结果'),{},{timeout:30000});assert.match(await page.locator('#sy-summary').innerText(),/22 条/);
  assert.equal(await page.locator('#sy-preview img').count(),0);assert.match(await page.locator('#sy-preview').innerText(),/2026-09-21/);
  await page.locator('#sy-json').click();await page.waitForFunction(()=>document.getElementById('sy-status').textContent.includes('导出已保存'));
  const exported=JSON.parse(fs.readFileSync(path.join(dataDir,'export.json'),'utf8'));assert(exported.complete);assert.equal(exported.topics.length,2);assert(exported.topics[0].posts.every(p=>p.username==='bob'));
  const archiveDir=path.join(dataDir,'shuiyuan-archive');assert(fs.existsSync(path.join(archiveDir,'topics/101/post.md')));assert(fs.existsSync(path.join(archiveDir,'topics/101/post.html')));
  assert.match(await page.locator('#sy-topics').innerText(),/已归档 22 条/);
  await page.locator('#sy-crawl').click();await page.waitForFunction(()=>document.getElementById('sy-project-count').textContent.includes('未变 22 条'));
  await page.waitForFunction(()=>document.getElementById('sy-summary').textContent.includes('完整结果')&&!document.getElementById('sy-crawl').disabled);
  await page.locator('#sy-local-query').fill('第 正文');await page.locator('#sy-local-author').fill('@bob');await page.locator('#sy-local-category').selectOption('2');await page.locator('#sy-local-tag').fill('选课');await page.locator('#sy-local-start').fill('2026-09-21');await page.locator('#sy-local-end').fill('2026-09-21');await page.locator('#sy-local-search').click();
  await page.waitForFunction(()=>document.getElementById('sy-local-summary').textContent.includes('找到 22 条'));assert.equal(await page.locator('.forum-local-result').count(),22);
  await page.screenshot({path:path.resolve('../artifacts/shuiyuan-search-ui.png'),fullPage:true});
  const readerEvent=app.waitForEvent('window');await page.locator('.forum-local-result button').first().click();const reader=await readerEvent;await reader.waitForLoadState('domcontentloaded');
  assert(reader.url().endsWith('#post-10102'));assert.equal(await reader.locator(':target').getAttribute('id'),'post-10102');assert.match(await reader.locator(':target').innerText(),/@bob/);await reader.screenshot({path:path.resolve('../artifacts/shuiyuan-search-floor.png')});await reader.close();
  await assert.rejects(()=>page.evaluate(()=>window.assistant.invoke('shuiyuanLocalOpen',{topic_id:101,post_id:999999})),/不在/);
  await page.locator('#sy-local-query').fill('不存在的词');await page.locator('#sy-local-search').click();await page.waitForFunction(()=>document.getElementById('sy-local-summary').textContent.includes('找到 0 条'));
  await page.screenshot({path:path.resolve('../artifacts/shuiyuan-desktop-ui.png'),fullPage:true});
  await page.locator('#sy-users').fill('全部');await page.locator('#sy-crawl').click();await page.waitForFunction(()=>document.getElementById('sy-status').textContent.includes('已读取 1/45'));
  await assert.rejects(()=>page.evaluate(()=>window.assistant.invoke('search',{query:'x'})),/停止/);
  await page.locator('#sy-stop').click();await page.waitForFunction(()=>document.getElementById('sy-summary').textContent.includes('已停止'));
  await page.locator('[data-module="courses"]').click();await page.locator('#connect').waitFor();assert.equal(await page.evaluate(()=>typeof window.require),'undefined');
  console.log('PASS: Electron Shuiyuan navigation, connect, owner/category/tag search, pagination, multi-select, filtered crawl, safe preview, file export, stop and module exclusion.');
 }finally{try{await (await app.firstWindow()).evaluate(()=>window.assistant.invoke('shuiyuanStop'));}catch{}await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
