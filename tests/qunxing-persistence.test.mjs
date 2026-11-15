import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const script=readFileSync(new URL('../weibo.js',import.meta.url),'utf8');
const sharedSource=index.slice(
 index.indexOf('function phoneSelectionKey('),index.indexOf('function savedPhoneSelections(')
);
const roleFactory=new Function('selectedCharacter','getCharacterName','SETTINGS_KEY','recordError',
 sharedSource+'return {phoneSelectionKey,sharedQunxingAccounts,saveSharedQunxingAccounts,ensureSharedQunxingAccounts,explicitAccountFollowers};');
const ROLE_KEY='test-phone-config';
const role=roleFactory(c=>c.characters?.[c.characterId],c=>c.name,ROLE_KEY,()=>{});
const make=new Function('document','structuredClone',
 script.replace('export function createWeiboModule','function createWeiboModule')
  .replace('return {open,render,','return {data,mutate,open,render,')+
 '\nreturn createWeiboModule;');
const copy=x=>JSON.parse(JSON.stringify(x));
function setup({shared={},character=0,chat='story-a',legacyAccounts=[],phoneGenerate=null}={}){
 const characters=[{name:'林知远',avatar:'star-a.png'},{name:'另一个角色',avatar:'star-b.png'}];
 const c={characterId:character,chatId:chat,characters,
  extensionSettings:{[ROLE_KEY]:shared},saveSettingsDebounced(){this.saves=(this.saves||0)+1;},
  chatMetadata:{db:{version:1,storyTime:'2026-11-15T12:00',contacts:[],messages:[],
   qunxing:{posts:[],accounts:legacyAccounts,following:[]}}}};
 let calls=0;
 const app=make({visibilityState:'visible'},copy)({
  context:()=>c,getNodes:()=>null,
  readRootData:ctx=>ctx.chatMetadata.db,readData:ctx=>ctx.chatMetadata.db,
  writeData:async(ctx,value)=>{const payload={...value};delete payload.__contactId;ctx.chatMetadata.db=payload;},
  selectedCharacter:ctx=>ctx.characters[ctx.characterId],
  currentPersona:()=>({name:'user'}),stripModelReasoning:x=>x,
  storyContext:()=>'',recordActivity:()=>{},recordError:()=>{},
  readSharedAccounts:()=>role.sharedQunxingAccounts(c),
  saveSharedAccounts:(accounts,ctx)=>role.saveSharedQunxingAccounts(accounts,ctx),
  ensureSharedAccounts:()=>role.ensureSharedQunxingAccounts(c),
  phoneGenerate:async(_ctx,options)=>{
   calls++;
   if(phoneGenerate)return phoneGenerate(options,calls);
   const prompt=options.prompt?.[0]?.content||'';
   if(prompt.includes('一次性生成完整世界热搜榜')){
    return JSON.stringify({topics:Array.from({length:15},(_,i)=>({
     title:'热议'+i,category:'社会',summary:'热门事件',
     posts:[{author:'网友'+i,text:'完整评论帖'+i,
      comments:[{name:'甲',text:'我同意'},{name:'乙',text:'不同意见'}]}]
    }))});
   }
   return JSON.stringify({headline:'话题'+calls,
    posts:Array.from({length:prompt.includes('周边')?12:5},(_,i)=>({
     author:'路人'+i,text:'这轮生成的帖子'+calls+'-'+i,
     comments:[{name:'甲',text:'评论甲'},{name:'乙',text:'评论乙'}]
    }))});
  }
 });
 return {c,app,calls:()=>calls,role,shared,characters};
}
function secondStory(first,id='story-b'){
 const c={...first.c,chatId:id,chatMetadata:{db:{
  version:1,storyTime:'2026-11-16T13:00',contacts:[],messages:[],
  qunxing:{posts:[],accounts:[],following:[]}
 }}};
 const app=make({visibilityState:'visible'},copy)({
  context:()=>c,getNodes:()=>null,
  readRootData:ctx=>ctx.chatMetadata.db,readData:ctx=>ctx.chatMetadata.db,
  writeData:async(ctx,value)=>{const v={...value};delete v.__contactId;ctx.chatMetadata.db=v;},
  selectedCharacter:ctx=>ctx.characters[ctx.characterId],currentPersona:()=>({name:'user'}),
  readSharedAccounts:()=>role.sharedQunxingAccounts(c),
  saveSharedAccounts:(accounts,ctx)=>role.saveSharedQunxingAccounts(accounts,ctx),
  ensureSharedAccounts:()=>role.ensureSharedQunxingAccounts(c),
  stripModelReasoning:x=>x,recordActivity:()=>{},recordError:()=>{},
  phoneGenerate:async()=>{throw Error('must not generate unless requested');}
 });
 return {c,app};
}
test('manual NPC and char account directory persists across two chats of the same character card',async()=>{
 const h=setup();
 h.app.open();
 await h.app.mutate(q=>{q.accounts.push({
  id:'acc-sample-actor',name:'林知远',kind:'角色',bio:'演员',
  handle:'@sample_account',followers:32000000,source:'manual',publicFigure:true
 });});
 assert.equal(role.sharedQunxingAccounts(h.c).length,1);
 const second=secondStory(h);
 second.app.open();
 const account=second.app.data().accounts.find(x=>x.id==='acc-sample-actor');
 assert.ok(account);
 assert.equal(account.followers,32000000);
 assert.equal(account.handle,'@sample_account');
 assert.equal(second.c.chatMetadata.db.qunxing.posts.length,0);
});
test('unrelated character card never sees the saved directory of another card',async()=>{
 const h=setup();await h.app.mutate(q=>{q.accounts.push({
  id:'a',name:'林知远',kind:'角色',source:'manual',followers:8000000
 });});
 h.c.characterId=1;
 h.c.chatMetadata={db:{version:1,messages:[],qunxing:{accounts:[],posts:[]}}};
 h.app.open();
 assert.equal(h.app.data().accounts.length,0);
 assert.equal(role.sharedQunxingAccounts(h.c),null);
});
test('legacy accounts migrate once, and deleting the last shared account does not resurrect old chats',async()=>{
 const old={id:'legacy',name:'旧档中的NPC',source:'manual',followers:90000};
 const h=setup({legacyAccounts:[old]});
 h.app.open();
 assert.equal(role.sharedQunxingAccounts(h.c)?.[0].id,'legacy');
 await h.app.mutate(q=>{q.accounts=[];});
 assert.deepEqual(role.sharedQunxingAccounts(h.c),[]);
 const older=secondStory(h,'older-chat');
 older.c.chatMetadata.db.qunxing.accounts=[old];
 older.app.open();
 assert.equal(older.app.data().accounts.length,0);
});
test('closing and reopening a phone and re-creating its controller retains posts and full hot discussions without API requests',async()=>{
 const h=setup();
 await h.app.generate('home');
 await h.app.generate('nearby');
 await h.app.generateHot();
 const before=h.calls();
 const ids=h.app.state.posts.home.map(x=>x.id);
 const hotPosts=h.app.state.hotBundles[JSON.stringify(['home','热议3'])].posts;
 assert.equal(before,4);
 h.app.endPhoneSession();h.app.open();
 assert.equal(h.calls(),before);
 assert.deepEqual(h.app.state.posts.home.map(x=>x.id),ids);
 assert.equal(h.app.state.posts.nearby.length,12);
 assert.equal(h.app.state.trends.length,15);
 const reboot=secondStory(h,'story-a');
 reboot.c.chatMetadata=h.c.chatMetadata;
 reboot.app.open();
 assert.deepEqual(reboot.app.state.posts.home.map(x=>x.id),ids);
 assert.equal(reboot.app.state.trends.length,15);
 await reboot.app.openTopic('热议3');
 assert.equal(reboot.app.state.topic.posts[0].text,hotPosts[0].text);
 assert.equal(reboot.app.state.topic.posts[0].comments.length,2);
});
test('new story chat does not inherit the previous story generated posts or hot topics',async()=>{
 const h=setup();await h.app.generate('home');await h.app.generateHot();
 const b=secondStory(h);
 b.app.open();
 assert.equal(b.app.state.posts.home.length,0);
 assert.equal(b.app.state.trends.length,0);
 assert.equal(b.c.chatMetadata.db.qunxing.posts.length,0);
});
test('manual refresh discards generated posts before sending a new API request',async()=>{
 let unblock,started;
 const startedPromise=new Promise(resolve=>{started=resolve;});
 const deferred=new Promise(resolve=>{unblock=resolve;});
 let block=false;
 const h=setup({phoneGenerate:(options,calls)=>{
  if(block&&calls===3){started();return deferred;}
  return JSON.stringify({headline:'当前话题',posts:Array.from({length:5},(_,i)=>({
   author:'网友',text:'初始'+calls+'-'+i,comments:[{name:'甲',text:'评论'}]
  }))});
 }});
 await h.app.generate('home');assert.equal(h.app.state.posts.home.length,10);
 block=true;
 const refresh=h.app.generate('home');
 await startedPromise;
 assert.equal(h.app.state.posts.home.length,0);
 assert.equal(h.c.chatMetadata.db.qunxing.generated.feeds.home.length,0);
 assert.equal(h.c.chatMetadata.db.qunxing.posts.length,0);
 unblock(JSON.stringify({headline:'刷新结果',posts:Array.from({length:5},(_,i)=>({
  author:'新网友',text:'刷新后'+i,comments:[{name:'乙',text:'新评论'}]
 }))}));
 await refresh;
 assert.equal(h.app.state.posts.home.length,10);
 assert.match(h.app.state.posts.home[0].text,/刷新后/);
});
test('follower counts are read only from explicit numbers, with Chinese large-number units',()=>{
 assert.equal(role.explicitAccountFollowers('微博粉丝数量：3500万'),35000000);
 assert.equal(role.explicitAccountFollowers('社交媒体粉丝 1.2亿'),120000000);
 assert.equal(role.explicitAccountFollowers('粉丝数：5000000'),5000000);
 assert.equal(role.explicitAccountFollowers('曾经很受欢迎，很多粉丝'),null);
 assert.match(index,/followers:old\?\.followers\|\|0/,'the old import form remains compatible');
});
