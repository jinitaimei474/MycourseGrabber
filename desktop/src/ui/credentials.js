'use strict';
(()=>{
 const $=id=>document.getElementById(id);let ready=false,working=false,state=null,dirty=false;
 const read=()=>({username:$('username').value,password:$('password').value});
 function render(next){
  state=next||state;const disabled=!ready||working||!!state?.busy;
  for(const id of ['username','password','remember-account','forget-account'])$(id).disabled=disabled;
  const info=state?.credentials;
  $('credential-status').textContent=info?.warning||(dirty?'账号已修改；点击“记住账号密码”保存，或仅在本次使用。':info?.saved?'已记住账号密码，下次启动自动填充。':'尚未记住账号密码，填写后可仅在本次使用。');
 }
 function error(error){$('credential-status').textContent=error.message;}
 async function change(action){
  working=true;render();
  try{state=await window.assistant.invoke(action,action==='credentialsSave'?read():undefined);if(action==='credentialsForget'){$('username').value='';$('password').value='';}dirty=false;working=false;render();}
  catch(e){working=false;render();error(e);}
 }
 $('remember-account').onclick=()=>change('credentialsSave');$('forget-account').onclick=()=>change('credentialsForget');
 for(const id of ['username','password'])$(id).addEventListener('input',()=>{dirty=true;render();});
 window.credentialsUI={read,render};render();
 window.assistant.invoke('credentialsLoad').then(value=>{if(!dirty){$('username').value=value.username;$('password').value=value.password;}}).catch(error).finally(()=>{ready=true;render();});
})();
