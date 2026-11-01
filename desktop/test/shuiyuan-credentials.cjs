'use strict';
const {chromium}=require('playwright-core'),assert=require('node:assert/strict');
const {ShuiyuanService}=require('../src/modules/shuiyuan/service.cjs');
(async()=>{const edge=await chromium.launch({channel:'msedge',headless:true});try{
 const context=await edge.newContext();let posted=false;
 await context.route('**/*',route=>{if(route.request().method()!=='GET')posted=true;return route.fulfill({contentType:'text/html',body:'<form method="post"><input id="input-login-user"><input id="input-login-pass" type="password"><button type="submit">登录</button></form>'});});
 const page=await context.newPage();await page.goto('https://jaccount.sjtu.edu.cn/jaccount/login');
 const browser={context,launch:async()=>{},credentials:{username:'fixture-user',password:'fixture-password'}},service=new ShuiyuanService({browser});service.page=page;
 await assert.rejects(()=>service.connect(),/完成水源登录/);assert.equal(await page.locator('#input-login-user').inputValue(),'fixture-user');assert.equal(await page.locator('#input-login-pass').inputValue(),'fixture-password');assert(!posted);
 await page.locator('#input-login-user').fill('manually-entered');await page.locator('#input-login-pass').fill('manual-password');await assert.rejects(()=>service.connect(),/完成水源登录/);assert.equal(await page.locator('#input-login-pass').inputValue(),'manual-password');
 const fs=require('node:fs'),path=require('node:path'),{Store}=require('../src/services/store.cjs'),{Scheduler}=require('../src/services/scheduler.cjs'),{fillCredentials}=require('../src/services/browser.cjs');
 const dir=fs.mkdtempSync(path.resolve('../artifacts/credential-relogin-')),store=new Store(path.join(dir,'tasks.json'));store.setOwner('fixture-user');store.add({jxbId:'a',kchId:'a',keyword:'TEST',course:'Test',className:'A',teacher:'Teacher',time:'Monday',tabId:'tab_kklx_a',context:'2026|3|control|01|5'});store.configure({startAt:Date.now()-100,endAt:Date.now()+10000,intervalMs:5000,reloadMinutes:0});
 await page.locator('#input-login-pass').fill('');await page.locator('#input-login-pass').evaluate(input=>input.disabled=true);
 const scheduler=new Scheduler({store,browser:{ensureCourse:()=>fillCredentials(page,{username:'fixture-user',password:'private-relogin-value-'.repeat(30)},undefined,Date.now()+300)}}),messages=[];scheduler.on('update',state=>messages.push(state.message));await scheduler.start();
 assert.equal(scheduler.status.phase,'attention');assert(!messages.some(message=>message.includes('private-relogin-value-')),'relogin fill timeout must never broadcast a password fragment');assert(!fs.readFileSync(path.join(dir,'tasks.json'),'utf8').includes('private-relogin-value-'));
 await page.goto('https://unrelated.invalid/');await assert.rejects(()=>service.connect(),/完成水源登录/);assert.equal(await page.locator('#input-login-pass').inputValue(),'');
 console.log('PASS: Shuiyuan fills jAccount blank fields only, preserves manual input, never submits or fills another origin.');
 }finally{await edge.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
