// Smoke-test the actual distributable, with a separate user-data directory.
const {_electron:electron}=require('playwright-core');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  const dataDir=fs.mkdtempSync(path.resolve('../artifacts/desktop-package-'));
  const env={...process.env,SJTU_ASSISTANT_DATA_DIR:dataDir};delete env.ELECTRON_RUN_AS_NODE;
  const executablePath=path.resolve('release',require('../package.json').version,'SJTU-Assistant-win32-x64/SJTU-Assistant.exe');
  const app=await electron.launch({executablePath,args:[],env});
  try{
    const page=await app.firstWindow();await page.waitForSelector('#connect');
    assert.equal(await page.locator('#password').getAttribute('type'),'password');
    const state=await page.evaluate(()=>window.assistant.invoke('snapshot'));assert.equal(state.targets.length,0);assert.equal(state.connected,false);
    assert(state.modules.find(m=>m.id==='shuiyuan').available);assert.equal(state.shuiyuan.connected,false);
    await page.locator('[data-module="shuiyuan"]').click();await page.locator('#sy-connect').waitFor();
    const result=await app.evaluate(async({app})=>{
      const req=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');
      const fs=req('node:fs'),path=req('node:path');const {BrowserSession}=req('./src/services/browser.cjs');
      const session=new BrowserSession({profileDir:path.join(app.getPath('userData'),'smoke-edge'),tempDir:path.join(app.getPath('userData'),'temporary'),adapterPath:path.join(app.getAppPath(),'vendor/course-timer.user.js')});
      try{await session.launch(undefined,Date.now()+15000);return {packaged:app.isPackaged,edge:session.context.browser().version(),adapter:fs.existsSync(session.adapterPath),ocr:fs.readFileSync(path.join(app.getAppPath(),'scripts/ocr.ps1'),'utf8').includes('Windows.Media.Ocr')};}
      finally{await session.close();}
    });
    assert(result.packaged);assert(result.edge);assert(result.adapter);assert(result.ocr);
    assert(await app.evaluate(({app})=>{const req=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');return typeof req('./src/modules/shuiyuan/service.cjs').ShuiyuanService==='function'&&typeof req('./vendor/shuiyuan-core.js').crawl==='function';}));
    await page.screenshot({path:path.resolve('../artifacts/desktop-packaged-ui.png'),fullPage:true});
    console.log('PASS: packaged EXE opens, isolated IPC works, bundled browser service launches installed Edge, adapter and OCR script present.');
  }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
