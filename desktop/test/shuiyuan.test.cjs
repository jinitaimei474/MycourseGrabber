const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const file='../src/modules/shuiyuan/model.cjs';const m=fs.existsSync(require('node:path').join(__dirname,file))?require(file):{};
const categories=[{id:1,name:'校园'},{id:2,name:'选课',parent_category_id:1},{id:3,name:'生活'}];
test('owner search restricts to first posts; title and filters encode independently',()=>{
 const q=m.searchSpec({mode:'owner',query:'@Alice',category:'1',tag:'选课'},categories);
 assert.match(q.q,/in:first/);assert.match(q.q,/@Alice/);assert.match(q.q,/category:1/);assert.match(q.q,/tag:选课/);
 assert.doesNotMatch(q.q,/in:title/);assert.equal(q.owner,'alice');
 const title=m.searchSpec({mode:'title',query:'课程推荐'},categories);assert.match(title.q,/in:title/);
 assert.equal(m.searchSpec({mode:'id',query:'https://shuiyuan.sjtu.edu.cn/t/topic/123/45'},categories).id,123);
 assert.throws(()=>m.searchSpec({mode:'owner',query:'alice in:replies'},categories));
 assert.throws(()=>m.searchSpec({mode:'title',query:''},categories));
 assert.match(m.searchSpec({mode:'title',category:'2'},categories).q,/category:2/);
});
test('category includes descendants; tags and owner are exact, not reply authors',()=>{
 const filter=m.searchSpec({mode:'owner',query:'alice',category:'1',tag:'选课'},categories);
 assert.equal(m.topicMatches({category_id:2,tags:['选课'],owner:'ALICE'},filter,categories),true);
 assert.equal(m.topicMatches({category_id:3,tags:['选课'],owner:'alice'},filter,categories),false);
 assert.equal(m.topicMatches({category_id:2,tags:['选课经验'],owner:'alice'},filter,categories),false);
 assert.equal(m.topicMatches({category_id:2,tags:['选课'],owner:'bob'},filter,categories),false);
 const topic=m.topicSummary({id:1,title:'标题',category_id:2,tags:[{name:'选课'}]},[{topic_id:1,post_number:2,username:'intruder'},{topic_id:1,post_number:1,username:'alice'}],categories);
 assert.equal(topic.owner,'alice');assert.equal(topic.category,'校园 / 选课');assert.deepEqual(topic.tags,['选课']);
});
test('grouped tag metadata is deduplicated and exported completeness is explicit',()=>{
 assert.deepEqual(m.tagNames({tags:[{name:'a'}],extras:{tag_groups:[{tags:[{name:'b'},{name:'a'}]}]}}),['a','b']);
 const text=m.exportText({complete:false,cancelled:true,topics:[{topic_id:1,title:'测试',category:'校园',tags:['选课'],posts:[{username:'alice',post_number:1,created_at_beijing:'2026-09-21 12:00:00 +08:00',raw:'正文',url:'x'}],complete:true,scanned:1,expected:1,filter:{users:[],start:'',end:''},missing_ids:[],invalid_ids:[],url:'x',error:''}],requested_ids:[1,2],error:'已停止'});
 assert.match(text,/未完成/);assert.match(text,/2026-09-21 12:00:00/);assert.match(text,/选课/);assert.match(text,/正文/);
});
