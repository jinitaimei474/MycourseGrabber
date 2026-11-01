'use strict';
const {app,BrowserWindow,ipcMain,dialog,powerSaveBlocker,Notification,shell,safeStorage}=require('electron');
const {CredentialStore}=require('./services/credentials.cjs');
const path=require('node:path');const {pathToFileURL}=require('node:url');
const {Store}=require('./services/store.cjs');const {Scheduler}=require('./services/scheduler.cjs');const {BrowserSession}=require('./services/browser.cjs');const {safeError}=require('./services/model.cjs');const modules=require('./modules/index.cjs');
const {ShuiyuanService}=require('./modules/shuiyuan/service.cjs');const fs=require('node:fs/promises');
const {TennisStore}=require('./modules/tennis/store.cjs');const {TennisAdapter}=require('./modules/tennis/adapter.cjs');const {TennisService}=require('./modules/tennis/service.cjs');
if(process.env.SJTU_ASSISTANT_DATA_DIR)app.setPath('userData',path.resolve(process.env.SJTU_ASSISTANT_DATA_DIR));
if(!app.requestSingleInstanceLock()){app.quit();}else{
let win,store,browser,scheduler,forum,tennis,credentials,operation=null,operationModule='',connected=false,categories=[],results=[],logs=[],blocker=null;
let browserMessage='尚未连接 Edge';
function errorText(error){let message=String(error?.message||error||'操作失败');for(const value of [browser?.credentials.password,credentials?.get().password])if(value)message=message.split(value).join('[隐藏]');return safeError(message);}
function log(message){message=errorText(message);if(logs.at(-1)?.message!==message)logs.push({time:Date.now(),message});logs=logs.slice(-100);}
function snapshot(){const state=store.view();return {...state,modules,credentials:credentials.view(),busy:!!operation||!!scheduler.controller||!!tennis.controller,operationModule:operation?operationModule:scheduler.controller?'courses':tennis.controller?'tennis':'',shuiyuan:forum.view(),tennis:tennis.view(),connected,browserMessage,categories,results,logs,status:scheduler.status};}
function emit(){if(win&&!win.isDestroyed())win.webContents.send('assistant:state',snapshot());}
function idle(allowMonitor=false){if(operation||scheduler.controller||(tennis?.controller&&!(allowMonitor&&tennis.mode==='monitor')))throw Error('当前操作尚未结束，请先停止');}
function wake(){const running=!!scheduler?.controller||!!tennis?.controller;if(running&&blocker===null)blocker=powerSaveBlocker.start('prevent-app-suspension');if(!running&&blocker!==null){powerSaveBlocker.stop(blocker);blocker=null;}}
async function exclusive(fn,module='courses',allowMonitor=false){idle(allowMonitor);operation=new AbortController();operationModule=module;emit();try{await fn(operation.signal);}finally{operation=null;operationModule='';emit();}return snapshot();}
function forumTask(fn){return exclusive(async signal=>{try{await fn(signal);}catch(error){forum.note(errorText(error));throw error;}},'shuiyuan');}
async function dispatch(action,payload={}){
  switch(action){
    case 'snapshot':return snapshot();
    case 'credentialsLoad':return credentials.get();
    case 'credentialsSave':return exclusive(async()=>{await credentials.save(payload);browser.credentials=credentials.get();},'account');
    case 'credentialsForget':return exclusive(async()=>{await credentials.forget();browser.credentials={username:'',password:''};},'account');
    case 'tennisConnect':return exclusive(signal=>tennis.connect(payload,signal),'tennis');
    case 'tennisConfigure':idle();tennis.configure(payload);return snapshot();
    case 'tennisStart':idle();if(!tennis.connected)throw Error('请先连接场馆预约');tennis.run().catch(error=>{log(error);emit();});await Promise.resolve();return snapshot();
    case 'tennisMonitor':idle();tennis.monitor(payload).catch(error=>{log(error);emit();});await Promise.resolve();return snapshot();
    case 'tennisBookAvailable':return exclusive(async signal=>{
      await tennis.haltMonitor();if(signal.aborted)throw Error('已停止');
      const candidates=tennis.availableCandidates(payload.ids);
      tennis.configure({candidates,startAt:Date.now(),endAt:Date.now()+300000,intervalMs:3000});
      await tennis.run();
    },'tennis',true);
    case 'tennisStop':tennis.stop();if(operationModule==='tennis')operation?.abort();return snapshot();
    case 'tennisShow':await tennis.adapter.show();return null;
    case 'tennisCheck':return exclusive(signal=>tennis.check(signal),'tennis');
    case 'tennisResume':return exclusive(signal=>tennis.resume(payload.date,signal),'tennis');
    case 'tennisUnlock':return exclusive(signal=>tennis.unlock(payload.date,signal),'tennis');
    case 'tennisExport':return exclusive(async()=>{
      const record=tennis.store.get(tennis.owner,payload.date);if(!record?.qrFile)throw Error('尚无可保存的二维码');
      const source=tennis.adapter.qrPath(record.qrFile);const file=await dialog.showSaveDialog(win,{title:'保存微信缴费二维码',defaultPath:`网球缴费-${record.date}.png`,filters:[{name:'PNG 图片',extensions:['png']}]});
      if(!file.canceled&&file.filePath){await fs.copyFile(source,file.filePath);tennis.note('缴费二维码已保存到所选位置。');}
    },'tennis');
    case 'shuiyuanConnect':return forumTask(signal=>{browser.credentials={username:String(payload.username??browser.credentials.username??'').slice(0,200),password:String(payload.password??browser.credentials.password??'').slice(0,1000)};return forum.connect(signal);});
    case 'shuiyuanLocalSearch':return forumTask(()=>forum.searchLocal(payload));
    case 'shuiyuanLocalOpen':return forumTask(async()=>{
      const target=await forum.localPost(payload);
      const reader=new BrowserWindow({width:1050,height:820,title:'水源本地阅读',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,javascript:false}});
      const expected=pathToFileURL(target.file).href;
      reader.webContents.on('will-navigate',(event,url)=>{if(url.split('#')[0]!==expected)event.preventDefault();});
      reader.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      try{await reader.loadFile(target.file,{hash:target.hash});}catch(error){reader.close();throw error;}
    });
    case 'shuiyuanProject':return forumTask(async()=>{
      const chosen=await dialog.showOpenDialog(win,{title:'选择水源资料项目文件夹',properties:['openDirectory','createDirectory']});
      if(!chosen.canceled&&chosen.filePaths[0])await forum.chooseProject(chosen.filePaths[0]);
    });
    case 'shuiyuanOpenProject':return forumTask(async()=>{const error=await shell.openPath(await forum.projectIndex());if(error)throw Error(error);});
    case 'shuiyuanSearch':return forumTask(signal=>forum.search(payload,signal));
    case 'shuiyuanCrawl':return forumTask(signal=>forum.crawl(payload,signal));
    case 'shuiyuanStop':if(operationModule==='shuiyuan')operation?.abort();return snapshot();
    case 'shuiyuanShow':await forum.show();return null;
    case 'shuiyuanExport':return forumTask(async()=>{
      const format=payload.format,text=forum.export(format);
      const file=await dialog.showSaveDialog(win,{title:'保存水源采集内容',defaultPath:`水源-${forum.result.complete?'完整':'未完成'}-${new Date().toISOString().slice(0,10)}.${format}`,filters:[{name:format.toUpperCase(),extensions:[format]}]});
      if(!file.canceled&&file.filePath){await fs.writeFile(file.filePath,text,'utf8');forum.note('导出已保存。');}
    });
    case 'connect':return exclusive(async signal=>{
      browser.credentials={username:String(payload.username||'').slice(0,200),password:String(payload.password||'').slice(0,1000)};
      connected=false;const info=await browser.ensureCourse(signal,Date.now()+120000);const previous=store.view().owner;
      store.setOwner(info.owner);if(previous&&previous!==info.owner){results=[];log('当前登录账户已改变，已清空旧账户的任务列表');}
      browser.expectedOwner=info.owner;categories=await browser.categories();connected=true;browserMessage='已连接自主选课';log(browserMessage);return snapshot();
    });
    case 'search':return exclusive(async signal=>{
      if(!connected)throw Error('请先连接选课页面');
      const terms=String(payload.query||'').split(/[\n,，;；]+/).map(x=>x.trim()).filter(Boolean);
      const teachers=String(payload.teachers||'').split(/[\n,，;；]+/).map(x=>x.trim()).filter(Boolean);const keywords=terms.length?terms:teachers;
      if(!keywords.length||keywords.length>20)throw Error('请输入 1–20 个课程或教师关键词');
      const info=await browser.ensureCourse(signal,Date.now()+120000);if(info.owner!==store.view().owner){connected=false;throw Error('登录账户已改变，请重新连接');}
      if(payload.category){if(!categories.some(x=>x.id===payload.category))throw Error('请选择有效的课程类别');await browser.category(payload.category,signal);}
      const found=new Map();results=[];emit();
      for(const word of keywords){log(`正在查询：${word}`);emit();const items=await browser.search(word,signal,Date.now()+120000);for(const item of items)if(!teachers.length||teachers.some(name=>item.teacher.includes(name)))found.set(`${item.context}|${item.jxbId}`,item);results=[...found.values()];emit();}
      categories=await browser.categories();log(`查询完成，找到 ${results.length} 个教学班`);return snapshot();
    });
    case 'add':{idle();const target=results.find(x=>x.jxbId===payload.jxbId&&x.context===payload.context);if(!target)throw Error('结果已变化，请重新查询');store.add(target);emit();return snapshot();}
    case 'remove':idle();store.remove(payload.kchId,payload.jxbId);emit();return snapshot();
    case 'configure':idle();store.configure(payload);emit();return snapshot();
    case 'start':{
      idle();if(!connected)throw Error('请先连接选课页面');
      const promise=scheduler.start();promise.catch(error=>{log(error);emit();});await Promise.resolve();return snapshot();
    }
    case 'stop':operation?.abort();tennis.stop();if(operationModule==='shuiyuan'){log('已请求停止水源操作');}else{scheduler.stop();await browser.cancel();log('已请求停止；已经提交的操作请核对网站结果');}emit();return snapshot();
    case 'retry':idle();store.retry(payload.kchId);emit();return snapshot();
    case 'showBrowser':await browser.show();return null;
    default:throw Error('不支持的操作');
  }
}
app.whenReady().then(async()=>{
  credentials=new CredentialStore({file:path.join(app.getPath('userData'),'credentials.json'),secure:safeStorage});await credentials.load();
  store=new Store(path.join(app.getPath('userData'),'tasks.json'));
  browser=new BrowserSession({profileDir:path.join(app.getPath('userData'),'edge-profile'),tempDir:path.join(app.getPath('userData'),'temporary'),adapterPath:path.join(__dirname,'../vendor/course-timer.user.js')});
  browser.credentials=credentials.get();
  scheduler=new Scheduler({store,browser});
  forum=new ShuiyuanService({browser});forum.on('update',emit);
  tennis=new TennisService({store:new TennisStore(path.join(app.getPath('userData'),'tennis.json')),adapter:new TennisAdapter({browser,qrDir:path.join(app.getPath('userData'),'tennis-qr')})});
  tennis.on('update',()=>{wake();emit();});
  tennis.on('payment',info=>{shell.beep();if(win&&!win.isDestroyed()){win.flashFrame(true);if(win.isMinimized())win.restore();win.show();}if(Notification.isSupported()){const notice=new Notification({title:info.paid?'网球预约成功':'网球订单待付款',body:info.paid?`${info.date} 的订单已确认。`:`${info.date} 的微信缴费二维码已保存，请打开交大助手扫码付款。`});notice.on('click',()=>{win?.show();win?.focus();});notice.show();}});
  browser.on('status',message=>{browserMessage=message;if(message.includes('Edge 已关闭')){connected=false;forum.connected=false;forum.message='Edge 已关闭，请重新连接水源';tennis.connected=false;tennis.stop();}log(message);emit();});
  scheduler.on('update',status=>{log(status.message);wake();emit();});
  win=new BrowserWindow({width:1320,height:930,minWidth:1060,minHeight:760,backgroundColor:'#f5f7f4',title:'交大助手',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  const url=pathToFileURL(path.join(__dirname,'ui/index.html')).href;
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(event,next)=>{if(next!==url)event.preventDefault();});
  ipcMain.handle('assistant:command',async(event,action,payload)=>{
    if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame.url!==url)return {ok:false,error:'不允许的来源'};
    try{return {ok:true,data:await dispatch(action,payload)}}catch(error){const message=errorText(error);log(message);emit();return {ok:false,error:message};}
  });
  win.loadURL(url);if(store.warning)log(store.warning);
  win.on('close',event=>{if(operation||scheduler.controller||tennis.controller){const choice=dialog.showMessageBoxSync(win,{type:'question',buttons:['继续运行','停止并退出'],defaultId:0,cancelId:0,message:'任务仍在进行，是否停止并退出？',detail:'已提交的请求可能继续完成，重新启动后请核对网站结果和预约订单。'});if(choice===0){event.preventDefault();return;}operation?.abort();scheduler.stop();tennis.stop();}});
});
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
let quitting=false;
app.on('before-quit',event=>{if(quitting)return;event.preventDefault();quitting=true;operation?.abort();scheduler?.stop();tennis?.stop();if(blocker!==null)powerSaveBlocker.stop(blocker);Promise.race([browser?.close(),new Promise(resolve=>setTimeout(resolve,2500))]).finally(()=>app.quit());});
app.on('window-all-closed',()=>app.quit());
}
