'use strict';
const fs=require('node:fs');const path=require('node:path');
const {targetCopy,keyOf,validateConfig}=require('./model.cjs');
class Store{
  constructor(file){this.file=file;this.warning='';this.data={version:1,owner:'',targets:[],progress:{},config:{startAt:Date.now()+60000,endAt:Date.now()+3600000,intervalMs:5000,reloadMinutes:60}};
    if(fs.existsSync(file))try{
      const raw=JSON.parse(fs.readFileSync(file,'utf8'));if(raw.version!==1||typeof raw.owner!=='string'||!Array.isArray(raw.targets)||raw.targets.length>10)throw Error('bad record');
      const targets=raw.targets.map(group=>({...targetCopy(group),candidates:group.candidates.map(targetCopy)}));
      if(new Set(targets.map(x=>x.kchId)).size!==targets.length)throw Error('duplicate courses');
      for(const group of targets)if(!group.candidates.length||group.candidates.some(x=>keyOf(x)!==keyOf(group)))throw Error('bad alternatives');
      this.data={version:1,owner:raw.owner,targets,progress:{},config:validateConfig(raw.config)};
      for(const group of targets){const item=raw.progress?.[keyOf(group)];if(item)this.data.progress[keyOf(group)]={state:['success','uncertain'].includes(item.state)?item.state:'pending',attempts:Number.isInteger(item.attempts)?item.attempts:0,message:String(item.message||'').slice(0,450)};}
    }catch{this.warning='任务记录无法读取，请重新添加课程。原文件将在下次保存时覆盖。';}
  }
  view(){return structuredClone(this.data);}
  save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.data,null,2),{mode:0o600});fs.renameSync(tmp,this.file);}
  setOwner(owner){if(!owner)throw Error('无法确认当前登录账户');if(this.data.owner!==owner){this.data.owner=owner;this.data.targets=[];this.data.progress={};this.save();return true;}return false;}
  add(input){if(!this.data.owner)throw Error('请先连接选课页面');const target=targetCopy(input),group=this.data.targets.find(x=>x.kchId===target.kchId);
    if(group){if(keyOf(group)!==keyOf(target))throw Error('不能混入不同学期的课程');if(!group.candidates.some(x=>x.jxbId===target.jxbId))group.candidates.push(target);}
    else{if(this.data.targets.length>=10)throw Error('最多添加 10 门课程');this.data.targets.push({...target,candidates:[target]});}this.save();}
  remove(kchId,jxbId){const group=this.data.targets.find(x=>x.kchId===kchId);if(!group)return;group.candidates=group.candidates.filter(x=>x.jxbId!==jxbId);this.data.targets=this.data.targets.filter(x=>x.candidates.length);this.save();}
  configure(input){const config={};for(const key of ['startAt','endAt','intervalMs','reloadMinutes'])config[key]=input[key];validateConfig(config);this.data.config=config;this.save();}
  progress(target){return this.data.progress[keyOf(target)]||{state:'pending',attempts:0,message:'等待开始'};}
  mark(target,state,message='',extra={}){this.data.progress[keyOf(target)]={...this.progress(target),...extra,state,message};this.save();}
  retry(kchId){const target=this.data.targets.find(x=>x.kchId===kchId);if(!target||this.progress(target).state!=='uncertain')throw Error('该课程无需解除待核对状态');this.mark(target,'pending','使用者已核对未选上，允许重试');}
}
module.exports={Store};
