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
    const effects = [], events = new Map();
    const jq = () => ({searchBox:()=>({searchInput:doc.querySelector('input[name="searchInput"]').value}),on:(event,fn)=>{if(!events.has(event))events.set(event,new Set());events.get(event).add(fn);},off:(event,fn)=>events.get(event)?.delete(fn)});
    jq.param = data => new URLSearchParams(data).toString();
    jq.active = 0;
    const win = {document:doc,jQuery:jq,location:{hostname:'i.sjtu.edu.cn',href:'https://i.sjtu.edu.cn/xsxk/zzxkyzb_cxZzxkYzbIndex.html'},getComputedStyle:window.getComputedStyle.bind(window),addEventListener:window.addEventListener.bind(window)};
    function emit(path, data, body, status=200) {
      for (const listener of [...(events.get('ajaxComplete')||[])]) listener({}, {status,responseJSON:body}, {url:path,data:new URLSearchParams(data).toString()});
    }
    function render(id, kch, append=false) {
      if(!append)doc.getElementById('contentBox').replaceChildren();
      const part=doc.createElement('div');part.innerHTML = `<div class="panel-heading"><span id="kcmc_${kch}">(CODE${id})Course ${id}</span><input name="kch_id" value="${kch}"><input name="czzt" value="1"><a class="expand_close expand1"></a></div>
        <div class="panel-body" style="display:none"><table><tbody><tr class="body_tr"><td class="jxb_id">${id}</td><td class="kch_id">${kch}</td><td class="do_jxb_id">op-${id}</td><td class="jxbzls">1</td><td class="jxbmc">Class ${id}</td><td class="jsxmzc">Teacher ${id}</td><td class="sksj">Monday</td><td class="rsxx"><span class="jxbrs">10</span>/<span class="jxbrl">20</span></td><td class="an"><button onclick="chooseCourseZzxk()">选课</button></td></tr></tbody></table></div>`;
      doc.getElementById('contentBox').append(...part.childNodes);
      const rows=doc.querySelectorAll('.body_tr');const button=rows[rows.length-1].querySelector('.an button');
      button.addEventListener('click',()=>{effects.push(['submit',id]);setTimeout(()=>{
        emit('/xsxk/zzxkyzbjk_xkBcZyZzxkYzb.html',{kch_id:kch,jxb_ids:'wrong-op'},{flag:'1'});
        emit('/xsxk/zzxkyzbjk_xkBcZyZzxkYzb.html',{kch_id:kch,jxb_ids:`op-${id}`},{flag:win.submitFlag || '-1'});
      },1);});
    }
    render('a','course-a');
    function toggle(heading) {
      const arrow=heading.querySelector('.expand_close');const collapsed=arrow.classList.contains('expand1');
      arrow.className=collapsed?'expand_close close1':'expand_close expand1';heading.nextElementSibling.style.display=collapsed?'block':'none';
    }
    win.loadJxbxxZzxk = heading => {const kch=heading.querySelector('input[name="kch_id"]').value;const row=heading.nextElementSibling.querySelector('.body_tr');const id=row.querySelector('.jxb_id').textContent;
      if(heading.querySelector('input[name="czzt"]').value==='1'){toggle(heading);return;}
      effects.push(['refresh',id]);setTimeout(()=>{
        emit('/xsxk/zzxkyzbjk_cxJxbWithKchZzxkYzb.html',{kch_id:kch},[{jxb_id:id}]);
        setTimeout(()=>{toggle(heading);const counts=win.counts?.[id]||['10','20'];row.querySelector('.jxbrs').textContent=counts[0];row.querySelector('.jxbrl').textContent=counts[1];heading.querySelector('input[name="czzt"]').value='1';},win.renderDelay||1);
      },1);};
    doc.getElementById('tab_kklx_b').addEventListener('click',()=>{
      effects.push(['category','b']);doc.getElementById('xkkz_id').value='control-b';doc.getElementById('kklxdm').value='10';
      doc.querySelector('#nav_tab li.active').classList.remove('active');doc.getElementById('tab_kklx_b').parentElement.classList.add('active');doc.getElementById('contentBox').replaceChildren();});
    doc.querySelector('button[name="query"]').addEventListener('click',()=>{
      const keyword=doc.querySelector('input[name="searchInput"]').value;effects.push(['query',keyword]);const id=keyword.startsWith('CODE')?keyword.slice(4):(keyword==='Course a'||keyword==='Teacher a'?'a':'b');const ids=win.catalog?.[keyword]||[id];
      if(win.noListResponse)return;
      jq.active++;
      setTimeout(()=>{
        if(!win.listFailure&&!win.keepOldRow){ids.forEach((item,i)=>render(item,'course-'+item,i>0));if(win.autoExpand){const heading=doc.querySelector('.panel-heading');heading.querySelector('input[name="czzt"]').value='0';win.loadJxbxxZzxk(heading);}}
        const params={kklxdm:doc.getElementById('kklxdm').value,xkkz_id:doc.getElementById('xkkz_id').value};
        keyword.split(' ').filter(word=>word.trim()).forEach((word,i)=>{params['filter_list['+i+']']=word;});
        emit('/xsxk/zzxkyzb_cxZzxkYzbPartDisplay.html',params,{tmpList:ids.map(item=>({jxb_id:item,kch_id:'course-'+item}))},win.listFailure?500:200);
        jq.active--;
      },win.listDelay||20);
    });
    return {doc,win,effects,render,emit,adapter:api.createAdapter(win),target:api.scan(doc)[0]};
  }
  await test('every prepare enters course code and clicks query even when row already exists',async()=>{
    const f=fixture();const original=f.doc.querySelector('.body_tr');
    await f.adapter.prepare(f.target,undefined,Date.now()+1500);
    assert(f.doc.querySelector('input[name="searchInput"]').value==='CODEa','course code not entered');
    assert(f.doc.querySelector('.body_tr')!==original,'old row was reused');
    await f.adapter.prepare(f.target,undefined,Date.now()+1500);
    assert(JSON.stringify(f.effects)===JSON.stringify([['query','CODEa'],['query','CODEa']]),'query skipped on repeated check');
  });
  await test('failed list query cannot use old available row to select',async()=>{
    const f=fixture();f.win.listFailure=true;
    const r=await api.run({targets:[f.target],startAt:Date.now()-1000,endAt:Date.now()+300,intervalMs:5000,dryRun:false},f.adapter);
    assert(r.state==='expired'&&!f.effects.some(e=>e[0]==='submit'||e[0]==='refresh'),'stale row used after query failure');
  });
  await test('successful query response without a newly rendered row cannot use stale data',async()=>{
    const f=fixture();f.win.keepOldRow=true;let message='';
    try{await f.adapter.prepare(f.target,undefined,Date.now()+250);}catch(error){message=error.message;}
    assert(message.includes('结束时间'),'old row accepted as new query result');
  });
  await test('query with no response honors deadline and never accepts existing row',async()=>{
    const f=fixture();f.win.noListResponse=true;let message='';
    try{await f.adapter.prepare(f.target,undefined,Date.now()+250);}catch(error){message=error.message;}
    assert(message.includes('结束时间'),'query returned old row or ignored deadline');
  });
  await test('stop while querying prevents later refresh and submission',async()=>{
    const f=fixture(),c=new AbortController();f.win.noListResponse=true;
    const task=api.run({targets:[f.target],startAt:Date.now()-1000,endAt:Date.now()+2000,intervalMs:5000,dryRun:false},f.adapter,{signal:c.signal});
    setTimeout(()=>c.abort(),50);let stopped=false;try{await task;}catch{stopped=true;}
    assert(stopped&&JSON.stringify(f.effects)===JSON.stringify([['query','CODEa']]),'stop allowed further operations');
  });
  await test('refresh waits for rendered capacity instead of a fixed short delay',async()=>{
    const f=fixture();f.win.renderDelay=250;f.win.counts={a:['20','20']};
    assert((await f.adapter.refresh(f.target,undefined,Date.now()+1500)).state==='full','read old capacity before render completed');
  });
  await test('full course is visibly queried again and selected after a later release',async()=>{
    const f=fixture();f.win.counts={a:['20','20']};f.win.submitFlag='1';let time=Date.now();
    const r=await api.run({targets:[f.target],startAt:time-1000,endAt:time+20000,intervalMs:5000,dryRun:false},f.adapter,{now:()=>time,sleep:async ms=>{time+=ms;f.win.counts.a=['19','20'];}});
    assert(r.state==='success','later release not selected');
    assert(JSON.stringify(f.effects)===JSON.stringify([['query','CODEa'],['refresh','a'],['query','CODEa'],['refresh','a'],['submit','a']]),'missing visible query on a full course');
    assert(r.courses[0].lastCheckedAt>0,'last refreshed time missing');
  });
  await test('target stays expanded after the original query auto-loads its classes',async()=>{
    const f=fixture();f.win.autoExpand=true;
    await f.adapter.prepare(f.target,undefined,Date.now()+1500);
    await f.adapter.refresh(f.target,undefined,Date.now()+1500);
    assert(f.doc.querySelector('.expand_close').classList.contains('close1')&&f.doc.querySelector('.panel-body').style.display==='block','refreshed rows ended collapsed');
    assert(f.effects.filter(e=>e[0]==='refresh').length===2,'reopening sent another request');
  });
  await test('chosen list recognizes a saved class after switching categories',async()=>{
    const f=fixture(),target=f.target;f.doc.getElementById('kklxdm').value='10';f.render('b','course-b');
    f.doc.getElementById('choosedBox').innerHTML='<input name="right_jxb_id" value="a">';
    assert(f.adapter.isSelected(target),'selected target not recognized outside current category');
    f.doc.getElementById('xkxnm').value='2027';assert(!f.adapter.isSelected(target),'selected status reused across terms');
  });
  await test('multiple courses complete in the first round with real adapter and fresh page checks',async()=>{
    const f=fixture(),a=f.target;f.render('b','course-b');const b=api.scan(f.doc)[0];f.render('a','course-a');f.win.submitFlag='1';
    const result=await api.run({targets:[a,b],startAt:Date.now()-1000,endAt:Date.now()+3000,intervalMs:5000,dryRun:false},f.adapter);
    assert(result.state==='success'&&result.courses.every(item=>item.state==='success'),'both courses did not complete before per-course interval');
    assert(JSON.stringify(f.effects.filter(e=>e[0]==='query'))===JSON.stringify([['query','CODEa'],['query','CODEb']]),'did not visibly query both courses');
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
  await test('search queries by name and hydrates all matching courses without enrollment',async()=>{
    const f=fixture();f.win.catalog={'Course a':['a','b']};
    const found=await f.adapter.search('Course a',undefined,Date.now()+3000);
    assert(found.length===2&&found[0].keyword==='CODEa'&&found[1].keyword==='CODEb','search lost matches');
    assert(f.effects.filter(e=>e[0]==='refresh').length===2&&!f.effects.some(e=>e[0]==='submit'),'search did not load each course or enrolled');
  });
  await test('empty search clears stale results and failed search rejects',async()=>{
    const f=fixture();f.win.catalog={missing:[]};assert((await f.adapter.search('missing',undefined,Date.now()+1000)).length===0,'empty query reused old rows');
    f.win.listFailure=true;let failed=false;try{await f.adapter.search('CODEa',undefined,Date.now()+1000);}catch{failed=true;}assert(failed,'failed search accepted');
  });
  await test('search includes later pages and hydrates their teachers before returning',async()=>{
    const f=fixture();const end=f.doc.createElement('input');end.id='isEnd';end.value='false';f.doc.body.appendChild(end);let pages=0;
    f.win.loadCoursesByPaged=()=>{pages++;f.render('b','course-b',true);end.value='true';f.emit('/xsxk/zzxkyzb_cxZzxkYzbPartDisplay.html',{'filter_list[0]':'CODEa',kklxdm:'01',xkkz_id:'control-a'},{tmpList:[{jxb_id:'b',kch_id:'course-b'}]});};
    const found=await f.adapter.search('CODEa',undefined,Date.now()+3000);
    assert(found.length===2&&pages===1,'later page missing');assert(f.effects.filter(e=>e[0]==='refresh').length===2,'later page was not hydrated');
  });
  await test('search normalizes full-width spaces and tabs before matching website requests',async()=>{
    const f=fixture();const found=await f.adapter.search('Course\u3000\ta',undefined,Date.now()+1000);
    assert(found.length===1&&found[0].jxbId==='a','whitespace query lost its response');
    assert(f.effects[0][1]==='Course a','search keyword not normalized');
  });
  await test('scheduled task finds its saved teaching class on a later query page',async()=>{
    const f=fixture();f.render('b','course-b');const target={...api.scan(f.doc)[0],keyword:'CODEa'};f.render('a','course-a');
    const end=f.doc.createElement('input');end.id='isEnd';end.value='false';f.doc.body.appendChild(end);let pages=0;
    f.win.loadCoursesByPaged=()=>{pages++;f.render('b','course-b',true);end.value='true';f.emit('/xsxk/zzxkyzb_cxZzxkYzbPartDisplay.html',{'filter_list[0]':'CODEa',kklxdm:'01',xkkz_id:'control-a'},{tmpList:[{jxb_id:'b',kch_id:'course-b'}]});};
    await f.adapter.prepare(target,undefined,Date.now()+2000);assert(pages===1&&f.adapter.inspect(target).jxbId==='b','later page task not located');
  });
  await test('search cards accumulate selected tasks across queries and start both courses',async()=>{
    const f=fixture();f.win.SJTUCourseTimer=api;api.mount(f.win);const p=f.doc.getElementById('sjtu-course-timer').shadowRoot;
    assert(p.getElementById('queries'),'missing search mode');
    p.getElementById('queries').value='CODEa';await p.getElementById('searchBtn').onclick();p.querySelector('#results button[data-add]').click();
    p.getElementById('queries').value='CODEb';await p.getElementById('searchBtn').onclick();p.querySelector('#results button[data-add]').click();
    assert(p.getElementById('queue').children.length===2,'query replaced queue');
    assert(!f.effects.some(e=>e[0]==='submit'),'adding course submitted it');
    assert(p.getElementById('dry').checked,'default no longer read only');await p.getElementById('startBtn').onclick();
    const start=f.effects.length;f.win.submitFlag='1';p.getElementById('dry').checked=false;
    p.getElementById('start').value=new Date(Date.now()+28800000-1000).toISOString().slice(0,19);
    p.getElementById('end').value=new Date(Date.now()+28800000+10000).toISOString().slice(0,19);
    await p.getElementById('startBtn').onclick();
    assert(JSON.stringify(f.effects.slice(start).filter(e=>e[0]==='submit'))===JSON.stringify([['submit','a'],['submit','b']]),'only one added course ran');
  });
  await test('multi-keyword search and teacher checkboxes narrow choices without clearing tasks',async()=>{
    const f=fixture();f.win.SJTUCourseTimer=api;api.mount(f.win);const p=f.doc.getElementById('sjtu-course-timer').shadowRoot;
    p.getElementById('queries').value='CODEa，CODEb';await p.getElementById('searchBtn').onclick();
    assert(p.querySelectorAll('#results button[data-add]').length===2,'multiple queries not accumulated');
    const check=p.querySelector('#teachers input');check.checked=false;check.onchange();
    assert(p.querySelectorAll('#results button[data-add]').length===1,'teacher multi-select not applied');
    p.querySelector('#results button[data-add]').click();assert(p.getElementById('queue').children.length===1,'filtered card not added');
  });
  await test('same-course teachers join as alternatives and the eleventh course is blocked in UI',async()=>{
    const f=fixture();f.win.SJTUCourseTimer=api;api.mount(f.win);const p=f.doc.getElementById('sjtu-course-timer').shadowRoot;
    p.getElementById('scan').click();p.querySelector('#results button[data-add]').click();
    f.render('a2','course-a');p.getElementById('scan').click();p.querySelector('#results button[data-add]').click();
    assert(p.getElementById('queue').children.length===1&&p.querySelectorAll('#queue [data-remove]').length===2,'alternatives rejected or counted as two courses');
    for(let i=1;i<=10;i++){f.render('x'+i,'course-x'+i);p.getElementById('scan').click();const add=p.querySelector('#results button[data-add]');if(!add.disabled)add.click();}
    assert(p.getElementById('queue').children.length===10,'ten-course cap not applied');
  });
  await test('ten cards added from search all run through the actual panel start button',async()=>{
    const f=fixture();f.win.catalog={All:Array.from({length:10},(_,i)=>'x'+i)};f.win.SJTUCourseTimer=api;api.mount(f.win);const p=f.doc.getElementById('sjtu-course-timer').shadowRoot;
    p.getElementById('queries').value='All';await p.getElementById('searchBtn').onclick();
    for(let i=0;i<10;i++)p.querySelectorAll('#results button[data-add]')[i].click();
    assert(p.getElementById('queue').children.length===10,'ten tasks not collected');
    f.win.submitFlag='1';p.getElementById('dry').checked=false;
    p.getElementById('start').value=new Date(Date.now()+28800000-1000).toISOString().slice(0,19);
    p.getElementById('end').value=new Date(Date.now()+28800000+20000).toISOString().slice(0,19);
    await p.getElementById('startBtn').onclick();
    assert(f.effects.filter(e=>e[0]==='submit').length===10,'not all ten tasks submitted');assert(p.getElementById('status').textContent.includes('10/10'),'missing completion count');
  });
  await test('teacher-only search supports several names and stop restores editing controls',async()=>{
    const f=fixture();f.win.SJTUCourseTimer=api;api.mount(f.win);const p=f.doc.getElementById('sjtu-course-timer').shadowRoot;
    p.getElementById('teacherQuery').value='Teacher a,Teacher b';await p.getElementById('searchBtn').onclick();
    assert(p.querySelectorAll('#results button[data-add]').length===2,'teacher-only query did not find both names');
    f.win.noListResponse=true;p.getElementById('queries').value='CODEa';const searching=p.getElementById('searchBtn').onclick();
    assert(p.getElementById('startBtn').disabled,'enrollment can race a search');p.getElementById('stop').click();await searching;
    assert(!p.getElementById('searchBtn').disabled&&!p.getElementById('startBtn').disabled&&p.getElementById('stop').disabled,'search stop left controls locked');
    assert(!f.effects.some(e=>e[0]==='submit'),'search triggered enrollment');
  });
  document.getElementById('results').textContent=JSON.stringify({passed:results.filter(x=>x.passed).length,total:results.length,results});
})();
