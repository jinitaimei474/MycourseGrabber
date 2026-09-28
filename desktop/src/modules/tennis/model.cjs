'use strict';
const VENUES=['东区网球场','胡晓明网球场'];
function dateValue(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('请选择有效预约日期');
 const ms=Date.parse(value+'T00:00:00+08:00');if(!Number.isFinite(ms)||new Date(ms+28800000).toISOString().slice(0,10)!==value)throw Error('预约日期不存在');return ms;
}
function releaseAt(date){return dateValue(date)-7*86400000+12*3600000;}
function candidateCopy(c){
 if(!VENUES.includes(c?.venue))throw Error('仅支持东区网球场和胡晓明网球场');dateValue(c.date);
 const match=/^(\d{2}):00-(\d{2}):00$/.exec(c.time||'');if(!match||+match[1]<7||+match[2]>22||+match[2]!==+match[1]+1)throw Error('每个候选请选择 07:00–22:00 内的单个一小时时段');
 const court=String(c.court||'').trim();if(court&&!/^[1-9]\d?$/.test(court))throw Error('场地编号须为 1–99，留空表示任意场地');
 return {venue:c.venue,date:c.date,time:c.time,court};
}
function validateConfig(input){
 if(!Array.isArray(input?.candidates)||!input.candidates.length||input.candidates.length>30)throw Error('请添加 1–30 个首选或备选');
 const candidates=input.candidates.map(candidateCopy);if(new Set(candidates.map(c=>JSON.stringify(c))).size!==candidates.length)throw Error('请移除重复候选');
 const {startAt,endAt,intervalMs}=input;if(!Number.isFinite(startAt)||!Number.isFinite(endAt)||endAt<=startAt||endAt-startAt>86400000*8)throw Error('请设置有效开始/结束时间，持续时间不超过八天');
 if(!Number.isInteger(intervalMs)||intervalMs<1000||intervalMs>60000)throw Error('检查间隔须为 1–60 秒');
 return {candidates,startAt,endAt,intervalMs};
}
function orderRecord(raw){
 const date=String(raw.scDate||raw.spaces?.[0]?.scheduleDate||'').slice(0,10);dateValue(date);
 const orderId=String(raw.pOrderid||raw.orderId||raw.pOrderId||'');if(!orderId)throw Error('订单标识缺失，不能安全核对');
 const status=String(raw.orderstateid??raw.orderStateId??'');
 const state=['2','8','23'].includes(status)?'cancelled':['0','9'].includes(status)?'awaiting_payment':['1','7','16','18','19','20','21'].includes(status)?'success':'uncertain';
 return {date,orderId,state,venue:String(raw.venuename||raw.venueName||''),amount:String(raw.countprice??raw.countPrice??''),status};
}
function paymentExpiry(text,now=Date.now()){
 const date=/请在\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s*之前/.exec(text);
 const remaining=/剩余时间\s*[:：]\s*(\d+)\s*秒/.exec(text);const dates=[];
 if(date){const value=Date.parse(`${date[1]}T${date[2]}+08:00`);if(Number.isFinite(value))dates.push(value);}
 if(remaining)dates.push(now+Number(remaining[1])*1000);return dates.length?Math.min(...dates):null;
}
function availabilityFilters(input){
 dateValue(input?.date);const venues=[...new Set(input.venues||[])];
 if(!venues.length||venues.some(v=>!VENUES.includes(v)))throw Error('请选择东区或胡晓明网球场');
 const valid=t=>typeof t==='string'&&/^(0[7-9]|1\d|2[0-2]):00$/.test(t);
 if(!valid(input.after)||!valid(input.before)||input.after>=input.before)throw Error('请设置 07:00–22:00 内有效的时间范围');
 if(!Number.isInteger(input.intervalMs)||input.intervalMs<3000||input.intervalMs>60000)throw Error('监测间隔须为 3–60 秒');
 return {date:input.date,venues,after:input.after,before:input.before,intervalMs:input.intervalMs};
}
function availableSlots(fields,filters,venue,now=Date.now()){
 if(!Array.isArray(fields))throw Error('场地余量数据不完整');const slots=[];
 for(const f of fields){
  if(!Array.isArray(f.priceList)||f.priceList.length>15)throw Error('场地时间表结构已变化');
  for(let i=0;i<f.priceList.length;i++){
   const cell=f.priceList[i];if(cell?.status!==0&&cell?.status!=='0')continue;
   const start=String(7+i).padStart(2,'0')+':00',end=String(8+i).padStart(2,'0')+':00';
   if(start<filters.after||end>filters.before||Date.parse(`${filters.date}T${start}:00+08:00`)<=now)continue;
   const court=/^场地\s*([1-9]\d?)$/.exec(String(f.fieldName||'').trim())?.[1];if(!court)throw Error('无法识别场地编号，请在网页核对');
   const candidate={venue,date:filters.date,time:`${start}-${end}`,court};
   slots.push({...candidate,id:JSON.stringify([venue,filters.date,start,court]),fieldName:String(f.fieldName),price:cell.price===null||cell.price===undefined?'':String(cell.price)});
  }
 }return slots.sort((a,b)=>a.time.localeCompare(b.time)||Number(a.court)-Number(b.court));
}
function accountRestriction(response){
 if(Number(response?.code)!==0||!response.data||!Object.hasOwn(response.data,'distableStatus'))throw Error('无法核实场馆账号状态，请在网页检查后重试');
 const s=response.data.distableStatus;if(![null,false,'',0,'0'].includes(s)&&!(typeof s==='string'||typeof s==='number'))throw Error('账号状态数据无法识别');
 return {disabled:!!s&&s!=0,message:String(response.data.breackInfo||'').slice(0,300)};
}
module.exports={VENUES,dateValue,releaseAt,candidateCopy,validateConfig,orderRecord,paymentExpiry,availabilityFilters,availableSlots,accountRestriction};
