import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('../takeout.js',import.meta.url),'utf8');
const factory=new Function('document','window','structuredClone',
 script.replace('export function createTakeoutModule','function createTakeoutModule')+
 '\nreturn createTakeoutModule;');
function harness(rootData){
 const metadata={phone:rootData};
 const ctx={chatMetadata:metadata,chatId:'story-1'};
 const log=[];
 const app=factory({}, {confirm:()=>true},structuredClone)({
  context:()=>ctx,getNodes:()=>({takeoutContent:null}),
  readRootData:()=>ctx.chatMetadata.phone,readData:()=>ctx.chatMetadata.phone,
  writeData:async(_,r)=>{ctx.chatMetadata.phone=r;},
  currentPersona:()=>({name:'剧情用户'}),
  storyScenePreview:()=>({location:'剧情中的校园'}),
  walletMoney:c=>(c/100).toFixed(2),
  walletChargeOrder:(r,{orderId,amountCents,shop})=>{
   if(r.wallet.balanceCents<amountCents)throw Error('余额不足，无法付款');
   r.wallet.balanceCents-=amountCents;
   r.wallet.ledger.push({id:'order:'+orderId,amountCents:-amountCents,shop});
  },
  walletRefundOrder:(r,{orderId,amountCents})=>{
   if(r.wallet.ledger.some(x=>x.id==='refund:'+orderId))throw Error('重复退款');
   r.wallet.balanceCents+=amountCents;
   r.wallet.ledger.push({id:'refund:'+orderId,amountCents});
  },
  phoneGenerate:async()=>'',stripModelReasoning:x=>x,recordError:(where,error)=>log.push(where+':'+error.message)
 });
 return {app,ctx,log};
}
const press=(action,props={})=>({target:{closest:()=>({dataset:{takeoutAction:action,...props}})}});
const base=()=>({
 version:1,messages:[],storyTime:'2025-12-17T19:50',
 wallet:{balanceCents:10000,ledger:[],transfers:[]},
 takeout:{cart:{'sample:rice':{r1:1}},selectedAddressId:'address:1',
  addresses:[{id:'address:1',label:'学校',recipient:'剧情用户',phone:'剧情电话',detail:'虚构校园宿舍'}],
  orders:[]}
});
test('story takeout checks out one shop, charges wallet once and refunds on cancel',async()=>{
 const {app,ctx}=harness(base());app.open();
 await app.handleClick(press('checkout',{shop:'sample:rice'}));
 await app.handleClick(press('pay'));
 const paid=ctx.chatMetadata.phone;
 assert.equal(paid.wallet.balanceCents,6800);
 assert.equal(paid.takeout.orders.length,1);
 assert.equal(paid.takeout.orders[0].total,3200);
 assert.equal(Object.keys(paid.takeout.cart['sample:rice']).length,0);
 const order=paid.takeout.orders[0];
 await app.handleClick(press('refund',{order:order.id}));
 assert.equal(ctx.chatMetadata.phone.wallet.balanceCents,10000);
 assert.equal(ctx.chatMetadata.phone.takeout.orders[0].status,'refunded');
 await app.handleClick(press('refund',{order:order.id}));
 assert.equal(ctx.chatMetadata.phone.wallet.balanceCents,10000);
});
test('no address and insufficient wallet balance cannot create a paid order',async()=>{
 const missing=base();missing.takeout.addresses=[];
 const a=harness(missing);a.app.open();
 await a.app.handleClick(press('checkout',{shop:'sample:rice'}));
 await a.app.handleClick(press('pay'));
 assert.equal(a.ctx.chatMetadata.phone.takeout.orders.length,0);
 assert.equal(a.ctx.chatMetadata.phone.wallet.balanceCents,10000);
 const broke=base();broke.wallet.balanceCents=100;
 const b=harness(broke);b.app.open();
 await b.app.handleClick(press('checkout',{shop:'sample:rice'}));
 await b.app.handleClick(press('pay'));
 assert.equal(b.ctx.chatMetadata.phone.takeout.orders.length,0);
 assert.equal(b.ctx.chatMetadata.phone.wallet.balanceCents,100);
});
test('outer recovery actions do not wipe conversation data',()=>{
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 assert.ok(index.includes('function restoreDefaultThemeFromHost()'));
 assert.ok(index.includes('function resetPhonePasswordFromHost()'));
 assert.ok(index.includes("delete settings.lock"));
 assert.ok(index.includes("palette:'swiss'"));
 assert.ok(index.includes("'takeoutContent','takeoutTabs'"));
 assert.ok(index.includes("screen:'takeout',name:'外卖',ready:true"));
 const markup=index.split('container.innerHTML = '+String.fromCharCode(96))[1]
  .split(String.fromCharCode(96)+';\n    return container;')[0];
 for(const item of ['browse','cart','me'])assert.ok(markup.includes('data-takeout-tab="'+item+'"'));
 assert.ok(!script.includes('geolocation'));
});
