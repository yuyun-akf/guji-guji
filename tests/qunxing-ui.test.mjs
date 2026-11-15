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
  phoneGenerate:async()=>{requests++;
   return JSON.stringify({topics:Array.from({length:15},(_,i)=>({
    title:i===0?'新剧首映':'话题'+i,category:'影视',
    summary:i===0?'虚构新剧的讨论':'网友讨论',
    posts:[
     {author:'影迷甲',text:'看了预告',comments:[{name:'观众',text:'期待上映'}]},
     {author:'影迷乙',text:'聊聊角色',comments:[{name:'粉丝',text:'角色塑造很特别'}]}
    ]
   }))});
  },
  recordActivity:()=>{},recordError:()=>{}
 };
 return {module:factory(api),ctx,requests:()=>requests};
}
test('十五个热搜及对应帖子评论单次生成；点开详情不再发请求或持久化',async()=>{
 const h=harness();
 await h.module.generateHot();
 assert.equal(h.requests(),1,'十五个话题只能调用一次模型');
 assert.equal(h.module.state.trends.length,15);
 assert.equal(h.module.state.trends[0].preview,'看了预告');
 await h.module.openTopic('新剧首映','home');
 assert.equal(h.requests(),1,'点击热搜直接使用同轮生成内容');
 assert.equal(h.module.state.topic.title,'新剧首映');
 assert.equal(h.module.state.topic.posts.length,2);
 assert.equal(h.module.state.topic.posts[0].comments[0].text,'期待上映');
 assert.equal(h.module.state.posts.home.length,0);
 assert.equal(Object.keys(h.ctx.chatMetadata.st_little_phone_v1.qunxing.topicDetails||{}).length,0);
 await h.module.openTopic('新剧首映','home');
 assert.equal(h.requests(),1,'重复打开详情仍然不产生 API 费用');
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


test('扫描只生成候选账号，明确勾选保存后才写入存档',async()=>{
 const extended=new Function('document',src.replace('export function createWeiboModule','function createWeiboModule')
   .replace('return {open,render,','return {action,open,render,')+'\nreturn createWeiboModule;')({visibilityState:'visible'});
 const ctx={characterId:0,chatId:'test-scan',chatMetadata:{st_little_phone_v1:{
  storyTime:'2025-12-17T19:50',contacts:[],messages:[],qunxing:{accounts:[]}
 }}};
 let selected=[];
 const n={weiboFeed:null,weiboMe:{parentElement:{scrollTop:0},
  querySelector:()=>({value:''}),querySelectorAll:()=>selected}};
 const api={
  context:()=>ctx,getNodes:()=>n,readRootData:()=>ctx.chatMetadata.st_little_phone_v1,
  readData:()=>ctx.chatMetadata.st_little_phone_v1,selectedCharacter:()=>({name:'角色'}),
  currentPersona:()=>({name:'我'}),recordError:()=>{},
  writeData:async(_,d)=>{delete d.__contactId;ctx.chatMetadata.st_little_phone_v1=d;},
  scanAccounts:async()=>({scanned:5,worlds:1,failures:[],candidates:[
   {name:'角色甲',kind:'NPC',source:'世界书',reference:'演员'}
  ]})
 };
 const module=extended(api);
 await module.action('scanAccounts');
 assert.equal(module.state.candidates.length,1);
 assert.equal(ctx.chatMetadata.st_little_phone_v1.qunxing.accounts.length,0);
 const fields={name:{value:'角色甲'},handle:{value:'@actor'},profession:{value:'演员'},
  bio:{value:'公开简介：今天天气不错'},publicFigure:{checked:true,type:'checkbox'},
  followers:{value:'3500'},followersUnit:{value:'wan'}};
 selected=[{closest:()=>({dataset:{wbCandidate:'0'},querySelector:selector=>{
  if(selector.includes('data-wb-field="candidate-0-subject"'))return {value:'npc:'+encodeURIComponent('角色甲')};
  if(selector.includes('data-wb-field="candidate-0-followersUnit"'))return fields.followersUnit;
  if(selector.includes('data-wb-field="candidate-0-followers"'))return fields.followers;
  return fields[selector.match(/data-wb-candidate-field="([^"]+)"/)?.[1]];
 }})}];
 await module.action('saveCandidates');
 const saved=ctx.chatMetadata.st_little_phone_v1.qunxing.accounts;
 assert.equal(saved.length,1);
 assert.equal(saved[0].handle,'@actor');
 assert.equal(saved[0].followers,35000000,'3500 万保存为整数人数');
 assert.deepEqual(saved[0].subject,{type:'npc',name:'角色甲'});
 assert.equal(saved[0].profession,'演员');
 assert.equal(saved[0].bio,'公开简介：今天天气不错');
 assert.equal(saved[0].source,'manual');
});
