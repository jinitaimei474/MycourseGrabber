'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFile}=require('node:child_process');
const {guard}=require('./model.cjs');
async function recognize(imagePath,{signal,deadline=Infinity}={}){
  guard(signal,deadline);
  const script=fs.readFileSync(path.join(__dirname,'../../scripts/ocr.ps1'),'utf8');
  const escaped=path.resolve(imagePath).replace(/'/g,"''");
  const encoded=Buffer.from(`& {\n${script}\n} -ImagePath '${escaped}'`,'utf16le').toString('base64');
  const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const text=await new Promise((resolve,reject)=>execFile(powershell,['-NoProfile','-NonInteractive','-EncodedCommand',encoded],{windowsHide:true,timeout:Math.max(1,Math.min(15000,deadline-Date.now())),signal,maxBuffer:128*1024},(error,out)=>error?reject(Error(signal?.aborted?'已停止':'Windows 本地 OCR 不可用，请在 Edge 中手动完成验证码')):resolve(out)));
  const result=JSON.parse(text.replace(/^\uFEFF/,''));const code=String(result.text||'').replace(/\s/g,'');
  if(!/^[a-zA-Z0-9]{4,6}$/.test(code)){const error=Error('验证码识别不确定，请在 Edge 中输入验证码并登录，再点击连接');error.retryable=true;throw error;}
  return code;
}
module.exports={recognize};
