'use strict';
const {EventEmitter}=require('node:events');
const core=require('../../../vendor/shuiyuan-core.js');
const {guard}=require('../../services/model.cjs');
const {searchSpec,categoryName,topicSummary,topicMatches,tagNames,plainText,exportText}=require('./model.cjs');
const ORIGIN=core.ORIGIN;
class ShuiyuanService extends EventEmitter{
  constructor({browser,interval=1000}){
    super();this.browser=browser;this.page=null;this.sequence=0;this.username='';this.connected=false;
    this.categories=[];this.tags=[];this.topics=[];this.more=false;this.searchPage=0;this.spec=null;this.result=null;this.progress=null;this.message='首次连接后，在专用 Edge 中完成水源登录。';
    this.client=core.createClient({metadata:true,interval,fetchImpl:(url,options)=>this.fetch(url,options),onWait:message=>this.note(message)});
  }
  note(message){this.message=message;this.emit('update');}
  view(){
    const r=this.result;
    return {connected:this.connected,username:this.username,categories:this.categories.map(c=>({id:c.id,name:categoryName(c.id,this.categories)})),tags:this.tags,topics:this.topics,more:this.more,message:this.message,progress:this.progress,
      result:r?{complete:r.complete,cancelled:r.cancelled,processed:r.topics.length,requested:r.requested_ids.length,count:r.topics.reduce((n,t)=>n+t.posts.length,0),error:r.error,preview:r.topics.flatMap(t=>t.posts.slice(0,30).map(p=>({topic:t.title,username:p.username,time:p.created_at_beijing,post_number:p.post_number,content:(p.raw??plainText(p.cooked)).slice(0,3000)}))).slice(0,30)}:null};
  }
  async fetch(url,{signal}={}){
    const address=new URL(url);if(address.origin!==ORIGIN||!/^\/(?:t\/\d+(?:\/posts)?\.json|search\.json|site\.json|tags\.json|session\/current\.json)$/.test(address.pathname))throw Error('不允许的水源请求');
    guard(signal);const page=this.page;if(!page||page.isClosed()||new URL(page.url()).origin!==ORIGIN)throw Error('请在 Edge 中完成水源登录，然后重新连接');
    const id=++this.sequence;
    const abort=()=>page.evaluate(id=>{const b=window.__SJTUShuiyuanRequests;if(b){b.cancelled=Math.max(b.cancelled,id);b.active?.abort();}},id).catch(()=>{});
    signal?.addEventListener('abort',abort,{once:true});
    try{
      const data=await page.evaluate(async({url,id,origin})=>{
        if(window.location.origin!==origin)throw Error('水源登录已失效');
        const b=window.__SJTUShuiyuanRequests??={cancelled:0,active:null};if(id<=b.cancelled)throw Error('已停止');
        const controller=new AbortController();b.active=controller;
        try{const r=await fetch(url,{credentials:'same-origin',headers:{Accept:'application/json','X-Requested-With':'XMLHttpRequest'},signal:controller.signal});return {status:r.status,url:r.url,headers:Object.fromEntries(r.headers),body:await r.text()};}
        finally{b.active=null;}
      },{url,id,origin:ORIGIN});
      guard(signal);
      return {ok:data.status>=200&&data.status<300,status:data.status,url:data.url,headers:new Headers(data.headers),json:async()=>JSON.parse(data.body)};
    }finally{signal?.removeEventListener('abort',abort);}
  }
  async connect(signal){
    this.connected=false;this.note('正在连接水源……');await this.browser.launch(signal,Date.now()+30000);guard(signal);
    if(!this.page||this.page.isClosed()){
      this.page=this.browser.context.pages().find(p=>p.url().startsWith(ORIGIN+'/'))||await this.browser.context.newPage();
      await this.page.goto(ORIGIN+'/',{waitUntil:'domcontentloaded',timeout:30000});
    }
    if(new URL(this.page.url()).origin!==ORIGIN){await this.page.bringToFront();throw Error('请在打开的 Edge 窗口完成水源登录，再点击“连接水源”');}
    const data=await this.client.get('/session/current.json',{signal});const name=data.current_user?.username;
    if(!name)throw Error('请先在 Edge 中登录水源');
    if(this.username&&this.username!==name){this.topics=[];this.result=null;this.spec=null;this.more=false;}
    this.username=name;
    const site=await this.client.get('/site.json',{signal});if(!Array.isArray(site.categories))throw Error('无法读取水源类别');this.categories=site.categories;
    let tagWarning='';this.tags=[];
    try{this.tags=tagNames(await this.client.get('/tags.json',{signal}));}catch(error){guard(signal);tagWarning='；标签列表暂不可用，可手动填写标签';}
    guard(signal);this.connected=true;this.note(`已连接水源 · @${name}${tagWarning}`);
  }
  async checkSession(signal){
    if(!this.connected)throw Error('请先连接水源');
    try{const data=await this.client.get('/session/current.json',{signal});if(data.current_user?.username!==this.username){this.topics=[];this.result=null;this.more=false;this.spec=null;throw Error('水源账号已变化，请重新连接');}}
    catch(error){this.connected=false;throw error;}
  }
  async search(input,signal){
    await this.checkSession(signal);
    const more=Boolean(input.more);let spec;
    if(more){if(!this.more||!this.spec)throw Error('没有更多搜索结果');spec=this.spec;}else{spec=searchSpec(input,this.categories);}
    const page=more?this.searchPage+1:1;this.note('正在查找主题……');
    let topics,hasMore=false;
    if(spec.id){const data=await this.client.get(`/t/${spec.id}.json`,{signal});topics=[topicSummary(data,[],this.categories)];}
    else{
      const params=new URLSearchParams({q:spec.q,page:String(page)});const data=await this.client.get('/search.json?'+params,{signal});
      if(!Array.isArray(data.topics))throw Error('搜索接口未返回主题列表');
      topics=data.topics.map(t=>topicSummary(t,data.posts||[],this.categories));hasMore=Boolean(data.grouped_search_result?.more_full_page_results);
    }
    guard(signal);topics=topics.filter(t=>topicMatches(t,spec,this.categories));
    this.topics=[...new Map([...(more?this.topics:[]),...topics].map(t=>[t.id,t])).values()];this.spec=spec;this.searchPage=page;this.more=hasMore;
    this.note(`找到 ${this.topics.length} 个主题${hasMore?'，可继续加载更多':'（本次搜索已返回全部候选）'}。请选择要采集的帖子。`);
  }
  async crawl(input,signal){
    const ids=[...new Set(input.ids||[])];if(!ids.length||ids.length>50||ids.some(id=>!Number.isSafeInteger(id)||!this.topics.some(t=>t.id===id)))throw Error('请从搜索结果选择 1–50 个帖子');
    const filter=core.makeFilter(input.users,input.start,input.end);await this.checkSession(signal);
    const r=this.result={requested_ids:ids,started_at:new Date().toISOString(),complete:false,cancelled:false,error:'',topics:[]};
    try{
      for(const id of ids){
        guard(signal);await this.checkSession(signal);const topic=this.topics.find(t=>t.id===id);
        const result=await core.crawl(this.client,id,filter,{signal,onProgress:p=>{this.progress={...p,topic:id,done:r.topics.length,total:ids.length};this.note(`主题 ${r.topics.length+1}/${ids.length} · 已读取 ${p.scanned}/${p.expected} 楼，匹配 ${p.matched} 条`);}});
        Object.assign(result,{category:topic.category,category_id:topic.category_id,tags:topic.tags,owner:topic.owner});r.topics.push(result);
        if(result.cancelled){r.cancelled=true;break;}
        if(result.error){r.error=result.error;break;}
      }
      r.complete=r.topics.length===ids.length&&r.topics.every(t=>t.complete)&&!signal?.aborted;
    }catch(error){r.error=error.message;}
    r.cancelled||=Boolean(signal?.aborted);r.finished_at=new Date().toISOString();this.progress=null;
    if(this.result!==r)throw Error('水源账号已变化，已清空旧账号的采集结果');
    const count=r.topics.reduce((n,t)=>n+t.posts.length,0);
    this.note(`${r.complete?'采集完成':r.cancelled?'已停止，保留部分结果':'采集未完成'}：处理 ${r.topics.length}/${ids.length} 个帖子，匹配 ${count} 条发言。${r.error?' '+r.error:''}`);
  }
  export(format){if(!this.result)throw Error('请先采集内容');if(!['txt','json'].includes(format))throw Error('不支持的导出格式');return format==='json'?JSON.stringify(this.result,null,2):'\uFEFF'+exportText(this.result);}
  async show(){if(this.page&&!this.page.isClosed())await this.page.bringToFront();else throw Error('请先连接水源');}
}
module.exports={ShuiyuanService};
