'use strict';
const TARGET_FIELDS=['jxbId','kchId','keyword','course','className','teacher','time','tabId','context','count','capacity','state'];
function targetCopy(input){
  const result={};for(const key of TARGET_FIELDS)if(typeof input?.[key]==='string')result[key]=input[key].slice(0,4000);
  for(const key of ['jxbId','kchId','keyword','className','context'])if(!result[key])throw Error('教学班信息不完整，请重新查询');
  return result;
}
const keyOf=target=>`${target.context.split('|').slice(0,2).join('|')}|${target.kchId}`;
function validateConfig(c){
  if(!Number.isFinite(c.startAt)||!Number.isFinite(c.endAt)||c.endAt<=c.startAt||c.endAt>8640000000000000)throw Error('请填写有效的开始和结束时间');
  if(!Number.isInteger(c.intervalMs)||c.intervalMs<5000||c.intervalMs>60000)throw Error('每轮间隔须为 5–60 秒');
  if(!Number.isInteger(c.reloadMinutes)||c.reloadMinutes<0||c.reloadMinutes>120)throw Error('整页刷新须为 0–120 分钟');
  return c;
}
function safeError(error){return String(error?.message||error||'操作失败').replace(/https?:\/\/[^\s)]+/g,'[网站地址]').replace(/(pass(?:word)?|cookie|token|ticket|authorization)\s*[:=]\s*[^\s,;]+/gi,'$1=[隐藏]').slice(0,450);}
function wait(ms,signal){return new Promise((resolve,reject)=>{const end=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve();};const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(Error('已停止'));};const timer=setTimeout(end,Math.max(0,ms));if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});});}
function guard(signal,deadline=Infinity){if(signal?.aborted)throw Error('已停止');if(Date.now()>=deadline)throw Error('已到结束时间');}
module.exports={targetCopy,keyOf,validateConfig,safeError,wait,guard};
