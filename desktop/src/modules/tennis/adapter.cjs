'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {guard,wait}=require('../../services/model.cjs');const {VENUES,orderRecord,paymentExpiry,availabilityFilters,availableSlots,accountRestriction}=require('./model.cjs');
const SPORTS='https://sports.sjtu.edu.cn',PORTAL='https://my.sjtu.edu.cn/ui/task',PAY_HOST='cwc2.jdcw.sjtu.edu.cn';
const originIs=(page,origin)=>{try{return new URL(page.url()).origin===origin;}catch{return false;}};
// Runs inside the school's page. Only narrowly defined reads and normal selection handlers.
async function pageOperation({op,args}){
 if(location.origin!=='https://sports.sjtu.edu.cn')throw Error('场馆页面登录已失效');
 const seen=new Set(),all=[];function walk(v){if(!v||seen.has(v))return;seen.add(v);all.push(v);for(const child of v.$children||[])walk(child);}
 for(const el of document.querySelectorAll('#app, #app *'))if(el.__vue__)walk(el.__vue__);
 const app=all.find(v=>v.$ajax);if(!app)throw Error('场馆网页尚未准备好或页面结构已变化');
 if(op==='read'){
  const {endpoint,params}=args;const json=['/manage/fieldDetail/queryFieldReserveSituationIsFull','/manage/fieldDetail/queryFieldSituation','/appointment/disabled/getAppintmentAndSysUserbyUser'];const allowed=['/system/user/currentUser','/venue/personal/personalOrderlist','/venue/personal/queryOrder','/manage/venue/list','/manage/venue/queryVenueById',...json];
  if(!allowed.includes(endpoint))throw Error('不允许的预约读取');
  const post=endpoint.startsWith('/manage/')||json.includes(endpoint);const r=await app.$ajax({url:endpoint,method:post?'post':'get',timeout:15000,...(json.includes(endpoint)?{data:params||{}}:post?{data:new URLSearchParams(params||{}).toString(),headers:{'Content-Type':'application/x-www-form-urlencoded'}}:{params:params||{}})});return r.data;
 }
 if(op==='watchNotice'){
  // The homepage may finish its independent status request after connect returns.
  // Watch only this exact dialog, and read a fresh status for each appearance.
  const key='__sjtuAssistantAccountNotice';
  if(!window[key]){
   const handled=new WeakSet();let pending=null,scheduled=false;
   const visible=el=>el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden';
   const inspect=()=>{
    if(pending)return pending;
    const dialogs=[...document.querySelectorAll('.el-dialog')].filter(el=>el.querySelector('.el-dialog__title')?.textContent.trim()==='账号禁用提示');
    for(const el of dialogs)if(!visible(el))handled.delete(el);
    const targets=dialogs.filter(el=>visible(el)&&!handled.has(el));if(!targets.length)return Promise.resolve();
    for(const el of targets)handled.add(el);
    pending=(async()=>{
     try{
      const response=await app.$ajax({url:'/appointment/disabled/getAppintmentAndSysUserbyUser',method:'post',data:{},timeout:15000}),r=response.data;
      const normal=Number(r?.code)===0&&r.data&&Object.hasOwn(r.data,'distableStatus')&&[null,false,'',0,'0'].includes(r.data.distableStatus);
      if(normal)for(const el of targets)if(el.isConnected&&visible(el))el.querySelector('.el-dialog__headerbtn')?.click();
     }catch{/* Leave unknown/failed status visible for manual checking. */}
     finally{pending=null;}
    })();return pending;
   };
   const observer=new MutationObserver(()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;void inspect();});});
   observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['style','class']});window[key]={inspect};
  }
  await window[key].inspect();return true;
 }
 const v=all.find(v=>typeof v.handleChooseSeat==='function'&&Array.isArray(v.weekList));if(!v)throw Error('未找到场地时间表');
 if(op==='snapshot')return {venue:v.detailedData?.venueName,venueId:v.venueId,date:v.timeData?.isdate,loading:!!v.loading,dates:v.weekList.map(d=>d.isdate),selected:v.buyLists?.length||0};
 if(op==='date'){
  if(!v.weekList.some(d=>d.isdate===args.date))return false;
  v.weekName=args.date;v.weekClick({name:args.date});return true;
 }
 if(op==='choose'){
  if(v.loading||v.timeData?.isdate!==args.date||v.detailedData?.venueName!==args.venue)throw Error('场馆或日期已变化，请重新检查');
  if(v.buyLists?.length)throw Error('页面已有选中场地，请清除后重新启动');
  for(let col=0;col<v.topSite.length;col++){
   const court=v.topSite[col];if(args.court&&String(court.name).replace(/\s/g,'')!==`场地${args.court}`)continue;
   for(let row=0;row<(v.seatArray[col]||[]).length;row++){
    const cell=v.seatArray[col][row];if(v.period(row)!==args.time||(cell.status!==0&&cell.status!=='0'))continue;
    v.handleChooseSeat(col,row);
    const selected=v.buyLists;if(selected?.length!==1||selected[0].scheduleTime!==args.time||String(selected[0].subSiteId)!==String(court.fieldId))throw Error('场地选择结果不一致');
    return {court:String(court.name),amount:String(v.allSun)};
   }
  }return false;
 }
 if(op==='verifySelection'){
  const selected=v.buyLists;return v.timeData?.isdate===args.date&&v.detailedData?.venueName===args.venue&&selected?.length===1&&selected[0].scheduleTime===args.time&&(!args.court||String(selected[0].subSitename).replace(/\s/g,'')===`场地${args.court}`);
 }
 throw Error('不支持的场馆操作');
}
class TennisAdapter{
 constructor({browser,qrDir,note=()=>{}}){this.browser=browser;this.qrDir=qrDir;this.note=note;this.page=null;this.readPage=null;this.owner='';this.venues=new Map();}
 async op(op,args={},signal){guard(signal);const result=await this.page.evaluate(pageOperation,{op,args});guard(signal);return result;}
 async until(fn,signal,ms=15000){const until=Date.now()+ms;while(Date.now()<until){guard(signal);const value=await fn();if(value)return value;await wait(200,signal);}throw Error('等待页面超时，请在 Edge 中检查后重试');}
 async visible(locator){return await locator.first().isVisible().catch(()=>false);}
 async clickText(page,name,signal){guard(signal);const button=page.getByRole('button',{name,exact:true});if(await this.visible(button)){await button.first().click({timeout:5000});return true;}const other=page.getByText(name,{exact:true});if(await this.visible(other)){await other.first().click({timeout:5000});return true;}return false;}
 async connect(credentials={},signal){
  this.browser.credentials={username:String(credentials.username||'').slice(0,200),password:String(credentials.password||'').slice(0,1000)};
  await this.browser.launch(signal,Date.now()+30000);guard(signal);const ctx=this.browser.context;
  if(!this.page||this.page.isClosed())this.page=ctx.pages().find(p=>originIs(p,SPORTS))||await ctx.newPage();
  if(!originIs(this.page,SPORTS)){
   await this.page.goto(PORTAL,{waitUntil:'domcontentloaded',timeout:30000});
   if(originIs(this.page,'https://jaccount.sjtu.edu.cn'))await this.browser.login(this.page,signal,Date.now()+90000);
   if(!originIs(this.page,SPORTS)){
    if(!originIs(this.page,'https://my.sjtu.edu.cn'))throw Error('请在 Edge 完成 jAccount 登录，然后重新连接');
    const search=this.page.locator('input[placeholder*="搜索"],input[placeholder*="查询"],input[type="search"]');
    await search.first().waitFor({state:'visible',timeout:15000});guard(signal);await search.first().fill('场馆预约');await search.first().press('Enter');
    const entry=this.page.getByText('场馆预约',{exact:true});await entry.first().waitFor({state:'visible',timeout:15000});guard(signal);await entry.first().click();
    this.page=await this.until(()=>ctx.pages().find(p=>originIs(p,SPORTS)),signal,20000);
   }
  }
  await this.page.waitForLoadState('domcontentloaded');
  await this.until(()=>this.page.evaluate(()=>!!document.querySelector('#app')?.__vue__).catch(()=>false),signal);
  if(await this.clickText(this.page,'校内人员登录',signal)){
   await this.until(async()=>{
    if(originIs(this.page,'https://jaccount.sjtu.edu.cn'))return true;
    if(originIs(this.page,SPORTS))try{const user=await this.read('/system/user/currentUser',{},signal);return !!user.data?.loginName;}catch{return false;}
    return false;
   },signal);
   if(originIs(this.page,'https://jaccount.sjtu.edu.cn'))await this.browser.login(this.page,signal,Date.now()+90000);
   await this.until(()=>originIs(this.page,SPORTS),signal,30000);
   await this.until(()=>this.page.evaluate(()=>!!document.querySelector('#app')?.__vue__).catch(()=>false),signal);
  }
  const user=await this.read('/system/user/currentUser',{},signal);this.owner=String(user.data?.loginName||'');if(!this.owner)throw Error('无法确认场馆登录账号，请在 Edge 中完成登录后重连');
  await this.checkAccount(signal);this.venues.clear();await this.page.bringToFront();return this.owner;
 }
 async sportsReader(signal){
  if(this.page&&!this.page.isClosed()&&originIs(this.page,SPORTS))return this.page;
  if(!this.browser.context)throw Error('Edge 已关闭，请重新连接');
  if(!this.readPage||this.readPage.isClosed()||!originIs(this.readPage,SPORTS)){this.readPage=await this.browser.context.newPage();await this.readPage.goto(SPORTS+'/pc/#/',{waitUntil:'domcontentloaded',timeout:20000});}
  await this.until(()=>this.readPage.evaluate(()=>!!document.querySelector('#app')?.__vue__).catch(()=>false),signal);return this.readPage;
 }
 async read(endpoint,params={},signal){guard(signal);const page=await this.sportsReader(signal);const result=await page.evaluate(pageOperation,{op:'read',args:{endpoint,params}});guard(signal);return result;}
 async checkOwner(expected,signal){const data=await this.read('/system/user/currentUser',{},signal);if(!expected||data.data?.loginName!==expected)throw Error('场馆登录账号已变化或登录失效，请重新连接');}
 async checkAccount(signal){
  const status=accountRestriction(await this.read('/appointment/disabled/getAppintmentAndSysUserbyUser',{},signal));
  if(status.disabled)throw Error('账号已被场馆系统禁用，请在网站处理：'+status.message);
  const page=await this.sportsReader(signal);
  guard(signal);await page.evaluate(pageOperation,{op:'watchNotice',args:{}});guard(signal);
 }
 async scan(input,signal){
  const filters=availabilityFilters(input);await this.checkAccount(signal);const slots=[],warnings=[];
  for(const name of filters.venues){
   guard(signal);const venue=await this.venue(name,signal);
   const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
   const days=await this.read('/manage/fieldDetail/queryFieldReserveSituationIsFull',{id:venue.id,feildType:venue.typeId,date:today},signal);
   if(Number(days.code)!==0||!Array.isArray(days.data))throw Error(`${name}可预约日期读取失败`);
   const matches=days.data.filter(d=>d.date===filters.date);
   if(!matches.length){warnings.push(`${name}：${filters.date}尚未开放或不在可预约日期内`);continue;}
   if(matches.length!==1||matches[0].dateId===undefined||matches[0].dateId===null)throw Error('场馆日期信息不完整');
   const data=await this.read('/manage/fieldDetail/queryFieldSituation',{fieldType:venue.typeId,date:filters.date,venueId:venue.id,dateId:matches[0].dateId},signal);
   if(Number(data.code)!==0)throw Error(`${name}余量读取失败`);
   slots.push(...availableSlots(data.data,filters,name));
  }
  slots.sort((a,b)=>a.time.localeCompare(b.time)||filters.venues.indexOf(a.venue)-filters.venues.indexOf(b.venue)||Number(a.court)-Number(b.court));
  return {slots,warnings};
 }
 async orders(signal){
  const records=[];let total=Infinity;
  for(let pageNo=1;pageNo<=100;pageNo++){
   const data=await this.read('/venue/personal/personalOrderlist',{pageNo,pageSize:50},signal);
   if(!Array.isArray(data.records)||!Number.isFinite(Number(data.total)))throw Error('无法完整读取已有订单，已暂停预约');total=Number(data.total);
   for(const r of data.records)records.push(orderRecord(r));if(records.length>=total)return records;
   if(!data.records.length)throw Error('订单列表不完整，已暂停预约');
  }throw Error('订单数量超出安全核对范围，请手动检查');
 }
 async venue(name,signal){
  if(this.venues.has(name))return this.venues.get(name);if(!VENUES.includes(name))throw Error('不支持的场馆');
  const data=await this.read('/manage/venue/list',{venueName:name,pageNum:1,pageSize:50,flag:0},signal);const rows=data.rows?.filter(v=>v.venueName===name);
  if(rows?.length!==1||!rows[0].venueId)throw Error(`未能唯一识别${name}，请检查场馆页面`);
  const id=String(rows[0].venueId),detail=await this.read('/manage/venue/queryVenueById',{id},signal);const types=detail.data?.motionTypes?.filter(t=>/网球/.test(t.name));
  if(types?.length!==1||types[0].id===undefined)throw Error('未能唯一识别网球类型');const result={id,type:types[0].name,typeId:types[0].id};this.venues.set(name,result);return result;
 }
 async prepare(candidate,signal,deadline=Infinity){
  guard(signal,deadline);const venue=await this.venue(candidate.venue,signal);
  const url=SPORTS+'/pc/#/apointmentDetails/1/'+encodeURIComponent(venue.id)+'/'+encodeURIComponent(venue.type)+'/0';
  await this.page.goto(url,{waitUntil:'domcontentloaded',timeout:15000});
  // Refresh even when the hash is unchanged, so a new round never uses stale availability.
  await this.page.reload({waitUntil:'domcontentloaded',timeout:15000});
  await this.until(async()=>{try{const s=await this.op('snapshot',{},signal);return s.venue===candidate.venue&&!s.loading&&s.dates.length;}catch{return false;}},signal);
  await this.checkAccount(signal);
  if(!await this.op('date',candidate,signal))return false;
  await this.until(async()=>{const s=await this.op('snapshot',{},signal);return !s.loading&&s.date===candidate.date;},signal);
  guard(signal,deadline);return !!await this.op('choose',candidate,signal);
 }
 async submit(candidate,signal,deadline=Infinity){
  await this.checkAccount(signal);
  guard(signal,deadline);if(!await this.op('verifySelection',candidate,signal))throw Error('提交前场地核验不一致');
  if(!await this.clickText(this.page,'立即下单',signal))throw Error('未找到立即下单按钮');
  const consent=this.page.locator('.el-dialog:visible').filter({hasText:'本人已认真阅读'});
  await consent.waitFor({state:'visible',timeout:10000});guard(signal,deadline);
  const checkbox=consent.getByRole('checkbox');
  if(!await checkbox.isChecked())await consent.locator('label.el-checkbox').filter({hasText:'本人已认真阅读'}).click({timeout:5000});
  if(!await checkbox.isChecked())throw Error('未能确认接受预订规定，请在网页检查');
  const responsePromise=this.page.waitForResponse(r=>new URL(r.url()).pathname==='/venue/personal/ConfirmOrder'&&r.request().method()==='POST',{timeout:20000}).then(r=>r.json()).catch(()=>null);
  guard(signal,deadline);await consent.getByRole('button',{name:'提交订单',exact:true}).click({timeout:5000});
  const result=await responsePromise;
  if(result&&Number(result.code)===0&&result.data){const orderId=typeof result.data==='object'?result.data.orderId:result.data;if(orderId)return {orderId:String(orderId)};}
  if(result&&Number(result.code)===1002)throw Error('网站要求滑块验证，请在 Edge 中完成后点击“核对订单”');
  // Only explicit slot contention may advance to another candidate. Unknown failures stay locked.
  if(result&&Number(result.code)!==0&&/已被预约|已被预订|场地已满|场地不可预约|无可用场地/.test(String(result.msg)))return {rejected:true,message:String(result.msg)};
  throw Error(result?.msg?`订单未完成：${String(result.msg).slice(0,150)}。请先核对订单。`:'订单结果未知，请先核对订单');
 }
 async payment(record,signal){
  await this.checkOwner(this.owner,signal);const orders=await this.orders(signal);const order=orders.find(o=>o.orderId===record.orderId&&o.date===record.date);
  if(!order)throw Error('当前账号未找到该订单，已停止支付操作');if(order.state==='success')return {paid:true};if(order.state!=='awaiting_payment')throw Error('订单状态不允许继续付款');
  // Each resume starts from the verified school order, never an arbitrary existing payment tab.
  {
   const reader=await this.sportsReader(signal);this.page=reader;
   await this.page.evaluate(id=>sessionStorage.setItem('newOrderDetailsId',id),record.orderId);
   await this.page.goto(SPORTS+'/pc/#/orderDetails/0',{waitUntil:'domcontentloaded',timeout:15000});
   await this.page.reload({waitUntil:'domcontentloaded',timeout:15000});
   await this.until(()=>this.visible(this.page.getByRole('button',{name:'立即支付',exact:true})),signal);
   await this.checkAccount(signal);
   const previousPages=new Set(this.browser.context.pages());
   if(!await this.clickText(this.page,'立即支付',signal))throw Error('未找到立即支付按钮');
   let paid=false,confirmedRules=false,confirmedUnpaid=false;
   await this.until(async()=>{
    if(originIs(this.page,'https://'+PAY_HOST))return true;
    if(originIs(this.page,SPORTS)&&this.page.url().includes('/paymentResult/')){
     await this.checkOwner(this.owner,signal);const latest=await this.orders(signal);paid=latest.some(o=>o.orderId===record.orderId&&o.date===record.date&&o.state==='success');return paid;
    }
    const dialog=this.page.locator('.el-dialog:visible').filter({hasText:'请遵守各场馆管理规定'});
    if(!confirmedRules&&await this.visible(dialog)){guard(signal);confirmedRules=true;await dialog.getByRole('button',{name:/^确\s*定$/}).click({timeout:5000});return false;}
    const unpaid=this.page.getByRole('button',{name:'尚未支付',exact:true});if(!confirmedUnpaid&&await this.visible(unpaid)){guard(signal);confirmedUnpaid=true;await unpaid.click({timeout:5000});}
    const next=this.browser.context.pages().find(p=>!previousPages.has(p)&&originIs(p,'https://'+PAY_HOST));if(next){this.page=next;return true;}return false;
   },signal,20000);
   if(paid)return {paid:true};
   this.paymentOrder=record.orderId;
  }
  if(!originIs(this.page,'https://'+PAY_HOST))throw Error('支付页面地址无法核实，请在 Edge 中处理');
  // Includes frames used by the legacy campus payment gateway.
  const before=await this.captureQr(record,signal);if(before)return before;
  let frame;await this.until(async()=>{frame=await this.findPaymentFrame();return frame;},signal);
  const radio=frame.locator('input[type="radio"]:checked');
  const method=await radio.evaluateAll(els=>els.map(el=>({value:el.value,near:el.parentElement?.textContent||'',markup:el.parentElement?.innerHTML||''}))).catch(()=>[]);
  if(method.length!==1||!/微信|wechat|weixin|wxpay/i.test(JSON.stringify(method))){
   const wx=frame.getByRole('radio',{name:/微信/});if(await this.visible(wx))await wx.first().check();else throw Error('无法确认默认微信支付，请在 Edge 中选择微信后再次继续');
  }
  let dialogRejected=false;
  const handler=async dialog=>{if(originIs(this.page,'https://'+PAY_HOST)&&dialog.type()==='confirm'&&/是否|确定|确认|支付|缴费/.test(dialog.message()))await dialog.accept();else{dialogRejected=true;await dialog.dismiss();}};
  this.page.on('dialog',handler);
  try{
   if(!await this.clickText(frame,'下一步',signal))throw Error('未找到缴费下一步按钮');
   const limit=Date.now()+20000;let clickedYes=false;
   while(Date.now()<limit){
    guard(signal);if(dialogRejected)throw Error('支付页面出现未知提示，请手动核对');
    if(!originIs(this.page,'https://'+PAY_HOST))throw Error('支付页面跳转到未知地址，已暂停');
    const qr=await this.captureQr(record,signal);if(qr)return qr;
    if(!clickedYes){for(const f of this.page.frames()){if(await this.clickText(f,'是',signal)){clickedYes=true;break;}}}
    await wait(250,signal);
   }throw Error('尚未识别缴费二维码，请在 Edge 完成页面步骤后再次继续获取');
  }finally{this.page.removeListener('dialog',handler);}
 }
 async findPaymentFrame(){for(const frame of this.page.frames()){if(await this.visible(frame.getByRole('button',{name:'下一步',exact:true}))||await this.visible(frame.getByText('下一步',{exact:true})))return frame;}return null;}
 async captureQr(record,signal){
  if(!originIs(this.page,'https://'+PAY_HOST))return null;
  for(const frame of this.page.frames()){
   const body=await frame.locator('body').innerText({timeout:1000}).catch(()=>'');if(!/微信支付/.test(body)||!/剩余时间|之前缴费/.test(body))continue;
   const images=frame.locator('img,canvas,svg');const indices=await images.evaluateAll(els=>els.flatMap((el,i)=>{const b=el.getBoundingClientRect();return b.width>=100&&b.width<=600&&b.height>=100&&b.height<=600&&Math.abs(b.width-b.height)<20&&getComputedStyle(el).visibility!=='hidden'?[i]:[];}));
   if(indices.length!==1)continue;guard(signal);
   const expiresAt=paymentExpiry(body);if(expiresAt!==null&&expiresAt<=Date.now())throw Error('此缴费二维码已过期，请在网站核对订单');
   fs.mkdirSync(this.qrDir,{recursive:true});const qrFile=`tennis-${crypto.randomUUID()}.png`;const buffer=await images.nth(indices[0]).screenshot({path:path.join(this.qrDir,qrFile)});
   return {qrFile,qrData:'data:image/png;base64,'+buffer.toString('base64'),expiresAt};
  }return null;
 }
 async show(){if(this.page&&!this.page.isClosed())await this.page.bringToFront();}
 qrPath(file){if(!/^tennis-[a-f0-9-]+\.png$/.test(file||''))throw Error('二维码文件无效');const result=path.resolve(this.qrDir,file);if(!result.startsWith(path.resolve(this.qrDir)+path.sep))throw Error('二维码路径无效');return result;}
}
module.exports={TennisAdapter,pageOperation};
