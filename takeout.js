/* Fictional story-world food delivery. All data is scoped to current chat. */
export function createTakeoutModule(api){
 const demo=[
  {id:'sample:rice',name:'巷里家常菜',category:'家常菜',feeCents:400,packingCents:200,menu:[{id:'r1',name:'番茄牛腩盖饭',priceCents:2600},{id:'r2',name:'青椒肉丝饭',priceCents:2200},{id:'r3',name:'菌菇炖鸡汤',priceCents:1800}]},
  {id:'sample:noodle',name:'街角面馆',category:'粉面',feeCents:300,packingCents:100,menu:[{id:'n1',name:'鲜虾云吞面',priceCents:2500},{id:'n2',name:'牛肉汤粉',priceCents:2400},{id:'n3',name:'葱油拌面',priceCents:1600}]},
  {id:'sample:snack',name:'暮色小食',category:'小吃',feeCents:500,packingCents:200,menu:[{id:'s1',name:'烤鸡腿饭',priceCents:2700},{id:'s2',name:'炸虾球',priceCents:2300},{id:'s3',name:'梅子气泡饮',priceCents:1100}]},
  {id:'sample:sweet',name:'午后甜品屋',category:'甜品饮品',feeCents:300,packingCents:300,menu:[{id:'d1',name:'草莓奶油蛋糕',priceCents:2800},{id:'d2',name:'焦糖布丁',priceCents:1600},{id:'d3',name:'热可可',priceCents:1800}]}
 ];
 const state={scope:null,tab:'browse',view:'',shopId:'',addressId:'',returnCheckout:false,loading:false,message:'',error:''};
 const scrollByRoute=new Map();let previousRoute='';
 const routeKey=()=>[state.tab,state.view,state.shopId].join(':');
 const id=p=>p+':'+Date.now().toString(36)+':'+Math.random().toString(36).slice(2,9);
 const clean=(v,max=180)=>String(v??'').trim().slice(0,max);
 const money=c=>api.walletMoney(c);
 const create=(tag,cls='',txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=txt;return e;};
 const btn=(label,action,info={})=>{const e=create('button','lp-takeout-btn',label);e.type='button';e.dataset.takeoutAction=action;for(const [k,v] of Object.entries(info))e.dataset[k]=v;return e;};
 const heading=(title,subtitle='')=>{const d=create('div','lp-takeout-heading');d.append(create('strong','',title));if(subtitle)d.append(create('small','',subtitle));return d;};
 const root=()=>api.readRootData(api.context());
 const model=()=>{
  const r=root().takeout||{},persona=api.currentPersona(api.context());
  return {shops:Array.isArray(r.shops)&&r.shops.length?r.shops:demo,
   cart:r.cart&&typeof r.cart==='object'?r.cart:{},
   addresses:Array.isArray(r.addresses)?r.addresses:[],
   selectedAddressId:r.selectedAddressId||'',
   orders:Array.isArray(r.orders)?r.orders:[],
   profile:r.profile||{name:persona.name||'我',phone:''}};
 };
 let queue=Promise.resolve(),lastFeedbackState='';
 const reportFeedback=()=>{
  const current=[state.loading,state.message,state.error].join('|');
  if(lastFeedbackState===current)return;
  lastFeedbackState=current;
  if(state.error)api.notifyInteraction?.(state.error,'error');
  else if(!state.loading&&state.message)api.notifyInteraction?.(state.message,'success');
  if(!state.loading){state.error='';state.message='';}
 };
 const mutate=fn=>{
  queue=queue.catch(()=>{}).then(async()=>{
   const ctx=api.context(),metadata=ctx?.chatMetadata;if(!metadata)throw Error('请先打开角色聊天存档');
   const r=structuredClone(api.readRootData(ctx)),d=r.takeout={...model(),...(r.takeout||{})};
   await fn(d,r);
   if(ctx.chatMetadata!==metadata)throw Error('已切换存档，本次操作未保存');
   await api.writeData(ctx,r);
  });
  return queue;
 };
 const shop=(d)=>d.shops.find(s=>s.id===state.shopId);
 const address=d=>d.addresses.find(a=>a.id===d.selectedAddressId)||d.addresses[0];
 const quantity=(d,shopId,itemId)=>Math.max(0,Math.min(99,Number(d.cart[shopId]?.[itemId])||0));
 const summary=(d,s)=>{
  if(!s)return {items:[],count:0,subtotal:0,total:0};
  const items=s.menu.map(x=>({...x,count:quantity(d,s.id,x.id)})).filter(x=>x.count);
  const subtotal=items.reduce((sum,x)=>sum+x.priceCents*x.count,0);
  return {items,count:items.reduce((sum,x)=>sum+x.count,0),subtotal,
   total:items.length?subtotal+s.feeCents+s.packingCents:0};
 };
 function render(){
  const n=api.getNodes();if(!n?.takeoutContent)return;
  n.takeoutTabs.querySelectorAll('[data-takeout-tab]').forEach(b=>b.classList.toggle('active',b.dataset.takeoutTab===state.tab));
  const host=n.takeoutContent,d=model(),body=create('div','lp-takeout-body');
  const route=routeKey();
  if(previousRoute&&previousRoute!==route)scrollByRoute.set(previousRoute,host.scrollTop);
  const savedTop=previousRoute===route?host.scrollTop:(scrollByRoute.get(route)||0);
  if(state.view==='checkout')renderCheckout(body,d);
  else if(state.view==='addresses')renderAddresses(body,d);
  else if(state.view==='profile')renderProfile(body,d);
  else if(state.view==='orders')renderOrders(body,d);
  else if(state.tab==='browse')state.shopId?renderShop(body,d):renderBrowse(body,d);
  else if(state.tab==='cart')renderCart(body,d);
  else renderMe(body,d);
  host.replaceChildren(body);host.scrollTop=savedTop;previousRoute=route;
  reportFeedback();
 }
 function renderBrowse(host,d){
  host.append(heading('浏览商户','当前剧情中的虚构店铺，不使用设备定位'));
  const search=create('input','lp-takeout-search');search.type='search';search.placeholder='搜索商户或餐食';
  search.addEventListener('input',()=>{
   const q=search.value.toLowerCase().trim();
   host.querySelectorAll('[data-shop-search]').forEach(e=>e.hidden=!e.dataset.shopSearch.includes(q));
  });host.append(search);
  const loc=api.storyScenePreview(api.context(),root()).location;
  if(loc)host.append(create('p','lp-takeout-note','剧情地点：'+loc));
  const refresh=btn(state.loading?'生成中…':'生成剧情周边商户','generate');refresh.disabled=state.loading;host.append(refresh);
  for(const s of d.shops){
   const box=create('div','lp-takeout-shop');box.dataset.shopSearch=(s.name+' '+s.category+' '+s.menu.map(x=>x.name).join(' ')).toLowerCase();
   const badge=create('div','lp-takeout-shop-badge',s.category.includes('甜')?'🍰':s.category.includes('面')?'🍜':s.category.includes('小吃')?'🥡':'🍚');
   const info=create('div','lp-takeout-shop-info');
   info.append(create('strong','',s.name),create('small','',s.category),
     create('small','','配送 ¥'+money(s.feeCents)+' · 打包 ¥'+money(s.packingCents)));
   box.append(badge,info,btn('进店','shop',{shop:s.id}));host.append(box);
  }
 }
 function renderShop(host,d){
  const s=shop(d);if(!s){state.shopId='';renderBrowse(host,d);return;}
  host.append(heading(s.name,s.category));
  for(const item of s.menu){
   const row=create('div','lp-takeout-dish'),text=create('div');
   text.append(create('strong','',item.name),create('small','lp-takeout-price','¥'+money(item.priceCents)));
   const actions=create('div','lp-takeout-qty');
   actions.append(btn('−','minus',{shop:s.id,item:item.id}),
     create('span','',String(quantity(d,s.id,item.id))),btn('+','plus',{shop:s.id,item:item.id}));
   row.append(text,actions);host.append(row);
  }
  const t=summary(d,s);host.append(create('div','lp-takeout-subtotal','已选 '+t.count+' 件 · 小计 ¥'+money(t.subtotal)),btn('查看购物车','cart'));
 }
 function renderCart(host,d){
  host.append(heading('购物车','不同商户分别结算'));
  const shops=d.shops.filter(s=>summary(d,s).count>0);
  if(!shops.length){host.append(create('p','lp-takeout-empty','购物车还是空的'),btn('去逛商户','browse'));return;}
  for(const s of shops){
   const t=summary(d,s),box=create('div','lp-takeout-cart-group');
   box.append(create('strong','',s.name));
   for(const item of t.items){
    const row=create('div','lp-takeout-cart-line');
    row.append(create('span','',item.name),create('span','','¥'+money(item.priceCents)),
      btn('−','minus',{shop:s.id,item:item.id}),create('span','',String(item.count)),
      btn('+','plus',{shop:s.id,item:item.id}));box.append(row);
   }
   box.append(create('small','','配送 ¥'+money(s.feeCents)+' · 打包 ¥'+money(s.packingCents)),
     create('strong','lp-takeout-total','共 ¥'+money(t.total)),btn('结算这家','checkout',{shop:s.id}));
   host.append(box);
  }
 }
 function renderCheckout(host,d){
  const s=shop(d),t=summary(d,s);if(!s||!t.count){state.view='';renderCart(host,d);return;}
  const a=address(d);
  host.append(heading('确认订单',s.name));
  const card=create('div','lp-takeout-cart-group');
  card.append(create('strong','','收货地址'),
   create('p','',a?(a.label+' · '+a.recipient+' · '+a.phone+' · '+a.detail):'尚未填写收货地址'),
   btn(a?'更换地址':'添加地址','addresses'));
  host.append(card);
  const goods=create('div','lp-takeout-cart-group');
  for(const item of t.items)goods.append(create('div','lp-takeout-cart-line',item.name+' × '+item.count+'　¥'+money(item.priceCents*item.count)));
  goods.append(create('small','','配送 ¥'+money(s.feeCents)+' · 打包 ¥'+money(s.packingCents)),
    create('strong','lp-takeout-total','应付 ¥'+money(t.total)));
  host.append(goods,create('p','lp-takeout-note','仅在剧情中下单，付款使用吱付宝余额，不向真实商户发送订单。'));
  const pay=btn('确认付款 · ¥'+money(t.total),'pay');pay.disabled=!a||state.loading;host.append(pay);
 }
 function renderMe(host,d){
  host.append(heading('我的外卖',d.profile.name));
  const a=address(d);host.append(create('p','lp-takeout-note','默认收货：'+(a?a.label+' · '+a.detail:'尚未设置')));
  const list=create('div','lp-takeout-me-menu');
  list.append(btn('我的订单 ›','orders'),btn('收货地址 ›','addresses'),btn('账号设置 ›','profile'));
  host.append(list);
  if(d.orders.length)host.append(heading('最近订单'),...d.orders.slice(-3).reverse().map(o=>orderCard(o,true)));
 }
 function orderCard(o,brief=false){
  const card=create('div','lp-takeout-order');
  card.append(create('strong','',o.shop),create('span','',o.status==='refunded'?'已取消 · 已退款':'已付款 · 待接单'),
    create('small','',o.storyTime.replace('T',' ')+' · '+o.items.map(x=>x.name+'×'+x.count).join('、')),
    create('strong','lp-takeout-total','¥'+money(o.total)));
  if(!brief&&o.status==='paid')card.append(btn('取消订单并退款','refund',{order:o.id}));
  return card;
 }
 function renderOrders(host,d){host.append(heading('我的订单'));
  if(!d.orders.length)host.append(create('p','lp-takeout-empty','暂无订单'));
  d.orders.slice().reverse().forEach(o=>host.append(orderCard(o)));
 }
 const input=(group,key,label,value,max=160)=>{
  const row=create('label','lp-takeout-field',label);
  const field=create('input');field.value=value||'';field.dataset.takeoutField=key;field.maxLength=max;
  row.append(field);group.append(row);
 };
 function renderProfile(host,d){
  host.append(heading('账号资料'));
  const form=create('div','lp-takeout-form');
  input(form,'name','称呼',d.profile.name,40);
  input(form,'phone','联系电话（剧情设定）',d.profile.phone,40);
  form.append(btn('保存','saveProfile'));host.append(form);
 }
 function renderAddresses(host,d){
  host.append(heading('收货地址','手动设置剧情地址，不读取真实定位'));
  const existing=d.addresses.find(a=>a.id===state.addressId);
  const form=create('div','lp-takeout-form');
  input(form,'label','地址标签',existing?.label||'家',30);
  input(form,'recipient','收货人',existing?.recipient||d.profile.name,40);
  input(form,'phone','联系电话',existing?.phone||d.profile.phone,40);
  input(form,'detail','完整地址',existing?.detail||'',200);
  form.append(btn(existing?'更新地址':'保存新地址','saveAddress'));
  host.append(form,heading('已保存地址'));
  for(const a of d.addresses){
   const card=create('div','lp-takeout-address');
   card.append(create('strong','',a.label+' · '+a.recipient),
     create('small','',a.detail+' · '+a.phone),
     btn(a.id===d.selectedAddressId?'当前默认':'设为默认','setAddress',{address:a.id}),
     btn('编辑','editAddress',{address:a.id}),btn('删除','deleteAddress',{address:a.id}));
   host.append(card);
  }
 }
 async function handleClick(event){
  const b=event.target.closest('[data-takeout-action]');if(!b)return false;
  const action=b.dataset.takeoutAction;
  const go=(tab,view='',shopId='')=>{
   state.tab=tab;state.view=view;state.shopId=shopId;state.error='';state.message='';
   render();
  };
  if(action==='shop'){go('browse','',b.dataset.shop);return true;}
  if(action==='browse'){go('browse');return true;}
  if(action==='cart'){go('cart');return true;}
  if(action==='me'){go('me');return true;}
  if(action==='orders'){go('me','orders');return true;}
  if(action==='profile'){go('me','profile');return true;}
  if(action==='checkout'){go('cart','checkout',b.dataset.shop);return true;}
  if(action==='addresses'){state.returnCheckout=state.view==='checkout';state.view='addresses';state.addressId='';render();return true;}
  if(action==='backAddress'){state.view=state.returnCheckout?'checkout':'';state.tab=state.returnCheckout?'cart':'me';render();return true;}
  if(action==='editAddress'){state.addressId=b.dataset.address;render();return true;}
  const field=k=>clean(api.getNodes().takeoutContent.querySelector('[data-takeout-field="'+k+'"]')?.value,k==='detail'?200:45);
  try{
   if(action==='plus'||action==='minus'){
    await mutate(d=>{const s=d.shops.find(x=>x.id===b.dataset.shop);
     if(!s?.menu.some(x=>x.id===b.dataset.item))throw Error('餐品已下架');
     d.cart[s.id]||={};
     const n=Math.max(0,Math.min(99,quantity(d,s.id,b.dataset.item)+(action==='plus'?1:-1)));
     if(n)d.cart[s.id][b.dataset.item]=n;else delete d.cart[s.id][b.dataset.item];
    });
   }else if(action==='saveAddress'){
    const entry={id:state.addressId||id('address'),label:field('label')||'收货地址',
     recipient:field('recipient'),phone:field('phone'),detail:field('detail')};
    if(!entry.recipient||!entry.detail)throw Error('请填写收货人及完整地址');
    await mutate(d=>{const p=d.addresses.findIndex(x=>x.id===entry.id);
     if(p>=0)d.addresses[p]=entry;else d.addresses.push(entry);d.selectedAddressId=entry.id;});
    state.addressId='';state.message='地址已保存';
   }else if(action==='setAddress'||action==='deleteAddress'){
    await mutate(d=>{if(action==='setAddress')d.selectedAddressId=b.dataset.address;
     else{d.addresses=d.addresses.filter(x=>x.id!==b.dataset.address);
      if(d.selectedAddressId===b.dataset.address)d.selectedAddressId=d.addresses[0]?.id||'';}
    });
   }else if(action==='saveProfile'){
    await mutate(d=>{d.profile={name:field('name')||d.profile.name,phone:field('phone')};});
    state.message='账号资料已保存';
   }else if(action==='pay'){
    if(state.loading)return true;state.loading=true;
    api.notifyInteraction?.('正在确认付款与订单…','pending');
    await mutate((d,r)=>{
     const s=d.shops.find(x=>x.id===state.shopId),t=summary(d,s),a=address(d);
     if(!s||!t.count)throw Error('购物车是空的');
     if(!a?.detail)throw Error('请先填写收货地址');
     const orderId=id('food');
     api.walletChargeOrder(r,{orderId,amountCents:t.total,shop:s.name,category:'takeout'});
     d.orders.push({id:orderId,shop:s.name,merchantId:s.id,
      items:t.items.map(x=>({name:x.name,count:x.count,priceCents:x.priceCents})),
      total:t.total,storyTime:r.storyTime,status:'paid',address:{...a}});
     d.cart[s.id]={};
    });
    state.message='下单成功，已从吱付宝扣款';state.tab='me';state.view='orders';
   }else if(action==='refund'){
    if(!window.confirm('取消这个剧情订单并退回吱付宝余额？'))return true;
    await mutate((d,r)=>{const order=d.orders.find(x=>x.id===b.dataset.order);
     if(!order||order.status!=='paid')throw Error('订单不能取消');
     api.walletRefundOrder(r,{orderId:order.id,amountCents:order.total,category:'takeout'});
     order.status='refunded';
    });state.message='已取消并退款';
   }else if(action==='generate'){void generateShops();return true;}
  }catch(e){state.error=String(e.message||e);api.recordError('外卖操作',e);}
  finally{state.loading=false;render();}
  return true;
 }
 async function generateShops(){
  if(state.loading)return;state.loading=true;state.error='';state.message='';render();
  const oldScope=api.context()?.chatMetadata;
  try{
   const ctx=api.context(),loc=clean(api.storyScenePreview(ctx,root()).location||'未明确',50);
   const prompt='为虚构剧情的外卖 App 生成4家不同品类的虚构餐饮商户，每家3至5道菜，参考剧情地点：'+loc+
    '。禁止假装读取用户真实GPS或真实商户营业数据。只返回 JSON，格式：'+
    '{"shops":[{"name":"店名","category":"品类","feeCents":300,"packingCents":200,"menu":[{"name":"餐品","priceCents":2500}]}]}。';
   const raw=await api.phoneGenerate(ctx,{systemPrompt:'只输出合法JSON',prompt:[{role:'user',content:prompt}]},api.readData(ctx));
   if(api.context()?.chatMetadata!==oldScope)return;
   const match=api.stripModelReasoning(String(raw||'')).match(/\{[\s\S]*\}/);
   if(!match)throw Error('没有生成可解析的商户');
   const parsed=JSON.parse(match[0]);
   const shops=(Array.isArray(parsed.shops)?parsed.shops:[]).slice(0,8).map(m=>({
    id:id('merchant'),name:clean(m.name,60),category:clean(m.category,30),
    feeCents:Math.round(Number(m.feeCents)),packingCents:Math.round(Number(m.packingCents)),
    menu:(Array.isArray(m.menu)?m.menu:[]).slice(0,12).map(item=>({
     id:id('dish'),name:clean(item.name,70),priceCents:Math.round(Number(item.priceCents))
    })).filter(x=>x.name&&Number.isSafeInteger(x.priceCents)&&x.priceCents>=100&&x.priceCents<=100000)
   })).filter(m=>m.name&&m.menu.length&&Number.isSafeInteger(m.feeCents)&&m.feeCents>=0&&m.feeCents<=5000&&Number.isSafeInteger(m.packingCents)&&m.packingCents>=0&&m.packingCents<=5000);
   if(!shops.length)throw Error('生成内容缺少有效店铺和菜品');
   await mutate(d=>{const retained=d.shops.filter(s=>
    Object.values(d.cart[s.id]||{}).some(Number)||d.orders.some(o=>o.merchantId===s.id));
    d.shops=[...shops,...retained].slice(0,30);
   });state.message='已生成 '+shops.length+' 家剧情商户，原购物车保留';
  }catch(e){state.error='商户生成失败：'+String(e.message||e);api.recordError('生成外卖商户',e);}
  finally{state.loading=false;render();}
 }
 function selectTab(tab){if(!['browse','cart','me'].includes(tab))return;
  state.tab=tab;state.view='';state.shopId='';state.error='';state.message='';render();
 }
 function open(){const current=api.context()?.chatMetadata;
  if(state.scope!==current){state.scope=current;state.tab='browse';state.view='';state.shopId='';state.message='';state.error='';scrollByRoute.clear();previousRoute='';}
  render();
 }
 function back(){
  if(state.view==='addresses'){
   state.view=state.returnCheckout?'checkout':'';
   state.tab=state.returnCheckout?'cart':'me';state.returnCheckout=false;
  }else if(state.view==='checkout'){state.view='';state.tab='cart';}
  else if(state.view==='orders'||state.view==='profile'){state.view='';state.tab='me';}
  else if(state.shopId&&state.tab==='browse'){state.shopId='';}
  else return false;
  render();return true;
 }
 return {state,open,render,selectTab,handleClick,back};
}
