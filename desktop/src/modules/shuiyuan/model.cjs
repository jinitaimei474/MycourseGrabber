'use strict';
const core=require('../../../vendor/shuiyuan-core.js');
function searchSpec(input={},categories=[]){
  const mode=input.mode||'title',query=String(input.query||'').trim();
  if(!['title','id','owner'].includes(mode)||query.length>200)throw Error('请选择检索方式，关键词最多 200 字');
  const category=String(input.category||''),tag=String(input.tag||'').trim();
  if(category&&!categories.some(c=>String(c.id)===category))throw Error('请选择有效的类别');
  if(tag&&!/^[\p{L}\p{M}\p{N}_-]{1,100}$/u.test(tag))throw Error('请输入或选择一个有效标签');
  const spec={mode,query,category,tag,owner:'',id:null,q:''},parts=['in:first','order:latest'];
  if(mode==='id'||mode==='title'&&/^(?:\d+$|https?:\/\/|\/t\/)/.test(query)){
    const target=core.parseTarget(query);if(!target.id)throw Error('请输入帖子编号或网址');spec.id=target.id;
  }else if(mode==='owner'){
    const owner=query.replace(/^@/,'');if(!/^[\p{L}\p{M}\p{N}_.-]{1,100}$/u.test(owner))throw Error('帖主请填写单个用户名，不是昵称');
    spec.owner=owner.toLowerCase();parts.push('@'+owner);
  }else if(query){parts.push(query.replace(/["\\:\r\n]/g,' '),'in:title');}
  if(category)parts.push('category:'+category);if(tag)parts.push('tag:'+tag);
  if(!query&&!category&&!tag)throw Error('请输入标题、编号、帖主，或选择类别/标签');
  spec.q=parts.join(' ');return spec;
}
function categoryName(id,categories){
  const names=[],seen=new Set();let c=categories.find(c=>c.id===id);
  while(c&&!seen.has(c.id)){seen.add(c.id);names.unshift(c.name);c=categories.find(x=>x.id===c.parent_category_id);}
  return names.join(' / ')||`类别 ${id??'未知'}`;
}
function topicSummary(t,posts=[],categories=[]){
  const first=(t.post_stream?.posts||posts).find(p=>(p.topic_id==null||p.topic_id===t.id)&&p.post_number===1);
  return {id:t.id,title:t.title||`主题 ${t.id}`,owner:t.details?.created_by?.username||first?.username||'',category_id:t.category_id,category:categoryName(t.category_id,categories),tags:(t.tags||[]).map(x=>typeof x==='string'?x:x.name).filter(Boolean),posts_count:t.posts_count||0,created_at:t.created_at||'',url:`${core.ORIGIN}/t/${t.id}`};
}
function topicMatches(t,spec,categories){
  if(spec.owner&&t.owner.toLowerCase()!==spec.owner)return false;
  if(spec.tag&&!t.tags.some(tag=>tag.toLowerCase()===spec.tag.toLowerCase()))return false;
  if(spec.category){const seen=new Set();let id=t.category_id;while(id!=null&&!seen.has(id)){if(String(id)===spec.category)return true;seen.add(id);id=categories.find(c=>c.id===id)?.parent_category_id;}return false;}
  return true;
}
function tagNames(data){return [...new Set([...(data.tags||[]),...(data.extras?.tag_groups||data.tag_groups||[]).flatMap(g=>g.tags||[])].map(t=>typeof t==='string'?t:t.name||t.id).filter(t=>typeof t==='string'))].sort((a,b)=>a.localeCompare(b,'zh-CN'));}
function plainText(html){return String(html).replace(/<\/(?:p|div|li|blockquote|pre|tr)>|<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '})[x]);}
function exportText(result){
  const lines=[`水源内容导出 · ${result.complete?'完整':'未完成'}`,`计划主题：${result.requested_ids.join(', ')}；已处理：${result.topics.length}`,`说明：${result.error||'无'}`,''];
  for(const t of result.topics)lines.push(`类别：${t.category}；标签：${t.tags.join('、')||'无'}；帖主：${t.owner||'未知'}`,core.toText(t,plainText),'');
  return lines.join('\n');
}
module.exports={searchSpec,categoryName,topicSummary,topicMatches,tagNames,plainText,exportText};
