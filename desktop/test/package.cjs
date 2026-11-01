// Smoke-test the actual distributable, with a separate user-data directory.
const {_electron:electron}=require('playwright-core');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  const dataDir=fs.mkdtempSync(path.resolve('../artifacts/desktop-package-'));
  const env={...process.env,SJTU_ASSISTANT_DATA_DIR:dataDir};delete env.ELECTRON_RUN_AS_NODE;
  const executablePath=process.env.SJTU_PACKAGE_EXECUTABLE?path.resolve(process.env.SJTU_PACKAGE_EXECUTABLE):path.resolve('release',require('../package.json').version,'SJTU-Assistant-win32-x64/SJTU-Assistant.exe');
  const app=await electron.launch({executablePath,args:[],env});
  try{
    const page=await app.firstWindow();await page.waitForSelector('#connect');
    assert.equal(await page.locator('#password').getAttribute('type'),'password');
    const state=await page.evaluate(()=>window.assistant.invoke('snapshot'));assert.equal(state.targets.length,0);assert.equal(state.connected,false);
    assert(state.modules.find(m=>m.id==='shuiyuan').available);assert.equal(state.shuiyuan.connected,false);
    assert(state.modules.find(m=>m.id==='tennis').available);assert.equal(state.tennis.connected,false);
    await page.locator('[data-module="tennis"]').click();await page.locator('#tn-connect').waitFor();assert.equal(await page.locator('#password').getAttribute('type'),'password');
    await page.locator('#tn-live-start').waitFor();assert.equal(await page.locator('#tn-live-after').inputValue(),'18:00');assert.equal(state.tennis.availability.slots.length,0);
    await page.locator('[data-module="shuiyuan"]').click();await page.locator('#sy-connect').waitFor();
    await page.locator('#sy-project').waitFor();assert.equal(state.shuiyuan.project,null);assert(await page.locator('#sy-crawl').isDisabled());
    await page.locator('#sy-local-search').waitFor();assert(await page.locator('#sy-local-search').isDisabled());
    const result=await app.evaluate(async({app})=>{
      const req=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');
      const fs=req('node:fs'),path=req('node:path');const {BrowserSession}=req('./src/services/browser.cjs');
      const session=new BrowserSession({profileDir:path.join(app.getPath('userData'),'smoke-edge'),tempDir:path.join(app.getPath('userData'),'temporary'),adapterPath:path.join(app.getAppPath(),'vendor/course-timer.user.js')});
      try{await session.launch(undefined,Date.now()+15000);return {packaged:app.isPackaged,edge:session.context.browser().version(),adapter:fs.existsSync(session.adapterPath),ocr:fs.readFileSync(path.join(app.getAppPath(),'scripts/ocr.ps1'),'utf8').includes('Windows.Media.Ocr')};}
      finally{await session.close();}
    });
    assert(result.packaged);assert(result.edge);assert(result.adapter);assert(result.ocr);
    assert(await app.evaluate(async({app})=>{const req=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');const archive=await req('./src/modules/shuiyuan/archive.cjs').Archive.open(app.getPath('userData'));await archive.save({topic_id:1,title:'打包测试',complete:true,posts:[{post_id:1,post_number:1,username:'fixture',created_at:'2026-10-01T00:00:00Z',cooked:'<p><strong>测试正文</strong></p>'}]});return req('node:fs').readFileSync(req('node:path').join(archive.root,'topics/1/post.md'),'utf8').includes('**测试正文**')&&req('node:fs').existsSync(await archive.indexPath())&&typeof req('./src/modules/shuiyuan/service.cjs').ShuiyuanService==='function'&&typeof req('./vendor/shuiyuan-core.js').crawl==='function';}));
    await app.evaluate(({dialog,app})=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[app.getPath('userData')]});});
    await page.locator('#sy-project').click();await page.waitForFunction(()=>!document.getElementById('sy-local-search').disabled);await page.locator('#sy-local-query').fill('测试正文');await page.locator('#sy-local-search').click();await page.waitForFunction(()=>document.getElementById('sy-local-summary').textContent.includes('找到 1 条'));
    const readerEvent=app.waitForEvent('window');await page.locator('.forum-local-result button').click();const reader=await readerEvent;await reader.waitForLoadState('domcontentloaded');assert(reader.url().endsWith('#post-1'));assert.equal(await reader.locator(':target').getAttribute('id'),'post-1');await reader.close();
    await page.screenshot({path:path.resolve('../artifacts/desktop-packaged-ui.png'),fullPage:true});
    console.log('PASS: packaged EXE opens, isolated IPC works, bundled browser service launches installed Edge, archive Markdown, offline search and floor jump work, adapter and OCR script present.');
  }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
