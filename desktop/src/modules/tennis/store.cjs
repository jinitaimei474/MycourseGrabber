'use strict';
const fs=require('node:fs'),path=require('node:path');const {validateConfig,candidateCopy,dateValue}=require('./model.cjs');
class TennisStore{
 constructor(file){this.file=file;this.warning='';this.data={version:1,config:null,records:[]};
  if(fs.existsSync(file))try{const d=JSON.parse(fs.readFileSync(file,'utf8'));if(d.version!==1||!Array.isArray(d.records))throw Error('format');
   this.data={version:1,config:d.config?validateConfig(d.config):null,records:d.records.map(r=>this.copy(r))};
   for(const r of this.data.records)if(r.state==='submitting')r.state='uncertain';
  }catch{this.warning='网球预约记录无法读取。为避免重复订单，请先修复或备份本机 tennis.json 后重新打开软件。';}
 }
 copy(r){dateValue(r.date);if(!r.owner||!['submitting','uncertain','awaiting_payment','success','cancelled'].includes(r.state))throw Error('记录无效');
  const o={owner:String(r.owner),date:r.date,state:r.state,updatedAt:Number(r.updatedAt)||Date.now()};
  if(r.candidate)o.candidate=candidateCopy(r.candidate);
  for(const k of ['orderId','message','amount','status','venue','qrFile'])if(typeof r[k]==='string')o[k]=r[k].slice(0,1000);
  if(Number.isFinite(r.expiresAt))o.expiresAt=r.expiresAt;return o;
 }
 assert(){if(this.warning)throw Error(this.warning);}
 save(){this.assert();fs.mkdirSync(path.dirname(this.file),{recursive:true});const temp=this.file+'.tmp';fs.writeFileSync(temp,JSON.stringify(this.data,null,2),{mode:0o600});fs.renameSync(temp,this.file);}
 configure(c){this.assert();this.data.config=validateConfig(c);this.save();}
 get(owner,date){return structuredClone(this.data.records.find(r=>r.owner===owner&&r.date===date)||null);}
 mark(owner,date,value){this.assert();const item=this.copy({...this.get(owner,date),...value,owner,date,updatedAt:Date.now()});this.data.records=this.data.records.filter(r=>r.owner!==owner||r.date!==date);this.data.records.push(item);this.save();return item;}
 clear(owner,date){this.assert();this.data.records=this.data.records.filter(r=>r.owner!==owner||r.date!==date);this.save();}
 view(owner){return {config:structuredClone(this.data.config),records:structuredClone(this.data.records.filter(r=>r.owner===owner)),warning:this.warning};}
}
module.exports={TennisStore};
