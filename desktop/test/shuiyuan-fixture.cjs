'use strict';
const categories=[{id:1,name:'校园生活'},{id:2,name:'课程交流',parent_category_id:1},{id:3,name:'闲聊'}];
const post=(topic,id)=>({id:topic*100+id,topic_id:topic,post_number:id,username:id%2?'alice':'bob',created_at:id===1?'2026-09-20T15:59:59.000Z':'2026-09-20T16:00:00.000Z',raw:`第 ${id} 楼正文 <img src=x onerror=alert(1)>`,cooked:`<p>第 ${id} 楼正文</p>`});
const topic=(id,count=45)=>({id,title:id===101?'新学期选课经验与课程推荐':'校园讨论 '+id,category_id:id===102?3:2,tags:['选课','经验分享'],posts_count:count,created_at:'2026-09-20T15:59:59Z',details:{created_by:{username:id===102?'bob':'alice'}}});
async function installRoutes(context,options={}){
 const makePost=(topicId,id)=>{const p=post(topicId,id);if(options.richPost&&topicId===101&&id===3)p.cooked='<p><strong>课程经验</strong>和本地图片</p><blockquote>引用内容</blockquote><table><thead><tr><th>课程</th><th>建议</th></tr></thead><tbody><tr><td>高数</td><td>先做例题</td></tr></tbody></table><pre><code class="lang-js">const hours = 2;</code></pre><a class="lightbox" href="/uploads/test.png"><img alt="离线测试图" width="100" height="100" src="/uploads/missing-thumb.png"></a>';return p;};
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());options.requests?.push(url.pathname+url.search);options.onRequest?.(url);
  if(url.hostname!=='shuiyuan.sjtu.edu.cn')return route.abort();
  if(url.pathname==='/uploads/test.png')return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7p8AAAAASUVORK5CYII=','base64')});
  let body;
  if(url.pathname==='/session/current.json')body={current_user:{username:options.username?.()||'test-user'}};
  else if(url.pathname==='/site.json')body={categories};
  else if(url.pathname==='/tags.json')body={tags:[{name:'选课'},{name:'经验分享'}]};
  else if(url.pathname==='/search.json'){
   const page=Number(url.searchParams.get('page'));body={topics:page===1?[topic(101),topic(102,1)]:[topic(101),topic(103,1)],posts:[{...post(101,1)},{...post(102,1),username:'bob'},post(103,1)],grouped_search_result:{more_full_page_results:page===1}};
  }else if(/^\/t\/\d+\.json$/.test(url.pathname)){
   const id=Number(url.pathname.match(/\d+/)[0]),count=id===101?45:1;body={...topic(id,count),post_stream:{stream:Array.from({length:count},(_,i)=>id*100+i+1),posts:[post(id,1)]}};
  }else if(/^\/t\/\d+\/posts.json$/.test(url.pathname)){
   if(options.delayBatch)await new Promise(r=>setTimeout(r,options.delayBatch));
   const topicId=Number(url.pathname.match(/\d+/)[0]);body={post_stream:{posts:url.searchParams.getAll('post_ids[]').map(id=>makePost(topicId,Number(id)%100))}};
  }else return route.fulfill({contentType:'text/html',body:'<!doctype html><title>水源模拟页面</title><h1>Offline Shuiyuan</h1>'});
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)}).catch(()=>{});
 });
}
module.exports={installRoutes,categories,post,topic};
