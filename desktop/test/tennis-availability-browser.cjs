'use strict';
const {chromium}=require('playwright-core'),assert=require('node:assert/strict');const {TennisAdapter}=require('../src/modules/tennis/adapter.cjs');const {installRoutes,fixtureDate}=require('./tennis-fixture.cjs');
(async()=>{const edge=await chromium.launch({channel:'msedge',headless:true});try{
 const ctx=await edge.newContext(),state=await installRoutes(ctx,{notice:true});const a=new TennisAdapter({browser:{context:ctx,launch:async()=>{}},qrDir:'unused'});await a.connect({});
 await a.page.waitForTimeout(100);assert.equal(await a.page.getByText('账号禁用提示',{exact:true}).isVisible(),false,'normal account false warning must be dismissed');assert(state.noticeClosed>0);
 const filters={date:fixtureDate,venues:['胡晓明网球场'],after:'18:00',before:'22:00',intervalMs:3000};const result=await a.scan(filters);assert.deepEqual(result.slots.map(s=>s.time),['18:00-19:00','20:00-21:00']);assert.equal(state.submissions,0);
 state.extraSlot=false;assert.equal((await a.scan(filters)).slots.length,1);assert.equal((await a.scan({...filters,date:new Date(Date.parse(fixtureDate+'T00:00:00Z')+86400000).toISOString().slice(0,10)})).slots.length,0);
 state.restriction=1;await assert.rejects(()=>a.scan(filters),/暂停|禁用/);assert.equal(state.submissions,0);
 const blocked=await edge.newContext(),bstate=await installRoutes(blocked,{notice:true,restriction:1});const b=new TennisAdapter({browser:{context:blocked,launch:async()=>{}},qrDir:'unused'});await assert.rejects(()=>b.connect({}),/暂停|禁用/);assert.equal(bstate.noticeClosed,0);
 const late=await edge.newContext(),lateState=await installRoutes(late,{notice:true,noticeDelay:1500});const lateAdapter=new TennisAdapter({browser:{context:late,launch:async()=>{}},qrDir:'unused'});await lateAdapter.connect({});
 await lateAdapter.page.waitForTimeout(2000);assert.equal(await lateAdapter.page.getByText('账号禁用提示',{exact:true}).isVisible(),false,'late homepage status response must not reopen the false notice');assert(lateState.noticeClosed>0);
 // A later real restriction must not be closed using the earlier normal response.
 lateState.restriction=1;await lateAdapter.page.evaluate(()=>{location.hash='/Venue/1';});await lateAdapter.page.getByText('账号禁用提示',{exact:true}).waitFor();await lateAdapter.page.waitForTimeout(200);assert.equal(await lateAdapter.page.getByText('账号禁用提示',{exact:true}).isVisible(),true);
 console.log('PASS: normal and delayed false notices closed; later real restriction preserved; live inventory refresh and exact date/time scopes without orders.');
}finally{await edge.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
