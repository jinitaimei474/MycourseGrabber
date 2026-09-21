// All school URLs in this test are fulfilled locally; no login or enrollment request is sent.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require('playwright-core');
(async()=>{
 const {BrowserSession,fillCredentials}=require('../src/services/browser.cjs');
 const browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext();
 const login=`<input id="input-login-user"><input id="input-login-pass" type="password"><input id="input-login-captcha"><img id="captcha-img" width="110" height="36"><input type="submit" id="submit-password-button" value="登录"><script>document.getElementById('submit-password-button').onclick=()=>{location.href='https://i.sjtu.edu.cn/xtgl/index_initMenu.html'}</script>`;
 await context.route('**/*',route=>{const u=new URL(route.request().url());let html='';if(u.pathname.includes('login_slogin'))html='<a id="authJwglxtLoginURL" href="https://jaccount.sjtu.edu.cn/jaccount/jalogin">通过jAccount登录</a>';else if(u.hostname==='jaccount.sjtu.edu.cn')html=login;else if(u.pathname.includes('index_initMenu'))html='<a id="drop1" role="button">报名申请</a><a id="drop1" role="button" onclick="this.nextElementSibling.hidden=false">选课</a><a hidden role="menuitem" href="/xsxk/zzxkyzb_cxZzxkYzbIndex.html" target="_blank">自主选课</a>';else html='<input id="xkxnm" value="2026"><input id="xh_id" value="offline-student"><input id="iskxk" value="1"><ul id="nav_tab"><li class="active"><a id="tab_kklx_a">主修课程</a></li></ul><script>window.jQuery={active:0};window.loadJxbxxZzxk=()=>{};</script>';return route.fulfill({contentType:'text/html; charset=utf-8',body:html});});
 try{
  const page=await context.newPage();await page.goto('https://jaccount.sjtu.edu.cn/jaccount/jalogin');
  await page.locator('#input-login-user').fill('autofilled');await page.locator('#input-login-pass').fill('existing-secret');
  await fillCredentials(page,{username:'replacement',password:'replacement'});assert.equal(await page.locator('#input-login-user').inputValue(),'autofilled');assert.equal(await page.locator('#input-login-pass').inputValue(),'existing-secret');
  await page.locator('#input-login-pass').fill('');await fillCredentials(page,{username:'replacement',password:'fallback-secret'});assert.equal(await page.locator('#input-login-pass').inputValue(),'fallback-secret');
  const session=new BrowserSession({profileDir:'unused',tempDir:path.resolve('../artifacts'),adapterPath:path.resolve('../course-timer.user.js'),ocr:async()=> 'abcd'});session.context=context;session.page=page;
  session.credentials={username:'test',password:'local-only'};let ocrCalls=0;session.readCaptcha=async()=>{if(++ocrCalls<3){const error=Error('uncertain OCR');error.retryable=true;throw error;}return 'abcd';};
  const info=await session.ensureCourse(undefined,Date.now()+15000);assert.equal(ocrCalls,3);assert.equal(info.owner,'offline-student');assert(session.page.url().includes('zzxkyzb_cxZzxkYzbIndex'));assert.equal((await session.categories())[0].name,'主修课程');
  await session.installBridge();assert.equal(await session.page.evaluate(()=>typeof window.__SJTUDesktop.adapter.search),'function');assert.equal(await session.page.locator('#sjtu-course-timer').count(),0);
  await session.page.evaluate(()=>{const li=document.createElement('li'),a=document.createElement('a');a.id='tab_kklx_b';a.textContent='任选课程';li.appendChild(a);document.getElementById('nav_tab').appendChild(li);a.onclick=()=>{window.categoryReady=false;window.jQuery.active=1;document.querySelector('#nav_tab li.active').classList.remove('active');li.classList.add('active');setTimeout(()=>{window.jQuery.active=0;setTimeout(()=>{window.jQuery.active=1;setTimeout(()=>{window.categoryReady=true;window.jQuery.active=0;},40);},100);},20);};});
  await session.category('tab_kklx_b');assert.equal(await session.page.evaluate(()=>window.categoryReady),true,'category returned before the delayed automatic query completed');
  session.expectedOwner='offline-student';await session.page.evaluate(()=>{document.getElementById('xh_id').value='another-account';window.__probeSubmitCount=0;window.__SJTUDesktop.adapter.submit=async()=>{window.__probeSubmitCount++;return {state:'success'};};});
  await assert.rejects(()=>session.submit({}),/账户已改变/);assert.equal(await session.page.evaluate(()=>window.__probeSubmitCount),0);
  console.log('PASS: preserve autofill, fill missing password, submit login, follow new course tab, install adapter without extension panel.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
