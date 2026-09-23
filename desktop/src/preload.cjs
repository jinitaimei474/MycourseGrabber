const {contextBridge,ipcRenderer}=require('electron');
const actions=new Set(['snapshot','connect','search','add','remove','configure','start','stop','retry','showBrowser','shuiyuanConnect','shuiyuanSearch','shuiyuanCrawl','shuiyuanStop','shuiyuanShow','shuiyuanExport']);
contextBridge.exposeInMainWorld('assistant',{
  invoke:(action,payload)=>{if(!actions.has(action))return Promise.reject(Error('不支持的操作'));return ipcRenderer.invoke('assistant:command',action,payload).then(result=>{if(!result.ok)throw Error(result.error);return result.data;});},
  onState:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('assistant:state',listener);return ()=>ipcRenderer.removeListener('assistant:state',listener);}
});
