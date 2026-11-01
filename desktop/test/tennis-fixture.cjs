'use strict';
// Entirely offline: every network request, including school and payment URLs, is intercepted.
const fixtureDate=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
const sportsHtml=`<!doctype html><html><meta charset="utf-8"><style>.el-checkbox input{opacity:0;outline:none;position:absolute;margin:0;width:0;height:0;z-index:-1}.el-checkbox{cursor:pointer;display:inline-block;padding:10px}</style><body><div id="app"></div><script>
const root=document.getElementById('app');
const noticeEnabled=false;
const ajax=async o=>{let url=o.url;if(o.params)url+='?'+new URLSearchParams(o.params);const json=o.data&&typeof o.data==='object';const r=await fetch(url,{method:o.method||'GET',headers:json?{'Content-Type':'application/json',...o.headers}:o.headers,body:json?JSON.stringify(o.data):o.data});return {data:await r.json()};};
function render(){
 root.innerHTML='';const vm={$ajax:ajax,$children:[]};root.__vue__=vm;
 if(location.hash.includes('apointmentDetails')){
  Object.assign(vm,{venueId:'hxm',detailedData:{venueName:'胡晓明网球场'},weekList:[{isdate:'${fixtureDate}',dateId:'d1'}],timeData:{isdate:'${fixtureDate}'},loading:false,topSite:[{name:'场地1',fieldId:'f1'},{name:'场地2',fieldId:'f2'}],seatArray:[[{status:-1},{status:-1}],[{status:0},{status:-1}]],buyLists:[],allSun:'0',period:r=>r===0?'18:00-19:00':'19:00-20:00',weekClick:function(e){this.timeData={isdate:e.name};this.buyLists=[];},handleChooseSeat:function(col,row){this.buyLists=[{scheduleTime:this.period(row),subSiteId:this.topSite[col].fieldId,subSitename:this.topSite[col].name}];this.allSun='5';}});
  root.innerHTML='<h1>胡晓明网球场</h1><button id="book">立即下单</button>';
  document.getElementById('book').onclick=()=>{const d=document.createElement('div');d.className='el-dialog';d.innerHTML='<label class="el-checkbox"><input type="checkbox">本人已认真阅读、充分了解并自愿接受上述规定。</label><button>提交订单</button>';root.append(d);d.querySelector('button').onclick=async()=>{if(!d.querySelector('input').checked)return;const r=await ajax({url:'/venue/personal/ConfirmOrder',method:'POST',headers:{'Content-Type':'application/json'},data:JSON.stringify({terms:true,spaces:vm.buyLists})});sessionStorage.setItem('newOrderDetailsId',r.data.data);location.hash='/orderDetails/0';};};
 }else if(location.hash.includes('orderDetails')){
  root.innerHTML='<h1>胡晓明网球场 ${fixtureDate}</h1><p>应付金额 5元</p><button id="pay">立即支付</button>';
  document.getElementById('pay').onclick=()=>{const d=document.createElement('div');d.className='el-dialog';d.innerHTML='<p>请遵守各场馆管理规定，在现场管理人员的指导下开展活动。</p><button>确 定</button>';root.append(d);d.querySelector('button').onclick=async()=>{await fetch('/test-payment-prepare');location.href='https://cwc2.jdcw.sjtu.edu.cn/payment/pay/pay.action';};};
 }else root.innerHTML='<h1>体育场馆预约</h1><a href="#/Venue/1">网球</a>';
 if(noticeEnabled)setTimeout(async()=>{const r=await ajax({url:'/appointment/disabled/getAppintmentAndSysUserbyUser',method:'POST'});const d=document.createElement('div');d.className='el-dialog';d.style='position:fixed;inset:10%;background:white;z-index:9999;box-shadow:0 0 0 3000px #0008';d.innerHTML='<span class="el-dialog__title">账号禁用提示</span><p></p><button class="el-dialog__headerbtn" aria-label="Close">×</button><button>爽约申诉</button>';d.querySelector('p').textContent=r.data.data.breackInfo||'';d.querySelector('.el-dialog__headerbtn').onclick=()=>{d.remove();fetch('/test-notice-closed');};root.append(d);},0);
}
window.addEventListener('hashchange',render);render();
</script></body></html>`;
async function installRoutes(context,options={}){
 const state={owner:'alice',submissions:0,portalSearch:'',terms:false,selected:'',paymentMethod:'',confirmed:false,orders:[],loggedIn:!options.loginRequired,restriction:options.restriction??0,noticeClosed:0,extraSlot:true,noticeRequests:0};
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url()),respond=(body,type='text/html; charset=utf-8')=>route.fulfill({status:200,contentType:type,body:typeof body==='string'?body:JSON.stringify(body)});
  if(u.hostname==='my.sjtu.edu.cn')return respond('<meta charset="utf-8"><input placeholder="搜索事项"><a href="https://sports.sjtu.edu.cn/pc/" hidden>场馆预约</a><script>document.querySelector("input").onkeydown=e=>{if(e.key==="Enter"){fetch("/test-search?q="+encodeURIComponent(e.target.value));document.querySelector("a").hidden=false;}};</script>');
  // Playwright routing only intercepts the first request in an HTTP redirect chain.
  // Navigate in the fixture document so the destination is intercepted too.
  if(u.hostname==='jaccount.sjtu.edu.cn'){state.loggedIn=true;return respond('<script>location.replace("https://sports.sjtu.edu.cn/pc/")</script>');}
  if(u.pathname==='/system/user/currentUser')return respond({code:0,data:state.loggedIn?{loginName:state.owner}:{}},'application/json');
  if(u.pathname==='/appointment/disabled/getAppintmentAndSysUserbyUser'){state.noticeRequests++;if(state.noticeRequests===1&&options.noticeDelay)await new Promise(resolve=>setTimeout(resolve,options.noticeDelay));return respond({code:0,data:{distableStatus:state.restriction,breackInfo:state.restriction?'账号暂停预约':''}},'application/json');}
  if(u.pathname==='/test-notice-closed'){state.noticeClosed++;return respond('ok');}
  if(u.pathname==='/manage/venue/list')return respond({code:0,rows:[{venueId:'hxm',venueName:'胡晓明网球场'}]},'application/json');
  if(u.pathname==='/manage/venue/queryVenueById')return respond({code:0,data:{venueId:'hxm',venueName:'胡晓明网球场',motionTypes:[{id:'tennis',name:'网球'}]}},'application/json');
  if(u.pathname==='/manage/fieldDetail/queryFieldReserveSituationIsFull')return respond({code:0,data:[{date:fixtureDate,dateId:'d1'}]},'application/json');
  if(u.pathname==='/manage/fieldDetail/queryFieldSituation'){
   const input=JSON.parse(route.request().postData());if(input.date!==fixtureDate||input.dateId!=='d1'||input.fieldType!=='tennis'||input.venueId!=='hxm')return respond({code:500,msg:'wrong inventory scope'},'application/json');
   const prices=Array.from({length:15},()=>({status:-1,price:5}));prices[11]={status:0,price:5};prices[13]={status:state.extraSlot?0:-1,price:8};return respond({code:0,data:[{fieldId:'f2',fieldName:'场地2',priceList:prices}]},'application/json');
  }
  if(u.pathname==='/venue/personal/personalOrderlist')return respond({total:state.orders.length,records:state.orders},'application/json');
  if(u.pathname==='/test-paid'){state.orders.forEach(o=>o.orderstateid='1');return respond({code:0},'application/json');}
  if(u.pathname==='/test-payment-prepare'){await new Promise(resolve=>setTimeout(resolve,700));return respond({code:0},'application/json');}
  if(u.pathname==='/venue/personal/ConfirmOrder'){
   const data=JSON.parse(route.request().postData());state.submissions++;state.terms=data.terms;state.selected=data.spaces[0].subSitename.replace('场地','')+'/'+data.spaces[0].scheduleTime;
   state.orders=[{pOrderid:'o1',scDate:fixtureDate,orderstateid:'0',venuename:'胡晓明网球场',countprice:'5'}];return respond({code:0,data:'o1'},'application/json');
  }
  if(u.hostname==='sports.sjtu.edu.cn'){
   const html=options.free?sportsHtml.replace("d.querySelector('button').onclick=async()=>{await fetch('/test-payment-prepare');location.href='https://cwc2.jdcw.sjtu.edu.cn/payment/pay/pay.action';};","d.querySelector('button').onclick=async()=>{await fetch('/test-paid');location.hash='/paymentResult/1';};"):sportsHtml;
   return respond(state.loggedIn?html.replace('const noticeEnabled=false;',`const noticeEnabled=${!!options.notice};`):'<meta charset="utf-8"><div id="app"><button onclick="location.href=\'https://jaccount.sjtu.edu.cn/oauth2/authorize\'">校内人员登录</button></div><script>document.getElementById("app").__vue__={};</script>');
  }
  if(u.hostname==='cwc2.jdcw.sjtu.edu.cn'){
   if(u.pathname==='/qr'){state.confirmed=true;state.paymentMethod=u.searchParams.get('method');return respond('<meta charset="utf-8"><h1>微信支付</h1><p>剩余时间:598秒</p><canvas id="qrcode" width="220" height="220"></canvas><script>const c=document.querySelector("canvas").getContext("2d");c.fillStyle="white";c.fillRect(0,0,220,220);c.fillStyle="black";for(let y=0;y<21;y++)for(let x=0;x<21;x++)if((x*y+x+y)%3)c.fillRect(5+x*10,5+y*10,8,8);</script>');}
   return respond('<meta charset="utf-8"><h1>上海交通大学 缴费系统</h1><label><input name="method" type="radio" value="wechat" checked>微信支付<img alt="微信支付"></label><label><input name="method" type="radio" value="alipay">支付宝</label><button onclick="if(confirm(\'是否确认支付？\'))location.href=\'/qr?method=\'+document.querySelector(\'input:checked\').value">下一步</button>');
  }
  return respond('');
 });
 // Observe requests separately; never forward them to real servers.
 context.on('request',request=>{const u=new URL(request.url());if(u.pathname==='/test-search')state.portalSearch=u.searchParams.get('q');});
 return state;
}
module.exports={installRoutes,fixtureDate};
