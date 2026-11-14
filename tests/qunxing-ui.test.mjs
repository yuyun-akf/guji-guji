import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../weibo.js',import.meta.url),'utf8');
const script=src.replace('export function createWeiboModule','function createWeiboModule')
 .replace('return {open,render,','return {openTopic,open,render,');
const factory=new Function('document',script+'\nreturn createWeiboModule;')({visibilityState:'visible'});
function harness(){
 const ctx={characterId:0,chatId:'case-1',chatMetadata:{st_little_phone_v1:{
  storyTime:'2025-12-17T19:50',messages:[],contacts:[],qunxing:{
   accounts:[],posts:[],trends:[{title:'新剧首映',category:'影视'}]
  }
 }}};
 let requests=0;
 const api={
  context:()=>ctx,getNodes:()=>null,readRootData:()=>ctx.chatMetadata.st_little_phone_v1,
  readData:()=>ctx.chatMetadata.st_little_phone_v1,
  selectedCharacter:()=>({name:'虚构演员',description:'演员'}),
  currentPersona:()=>({name:'用户'}),storyContext:()=>'',stripModelReasoning:s=>s,
  writeData:async(_,d)=>{delete d.__contactId;ctx.chatMetadata.st_little_phone_v1=d;},
  phoneGenerate:async()=>{requests++;return JSON.stringify({
   summary:'虚构新剧的讨论',posts:[
    {author:'影迷甲',text:'看了预告',comments:[{name:'观众',text:'期待上映'}]},
    {author:'影迷乙',text:'聊聊角色',comments:[{name:'粉丝',text:'角色塑造很特别'}]}
   ]
  });},
  recordActivity:()=>{},recordError:()=>{}
 };
 return {module:factory(api),ctx,requests:()=>requests};
}
test('热搜是可保存的内容详情，不再以点击词条替换世界首页',async()=>{
 const h=harness();
 await h.module.openTopic('新剧首映','home');
 assert.equal(h.requests(),1);
 assert.equal(h.module.state.topic.title,'新剧首映');
 assert.equal(h.module.state.topic.posts.length,2);
 assert.equal(h.module.state.topic.posts[0].comments[0].text,'期待上映');
 assert.equal(h.module.state.posts.home.length,0);
 assert.equal(Object.keys(h.ctx.chatMetadata.st_little_phone_v1.qunxing.topicDetails).length,1);
 await h.module.openTopic('新剧首映','home');
 assert.equal(h.requests(),1,'话题详情在同一存档里复用，不重复计费');
});
test('群星资料识别、独立子页面、刷新尾部、主题壁纸和桌面结构均已连接',()=>{
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');
 const html=index.split('container.innerHTML = '+String.fromCharCode(96))[1].split(String.fromCharCode(96)+';\n    return container;')[0];
 for(const name of ['weiboRefreshBox','themeBindWallpaper','themeDesktopEffect'])
  assert.ok(html.includes('data-lp="'+name+'"'),name);
 assert.doesNotMatch(html,/class="lp-weibo-top"/);
 assert.ok(index.includes('scanAccounts:scanQunxingAccounts'));
 assert.ok(index.includes('async function scanQunxingAccounts('));
 assert.ok(index.includes('desktopLayoutSignature'));
 assert.ok(index.includes("if(page===0)"));
 assert.ok(index.includes('root.addEventListener('),'dynamic picker listeners');
 assert.ok(src.includes("if(type==='saveCandidates')"));
 assert.ok(src.includes("if(type==='backMe')"));
 assert.ok(src.includes("lp-wb-me-menu"));
 assert.ok(css.includes('lp-wb-avatar-picker'));
 assert.ok(css.includes('lp-wb-refresh-button'));
 assert.ok(css.includes('scrollbar-color:color-mix'));
 assert.ok(css.includes('lp-theme-binding'));
});
