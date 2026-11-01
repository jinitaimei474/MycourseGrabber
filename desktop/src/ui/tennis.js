'use strict';
window.tennisUI=(()=>{
 const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 let candidates=[],initialized=false,current=null,expiry=null,qrImage='',lastConfig='';
 const dt=ms=>new Date(ms+28800000).toISOString().slice(0,19);
 const labels={submitting:'提交中',uncertain:'需要核对',awaiting_payment:'待付款',success:'预约成功',cancelled:'已取消'};
 function times(start){$('tn-start').value=dt(start);$('tn-end').value=dt(start+300000);}
 function noon(date){return Date.parse(date+'T12:00:00+08:00')-7*86400000;}
 function drawCandidates(){
  $('tn-candidates').replaceChildren();
  candidates.forEach((c,i)=>{const li=el('li'),text=el('div');text.append(el('strong',`${i===0?'首选':`备选 ${i}`} · ${c.venue}`),el('p',`${c.date} · ${c.time} · ${c.court?'场地'+c.court:'任意场地'}`));const actions=el('div',undefined,'tennis-candidate-actions');
   for(const [label,change,disabled] of [['↑',()=>{[candidates[i-1],candidates[i]]=[candidates[i],candidates[i-1]];},i===0],['↓',()=>{[candidates[i+1],candidates[i]]=[candidates[i],candidates[i+1]];},i===candidates.length-1],['移除',()=>candidates.splice(i,1),false]]){const b=el('button',label,'text-button');b.disabled=!!current?.busy||disabled;b.onclick=()=>{change();drawCandidates();};actions.append(b);}li.append(text,actions);$('tn-candidates').append(li);
  });
  if(!candidates.length)$('tn-candidates').append(el('p','选择场馆、日期和时段后，加入首选。','helper'));
 }
 function config(){return {candidates,startAt:Date.parse($('tn-start').value+'+08:00'),endAt:Date.parse($('tn-end').value+'+08:00'),intervalMs:Number($('tn-interval').value)*1000};}
 async function call(action,payload){return window.invoke(action,payload);}
 function countdown(){const n=$('tn-countdown');if(!expiry){n.textContent='付款期限请以网页显示为准';return;}const seconds=Math.ceil((expiry-Date.now())/1000);n.textContent=seconds>0?`请在 ${Math.floor(seconds/60)} 分 ${String(seconds%60).padStart(2,'0')} 秒内付款`:'二维码已到付款期限，请打开网页核对订单';$('tn-qr').classList.toggle('expired',seconds<=0);}
 function render(state){
  current=state;const t=state.tennis;if(!t)return;
  window.tennisAvailabilityUI.render(state);
  if(!initialized){if(t.config){candidates=t.config.candidates;$('tn-start').value=dt(t.config.startAt);$('tn-end').value=dt(t.config.endAt);$('tn-interval').value=t.config.intervalMs/1000;}else{const day=dt(Date.now()+7*86400000).slice(0,10);$('tn-date').value=day;times(noon(day));}initialized=true;}
  const configKey=JSON.stringify(t.config);if(t.config&&configKey!==lastConfig){candidates=t.config.candidates.map(c=>({...c}));$('tn-start').value=dt(t.config.startAt);$('tn-end').value=dt(t.config.endAt);$('tn-interval').value=t.config.intervalMs/1000;}lastConfig=configKey;
  $('tn-connection').textContent=t.connected?`已连接 · ${t.owner}`:'复用专用 Edge 登录；额外验证请在网页中完成。';$('tn-status').textContent=t.warning||t.message;
  for(const id of ['tn-connect','tn-venue','tn-date','tn-time','tn-court','tn-add','tn-start','tn-end','tn-interval','tn-release','tn-now','tn-save','tn-start-run','tn-check'])$(id).disabled=state.busy;
  $('tn-stop').disabled=!(state.busy&&state.operationModule==='tennis');drawCandidates();
  $('tn-records').replaceChildren();for(const r of [...t.records].sort((a,b)=>b.updatedAt-a.updatedAt)){
   const card=el('div',undefined,'tennis-record'),title=el('strong',`${r.date} · ${labels[r.state]||r.state}`);card.append(title,el('p',r.candidate?`${r.candidate.venue} ${r.candidate.time}`:r.venue||'网站已有订单'));if(r.orderId)card.append(el('p',`订单 ${r.orderId}${r.amount?' · ¥'+r.amount:''}`,'muted'));
   const row=el('div',undefined,'forum-actions');const button=(text,action)=>{const b=el('button',text,'text-button');b.disabled=state.busy;b.onclick=action;row.append(b);};
   if(r.state==='awaiting_payment'&&r.orderId)button('继续获取二维码',()=>call('tennisResume',{date:r.date}));
   if(r.qrFile)button('保存二维码',()=>call('tennisExport',{date:r.date}));
   if(r.state==='uncertain'||r.state==='cancelled')button('已核对无有效订单，解除保护',()=>{if(confirm('请先在网站确认该日期没有待付款或已成功的订单。确认后允许软件重新预约？'))call('tennisUnlock',{date:r.date});});card.append(row);$('tn-records').append(card);
  }
  if(t.qrData){if(qrImage!==t.qrData){qrImage=t.qrData;$('tn-qr').src=t.qrData;const record=t.records.find(r=>r.date===t.qrDate);expiry=record?.expiresAt||null;}$('tn-qr-area').hidden=false;countdown();}else{$('tn-qr-area').hidden=true;qrImage='';}
  $('tn-logs').replaceChildren();for(const item of t.logs.slice(-20).reverse()){const row=el('div',undefined,'log-line');row.append(el('span',new Date(item.time).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}),'log-time'),el('span',item.message));$('tn-logs').append(row);}
 }
 for(let hour=7;hour<22;hour++){const time=`${String(hour).padStart(2,'0')}:00-${String(hour+1).padStart(2,'0')}:00`;$('tn-time').append(new Option(time,time));}$('tn-time').value='18:00-19:00';
 $('tn-add').onclick=()=>{const c={venue:$('tn-venue').value,date:$('tn-date').value,time:$('tn-time').value,court:$('tn-court').value.trim()};if(!c.date){window.toast('请选择预约日期');return;}if(candidates.some(x=>JSON.stringify(x)===JSON.stringify(c))){window.toast('这个候选已经加入');return;}if(candidates.length>=30){window.toast('最多 30 个候选');return;}candidates.push(c);drawCandidates();};
 $('tn-release').onclick=()=>{const day=candidates[0]?.date||$('tn-date').value;if(day)times(noon(day));};$('tn-now').onclick=()=>times(Date.now()+1000);
 $('tn-save').onclick=()=>call('tennisConfigure',config());
 $('tn-connect').onclick=()=>call('tennisConnect',window.credentialsUI.read());
 $('tn-start-run').onclick=async()=>{if(!current?.tennis.connected){window.toast('请先连接场馆预约');return;}if(await call('tennisConfigure',config()))await call('tennisStart');};
 $('tn-stop').onclick=()=>call('tennisStop');$('tn-show').onclick=()=>call('tennisShow');$('tn-check').onclick=()=>call('tennisCheck');setInterval(countdown,1000);
 return {render};
})();
