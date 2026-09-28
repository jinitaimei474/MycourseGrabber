'use strict';
window.tennisAvailabilityUI=(()=>{
 const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const selected=new Set();let current=null,revision='',owner='';
 const controls=['tn-live-date','tn-live-venue','tn-live-after','tn-live-before','tn-live-interval'];
 function filters(){return {date:$('tn-live-date').value,venues:$('tn-live-venue').value==='both'?['东区网球场','胡晓明网球场']:[$('tn-live-venue').value],after:$('tn-live-after').value,before:$('tn-live-before').value,intervalMs:Number($('tn-live-interval').value)*1000};}
 function usable(){const t=current?.tennis,a=t?.availability;return !!(t?.connected&&a?.updatedAt&&!a.error&&Date.now()-a.updatedAt<=Math.max(15000,a.filters.intervalMs*2)&&JSON.stringify(filters())===JSON.stringify(a.filters)&&(!current.busy||t.mode==='monitor'));}
 function selection(){
  const okay=usable();$('tn-live-book').textContent=`预约所选候选（${selected.size}）`;$('tn-live-book').disabled=!okay||!selected.size;
  for(const node of $('tn-live-slots').querySelectorAll('button,input'))node.disabled=!okay;
  $('tn-live-selection').textContent=selected.size?`已选 ${selected.size} 个，按勾选顺序尝试，成功一单即停止。`:'可以单场直接预约，也可以勾选多个作为备选；同一天只预约一场。';
 }
 async function book(ids){if(!usable()){window.toast('请重新查询最新空闲场次');return;}await window.invoke('tennisBookAvailable',{ids});}
 function render(state){
  current=state;const t=state.tennis,a=t?.availability;if(!a)return;
  if(owner!==t.owner){owner=t.owner;selected.clear();revision='';}
  for(const id of controls)$(id).disabled=state.busy;
  $('tn-live-start').disabled=state.busy||!t.connected;$('tn-live-stop').disabled=t.mode!=='monitor';
  const age=a.updatedAt?Date.now()-a.updatedAt:Infinity,stale=age>Math.max(15000,(a.filters?.intervalMs||0)*2);
  $('tn-live-count').textContent=a.updatedAt?`${a.slots.length} 个空闲场次`:'尚未查询';
  $('tn-live-updated').textContent=a.updatedAt?`${t.mode==='monitor'?'监测中':'已停止'} · ${new Date(a.updatedAt).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})} 更新${stale?' · 已过期，请重新查询':a.loading?' · 刷新中':''}`:a.loading?'正在读取场次……':t.connected?'选择条件后开始查询':'连接场馆后开始查询';
  $('tn-live-warning').textContent=[a.error,...a.warnings].filter(Boolean).join('；');
  const next=JSON.stringify([a.updatedAt,a.slots,a.error]);
  if(next!==revision){
   revision=next;for(const id of selected)if(!a.slots.some(s=>s.id===id))selected.delete(id);
   $('tn-live-slots').replaceChildren();
   for(const s of a.slots){
    const row=el('div',undefined,'tennis-slot'),label=el('label'),check=el('input'),text=el('div');check.type='checkbox';check.checked=selected.has(s.id);check.setAttribute('aria-label',`${s.venue} ${s.date} ${s.fieldName} ${s.time}`);
    text.append(el('strong',`${s.time} · ${s.venue} · ${s.fieldName}`),el('span',`${s.date} · ${s.price!==''?'¥ '+s.price:'价格以网站为准'}`));
    check.onchange=()=>{if(check.checked){if(selected.size>=30){check.checked=false;window.toast('最多选择 30 个候选');return;}selected.add(s.id);}else selected.delete(s.id);selection();};
    label.append(check,text);const button=el('button','预约此场','secondary');button.onclick=()=>book([s.id]);row.append(label,button);$('tn-live-slots').append(row);
   }
   if(!a.slots.length)$('tn-live-slots').append(el('p',a.error?'读取失败，请检查网页后重新查询。':a.updatedAt?'当前没有符合条件的空闲场次。':a.loading?'正在查询……':'选择日期和时间范围，查看可预约场次。','empty'));
  }selection();
 }
 for(let h=7;h<=22;h++){const time=String(h).padStart(2,'0')+':00';if(h<22)$('tn-live-after').append(new Option(time,time));if(h>7)$('tn-live-before').append(new Option(time,time));}
 $('tn-live-after').value='18:00';$('tn-live-before').value='22:00';$('tn-live-date').value=new Date(Date.now()+86400000+28800000).toISOString().slice(0,10);
 for(const id of controls)$(id).onchange=()=>{selected.clear();revision='';if(current)render(current);};
 $('tn-live-start').onclick=()=>window.invoke('tennisMonitor',filters());$('tn-live-stop').onclick=()=>window.invoke('tennisStop');$('tn-live-book').onclick=()=>book([...selected]);
 setInterval(()=>{if(current)render(current);},1000);
 return {render};
})();
