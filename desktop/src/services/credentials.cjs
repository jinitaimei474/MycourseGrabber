'use strict';
const fs=require('node:fs'),path=require('node:path');
const empty=()=>({username:'',password:''});
function validate(input){
  if(!input||typeof input.username!=='string'||typeof input.password!=='string')throw Error('请输入账号和密码');
  const username=input.username.trim(),password=input.password;
  if(!username||username.length>200||!password||password.length>1000)throw Error('请输入有效的账号和密码（账号最多 200 字，密码最多 1000 字）');
  return {username,password};
}
class CredentialStore{
  constructor({file,secure,platform=process.platform}){this.file=file;this.secure=secure;this.platform=platform;this.value=empty();this.saved=false;this.warning='';}
  get(){return {...this.value};}
  view(){return {saved:this.saved,warning:this.warning};}
  async available(){
    if(this.platform!=='win32')throw Error('账号记忆目前仅支持 Windows');
    let available=false;try{available=await this.secure.isAsyncEncryptionAvailable();}catch{}
    if(!available)throw Error('Windows 加密暂不可用，请稍后重试；本次可手动填写');
  }
  async load(){
    this.value=empty();this.warning='';this.saved=false;
    try{
      const stat=fs.lstatSync(this.file);this.saved=true;
      if(!stat.isFile()||stat.size>32768)throw Error('Invalid credential file');
      await this.available();const data=JSON.parse(fs.readFileSync(this.file,'utf8'));
      if(data.version!==1||typeof data.ciphertext!=='string'||!data.ciphertext)throw Error('Invalid credential format');
      const decoded=await this.secure.decryptStringAsync(Buffer.from(data.ciphertext,'base64'));
      this.value=validate(JSON.parse(decoded.result));
    }catch(error){if(error.code!=='ENOENT')this.warning='已保存的账号无法读取，请重新填写并记住，或点击忘记账号密码。';}
  }
  async save(input){
    const value=validate(input);await this.available();let ciphertext;
    try{ciphertext=await this.secure.encryptStringAsync(JSON.stringify(value));}catch{throw Error('账号加密失败，未更改已保存的信息');}
    if(!Buffer.isBuffer(ciphertext)||!ciphertext.length)throw Error('账号加密失败，未更改已保存的信息');
    const temporary=this.file+'.tmp';let created=false;
    try{
      fs.mkdirSync(path.dirname(this.file),{recursive:true});
      if(fs.existsSync(this.file)&&!fs.lstatSync(this.file).isFile())throw Error('Invalid credential path');
      const fd=fs.openSync(temporary,'wx',0o600);created=true;
      try{fs.writeFileSync(fd,JSON.stringify({version:1,ciphertext:ciphertext.toString('base64')}),'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      fs.renameSync(temporary,this.file);created=false;
    }catch{throw Error('账号保存失败，未更改已保存的信息；请检查用户数据目录是否可写');}
    finally{if(created){try{fs.unlinkSync(temporary);}catch{}}}
    this.value=value;this.saved=true;this.warning='';
  }
  async forget(){
    for(const file of [this.file+'.tmp',this.file])try{fs.unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw Error('无法清除已保存的账号，请检查用户数据目录是否可写');}
    this.value=empty();this.saved=false;this.warning='';
  }
}
module.exports={CredentialStore};
