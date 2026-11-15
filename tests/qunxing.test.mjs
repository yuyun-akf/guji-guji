import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../weibo.js',import.meta.url),'utf8');
const make=new Function('document',source.replace('export function createWeiboModule','function createWeiboModule')+'\nreturn createWeiboModule;')({visibilityState:'visible'});
function harness(){
 const memory={version:1,storyTime:'2025-12-17T19:50',messages:[],contacts:[],qunxing:{
  accounts:[{id:'acc-char',name:'林知远',handle:'@sample_account',kind:'演员',bio:'公众人物',publicFigure:true,source:'manual'}],
  following:['acc-char'],posts:[],settings:{autoEnabled:false,autoEveryMinutes:180}
 }};
 const ctx={chatId:'test-chat',characterId:1,chatMetadata:{st_little_phone_v1:memory}};
 let calls=0;
 const api={
  context:()=>ctx,getNodes:()=>null,readRootData:()=>ctx.chatMetadata.st_little_phone_v1,
  readData:()=>ctx.chatMetadata.st_little_phone_v1,currentPersona:()=>({name:'u'}),
  selectedCharacter:()=>({name:'林知远',description:'公众人物，演员'}),
  storyContext:()=>'',stripModelReasoning:x=>x,recordActivity:()=>{},recordError:(_,e)=>{throw e;},
  writeData:async(_,d)=>{delete d.__contactId;ctx.chatMetadata.st_little_phone_v1=d;},
  phoneGenerate:async(_,opts)=>{
   calls++;
   if(opts.systemPrompt.includes('自主发帖'))return '今天的拍摄顺利结束。';
   return JSON.stringify({posts:Array.from({length:5},(_,i)=>({
    author:i===0?'林知远':'网友'+i,handle:i===0?'@sample_account':'@'+i,
    text:'公开动态 '+i,likes:i,comments:[{name:'路人',text:'测试评论'}]
   })),trending:Array.from({length:15},(_,i)=>({title:'话题 '+i,category:'讨论'}))});
  }
 };
 return {module:make(api),ctx,calls:()=>calls};
}
test('世界推荐保留两次请求，周边一次请求生成真实帖子；未互动内容不写进存档',async()=>{
 const h=harness();
 await h.module.generate('home');
 assert.equal(h.calls(),2);
 assert.equal(h.module.state.posts.home.length,10);
 assert.equal(h.ctx.chatMetadata.st_little_phone_v1.qunxing.posts.length,0);
 assert.equal(h.module.headline(),'话题 0');
 await h.module.generate('nearby');
 assert.equal(h.calls(),3,'周边只发起一次 API 请求');
 assert.equal(h.module.state.posts.nearby.length,5,'模型返回的五条完整帖子均保留');
 assert.equal(h.ctx.chatMetadata.st_little_phone_v1.qunxing.posts.length,0);
 assert.equal(h.ctx.chatMetadata.st_little_phone_v1.qunxing.nearbyTrends.length,0);
 assert.equal(h.ctx.chatMetadata.st_little_phone_v1.qunxing.accounts[0].name,'林知远');
});
test('手动角色账号能自主营业，帖子保存且不代替 user 发布',async()=>{
 const h=harness();
 await h.module.tick(true);
 const q=h.ctx.chatMetadata.st_little_phone_v1.qunxing;
 assert.equal(h.calls(),1);
 assert.equal(q.posts.length,1);
 assert.equal(q.posts[0].author,'林知远');
 assert.equal(q.posts[0].autoPublished,true);
 assert.equal(q.posts[0].actions.owned,undefined);
});
test('五栏主页与主题设置节点都存在，桌面不再内嵌固定应用栏',()=>{
 const js=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 const html=js.split('container.innerHTML = ' + String.fromCharCode(96))[1]
  .split(String.fromCharCode(96)+';\n    return container;')[0];
 for(const tab of ['home','discover','nearby','compose','me'])
  assert.match(html,new RegExp('data-weibo-tab="'+tab+'"'));
 for(const control of ['themeWallpaper','themePreset','desktopSortList','lockKeypad','lockChangePin'])
  assert.match(html,new RegExp('data-lp="'+control+'"'));
 assert.doesNotMatch(html,/class="lp-home-dock"/);
 assert.equal((html.match(/data-lp="desktopSortList"/g)||[]).length,1);
});
