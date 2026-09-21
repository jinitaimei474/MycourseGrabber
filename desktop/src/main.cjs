'use strict';
const {app,BrowserWindow,ipcMain,dialog,powerSaveBlocker}=require('electron');
const path=require('node:path');const {pathToFileURL}=require('node:url');
const {Store}=require('./services/store.cjs');const {Scheduler}=require('./services/scheduler.cjs');const {BrowserSession}=require('./services/browser.cjs');const {safeError}=require('./services/model.cjs');const modules=require('./modules/index.cjs');
if(process.env.SJTU_ASSISTANT_DATA_DIR)app.setPath('userData',path.resolve(process.env.SJTU_ASSISTANT_DATA_DIR));
if(!app.requestSingleInstanceLock()){app.quit();}else{
let win,store,browser,scheduler,operation=null,connected=false,categories=[],results=[],logs=[],blocker=null;
let browserMessage='尚未连接 Edge';
function errorText(error){let message=safeError(error);for(const value of [browser?.credentials.password])if(value)message=message.split(value).join('[隐藏]');return message;}
function log(message){message=errorText(message);if(logs.at(-1)?.message!==message)logs.push({time:Date.now(),message});logs=logs.slice(-100);}
function snapshot(){const state=store.view();return {...state,modules,busy:!!operation||!!scheduler.controller,connected,browserMessage,categories,results,logs,status:scheduler.status};}
function emit(){if(win&&!win.isDestroyed())win.webContents.send('assistant:state',snapshot());}
function idle(){if(operation||scheduler.controller)throw Error('当前操作尚未结束，请先停止');}
async function exclusive(fn){idle();operation=new AbortController();emit();try{await fn(operation.signal);}finally{operation=null;emit();}return snapshot();}
async function dispatch(action,payload={}){
  switch(action){
    case 'snapshot':return snapshot();
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
    case 'stop':operation?.abort();scheduler.stop();await browser.cancel();log('已请求停止；已经提交的操作请核对网站结果');emit();return snapshot();
    case 'retry':idle();store.retry(payload.kchId);emit();return snapshot();
    case 'showBrowser':await browser.show();return null;
    default:throw Error('不支持的操作');
  }
}
app.whenReady().then(()=>{
  store=new Store(path.join(app.getPath('userData'),'tasks.json'));
  browser=new BrowserSession({profileDir:path.join(app.getPath('userData'),'edge-profile'),tempDir:path.join(app.getPath('userData'),'temporary'),adapterPath:path.join(__dirname,'../vendor/course-timer.user.js')});
  scheduler=new Scheduler({store,browser});
  browser.on('status',message=>{browserMessage=message;if(message.includes('Edge 已关闭'))connected=false;log(message);emit();});
  scheduler.on('update',status=>{log(status.message);if(scheduler.controller&&blocker===null)blocker=powerSaveBlocker.start('prevent-app-suspension');if(!scheduler.controller&&blocker!==null){powerSaveBlocker.stop(blocker);blocker=null;}emit();});
  win=new BrowserWindow({width:1320,height:930,minWidth:1060,minHeight:760,backgroundColor:'#f5f7f4',title:'交大助手',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  const url=pathToFileURL(path.join(__dirname,'ui/index.html')).href;
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(event,next)=>{if(next!==url)event.preventDefault();});
  ipcMain.handle('assistant:command',async(event,action,payload)=>{
    if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame.url!==url)return {ok:false,error:'不允许的来源'};
    try{return {ok:true,data:await dispatch(action,payload)}}catch(error){const message=errorText(error);log(message);emit();return {ok:false,error:message};}
  });
  win.loadURL(url);if(store.warning)log(store.warning);
  win.on('close',event=>{if(operation||scheduler.controller){const choice=dialog.showMessageBoxSync(win,{type:'question',buttons:['继续运行','停止并退出'],defaultId:0,cancelId:0,message:'任务仍在进行，是否停止并退出？',detail:'已提交的选课请求可能继续完成，重新启动后请核对已选列表。'});if(choice===0){event.preventDefault();return;}operation?.abort();scheduler.stop();}});
});
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
let quitting=false;
app.on('before-quit',event=>{if(quitting)return;event.preventDefault();quitting=true;operation?.abort();scheduler?.stop();if(blocker!==null)powerSaveBlocker.stop(blocker);Promise.race([browser?.close(),new Promise(resolve=>setTimeout(resolve,2500))]).finally(()=>app.quit());});
app.on('window-all-closed',()=>app.quit());
}
