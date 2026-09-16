(async () => {
  'use strict';
  const api = window.SJTUCourseTimer, results = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  async function test(name, fn) {
    try { await fn(); results.push({name,passed:true}); }
    catch (error) { results.push({name,passed:false,error:error.message}); }
  }
  function fixture() {
    const doc = document.implementation.createHTMLDocument('fixture');
    doc.body.innerHTML = `<input id="xkxnm" value="2026"><input id="xkxqm" value="3"><input id="xklc" value="5"><input id="xkkz_id" value="control-a"><input id="kklxdm" value="01"><input id="iskxk" value="1"><input id="gnjkxdnj" value="0">
      <ul id="nav_tab"><li class="active"><a id="tab_kklx_a">A</a></li><li><a id="tab_kklx_b">B</a></li></ul>
      <div id="searchBox"><input name="searchInput"><button name="query">查询</button></div><div id="contentBox"></div><div id="choosedBox"></div>`;
    Object.defineProperty(doc,'visibilityState',{value:'hidden'});
    const effects = [], events = new Map(), requests = [];
    const jq = () => ({searchBox:()=>({searchInput:doc.querySelector('input[name="searchInput"]').value}),on:(event,fn)=>{if(!events.has(event))events.set(event,new Set());events.get(event).add(fn);},off:(event,fn)=>events.get(event)?.delete(fn)});
    jq.param = data => new URLSearchParams(data).toString();
    jq.active = 0;
    const win = {document:doc,jQuery:jq,location:{hostname:'i.sjtu.edu.cn',href:'https://i.sjtu.edu.cn/xsxk/zzxkyzb_cxZzxkYzbIndex.html'},getComputedStyle:window.getComputedStyle.bind(window),addEventListener:window.addEventListener.bind(window)};
    win.XMLHttpRequest = class {
      open(method,url,async) { this.method=method;this.url=url;this.async=async; }
      setRequestHeader() {}
      send(body) { this.body=body;requests.push(this);this.timer=setTimeout(()=>{this.status=200;this.responseText=JSON.stringify(win.response ? win.response(this) : [{jxb_id:new URLSearchParams(body).get('kch_id').replace('course-',''),yxzrs:'10',jxbrl:'20'}]);this.onload();},win.queryDelay || 20); }
      abort() { clearTimeout(this.timer);this.aborted=true;this.onabort?.(); }
    };
    function emit(path, data, body) {
      for (const listener of [...(events.get('ajaxComplete')||[])]) listener({}, {status:200,responseJSON:body}, {url:path,data:new URLSearchParams(data).toString()});
    }
    function render(id, kch) {
      doc.getElementById('contentBox').innerHTML = `<div class="panel-heading"><span id="kcmc_${kch}">(CODE${id})Course ${id}</span><input name="kch_id" value="${kch}"><input name="czzt" value="1"></div>
        <table><tbody><tr class="body_tr"><td class="jxb_id">${id}</td><td class="kch_id">${kch}</td><td class="do_jxb_id">op-${id}</td><td class="jxbzls">1</td><td class="jxbmc">Class ${id}</td><td class="jsxmzc">Teacher ${id}</td><td class="sksj">Monday</td><td class="rsxx"><span class="jxbrs">10</span>/<span class="jxbrl">20</span></td><td class="an"><button onclick="chooseCourseZzxk()">选课</button></td></tr></tbody></table>`;
      const button=doc.querySelector('.an button');
      button.addEventListener('click',()=>{effects.push(['submit',id]);setTimeout(()=>{
        emit('/xsxk/zzxkyzbjk_xkBcZyZzxkYzb.html',{kch_id:kch,jxb_ids:'wrong-op'},{flag:'1'});
        emit('/xsxk/zzxkyzbjk_xkBcZyZzxkYzb.html',{kch_id:kch,jxb_ids:`op-${id}`},{flag:win.submitFlag || '-1'});
      },1);});
    }
    render('a','course-a');
    win.loadJxbxxZzxk = heading => {const kch=heading.querySelector('input[name="kch_id"]').value;const id=doc.querySelector('.jxb_id').textContent;
      effects.push(['refresh',id]);setTimeout(()=>emit('/xsxk/zzxkyzbjk_cxJxbWithKchZzxkYzb.html',{kch_id:kch},[{jxb_id:id}]),1);};
    doc.getElementById('tab_kklx_b').addEventListener('click',()=>{
      effects.push(['category','b']);doc.getElementById('xkkz_id').value='control-b';doc.getElementById('kklxdm').value='10';
      doc.querySelector('#nav_tab li.active').classList.remove('active');doc.getElementById('tab_kklx_b').parentElement.classList.add('active');doc.getElementById('contentBox').replaceChildren();});
    doc.querySelector('button[name="query"]').addEventListener('click',()=>{const keyword=doc.querySelector('input[name="searchInput"]').value;effects.push(['query',keyword]);const id=keyword==='CODEa'?'a':'b';render(id,'course-'+id);});
    return {doc,win,effects,requests,render,emit,adapter:api.createAdapter(win),target:api.scan(doc)[0]};
  }
  await test('parallel server queries retain each captured category without changing the page',async()=>{
    const f=fixture(),a=f.adapter.capture(f.target);
    f.doc.getElementById('xkkz_id').value='control-b';f.doc.getElementById('kklxdm').value='10';f.render('b','course-b');
    const b=f.adapter.capture(api.scan(f.doc)[0]);
    const pa=f.adapter.probe(a),pb=f.adapter.probe(b);
    assert(f.requests.length===2,'queries were not started concurrently');
    const [ra,rb]=await Promise.all([pa,pb]);assert(ra.state==='available'&&rb.state==='available','wrong result');
    const first=new URLSearchParams(f.requests[0].body),second=new URLSearchParams(f.requests[1].body);
    assert(first.get('kch_id')==='course-a'&&first.get('xkkz_id')==='control-a'&&first.get('kklxdm')==='01','first query used second category');
    assert(first.get('gnjkxdnj')==='0','grade restriction parameter was omitted');
    assert(second.get('kch_id')==='course-b'&&second.get('xkkz_id')==='control-b'&&second.get('kklxdm')==='10','second query context lost');
    assert(f.requests.every(x=>x.method==='POST'&&x.async===true&&x.url==='/xsxk/zzxkyzbjk_cxJxbWithKchZzxkYzb.html'),'wrong request contract');
    assert(f.doc.querySelector('.jxb_id').textContent==='b'&&f.effects.length===0,'probe mutated website or submitted');
  });
  await test('probe distinguishes full capacity and rejects absent or malformed class data',async()=>{
    const f=fixture(),target=f.adapter.capture(f.target);
    f.win.response=()=>[{jxb_id:'a',yxzrs:'20',jxbrl:'20'}];assert((await f.adapter.probe(target)).state==='full','full course was available');
    for(const response of [[{jxb_id:'other',yxzrs:0,jxbrl:20}],[{jxb_id:'a',yxzrs:null,jxbrl:20}],'<html>login</html>']){
      f.win.response=()=>response;let threw=false;try{await f.adapter.probe(target);}catch{threw=true;}assert(threw,'invalid query accepted');
    }
  });
  await test('chosen list recognizes a saved class after switching categories',async()=>{
    const f=fixture(),target=f.adapter.capture(f.target);f.doc.getElementById('kklxdm').value='10';f.render('b','course-b');
    f.doc.getElementById('choosedBox').innerHTML='<input name="right_jxb_id" value="a">';
    assert(f.adapter.isSelected(target),'selected target not recognized outside current category');
    f.doc.getElementById('xkxnm').value='2027';assert(!f.adapter.isSelected(target),'selected status reused across terms');
  });
  await test('stop and deadline abort outstanding probes and block new ones',async()=>{
    const f=fixture(),target=f.adapter.capture(f.target);f.win.queryDelay=1000;
    const controller=new AbortController(),pending=f.adapter.probe(target,controller.signal);controller.abort();
    let stopped=false;try{await pending;}catch{stopped=true;}assert(stopped&&f.requests[0].aborted,'stop left request active');
    let expired=false;try{await f.adapter.probe(target,undefined,Date.now()+100);}catch{expired=true;}
    assert(expired&&f.requests[1].aborted,'deadline left request active');
    let blocked=false;try{await f.adapter.probe(target,undefined,Date.now()-1);}catch{blocked=true;}
    assert(blocked&&f.requests.length===2,'request started after end');
  });
  await test('multiple courses complete in the first round with real adapter and fresh page checks',async()=>{
    const f=fixture(),a=f.adapter.capture(f.target);f.render('b','course-b');const b=f.adapter.capture(api.scan(f.doc)[0]);f.render('a','course-a');f.win.submitFlag='1';
    const result=await api.run({targets:[a,b],startAt:Date.now()-1000,endAt:Date.now()+3000,intervalMs:5000,dryRun:false},f.adapter);
    assert(result.state==='success'&&result.courses.every(item=>item.state==='success'),'both courses did not complete before per-course interval');
    assert(f.requests.length===2,'did not probe both courses');
    assert(JSON.stringify(f.effects.filter(e=>e[0]==='refresh'||e[0]==='submit'))===JSON.stringify([['refresh','a'],['submit','a'],['refresh','b'],['submit','b']]),'wrong course or missing pre-submit refresh');
  });
  await test('hidden page can refresh and submit only the intended teaching class',async()=>{
    const f=fixture();assert((await f.adapter.refresh(f.target)).state==='available','hidden refresh failed');
    const r=await f.adapter.submit(f.target);assert(r.state==='full','unrelated teaching class response accepted');
    assert(JSON.stringify(f.effects)===JSON.stringify([['refresh','a'],['submit','a']]),'wrong actions');
  });
  await test('cross-category queue target is re-queried with recorded course code',async()=>{
    const f=fixture();const target={...f.target,jxbId:'b',kchId:'course-b',className:'Class b',teacher:'Teacher b',keyword:'CODEb',tabId:'tab_kklx_b',context:'2026|3|control-b|10|5'};
    await f.adapter.prepare(target,undefined,Date.now()+10000);
    assert(f.adapter.inspect(target).className==='Class b','wrong target after query');
    assert(JSON.stringify(f.effects)===JSON.stringify([['category','b'],['query','CODEb']]),'missing category/query');
  });
  await test('deadline already reached blocks every adapter operation',async()=>{
    const f=fixture();for(const method of ['prepare','refresh','submit']){
      let threw=false;try{await f.adapter[method](f.target,undefined,Date.now()-1);}catch{threw=true;}assert(threw,method+' ignored deadline');
    }assert(f.effects.length===0,'activity after deadline');
  });
  await test('changed teacher prevents a selection click',async()=>{
    const f=fixture();f.doc.querySelector('.jsxmzc').textContent='Different teacher';
    let threw=false;try{await f.adapter.submit(f.target);}catch{threw=true;}assert(threw&&f.effects.length===0,'wrong teacher submitted');
  });
  await test('normal confirmation retains the response listener until the user confirms',async()=>{
    const f=fixture();const old=f.doc.querySelector('.an button'),button=old.cloneNode(true);old.replaceWith(button);
    f.win.getComputedStyle=()=>({display:'block'});
    button.addEventListener('click',()=>{
      const modal=f.doc.createElement('div');modal.className='modal';modal.getClientRects=()=>[{}];f.doc.body.appendChild(modal);
      setTimeout(()=>{modal.remove();f.emit('/xsxk/zzxkyzbjk_xkBcZyZzxkYzb.html',{kch_id:'course-a',jxb_ids:'op-a'},{flag:'1'});},300);
    });
    assert((await f.adapter.submit(f.target,undefined,Date.now()+3000)).state==='success','confirmation lost its final response');
  });
  await test('unresolved confirmation still ends at the configured deadline',async()=>{
    const f=fixture();const old=f.doc.querySelector('.an button'),button=old.cloneNode(true);old.replaceWith(button);
    f.win.getComputedStyle=()=>({display:'block'});
    button.addEventListener('click',()=>{const modal=f.doc.createElement('div');modal.className='modal';modal.getClientRects=()=>[{}];f.doc.body.appendChild(modal);});
    let message='';try{await f.adapter.submit(f.target,undefined,Date.now()+300);}catch(error){message=error.message;}
    assert(message.includes('结束时间'),'confirmation ignored deadline or rejected too early');
  });
  await test('panel accumulates courses from separate queries and defaults to dry run',async()=>{
    const f=fixture();f.win.SJTUCourseTimer=api;api.mount(f.win);
    const p=f.doc.getElementById('sjtu-course-timer').shadowRoot;
    p.getElementById('scan').click();p.getElementById('target').options[0].selected=true;p.getElementById('add').click();
    f.render('b','course-b');p.getElementById('scan').click();p.getElementById('target').options[0].selected=true;p.getElementById('add').click();
    assert(p.getElementById('queue').children.length===2,'queue lost previous query');
    assert(p.getElementById('dry').checked,'default is not read only');
    await p.getElementById('startBtn').onclick();assert(f.effects.length===0,'dry run issued website action');
    assert(p.getElementById('status').textContent.includes('只读检查完成'),'dry run failed');
    assert(p.getElementById('stop').disabled,'dry run still running');
  });
  document.getElementById('results').textContent=JSON.stringify({passed:results.filter(x=>x.passed).length,total:results.length,results});
})();
