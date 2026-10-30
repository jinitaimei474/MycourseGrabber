'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {renderTopic,renderIndex,imageURLs,plainText,localAsset}=require('./presentation.cjs');
const {SearchIndex}=require('./search.cjs');
const SOURCE='https://shuiyuan.sjtu.edu.cn',SCHEMA=1;
const validId=id=>Number.isSafeInteger(id)&&id>0;
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function rasterType(bytes){if(bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return 'png';if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'jpg';if(/^GIF8[79]a/.test(bytes.subarray(0,6).toString()))return 'gif';if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'webp';if(bytes.subarray(4,8).toString()==='ftyp'&&['avif','avis'].includes(bytes.subarray(8,12).toString()))return 'avif';return null;}
class Archive{
 constructor(root){this.root=root;this.records=new Map();this.searchIndex=null;}
 static async open(folder){
  const selected=await fs.realpath(folder);if(!(await fs.stat(selected)).isDirectory())throw Error('请选择项目文件夹');
  const root=path.basename(selected).toLowerCase()==='shuiyuan-archive'?selected:path.join(selected,'shuiyuan-archive');let exists=true;
  try{const st=await fs.lstat(root);if(st.isSymbolicLink()||!st.isDirectory())throw Error('资料库路径不能是链接或文件');}catch(e){if(e.code!=='ENOENT')throw e;exists=false;await fs.mkdir(root);}
  const archive=new Archive(root),marker=await archive.safe('project.json');let saved;
  try{saved=JSON.parse(await fs.readFile(marker,'utf8'));}catch(e){
   if(e.code!=='ENOENT')throw Error('资料库标识损坏，请检查 project.json');
   if(exists&&(await fs.readdir(root)).length)throw Error('该文件夹缺少资料库标识，请选择其他项目目录');
   saved={format:'sjtu-shuiyuan-archive',schema_version:SCHEMA,source:SOURCE,created_at:new Date().toISOString()};await archive.atomic('project.json',JSON.stringify(saved,null,2));
  }
  if(saved.format!=='sjtu-shuiyuan-archive'||saved.schema_version!==SCHEMA||saved.source!==SOURCE)throw Error('不支持的资料库版本或来源');
  const topics=await archive.safe('topics',true);
  for(const item of await fs.readdir(topics,{withFileTypes:true})){if(!/^\d+$/.test(item.name))continue;const id=Number(item.name);if(!validId(id))continue;const data=await archive.readTopic(id);if(data){const view=renderTopic(data);await archive.atomic(`topics/${id}/post.md`,view.md);await archive.atomic(`topics/${id}/post.html`,view.html);archive.remember(data);}}
  await archive.writeIndex();return archive;
 }
 async safe(relative,directory=false){
  if(path.isAbsolute(relative)||relative.split(/[\\/]/).some(x=>x==='..'||!x))throw Error('无效的资料库路径');
  const actual=await fs.realpath(this.root);if(actual.toLowerCase()!==this.root.toLowerCase()||(await fs.lstat(this.root)).isSymbolicLink())throw Error('资料库路径已改变或是链接');
  const parts=relative.split(/[\\/]/);let target=this.root;
  for(let i=0;i<parts.length;i++){
   target=path.join(target,parts[i]);const needDir=i<parts.length-1||directory;
   try{const st=await fs.lstat(target);if(st.isSymbolicLink())throw Error('资料库路径包含链接，已停止写入');if(needDir&&!st.isDirectory())throw Error('资料库目录被文件占用');if(!needDir&&!st.isFile())throw Error('资料库文件路径异常');}
   catch(e){if(e.code!=='ENOENT')throw e;if(needDir)await fs.mkdir(target);}
  }
  return target;
 }
 async atomic(relative,content,backup=false){
  const target=await this.safe(relative),temporary=await this.safe(relative+'.tmp-'+crypto.randomUUID());
  await fs.writeFile(temporary,content,{flag:'wx'});
  try{if(backup){const bak=await this.safe(relative+'.bak');try{await fs.copyFile(target,bak);}catch(e){if(e.code!=='ENOENT')throw e;}}await fs.rename(temporary,target);}
  finally{await fs.unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 }
 async readTopic(id){
  if(!validId(id))throw Error('帖子编号无效');const file=await this.safe(`topics/${id}/topic.json`);
  let data;try{data=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw Error(`帖子 #${id} 的记录读取失败或损坏；原文件已保留，可检查 .bak 备份`);}
  if(data.schema_version!==SCHEMA||data.source!==SOURCE||data.topic_id!==id||!Array.isArray(data.posts)||data.posts.some(p=>!validId(p.post_id)||typeof p.username!=='string'||typeof p.created_at!=='string'))throw Error(`帖子 #${id} 的记录损坏或版本不支持`);
  return data;
 }
 remember(data){this.records.set(data.topic_id,{topic_id:data.topic_id,title:data.title,category:data.category,tags:data.tags,post_count:data.posts.length,last_saved_at:data.last_saved_at,complete:!!data.last_run.complete});this.searchIndex?.upsert(data);}
 close(){this.searchIndex?.close();this.searchIndex=null;}
 async ensureSearch(){if(this.searchIndex)return;const index=new SearchIndex();try{for(const id of this.records.keys()){const data=await this.readTopic(id);if(!data)throw Error('项目内容已变化，请重新选择项目');index.upsert(data);}this.searchIndex=index;}catch(error){index.close();throw error;}}
 async search(input){await this.ensureSearch();return this.searchIndex.search(input);}
 async facets(){await this.ensureSearch();return this.searchIndex.facets();}
 async postPath(topicId,postId){if(!validId(topicId)||!validId(postId))throw Error('楼层编号无效');const topic=await this.readTopic(topicId);if(!topic?.posts.some(p=>p.post_id===postId))throw Error('该楼层不在当前资料库中');return {file:await this.safe(`topics/${topicId}/post.html`),hash:`post-${postId}`};}
 summary(){return {folder:this.root,topic_count:this.records.size,topics:[...this.records.values()].sort((a,b)=>b.last_saved_at.localeCompare(a.last_saved_at))};}
 async writeIndex(){const list=this.summary();await this.atomic('index.json',JSON.stringify({schema_version:SCHEMA,source:SOURCE,topics:list.topics},null,2));await this.atomic('index.html',renderIndex(list.topics));}
 async save(result,{fetchImage,signal}={}){
  const id=result.topic_id;if(!validId(id)||!Array.isArray(result.posts))throw Error('采集记录无效');
  const old=await this.readTopic(id),now=new Date().toISOString(),map=new Map((old?.posts||[]).map(p=>[p.post_id,p]));
  const stats={topic_id:id,existing:!!old,added:0,updated:0,unchanged:0,total:0,images:0,warnings:[]};
  for(const p of result.posts){
   if(!validId(p.post_id)||!validId(p.post_number)||typeof p.username!=='string'||!Number.isFinite(Date.parse(p.created_at)))throw Error('楼层缺少有效编号、作者或时间');
   const digest=hash(JSON.stringify([p.raw,p.cooked,p.username,p.created_at,p.updated_at]));const previous=map.get(p.post_id);
   if(!previous)stats.added++;else if(previous.content_hash!==digest)stats.updated++;else stats.unchanged++;
   map.set(p.post_id,{...p,content_hash:digest,text:p.cooked?plainText(p.cooked):(p.raw||''),first_seen_at:previous?.first_seen_at||now,last_seen_at:now});
  }
  const posts=[...map.values()].sort((a,b)=>a.post_number-b.post_number);const assets={...old?.assets};let used=0,attempts=0;
  for(const url of imageURLs(posts)){
   const cached=localAsset(assets[url]);if(cached){try{await fs.access(await this.safe(`topics/${id}/${cached}`));continue;}catch(e){if(e.code!=='ENOENT')throw e;}}
   delete assets[url];const address=new URL(url);
   if(address.origin!==SOURCE||!/^\/(?:uploads|user_avatar|images)\//.test(address.pathname)){stats.warnings.push(`${url}：外部或非图片目录资源，保留原链接`);continue;}
   if(!fetchImage||signal?.aborted||attempts>=100||used>=100*1024*1024){stats.warnings.push(`${url}：未下载（停止、无连接或达到本次资源上限）`);continue;}
   attempts++;
   try{
    const image=await fetchImage(url,signal),bytes=Buffer.from(image.bytes),ext=rasterType(bytes);
    if(!ext||bytes.length>10*1024*1024||used+bytes.length>100*1024*1024)throw Error('图片格式不支持或大小超限');
    const name=`assets/${hash(bytes)}.${ext}`;await this.atomic(`topics/${id}/${name}`,bytes);assets[url]=name;used+=bytes.length;stats.images++;
   }catch(error){stats.warnings.push(`${url}：${String(error.message).slice(0,160)}`);}
  }
  const run={at:now,filter:result.filter,complete:result.complete,cancelled:!!result.cancelled,error:result.error||'',scanned:result.scanned,expected:result.expected,matched:result.posts.length,missing_ids:result.missing_ids||[],invalid_ids:result.invalid_ids||[],added:stats.added,updated:stats.updated,unchanged:stats.unchanged};
  const data={schema_version:SCHEMA,source:SOURCE,topic_id:id,title:result.title||old?.title||`主题 ${id}`,url:`${SOURCE}/t/${id}`,category:result.category||old?.category||'',category_id:result.category_id??old?.category_id,tags:result.tags||old?.tags||[],owner:result.owner||old?.owner||'',first_saved_at:old?.first_saved_at||now,last_saved_at:now,last_run:run,runs:[...(old?.runs||[]),run].slice(-50),assets,resource_warnings:stats.warnings,posts};
  const view=renderTopic(data);
  await this.atomic(`topics/${id}/topic.json`,JSON.stringify(data,null,2),!!old);
  // JSON is authoritative. Derived files and the index can always be rebuilt.
  await this.atomic(`topics/${id}/post.md`,view.md);await this.atomic(`topics/${id}/post.html`,view.html);
  this.remember(data);await this.writeIndex();stats.total=posts.length;return stats;
 }
 async indexPath(){return this.safe('index.html');}
}
module.exports={Archive,rasterType};
