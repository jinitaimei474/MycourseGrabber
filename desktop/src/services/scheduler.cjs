'use strict';
const {EventEmitter}=require('node:events');
const {validateConfig,safeError,wait}=require('./model.cjs');
class Scheduler extends EventEmitter{
  constructor({store,browser,now=Date.now,sleep=wait}){super();Object.assign(this,{store,browser,now,sleep});this.controller=null;this.status={phase:'idle',message:'添加课程后即可开始'};}
  update(phase,message){this.status={phase,message};this.emit('update',this.status);}
  stop(){this.controller?.abort();this.browser.cancel?.().catch(()=>{});}
  async start(){
    if(this.controller)throw Error('任务正在运行');
    const snapshot=this.store.view(),c=validateConfig(snapshot.config),targets=snapshot.targets;
    if(!targets.length)throw Error('请先添加课程');if(c.endAt<=this.now())throw Error('结束时间已经过去');
    this.controller=new AbortController();const signal=this.controller.signal;
    const expired=()=>this.now()>=c.endAt;
    const checkpoint=()=>{if(signal.aborted)throw Error('已停止');};
    let reloadAt=this.now()+(c.reloadMinutes?c.reloadMinutes*60000:Infinity);
    const complete=()=>targets.every(t=>this.store.progress(t).state==='success');
    const identity=async()=>{const session=await this.browser.ensureCourse(signal,c.endAt);checkpoint();if(session.owner!==snapshot.owner){const error=Error('登录账户已改变，请停止并重新连接、核对课程');error.attention=true;throw error;}};
    const reload=async()=>{if(this.now()<reloadAt||expired())return;if(!await this.browser.canReload())return;checkpoint();await this.browser.reload(signal,c.endAt);await identity();reloadAt=this.now()+c.reloadMinutes*60000;this.update('running','页面已刷新，继续原任务');};
    try{
      this.update('running','正在检查登录和任务');await identity();
      while(this.now()<c.startAt){checkpoint();this.update('waiting',`等待开始 · ${Math.ceil((c.startAt-this.now())/1000)} 秒`);await reload();await this.sleep(Math.min(1000,c.startAt-this.now()),signal);}
      while(!expired()){
        checkpoint();if(complete())break;await identity();if(expired())break;await reload();
        for(const group of targets){
          checkpoint();if(expired())break;if(this.store.progress(group).state==='success')continue;await identity();checkpoint();if(expired())break;
          let selected=false;for(const target of group.candidates){try{if((await this.browser.inspect(target)).state==='selected'){selected=true;break;}}catch{}}
          if(selected){this.store.mark(group,'success','已在网站已选列表核实');this.update('running','已核实一门课程');continue;}
          if(this.store.progress(group).state==='uncertain')continue;
          for(const target of group.candidates){
            checkpoint();if(expired())break;let submitting=false;
            this.store.mark(group,'checking',`正在查询 ${target.keyword} · ${target.teacher}`,{attempts:this.store.progress(group).attempts+1});this.update('running',`正在查询 ${target.keyword}`);
            try{
              await this.browser.prepare(target,signal,c.endAt);checkpoint();if(expired())break;
              const fresh=await this.browser.refresh(target,signal,c.endAt);checkpoint();if(expired())break;
              let result=fresh.state;
              if(result==='available'){
                await identity();checkpoint();if(expired())break;
                this.store.mark(group,'uncertain','提交结果待核对');this.update('running',`正在选择 ${target.keyword} · ${target.teacher}`);
                checkpoint();if(expired())break;submitting=true;
                result=(await this.browser.submit(target,signal,c.endAt)).state;
              }
              if(result==='success'||result==='selected')this.store.mark(group,'success',`已选上 ${target.className} · ${target.teacher}`);
              else if(result==='unknown')this.store.mark(group,'uncertain','提交结果不明，请核对网站已选列表');
              else this.store.mark(group,'waiting',result==='full'?'已满，等待下一轮查询':'暂不可选，请留意学校页面提示');
            }catch(error){this.store.mark(group,submitting?'uncertain':'waiting',safeError(error));if(error.attention)throw error;}
            this.update('running',this.store.progress(group).message);
            if(['success','uncertain'].includes(this.store.progress(group).state))break;
          }
          checkpoint();if(!complete())await reload();
        }
        if(complete()||expired())break;
        this.update('running','本轮完成，等待下一轮');await this.sleep(Math.min(c.intervalMs,c.endAt-this.now()),signal);
      }
      checkpoint();this.update(complete()?'success':'expired',complete()?'全部课程已完成，请核对已选列表':'已到结束时间，停止开始新的操作');
    }catch(error){this.update(signal.aborted?'stopped':expired()?'expired':'attention',signal.aborted?'已停止；请核对已经提交的课程':safeError(error));}
    finally{this.controller=null;this.emit('update',this.status);}
  }
}
module.exports={Scheduler};
