'use strict';
const $=id=>document.getElementById(id);let current=null,initialized=false,toastTimer;
const labels={pending:'待开始',checking:'查询中',waiting:'等待名额',uncertain:'待核对',success:'已完成'};
function node(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6000);}
async function invoke(action,payload){try{const result=await window.assistant.invoke(action,payload);if(result?.targets)render(result);return result;}catch(error){toast(error.message);return null;}}
function datetime(ms){return new Date(ms+28800000).toISOString().slice(0,19);}
function keyOf(t){return `${t.context.split('|').slice(0,2).join('|')}|${t.kchId}`;}
function render(state){
 current=state;
 window.credentialsUI.render(state);
 window.shuiyuanUI.render(state);
 window.tennisUI.render(state);
 $('connection-text').textContent=state.connected?'自主选课已连接':'Edge 尚未连接';$('connection-dot').className=`dot${state.connected?' connected':''}`;
 $('browser-message').textContent=state.browserMessage;$('run-message').textContent=state.status.message;$('run-dot').className=`dot${state.busy?' running':state.status.phase==='success'?' connected':''}`;
 for(const id of ['connect','query','teachers','category','search','start-time','end-time','interval','reload','start-run'])$(id).disabled=state.busy;
 $('stop').disabled=!state.busy;
 if(!initialized){$('start-time').value=datetime(state.config.startAt);$('end-time').value=datetime(state.config.endAt);$('interval').value=String(state.config.intervalMs/1000);$('reload').value=String(state.config.reloadMinutes);initialized=true;}
 const selected=$('category').value;$('category').replaceChildren();
 if(!state.categories.length)$('category').appendChild(new Option('连接后加载课程类别',''));
 for(const category of state.categories)$('category').appendChild(new Option(category.name,category.id,false,category.id===selected||!selected&&category.active));
 $('result-count').textContent=`${state.results.length} 个教学班`;
 if(state.results.length){$('results').replaceChildren();for(const target of state.results){
   const card=node('article',undefined,'result-card'),detail=node('div');detail.append(node('h3',target.course),node('p',`${target.className}\n${target.teacher} · ${target.time}`),node('p',target.count&&target.capacity?`已选 / 容量：${target.count} / ${target.capacity}`:'人数信息以网站显示为准'));
   const group=state.targets.find(x=>x.kchId===target.kchId),added=group?.candidates.some(x=>x.jxbId===target.jxbId);const button=node('button',added?'已加入':'＋ 加入','add-button');button.disabled=state.busy||added||!group&&state.targets.length>=10;button.onclick=()=>invoke('add',{jxbId:target.jxbId,context:target.context});card.append(detail,button);$('results').appendChild(card);
 }}else{$('results').replaceChildren();const empty=node('div',undefined,'empty');empty.append(node('div','⌕','empty-symbol'),node('h3',state.connected?'查询后，在这里选择教学班':'下一门好课，从这里开始'),node('p',state.connected?'支持课程名、课号和教师姓名。':'先连接教务系统，再查询课程。'));$('results').appendChild(empty);}
 $('task-count').textContent=`${state.targets.length} / 10 门`;$('tasks').replaceChildren();
 if(!state.targets.length){const empty=node('div',undefined,'empty compact');empty.append(node('div','＋','empty-symbol'),node('p','把想上的教学班加入这里'));$('tasks').appendChild(empty);}
 for(const group of state.targets){const progress=state.progress[keyOf(group)]||{state:'pending',message:'等待开始'},card=node('article',undefined,'task-item'),title=node('div',undefined,'task-title');title.append(node('h3',group.course||group.keyword),node('span',labels[progress.state]||'等待中',`state-tag ${progress.state}`));card.appendChild(title);
   for(const target of group.candidates){const line=node('div',undefined,'candidate'),remove=node('button','移除','text-button');remove.disabled=state.busy;remove.onclick=()=>invoke('remove',{kchId:group.kchId,jxbId:target.jxbId});line.append(node('span',`${target.className} · ${target.teacher}`),remove);card.appendChild(line);}
   card.appendChild(node('p',progress.message,'task-message'));if(progress.state==='uncertain'){const retry=node('button','已核对未选上，允许重试','retry-button');retry.disabled=state.busy;retry.title=state.busy?'请先停止任务，再核对并允许重试':'';retry.onclick=()=>invoke('retry',{kchId:group.kchId});card.appendChild(retry);}$('tasks').appendChild(card);
 }
 $('logs').replaceChildren();for(const item of state.logs.slice(-25).reverse()){const line=node('div',undefined,'log-line');line.append(node('span',new Date(item.time).toLocaleTimeString('zh-CN',{hour12:false}),'log-time'),node('span',item.message));$('logs').appendChild(line);}
}
function showModule(id){const course=id==='courses',tennis=id==='tennis';$('course-page').hidden=!course;$('shuiyuan-page').hidden=id!=='shuiyuan';$('tennis-page').hidden=!tennis;$('show-browser').hidden=!course;$('page-title').textContent=course?'把选课安排好。':tennis?'给网球留个时间。':'把好内容留下来。';$('page-subtitle').textContent=course?'选好课程，设好时间，剩下的交给助手。':tennis?'排好首选和备选，预约后扫码付款。':'按帖子、帖主与分类检索，把想看的发言连同时间一起保存。';for(const b of document.querySelectorAll('[data-module]'))b.classList.toggle('active',b.dataset.module===id);}
for(const button of document.querySelectorAll('[data-module]'))button.onclick=()=>showModule(button.dataset.module);
$('connect').onclick=()=>invoke('connect',{username:$('username').value,password:$('password').value});
$('search').onclick=()=>invoke('search',{query:$('query').value,teachers:$('teachers').value,category:$('category').value});
$('show-browser').onclick=()=>invoke('showBrowser');$('stop').onclick=()=>invoke('stop');
$('start-run').onclick=async()=>{if(!current?.connected){toast('请先连接选课页面');return;}const config={startAt:Date.parse($('start-time').value+'+08:00'),endAt:Date.parse($('end-time').value+'+08:00'),intervalMs:Number($('interval').value)*1000,reloadMinutes:Number($('reload').value)};if(await invoke('configure',config))await invoke('start');};
window.assistant.onState(render);invoke('snapshot');
