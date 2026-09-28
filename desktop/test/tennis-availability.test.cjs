'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const m=require('../src/modules/tennis/model.cjs');
const filters={date:'2026-10-02',venues:['东区网球场','胡晓明网球场'],after:'18:00',before:'22:00',intervalMs:5000};
test('availability accepts date/time window and rejects invalid filters',()=>{
 assert.equal(typeof m.availabilityFilters,'function');assert.deepEqual(m.availabilityFilters(filters),filters);
 for(const x of [{after:'22:00'},{before:'17:00'},{date:'2026-02-30'},{venues:[]},{venues:['其他']},{intervalMs:100}])assert.throws(()=>m.availabilityFilters({...filters,...x}));
});
test('only truly available future courts inside the window are shown with exact price and identity',()=>{
 assert.equal(typeof m.availableSlots,'function');const prices=Array.from({length:15},()=>({status:-1,price:5}));prices[10]={status:0,price:4};prices[11]={status:'0',price:5};prices[12]={status:null,price:6};prices[13]={status:0,price:7};prices[14]={status:-3,price:8};
 const result=m.availableSlots([{fieldId:'f2',fieldName:'场地2',priceList:prices}],filters,'东区网球场',Date.parse('2026-10-02T17:30:00+08:00'));
 assert.deepEqual(result.map(r=>[r.time,r.court,r.price]),[['18:00-19:00','2','5'],['20:00-21:00','2','7']]);assert.notEqual(result[0].id,result[1].id);
 assert.equal(m.availableSlots([{fieldName:'场地2',priceList:prices}],filters,'东区网球场',Date.parse('2026-10-02T18:10:00+08:00')).length,1);
});
test('restriction response distinguishes normal nullable state, explicit disabled and unreadable data',()=>{
 assert.equal(typeof m.accountRestriction,'function');for(const status of [0,'0',null,false,''])assert.equal(m.accountRestriction({code:0,data:{distableStatus:status}}).disabled,false);
 assert.equal(m.accountRestriction({code:0,data:{distableStatus:1,breackInfo:'暂停预约'}}).disabled,true);
 assert.throws(()=>m.accountRestriction({code:0,data:{}}));assert.throws(()=>m.accountRestriction({code:500,data:{distableStatus:0}}));
});
