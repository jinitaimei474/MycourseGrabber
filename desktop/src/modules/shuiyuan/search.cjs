'use strict';
const {DatabaseSync}=require('node:sqlite');
const {makeFilter,beijing}=require('../../../vendor/shuiyuan-core.js');
const {plainText}=require('./presentation.cjs');
const fold=value=>String(value??'').normalize('NFKC').toLowerCase();
function snippet(text,terms){const normalized=fold(text);const positions=terms.map(t=>normalized.indexOf(t)).filter(n=>n>=0);const at=positions.length?Math.min(...positions):0,start=Math.max(0,at-70);return (start?'…':'')+text.slice(start,start+320)+(text.length>start+320?'…':'');}
class SearchIndex{
 constructor(){
  this.db=new DatabaseSync(':memory:');
  this.db.exec(`CREATE TABLE topics(id INTEGER PRIMARY KEY,title TEXT,category_id TEXT,category TEXT);
   CREATE TABLE tags(topic_id INTEGER,tag TEXT,PRIMARY KEY(topic_id,tag));
   CREATE TABLE posts(rowid INTEGER PRIMARY KEY,topic_id INTEGER,post_id INTEGER,post_number INTEGER,username TEXT,author TEXT,created_at TEXT,created_ms REAL,body TEXT,search_text TEXT,UNIQUE(topic_id,post_id));
   CREATE INDEX posts_time ON posts(created_ms DESC);CREATE INDEX posts_author ON posts(author);CREATE INDEX tags_name ON tags(tag);
   CREATE VIRTUAL TABLE bodies USING fts5(search_text,content=posts,content_rowid=rowid,tokenize=trigram);
   CREATE TRIGGER posts_insert AFTER INSERT ON posts BEGIN INSERT INTO bodies(rowid,search_text) VALUES(new.rowid,new.search_text); END;
   CREATE TRIGGER posts_update AFTER UPDATE ON posts BEGIN INSERT INTO bodies(bodies,rowid,search_text) VALUES('delete',old.rowid,old.search_text); INSERT INTO bodies(rowid,search_text) VALUES(new.rowid,new.search_text); END;`);
 }
 close(){if(this.db){this.db.close();this.db=null;}}
 upsert(topic){
  const db=this.db;db.exec('BEGIN');
  try{
   db.prepare('INSERT INTO topics VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,category_id=excluded.category_id,category=excluded.category').run(topic.topic_id,topic.title||'',String(topic.category_id??''),topic.category||'');
   db.prepare('DELETE FROM tags WHERE topic_id=?').run(topic.topic_id);const tag=db.prepare('INSERT OR IGNORE INTO tags VALUES(?,?)');for(const value of topic.tags||[])tag.run(topic.topic_id,String(value));
   const put=db.prepare(`INSERT INTO posts(topic_id,post_id,post_number,username,author,created_at,created_ms,body,search_text) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(topic_id,post_id) DO UPDATE SET post_number=excluded.post_number,username=excluded.username,author=excluded.author,created_at=excluded.created_at,created_ms=excluded.created_ms,body=excluded.body,search_text=excluded.search_text WHERE posts.body<>excluded.body OR posts.username<>excluded.username OR posts.created_at<>excluded.created_at OR posts.post_number<>excluded.post_number`);
   for(const p of topic.posts){const body=p.cooked?plainText(p.cooked):String(p.raw||p.text||'');put.run(topic.topic_id,p.post_id,p.post_number,p.username,fold(p.username),p.created_at,Date.parse(p.created_at),body,fold(body));}
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 facets(){return {authors:this.db.prepare('SELECT DISTINCT username FROM posts ORDER BY username').all().map(r=>r.username),categories:this.db.prepare("SELECT category_id AS id,MAX(category) AS name FROM topics WHERE category_id<>'' GROUP BY category_id ORDER BY name").all(),tags:this.db.prepare('SELECT DISTINCT tag FROM tags ORDER BY tag').all().map(r=>r.tag)};}
 search(input={}){
  const query=String(input.query||'').trim();if(query.length>500)throw Error('关键词最多 500 字');
  const terms=[...new Set(fold(query).split(/\s+/).filter(Boolean))];if(terms.length>20)throw Error('最多输入 20 个关键词');
  const filter=makeFilter(String(input.authors||''),String(input.start||''),String(input.end||''));if(filter.users.length>100)throw Error('作者筛选过多');
  const offset=Number(input.offset||0);if(!Number.isSafeInteger(offset)||offset<0)throw Error('无效的搜索页码');
  const where=[],args=[],long=terms.filter(t=>[...t].length>=3);
  if(long.length){where.push('p.rowid IN (SELECT rowid FROM bodies WHERE bodies MATCH ?)');args.push(long.map(t=>'"'+t.replace(/"/g,'""')+'"').join(' AND '));}
  for(const term of terms){where.push('instr(p.search_text,?)>0');args.push(term);}
  if(filter.users.length){where.push(`p.author IN (${filter.users.map(()=>'?').join(',')})`);args.push(...filter.users.map(fold));}
  if(Number.isFinite(filter.from)){where.push('p.created_ms>=?');args.push(filter.from);}if(Number.isFinite(filter.to)){where.push('p.created_ms<=?');args.push(filter.to);}
  if(input.category){where.push('t.category_id=?');args.push(String(input.category));}if(input.tag){where.push('EXISTS(SELECT 1 FROM tags WHERE topic_id=t.id AND tag=?)');args.push(String(input.tag));}
  const from='FROM posts p JOIN topics t ON t.id=p.topic_id'+(where.length?' WHERE '+where.join(' AND '):'');
  const total=this.db.prepare('SELECT COUNT(*) AS n '+from).get(...args).n;
  const results=this.db.prepare('SELECT p.topic_id,p.post_id,p.post_number,p.username,p.created_at,p.body,t.title,t.category '+from+' ORDER BY p.created_ms DESC,p.topic_id ASC,p.post_id ASC LIMIT 30 OFFSET ?').all(...args,offset).map(({body,...p})=>({...p,time:beijing(p.created_at),snippet:snippet(body,terms)}));
  return {total,offset,limit:30,more:offset+results.length<total,query,results};
 }
}
module.exports={SearchIndex};
