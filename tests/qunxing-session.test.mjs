import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const code=readFileSync(new URL('../weibo.js',import.meta.url),'utf8');
const shell=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const make=new Function('document','structuredClone',
 code.replace('export function createWeiboModule','function createWeiboModule')+
 '\nreturn createWeiboModule;');
function harness(){
 const base={storyTime:'2026-11-15T13:10',contacts:[],messages:[],qunxing:{
  posts:[{id:'original',author:'我',text:'我的原创',zone:'world',actions:{owned:true}}],
  accounts:[],following:[]}};
 const ctx={characterId:0,chatId:'session-test',chatMetadata:{db:base}};
 let calls=0;
 const requests=[];
 const app=make({visibilityState:'visible'},structuredClone)({
  context:()=>ctx,getNodes:()=>null,readRootData:()=>ctx.chatMetadata.db,
  readData:()=>ctx.chatMetadata.db,selectedCharacter:()=>({name:'演员',description:'虚构演员'}),
  currentPersona:()=>({name:'我'}),storyContext:()=>'',stripModelReasoning:s=>s,
  recordActivity:()=>{},recordError:()=>{},
  writeData:async(_,d)=>{delete d.__contactId;ctx.chatMetadata.db=d;},
  phoneGenerate:async(_ctx,options)=>{
   calls++;requests.push(options);
   const prompt=options.prompt[0].content;
   if(prompt.includes('一次性生成完整世界热搜榜'))
    return JSON.stringify({topics:Array.from({length:15},(_,i)=>({
     title:'热点'+i,category:'社会',summary:'话题'+i,
     posts:[{author:'网友'+i,text:'讨论内容'+i,
      comments:[{name:'路人甲',text:'我觉得不对'},{name:'路人乙',text:'有趣的观点'}]}]
    }))});
   return JSON.stringify({headline:'今天的公开话题'+calls,
    posts:Array.from({length:prompt.includes('周边')?12:5},(_,i)=>({
     author:'网友'+i,category:'日常',text:'第'+calls+'轮动态'+i,
     comments:[{name:'甲',text:'支持'},{name:'乙',text:'不认同'}]
    }))});
  }
 });
 return {app,ctx,requests,calls:()=>calls};
}
test('within a phone session re-entering Qunxing preserves every un-interacted post',async()=>{
 const h=harness();
 await h.app.generate('home');
 const ids=h.app.state.posts.home.map(p=>p.id);
 assert.equal(ids.length,10);
 assert.equal(h.calls(),2);
 h.app.open(); // navigate to another app and back, NOT close the virtual phone
 assert.equal(h.calls(),2,'returning to Qunxing must not generate again');
 assert.deepEqual(h.app.state.posts.home.map(p=>p.id),ids);
 assert.equal(h.app.state.attempted.world,true);
 // Manual refreshing replaces the feed and explicitly calls the model.
 await h.app.generate('home');
 assert.equal(h.calls(),4);
 assert.equal(h.app.state.posts.home.length,10);
 assert.notEqual(h.app.state.posts.home[0].id,ids[0]);
});
test('closing the entire phone discards generated items while preserving authored posts',async()=>{
 const h=harness();
 await h.app.generate('home');
 await h.app.generate('nearby');
 await h.app.generateHot();
 assert.equal(h.app.state.posts.home.length,10);
 assert.equal(h.app.state.posts.nearby.length,12);
 assert.equal(h.app.state.trends.length,15);
 h.app.endPhoneSession();
 assert.equal(h.app.state.posts.home.length,0);
 assert.equal(h.app.state.posts.nearby.length,0);
 assert.equal(h.app.state.trends.length,0);
 assert.ok(h.ctx.chatMetadata.db.qunxing.posts.some(p=>p.id==='original'));
 assert.equal(h.ctx.chatMetadata.db.qunxing.posts.length,1);
});
test('nearby generation is one API invocation for complete posts and comments',async()=>{
 const h=harness();
 await h.app.generate('nearby');
 assert.equal(h.calls(),1);
 assert.equal(h.app.state.posts.nearby.length,12);
 assert.equal(h.app.state.posts.nearby[0].comments.length,2);
 assert.equal(h.requests[0].maxTokens,4000);
});
test('hot list generates 15 topics and posts in one API call; topic clicks reuse them',async()=>{
 const h=harness();
 await h.app.generateHot();
 assert.equal(h.calls(),1);
 assert.equal(h.requests[0].maxTokens,10000);
 assert.equal(h.app.state.trends.length,15);
 assert.equal(h.app.state.trends[0].preview,'讨论内容0');
 await h.app.openTopic('热点0','home');
 assert.equal(h.calls(),1);
 assert.equal(h.app.state.topic.posts.length,1);
 assert.equal(h.app.state.topic.posts[0].comments[1].text,'有趣的观点');
 await h.app.openTopic('热点9','home');
 assert.equal(h.calls(),1);
 assert.equal(h.app.headline(),'热点0');
});
test('home hot-search button displays the generated topic and has a confirmation pathway',()=>{
 assert.match(shell,/function updateHomeHotSearch\(\)/);
 assert.match(shell,/weiboController\?\.headline\?\.\(\)/);
 assert.match(shell,/await w\.confirmHotSearch\(\)/);
 assert.match(code,/lp-wb-confirm-overlay/);
 assert.match(code,/查看热搜/);
 assert.match(code,/closeHotConfirmation\?\.\(false\)/);
 assert.match(shell,/weiboController\?\.endPhoneSession\?\.\(\)/);
});

test('the hot-search confirmation is a real dismissible dialog and closing the phone cancels it',async()=>{
 const makeElement=tag=>({
  tagName:tag.toUpperCase(),className:'',textContent:'',children:[],handlers:{},
  append(...children){this.children.push(...children);},
  setAttribute(){},addEventListener(type,fn){this.handlers[type]=fn;},
  remove(){this.removed=true;},focus(){}
 });
 const panel=makeElement('div');
 const document={createElement:makeElement,visibilityState:'visible'};
 const build=new Function('document','structuredClone',
  code.replace('export function createWeiboModule','function createWeiboModule')+
  '\nreturn createWeiboModule;');
 const app=build(document,structuredClone)({
  getNodes:()=>({weiboHot:{closest:()=>panel}}),
  context:()=>({characterId:0,chatId:'modals'}),
  readRootData:()=>({qunxing:{posts:[]},storyTime:'2026-11-15T11:00'}),
  currentPersona:()=>({name:'我'})
 });
 const first=app.confirmHotSearch();
 let mask=panel.children.at(-1),dialog=mask.children[0];
 let buttons=dialog.children.at(-1).children;
 assert.equal(buttons[1].textContent,'查看热搜');
 buttons[0].handlers.click();
 assert.equal(await first,false);
 assert.equal(mask.removed,true);
 const second=app.confirmHotSearch();
 mask=panel.children.at(-1);dialog=mask.children[0];
 buttons=dialog.children.at(-1).children;
 buttons[1].handlers.click();
 assert.equal(await second,true);
 const third=app.confirmHotSearch();
 mask=panel.children.at(-1);
 app.endPhoneSession();
 assert.equal(await third,false,'closing phone must cancel an unresolved confirmation');
 assert.equal(mask.removed,true);
});
