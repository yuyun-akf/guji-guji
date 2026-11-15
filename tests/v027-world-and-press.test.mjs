import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const weibo=readFileSync(new URL('../weibo.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');
const manifest=JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url),'utf8'));

function element(tag='div'){
 const children=[];
 return {tagName:tag.toUpperCase(),dataset:{},style:{},textContent:'',className:'',
  children,childNodes:children,append(...items){children.push(...items);},
  replaceChildren(...items){children.splice(0,children.length,...items);},
  setAttribute(name,value){this[name]=value;},
  classList:{add(){},remove(){},contains(){return false;},toggle(){}},
  addEventListener(){}};
}
function setup(withModel=false){
 const ctx={chatId:'world',characterId:3,chatMetadata:{}};
 const initial={id:'temp1',author:'都市观察报',handle:'@city',
  text:'近期公共新闻',category:'媒体',followers:800000,accountLikes:6400000,
  accountComments:215000,followingCount:102,likes:33500,commentCount:1940,
  comments:[{id:'c1',name:'甲',text:'好'},{id:'c2',name:'乙',text:'收到'}],
  zone:'world',time:'2026-11-14T18:00',actions:{}};
 let db={storyTime:'2026-11-16T20:00',contacts:[],messages:[],qunxing:{
  accounts:[
   {id:'official',name:'林知远',handle:'@official',source:'manual',followers:46127300,
    subject:{type:'primary',name:'林知远'},operatorMode:'team'},
   {id:'secret',name:'路过的人',handle:'@secret',source:'manual',followers:32,
    subject:{type:'primary',name:'林知远'},identityVisibility:'private',operatorMode:'self'}],
  following:[],posts:[],generated:{feeds:{home:[initial]},attempted:{world:true}}
 }};
 let calls=0;
 const source=weibo.replace('export function createWeiboModule','function createWeiboModule')
  .replace('return {open,render,','return {action,renderAccountSearchResults,publicAccountInfo,accountHistory,open,render,');
 const factory=new Function('document','structuredClone',source+'\nreturn createWeiboModule;')(
  {visibilityState:'visible',createElement:element,createTextNode:t=>({textContent:t})},
  x=>JSON.parse(JSON.stringify(x)));
 const fields={};
 const editor={querySelector(selector){
  const name=selector.match(/\[data-wb-field="([^"]+)"\]/)?.[1];
  return name?{value:fields[name]??'',checked:fields[name]===true}:null;
 }};
 const api={context:()=>ctx,readRootData:()=>db,readData:()=>db,
  writeData:async(_,value)=>{db=value;},getNodes:()=>({weiboFeed:null,weiboMe:editor}),
  selectedCharacter:()=>({name:'林知远'}),currentPersona:()=>({name:'我'}),
  stripModelReasoning:x=>x,
  ...(withModel?{phoneGenerate:async()=>{
   calls++;
   return JSON.stringify({posts:Array.from({length:5},(_,i)=>({
    author:'随机网友'+calls+'-'+i,handle:'@random'+calls+'-'+i,
    text:'新帖子 '+i,category:'生活',followers:98000,
    accountLikes:450000,accountComments:8100,likes:1200,
    comments:[{name:'甲',text:'有趣'},{name:'乙',text:'赞同'}]
   }))});
  }}:{})};
 const app=factory(api);app.open();
 return {app,db:()=>db,fields,initial,calls:()=>calls};
}

test('v0.27 starts with cached posts, simple button press and centered outcomes',()=>{
 assert.equal(manifest.version,'0.27.0');
 assert.ok(index.includes("weibo.js?v=0.27.0"));
 assert.ok(css.includes('filter:brightness(.84)!important'));
 assert.ok(css.includes('top:50%!important'));
 assert.ok(css.includes('margin:0 13px 14px!important'));
 assert.ok(index.includes("kind==='error'?2500:1200"));
 assert.ok(index.includes('lp-click-feedback'));
 assert.ok(css.includes('lpSocialTapRebound'));
 assert.ok(css.includes('[data-wb-action="favorite"]'));
 assert.ok(!index.slice(index.indexOf('function createInteractionController'),index.indexOf('let phoneInteraction=null;')).includes('function burst('));
});
test('80万粉丝成熟媒体号拥有刷新前的历史累计数据，而非本帖从零开始',()=>{
 const {app}=setup();
 const p=app.normalize({author:'新闻观察日报',handle:'@news',text:'今日新闻',
  followers:800000,likes:500,accountLikes:200,accountComments:4,
  comments:[{name:'甲',text:'好'},{name:'乙',text:'明白'}]},'world');
 assert.equal(p.followers,800000);
 assert.ok(p.accountLikes>=800000,'historical likes should not be this one post');
 assert.ok(p.accountComments>2000);
 assert.ok(p.commentCount>=2);
 assert.equal(app.normalize({author:'空白',text:'没有评论',comments:[]},'world'),null);
});
test('random likes and favorites stay in current feed cache, never permanently collect strangers',async()=>{
 const h=setup();
 await h.app.action('like',h.initial.id);
 assert.equal(h.db().qunxing.posts.length,0);
 assert.equal(h.db().qunxing.accounts.length,2);
 assert.equal(h.db().qunxing.generated.feeds.home[0].actions.liked,true);
 await h.app.action('favorite',h.initial.id);
 assert.equal(h.db().qunxing.generated.feeds.home[0].actions.favorited,true);
 assert.equal(h.db().qunxing.posts.length,0);
 await h.app.action('follow',h.initial.id);
 assert.equal(h.db().qunxing.accounts.length,3);
 assert.equal(h.db().qunxing.following.length,1);
 assert.equal(h.db().qunxing.posts.length,1);
 assert.equal(h.db().qunxing.accounts.find(a=>a.handle==='@city').likesTotal,6400000);
});
test('refresh replaces current transient posts; it does not build a persistent NPC directory',async()=>{
 const h=setup(true);
 await h.app.action('like',h.initial.id);
 await h.app.generate('home');
 assert.equal(h.calls(),2);
 assert.equal(h.db().qunxing.posts.length,0);
 assert.equal(h.db().qunxing.accounts.length,2);
 assert.equal(h.db().qunxing.generated.feeds.home.length,10);
 assert.equal(h.db().qunxing.generated.feeds.home.some(p=>p.id===h.initial.id),false);
});
test('same-character official/private accounts remain separate, and private binding is not public',()=>{
 const h=setup(),accounts=h.db().qunxing.accounts;
 const official=h.app.normalize({author:'林知远',handle:'@official',text:'公告',
  comments:[{name:'甲',text:'好'},{name:'乙',text:'好'}]},'world');
 const secret=h.app.normalize({author:'路过的人',handle:'@secret',text:'日常',
  comments:[{name:'甲',text:'嗯'},{name:'乙',text:'好的'}]},'world');
 assert.equal(official.authorId,'official');
 assert.equal(secret.authorId,'secret');
 assert.equal(h.app.publicAccountInfo(accounts[1]).includes('林知远'),false);
 assert.equal(h.app.publicAccountInfo(accounts[0]).includes('工作室'),true);
});
test('discover search starts empty and only finds entered nicknames/IDs',()=>{
 const h=setup(),view=element('div');
 h.app.renderAccountSearchResults(view);
 assert.equal(view.children.length,1);
 assert.equal(view.children[0].tagName,'SMALL');
 h.app.state.searchQuery='@official';
 h.app.renderAccountSearchResults(view);
 assert.equal(view.children.length,1);
 const row=view.children[0];
 assert.equal(row.children.length,2);
 assert.equal(row.children[1].dataset.wbAction,'followAccount');
 h.app.state.searchQuery='不存在的账号';
 h.app.renderAccountSearchResults(view);
 assert.equal(view.children.length,1);
 assert.equal(view.children[0].tagName,'SMALL');
});
test('another account may bind same subject with independent operator and private identity',async()=>{
 const h=setup();
 await h.app.action('newAccount');
 Object.assign(h.fields,{accountName:'林知远的小号',accountHandle:'@private_alt',
  accountSubject:'primary',accountFollowers:'120',accountFollowersUnit:'person',
  accountProfession:'个人',accountOperatorMode:'self',accountIdentityVisibility:'private',
  accountIdentityKnownTo:'',accountOperatorName:'',accountPublic:false,
  accountFollowing:'',accountLikes:'',accountComments:''});
 await h.app.action('saveAccount');
 const accounts=h.db().qunxing.accounts;
 assert.equal(accounts.length,3);
 const alt=accounts.find(a=>a.handle==='@private_alt');
 assert.equal(alt.subject.type,'primary');
 assert.equal(alt.identityVisibility,'private');
 assert.equal(alt.operatorMode,'self');
 assert.equal(alt.likesTotal,null);
 assert.equal(accounts[0].operatorMode,'team');
});
