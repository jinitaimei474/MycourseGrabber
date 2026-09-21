'use strict';
const fs=require('node:fs'),path=require('node:path');
const {EventEmitter}=require('node:events');const {chromium}=require('playwright-core');
const {recognize}=require('./ocr.cjs');const {guard,wait}=require('./model.cjs');
const ENTRY='https://i.sjtu.edu.cn/xtgl/login_slogin.html';
const courseUrl=url=>{try{const u=new URL(url);return u.hostname==='i.sjtu.edu.cn'&&u.pathname==='/xsxk/zzxkyzb_cxZzxkYzbIndex.html';}catch{return false;}};
function attention(message){const error=Error(message);error.attention=true;return error;}
async function fillCredentials(page,credentials,signal,deadline=Infinity){
  guard(signal,deadline);if(new URL(page.url()).hostname!=='jaccount.sjtu.edu.cn')throw Error('当前不是 jAccount 登录页面');
  for(const [selector,value,label] of [['#input-login-user',credentials.username,'用户名'],['#input-login-pass',credentials.password,'密码']]){
    guard(signal,deadline);const input=page.locator(selector);if(!await input.inputValue()){
      if(!value)throw attention(`网页未自动填入${label}，请在软件或 Edge 中补全后重新连接`);
      guard(signal,deadline);await input.fill(value,{timeout:Math.max(1,Math.min(5000,deadline-Date.now()))});
    }
  }
}
class BrowserSession extends EventEmitter{
  constructor({profileDir,tempDir,adapterPath,ocr=recognize}){super();Object.assign(this,{profileDir,tempDir,adapterPath,ocr});this.context=null;this.page=null;this.expectedOwner='';this.credentials={username:'',password:''};}
  note(message){this.emit('status',message);}
  timeout(deadline=Infinity){return Math.max(1,Math.min(15000,deadline-Date.now()));}
  async launch(signal,deadline){guard(signal,deadline);if(this.context)return;
    this.note('正在打开专用 Edge 窗口');
    this.context=await chromium.launchPersistentContext(this.profileDir,{channel:'msedge',headless:false,viewport:null,args:['--start-maximized'],timeout:this.timeout(deadline)});
    this.context.setDefaultTimeout(8000);this.context.on('close',()=>{this.context=null;this.page=null;this.note('Edge 已关闭，任务配置仍保留');});
    this.page=this.context.pages()[0]||await this.context.newPage();guard(signal,deadline);
  }
  async readCaptcha(page,signal,deadline){
    const img=page.locator('#captcha-img');await img.scrollIntoViewIfNeeded();const box=await img.boundingBox();if(!box)throw attention('验证码未显示，请在 Edge 中处理登录');
    fs.mkdirSync(this.tempDir,{recursive:true});const imagePath=path.join(this.tempDir,`captcha-${Date.now()}.png`);
    try{guard(signal,deadline);const offset=await page.evaluate(()=>({x:scrollX,y:scrollY}));const cdp=await page.context().newCDPSession(page);
      try{const image=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:box.x+offset.x,y:box.y+offset.y,width:box.width,height:box.height,scale:3}});fs.writeFileSync(imagePath,Buffer.from(image.data,'base64'));}finally{await cdp.detach();}
      return await this.ocr(imagePath,{signal,deadline});}
    finally{try{fs.unlinkSync(imagePath);}catch{}}
  }
  async login(page,signal,deadline){
    for(let attempt=0;attempt<3;attempt++){
      guard(signal,deadline);if(new URL(page.url()).hostname!=='jaccount.sjtu.edu.cn')return;
      await fillCredentials(page,this.credentials,signal,deadline);
      const input=page.locator('#input-login-captcha');
      if(!await input.inputValue()){
        this.note(`正在本地识别验证码（${attempt+1}/3）`);let code;
        try{code=await this.readCaptcha(page,signal,deadline);}catch(error){if(signal?.aborted)throw error;if(error.retryable&&attempt<2){guard(signal,deadline);await page.locator('#captcha-img').click();await wait(500,signal);continue;}throw attention(error.message);}
        guard(signal,deadline);await input.fill(code,{timeout:this.timeout(deadline)});
      }
      guard(signal,deadline);this.note('正在提交 jAccount 登录');await page.locator('#submit-password-button').click({timeout:this.timeout(deadline)});
      const until=Math.min(Date.now()+15000,deadline);let captchaWrong=false;
      while(Date.now()<until){
        guard(signal,deadline);if(new URL(page.url()).hostname!=='jaccount.sjtu.edu.cn'){await page.waitForLoadState('domcontentloaded',{timeout:this.timeout(deadline)});return;}
        const failure=await page.evaluate(()=>{const text=document.body.innerText;if(/(密码|用户名).{0,10}(错误|不正确|不存在)|账号.{0,10}(锁定|禁用)/.test(text))return 'credentials';if(/验证码.{0,12}(错误|不正确|失效|过期)/.test(text))return 'captcha';return '';}).catch(()=>'');
        if(failure==='credentials')throw attention('账号或密码未被接受，请在 Edge 中核对后重新连接');
        if(failure==='captcha'){captchaWrong=true;break;}await wait(200,signal);
      }
      if(!captchaWrong)throw attention('登录尚未完成，请在 Edge 中处理额外验证后重新连接');
      guard(signal,deadline);await input.fill('');await page.locator('#captcha-img').click();await wait(500,signal);
    }
    throw attention('验证码连续识别失败，请在 Edge 中手动登录后重新连接');
  }
  async ensureCourse(signal,deadline=Infinity){
    await this.launch(signal,deadline);guard(signal,deadline);
    const pages=this.context.pages();if(!this.page||this.page.isClosed())this.page=pages.find(p=>courseUrl(p.url()))||pages[0]||await this.context.newPage();
    if(courseUrl(this.page.url())){
      const ready=await this.page.locator('#xkxnm').count().catch(()=>0);
      const expired=ready&&await this.page.evaluate(()=>/登录凭证过期|请重新登[录陆]|登录超时/.test(document.body.innerText));
      if(ready&&!expired){await this.installBridge();return this.info();}
      if(expired){this.note('检测到登录失效，正在刷新页面');await this.page.reload({waitUntil:'domcontentloaded',timeout:this.timeout(deadline)});guard(signal,deadline);}
    }
    if(!/https:\/\/(i|jaccount)\.sjtu\.edu\.cn\//.test(this.page.url())||!this.page.url().includes('/jaccount/')&&!this.page.url().includes('index_initMenu')&&!courseUrl(this.page.url()))await this.page.goto(ENTRY,{waitUntil:'domcontentloaded',timeout:this.timeout(deadline)});
    guard(signal,deadline);
    if(await this.page.locator('#authJwglxtLoginURL').count()){
      this.note('正在进入 jAccount 统一认证');await this.page.locator('#authJwglxtLoginURL').click({timeout:this.timeout(deadline)});await this.page.waitForLoadState('domcontentloaded',{timeout:this.timeout(deadline)});
    }
    guard(signal,deadline);if(new URL(this.page.url()).hostname==='jaccount.sjtu.edu.cn')await this.login(this.page,signal,deadline);
    guard(signal,deadline);
    if(!courseUrl(this.page.url())){
      this.note('正在打开「选课 → 自主选课」');await this.page.bringToFront();const menu=this.page.getByRole('button',{name:'选课',exact:true});
      const entry=this.page.locator('a').filter({hasText:/^\s*自主选课\s*$/});await menu.hover({timeout:this.timeout(deadline)});guard(signal,deadline);
      try{await entry.waitFor({state:'visible',timeout:Math.min(800,this.timeout(deadline))});}catch{guard(signal,deadline);await menu.click({timeout:this.timeout(deadline)});}
      await entry.click({timeout:this.timeout(deadline)});
      const until=Math.min(Date.now()+15000,deadline);let found;
      while(Date.now()<until){guard(signal,deadline);found=this.context.pages().find(p=>courseUrl(p.url()));if(found)break;await wait(150,signal);}
      if(!found)throw attention('未能打开自主选课，请在 Edge 中检查选课菜单');this.page=found;
    }
    await this.page.waitForLoadState('domcontentloaded',{timeout:this.timeout(deadline)});
    await this.page.locator('#xkxnm').waitFor({state:'attached',timeout:this.timeout(deadline)});guard(signal,deadline);
    await this.installBridge();const info=await this.info();this.note('已连接自主选课页面');return info;
  }
  async info(){return this.page.evaluate(()=>{const owner=document.getElementById('xh_id')?.value||document.getElementById('xh')?.value||'';if(!owner)throw Error('无法确认登录账户');return {owner,term:[document.getElementById('xkxnm')?.value,document.getElementById('xkxqm')?.value].join('|')};});}
  async installBridge(){
    if(!this.page||this.page.isClosed()||!courseUrl(this.page.url()))throw attention('请先连接自主选课页面');
    if(await this.page.evaluate(()=>!!window.__SJTUDesktop))return;
    const source=fs.readFileSync(this.adapterPath,'utf8');
    await this.page.evaluate(source=>{const module={exports:{}};eval(source);window.__SJTUDesktop={api:module.exports,adapter:module.exports.createAdapter(window),controller:null,cancelledUntil:0,currentId:0};},source);
  }
  async call(method,target,signal,deadline=Infinity){
    guard(signal,deadline);await this.installBridge();guard(signal,deadline);const page=this.page,id=this.callSequence=(this.callSequence||0)+1;
    const abort=()=>{page.evaluate(id=>{const b=window.__SJTUDesktop;if(b){b.cancelledUntil=Math.max(b.cancelledUntil||0,id);if(b.currentId<=id)b.controller?.abort();}},id).catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
    try{const result=await page.evaluate(async({method,target,deadline,owner,id})=>{
      if(owner&&(document.getElementById('xh_id')?.value||document.getElementById('xh')?.value)!==owner)return {accountChanged:true};
      const bridge=window.__SJTUDesktop;if(id<=(bridge.cancelledUntil||0))throw Error('已停止');if(Date.now()>=deadline)throw Error('已到结束时间');
      bridge.currentId=id;bridge.controller=new AbortController();try{return await bridge.adapter[method](target,bridge.controller.signal,deadline);}finally{bridge.controller=null;}
    },{method,target,deadline:Number.isFinite(deadline)?deadline:Date.now()+120000,owner:this.expectedOwner,id});if(result?.accountChanged)throw attention('登录账户已改变，请停止并重新连接');return result;}
    finally{signal?.removeEventListener('abort',abort);}
  }
  async inspect(target){await this.installBridge();const result=await this.page.evaluate(({target,owner})=>{if(owner&&(document.getElementById('xh_id')?.value||document.getElementById('xh')?.value)!==owner)return {accountChanged:true};const a=window.__SJTUDesktop.adapter;return a.isSelected(target)?{state:'selected'}:a.inspect(target);},{target,owner:this.expectedOwner});if(result?.accountChanged)throw attention('登录账户已改变，请停止并重新连接');return result;}
  prepare(target,signal,deadline){return this.call('prepare',target,signal,deadline);}
  refresh(target,signal,deadline){return this.call('refresh',target,signal,deadline);}
  submit(target,signal,deadline){return this.call('submit',target,signal,deadline);}
  search(keyword,signal,deadline){return this.call('search',keyword,signal,deadline);}
  async categories(){await this.installBridge();return this.page.evaluate(()=>{const result=[];for(const a of document.querySelectorAll('#nav_tab li a'))result.push({id:a.id,name:(a.textContent||'').replace(/^\s+|\s+$/g,''),active:a.parentElement.classList.contains('active')});return result;});}
  async category(id,signal){guard(signal);await this.installBridge();const delay=await this.page.evaluate(()=>Math.max(0,5100-(Date.now()-(Number(window.tabChangeTime)||0))));if(delay)await wait(delay,signal);guard(signal);
    const changed=await this.page.evaluate(id=>{const el=document.getElementById(id);if(!id.startsWith('tab_kklx_')||!el)throw Error('课程类别不存在');if(el.parentElement.classList.contains('active'))return false;el.click();return true;},id);
    if(changed){
      await this.page.waitForFunction(()=>window.jQuery&&window.jQuery.active===0,{},{timeout:15000});guard(signal);
      // queryCourse schedules searchResult 100 ms after loading the category.
      // Let that delayed query start before treating zero active requests as idle.
      await wait(250,signal);
    }
    await this.page.waitForFunction(()=>window.jQuery&&window.jQuery.active===0,{},{timeout:15000});guard(signal);
  }
  async canReload(){if(!this.page||this.page.isClosed())return true;return this.page.evaluate(()=>!window.__SJTUDesktop||window.__SJTUDesktop.adapter.canReload()).catch(()=>false);}
  async reload(signal,deadline){guard(signal,deadline);if(this.page&&!this.page.isClosed())await this.page.reload({waitUntil:'domcontentloaded',timeout:this.timeout(deadline)});guard(signal,deadline);await this.ensureCourse(signal,deadline);}
  async cancel(){if(this.page&&!this.page.isClosed())await this.page.evaluate(()=>window.__SJTUDesktop?.controller?.abort()).catch(()=>{});}
  async show(){if(this.page&&!this.page.isClosed())await this.page.bringToFront();}
  async close(){this.credentials={username:'',password:''};await this.context?.close();}
}
module.exports={BrowserSession,fillCredentials};
