'use strict';
const {EventEmitter}=require('node:events');const {wait,guard,safeError}=require('../../services/model.cjs');
const {availabilityFilters,candidateCopy}=require('./model.cjs');
class TennisService extends EventEmitter{
 constructor({store,adapter}){super();this.store=store;this.adapter=adapter;this.owner='';this.connected=false;this.controller=null;this.mode='';this.monitorTask=null;this.availability={filters:null,slots:[],warnings:[],updatedAt:0,loading:false,error:''};this.message=store.warning||'先设置候选，再连接场馆预约。';this.phase='idle';this.logs=[];this.qrData='';this.qrDate='';}
 note(message,phase=this.phase){this.message=message;this.phase=phase;this.logs.push({time:Date.now(),message});this.logs=this.logs.slice(-60);this.emit('update');}
 view(){return {...this.store.view(this.owner),owner:this.owner,connected:this.connected,running:!!this.controller,mode:this.mode,availability:structuredClone(this.availability),message:this.message,phase:this.phase,logs:this.logs,qrData:this.qrData,qrDate:this.qrDate};}
 async connect(credentials,signal){this.connected=false;this.qrData='';this.qrDate='';this.owner='';this.availability={filters:null,slots:[],warnings:[],updatedAt:0,loading:false,error:''};this.owner=await this.adapter.connect(credentials,signal);this.connected=true;this.note('已连接网球预约，可查询空闲场次或启动任务。','ready');}
 configure(input){if(this.controller)throw Error('请先停止网球任务');this.store.configure(input);this.emit('update');}
 stop(){this.controller?.abort();}
 monitor(input){
  if(this.controller)throw Error('请先停止当前任务');if(!this.connected)throw Error('请先连接场馆预约');const filters=availabilityFilters(input);
  const controller=this.controller=new AbortController();this.mode='monitor';this.availability={filters,slots:[],warnings:[],updatedAt:0,loading:true,error:''};
  this.monitorTask=this.monitorLoop(filters,controller.signal);return this.monitorTask;
 }
 async monitorLoop(filters,signal){
  this.note('正在查询空闲场次……','monitoring');
  try{while(true){
   guard(signal);this.availability.loading=true;this.emit('update');await this.adapter.checkOwner(this.owner,signal);
   const result=await this.adapter.scan(filters,signal);guard(signal);await this.adapter.checkOwner(this.owner,signal);guard(signal);
   this.availability={filters,slots:result.slots,warnings:result.warnings||[],updatedAt:Date.now(),loading:false,error:''};
   this.note(`找到 ${result.slots.length} 个空闲场次，每 ${filters.intervalMs/1000} 秒继续检查。`,'monitoring');await wait(filters.intervalMs,signal);
  }}catch(error){if(signal.aborted){this.note('场次监测已停止。显示的是最近一次查询结果。','ready');}else{this.availability.slots=[];this.availability.updatedAt=0;this.availability.error=safeError(error);this.note(this.availability.error,'attention');}}
  finally{this.availability.loading=false;this.controller=null;this.mode='';this.emit('update');}
 }
 async haltMonitor(){if(this.mode==='monitor'){this.stop();await this.monitorTask;}}
 availableCandidates(ids){
  if(!this.connected)throw Error('请先连接场馆预约');const a=this.availability;
  if(!a.updatedAt||a.error||Date.now()-a.updatedAt>Math.max(15000,(a.filters?.intervalMs||0)*2))throw Error('空闲列表已过期，请重新刷新');
  if(!Array.isArray(ids)||!ids.length||ids.length>30||new Set(ids).size!==ids.length)throw Error('请选择 1–30 个场次');
  return ids.map(id=>{const s=a.slots.find(s=>s.id===id);if(!s)throw Error('场次已变化，请刷新后重选');return candidateCopy(s);});
 }
 async reconcile(signal){await this.adapter.checkOwner(this.owner,signal);const orders=await this.adapter.orders(signal);for(const o of orders){const local=this.store.get(this.owner,o.date);if(o.state!=='cancelled')this.store.mark(this.owner,o.date,o);else if(local?.orderId===o.orderId)this.store.mark(this.owner,o.date,{...o,qrFile:'',expiresAt:0});}return orders;}
 async payment(record,signal){
  this.note('已生成订单，正在获取微信缴费二维码……','payment');
  const result=await this.adapter.payment(record,signal);this.store.mark(this.owner,record.date,{...result,state:result.paid?'success':'awaiting_payment'});
  this.qrData=result.qrData||'';this.qrDate=record.date;
  this.note(result.paid?'网站确认预约成功。':'缴费二维码已保存，请及时扫码付款。付款后点击“核对订单”。',result.paid?'success':'awaiting_payment');
  this.emit('payment',{date:record.date,paid:!!result.paid,expiresAt:result.expiresAt});
 }
 async run(){
  if(this.controller)throw Error('网球任务已在运行');if(!this.connected)throw Error('请先连接场馆预约');this.store.assert();const config=this.store.view(this.owner).config;if(!config)throw Error('请先保存预约配置');
  const controller=this.controller=new AbortController(),signal=controller.signal;this.mode='booking';this.qrData='';this.note('等待设定开始时间……','waiting');
  try{
   if(config.endAt<=Date.now())throw Error('结束时间已过，请修改时间');
   if(config.startAt>Date.now())await wait(config.startAt-Date.now(),signal);
   while(Date.now()<config.endAt){
    guard(signal,config.endAt);await this.reconcile(signal);let pending=false;
    for(const candidate of config.candidates){
     guard(signal,config.endAt);const prior=this.store.get(this.owner,candidate.date);if(prior&&prior.state!=='cancelled')continue;pending=true;
     const starts=Date.parse(`${candidate.date}T${candidate.time.slice(0,5)}:00+08:00`);if(starts<=Date.now())continue;
     this.note(`正在检查 ${candidate.venue} · ${candidate.date} ${candidate.time}`,'checking');
     if(!await this.adapter.prepare(candidate,signal,config.endAt))continue;
     guard(signal,config.endAt);await this.adapter.checkOwner(this.owner,signal);await this.reconcile(signal);const checked=this.store.get(this.owner,candidate.date);if(checked&&checked.state!=='cancelled')continue;
     guard(signal,config.endAt);this.store.mark(this.owner,candidate.date,{state:'submitting',candidate,orderId:'',qrFile:'',message:'提交中；中断后需要核对订单'});
     let order;
     try{order=await this.adapter.submit(candidate,signal,config.endAt);}
     catch(error){this.store.mark(this.owner,candidate.date,{state:'uncertain',message:'提交结果未知，请先核对订单'});throw error;}
     if(order.rejected){this.store.clear(this.owner,candidate.date);this.note(order.message||'场地已不可预约，检查备选');continue;}
     if(!order.orderId){this.store.mark(this.owner,candidate.date,{state:'uncertain'});throw Error('订单编号缺失，请核对订单');}
     const record=this.store.mark(this.owner,candidate.date,{...order,state:'awaiting_payment',candidate});
     // Once an order exists, the booking deadline no longer cuts off payment QR retrieval.
     guard(signal);await this.payment(record,signal);return;
    }
    if(!pending){this.note('候选日期已有订单或待核对记录。可核对订单或继续获取二维码。','blocked');return;}
    this.note('暂无符合条件的场地，等待下一次检查……','waiting');await wait(Math.min(config.intervalMs,config.endAt-Date.now()),signal);
   }
   this.note('已到结束时间，停止预约。','idle');
  }catch(error){this.note(signal.aborted?'任务已停止；已提交的订单仍保留，请核对。':safeError(error),'attention');}
  finally{this.controller=null;this.mode='';this.emit('update');}
 }
 async resume(date,signal){if(!this.connected)throw Error('请先连接场馆预约');await this.reconcile(signal);const r=this.store.get(this.owner,date);if(!r?.orderId||r.state!=='awaiting_payment')throw Error('没有可继续付款的订单，请核对订单');await this.payment(r,signal);}
 async check(signal){if(!this.connected)throw Error('请先连接场馆预约');await this.reconcile(signal);const current=this.qrDate&&this.store.get(this.owner,this.qrDate);if(current?.state!=='awaiting_payment')this.qrData='';this.note(current?.state==='success'?'网站已确认预约成功。':'订单状态已核对；结果不明且未查到订单的记录仍保留，请在网站确认后解除。',current?.state==='success'?'success':'ready');}
 async unlock(date,signal){if(!this.connected)throw Error('请先连接场馆预约');const orders=await this.reconcile(signal);if(orders.some(r=>r.date===date&&r.state!=='cancelled'))throw Error('该日期仍有网站订单，不能解除');const record=this.store.get(this.owner,date);if(!record||!['uncertain','cancelled'].includes(record.state))throw Error('只允许解除已核对的结果不明或取消记录');this.store.clear(this.owner,date);this.note('已解除该日期的本机保护，可重新启动任务。','ready');}
}
module.exports={TennisService};
