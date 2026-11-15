import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const weibo=readFileSync(new URL('../weibo.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');
const manifest=JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url),'utf8'));

function element(tag){
 const children=[];
 return {tagName:tag.toUpperCase(),className:'',dataset:{},style:{},textContent:'',
  children,childNodes:children,
  append(...items){children.push(...items);},
  replaceChildren(...items){children.splice(0,children.length,...items);},
  setAttribute(name,value){this[name]=value;},
  addEventListener(){},
  classList:{add(){},remove(){},contains(){return false;},toggle(){}}};
}
function story(){
 const ctx={characterId:1,chatId:'v026',chatMetadata:{}};
 let root={storyTime:'2026-11-16T20:30',contacts:[],messages:[],qunxing:{
  accounts:[{id:'actor',name:'林知远',handle:'@sample_account',profession:'演员',followers:46127300,source:'manual'},
   {id:'weather',name:'沪上气象小助手',followers:530000,source:'follow'}],
  posts:[],following:[],settings:{autoEnabled:false,autoEveryMinutes:180,nearbyHint:''}}};
 const source=weibo.replace('export function createWeiboModule','function createWeiboModule')
  .replace('return {open,render,','return {renderSettings,card,action,open,render,');
 const make=new Function('document','structuredClone',source+'\nreturn createWeiboModule;')(
  {createElement:element,createTextNode:text=>({textContent:text}),visibilityState:'visible'},
  value=>JSON.parse(JSON.stringify(value)));
 const app=make({context:()=>ctx,getNodes:()=>({weiboFeed:null}),readRootData:()=>root,
  readData:()=>root,writeData:async(_,next)=>{root=next;},
  selectedCharacter:()=>({name:'林知远'}),currentPersona:()=>({name:'我'})});
 return {app,db:()=>root};
}
test('v0.26.1 uses a consistent cache key and full-width API reload control',()=>{
 assert.equal(manifest.version,'0.26.1');
 assert.match(index,/weibo\.js\?v=0\.26\.1/);
 assert.match(index,/data-lp="apiReloadModels"/);
 assert.match(css,/\[data-lp="apiReloadModels"\]\s*\{[^}]*width:100%/);
});
test('account management uses exactly two rows; four buttons always stay in one action grid',()=>{
 const {app,db}=story(),parent=element('section');
 app.renderSettings(parent,db().qunxing);
 const cards=parent.children.filter(x=>x.className.includes('lp-wb-managed-account'));
 assert.equal(cards.length,2);
 for(const card of cards){
  assert.equal(card.children.length,2);
  assert.ok(card.children[0].className.includes('lp-wb-managed-identity'));
  assert.deepEqual(card.children[1].children.map(x=>x.textContent),
   ['主页','编辑','历史帖管理','删除']);
 }
 assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
});
test('favorite is icon-only and both social icons have explicit effect triggers',()=>{
 const {app}=story();
 const card=app.card({id:'p1',author:'林知远',handle:'@sample_account',text:'工作日常',likes:2900,comments:[],actions:{}});
 const bar=card.children.find(x=>x.className.includes('lp-wb-actions-inline'));
 const like=bar.children.find(x=>x.dataset.wbAction==='like');
 const favorite=bar.children.find(x=>x.dataset.wbAction==='favorite');
 assert.equal(like.dataset.touchEffect,'like');
 assert.equal(favorite.dataset.touchEffect,'favorite');
 assert.equal(favorite.textContent,'☆');
 assert.equal(favorite['aria-label'],'收藏');
 assert.match(index,/Date\.now\(\)-last>480/,'click fallback needs to work on Android');
 assert.match(css,/lpLikePressed/);
 assert.match(css,/lpLikeParticle/);
});
test('saved followed accounts have a functional history-management route from settings',async()=>{
 const {app}=story();
 await app.action('openAccount','weather');
 assert.equal(app.state.adminHistoryAccount,'');
 await app.action('manageHistory','weather');
 assert.equal(app.state.adminHistoryAccount,'','public profile may not manage history');
 app.state.subview='settings';
 await app.action('manageHistory','weather');
 assert.equal(app.state.adminHistoryAccount,'weather');
 assert.equal(app.state.profileAccount,'');
});
test('notification appears over ST page and phone, and can be turned off from Me',()=>{
 const beginning=index.indexOf('function messageBannersEnabled(');
 const ending=index.indexOf('async function clearMomentsUnread(',beginning);
 assert.ok(beginning>0&&ending>beginning);
 const code=index.slice(beginning,ending);
 const settings={gujiguji:{}};
 let saves=0,inPhone=false;
 const ctx={extensionSettings:settings,saveSettingsDebounced(){saves++;}};
 const outside={hidden:true,dataset:{},replaceChildren(...children){this.children=children;}};
 const inside={hidden:true,dataset:{},replaceChildren(...children){this.children=children;}};
 const nodes={notification:outside,inlineNotification:inside,
  messageBannerToggle:{checked:true},messageBannerStatus:{textContent:''}};
 const f=new Function('context','nodes','root','document','SETTINGS_KEY','notificationTimer','setTimeout','clearTimeout',
  code+'return {showPhoneAlert,setMessageBannersEnabled,messageBannersEnabled};')(
  ()=>ctx,nodes,{classList:{contains:()=>inPhone}},
  {createElement:element},'gujiguji',null,()=>1,()=>{});
 f.showPhoneAlert('林知远 发来 1 条新消息','chat','actor');
 assert.equal(outside.hidden,false);
 assert.equal(outside.dataset.contactId,'actor');
 assert.equal(outside.children[1].children[0].textContent,'咕叽聊 · 新消息');
 inPhone=true;
 f.showPhoneAlert('林知远 发布了新朋友圈','discover','');
 assert.equal(inside.hidden,false);
 assert.equal(inside.children[1].children[0].textContent,'朋友圈 · 新动态');
 f.setMessageBannersEnabled(false);
 assert.equal(saves,1);
 assert.equal(outside.hidden,true);
 assert.equal(inside.hidden,true);
 f.showPhoneAlert('关闭后不显示','chat','actor');
 assert.equal(inside.hidden,true);
 assert.match(index,/data-lp="messageBannerToggle"/);
 assert.match(css,/lp-inline-notification\.lp-message-banner/);
});
test('wand icon samples colorful enabled host peers rather than a disabled gray item',()=>{
 const start=index.indexOf('function installWandEntry()');
 const end=index.indexOf('function restoreDefaultThemeFromHost',start);
 assert.ok(start>0&&end>start);
 const body=index.slice(start,end);
 assert.match(body,/const peers=/);
 assert.match(body,/peerButton\.disabled/);
 assert.match(body,/sort\(\(x,y\)=>y\.score-x\.score\)/);
});


test('actual touch click creates ripple, click feedback, and a persistent particle overlay',()=>{
 const begin=index.indexOf('/* Shared interaction system for every GujiGuji app.');
 const end=index.indexOf('let phoneInteraction=null;',begin);
 assert.ok(begin>0&&end>begin);
 const classes=(...values)=>{
  const set=new Set(values);
  return {add:value=>set.add(value),remove:value=>set.delete(value),contains:value=>set.has(value)};
 };
 const listeners=new Map();
 const panel={children:[],classList:classes(),append(x){this.children.push(x);},
  getBoundingClientRect(){return {left:0,top:0,width:360,height:700};}};
 const root={dataset:{},classList:classes('lp-open'),contains:()=>true,
  addEventListener:(type,fn)=>listeners.set(type,fn),
  querySelector:query=>query==='.lp-panel'?panel:null};
 const makeEl=tag=>({tag,children:[],dataset:{},classList:classes(),
  style:{setProperty(){}},append(...items){this.children.push(...items);},
  addEventListener(){},remove(){},animate(){return{};}});
 const button={dataset:{touchEffect:'like',wbAction:'like'},textContent:'♡ 200',
  classList:classes(),style:{},offsetWidth:70,getAttribute:()=>null,
  matches:query=>query.includes('button')&&!query.startsWith('input'),
  closest:query=>query.includes('.lp-moment')?null:button,
  getBoundingClientRect:()=>({left:30,top:400,width:65,height:30}),
  append(item){this.ripple=item;}};
 const source=index.slice(begin,end);
 const controller=new Function('window','document',source+'return createInteractionController;')(
  {matchMedia:()=>({matches:false}),getComputedStyle:()=>({position:'relative'})},
  {createElement:makeEl})({
  getRoot:()=>root,getNodes:()=>({interactionFeedback:{hidden:true,textContent:'',dataset:{}},
   interactionMotion:{value:''}}),getMode:()=> 'standard'
 });
 controller.bind(root);
 const e={button:0,clientX:40,clientY:410,detail:1,target:{closest:()=>button}};
 listeners.get('pointerdown')(e);
 listeners.get('pointerup')(e);
 listeners.get('click')(e);
 assert.equal(button.ripple?.className,'lp-touch-ripple');
 assert.equal(button.classList.contains('lp-tap-flash'),true);
 const burst=panel.children.find(x=>x.className==='lp-like-burst');
 assert.ok(burst,'ripple alone is not enough: like burst overlay must be created');
 assert.equal(burst.children[0].textContent,'♥');
 assert.equal(burst.children[1].textContent,'+1');
 controller.shutdown();
});
