import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const files={};
for(const p of ['index.js','weibo.js','style.css','groups.js','shopping.js','takeout.js','album.js','bootstrap.js','manifest.json'])
 files[p]=readFileSync(new URL('../'+p,import.meta.url),'utf8');
const index=files['index.js'],weibo=files['weibo.js'];
const section=(source,start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));

test('v0.31.0: scripts parse and module cache keys are updated',()=>{
 assert.equal(JSON.parse(files['manifest.json']).version,'0.31.0');
 for(const path of ['index.js','weibo.js','groups.js','shopping.js','takeout.js','album.js','bootstrap.js'])
  assert.doesNotThrow(()=>new Function(files[path].replace(/^export /gm,'')),path);
 for(const path of ['weibo','groups','shopping','takeout','album'])
  assert.match(index,new RegExp(path+'\\.js\\?v=0\\.30\\.0'));
 assert.match(files['bootstrap.js'],/index\.js\?v=0\.31\.0/);
});

test('pin buttons are removed; long press opens a menu and scroll memory exists across apps',()=>{
 const wrap=section(index,'function phoneThreadWrap(','async function openGroupFromChatList(');
 assert.doesNotMatch(wrap,/className='lp-thread-pin'/);
 assert.match(wrap,/pointerdown/);
 assert.match(wrap,/setTimeout\(\(\)=>\{timer=null;openMenu\(\);\},520\)/);
 assert.match(wrap,/取消置顶/);
 assert.match(wrap,/置顶聊天/);
 assert.match(wrap,/contextmenu/);
 assert.match(index,/saveScreenScroll\(previous\)/);
 assert.match(index,/restoreScreenScroll\(screen\)/);
 assert.match(weibo,/function rememberCurrentView\(/);
 assert.match(weibo,/function restoreCurrentView\(/);
 for(const path of ['takeout.js','shopping.js','groups.js'])
  assert.match(files[path],/scrollBy/);
 assert.match(files['album.js'],/wrap\.scrollTop=previousTop/);
});

const commentParts=section(weibo,' function isOwnComment(',' function card(');
const preview=new Function('actionState',commentParts+'return {isOwnComment,commentPreview};')(
 p=>p.actions||{});
const ownComment=(id='mine')=>({id,name:'我',text:'我的评论',isMine:true,authorId:'self'});

test('homepage shows only three original preview comments plus every user comment',()=>{
 const p={comments:Array.from({length:12},(_,i)=>({id:'r'+i,name:'网友',text:'第'+i+'条'})).concat([ownComment('a'),ownComment('b')]),actions:{comments:[ownComment('a'),ownComment('b')]}};
 const shown=preview.commentPreview(p);
 assert.equal(shown.length,5);
 assert.deepEqual(shown.filter(c=>c.isMine).map(c=>c.id),['a','b']);
 assert.match(weibo,/function card\(p,detailed=false\)/);
 assert.match(weibo,/detailed\?\(p\.comments\|\|\[\]\):commentPreview\(p\)/);
 assert.match(weibo,/加载完整评论区/);
 assert.match(weibo,/commentBusy\.has\(p\.id\)/);
});

function harness(post,response){
 const info={characterId:2,chatMetadata:{},chatId:'story'};
 const session='2:story',q={posts:[],generated:{feeds:{home:[post]},hotBundles:{}}};
 const state={posts:{home:[post],nearby:[]},hotBundles:{},topic:null};
 const notices=new Map(),busy=new Set(),calls=[];
 const env={
  state,commentBusy:busy,commentNotices:notices,api:{
   phoneGenerate:async(ctx,opts)=>{calls.push(opts);return JSON.stringify(response(opts));},
   storyContext:()=>'',readData:()=>({}),recordError:()=>{},accountSubjectContext:()=>''
  },
  context:()=>info,scope:()=>session,root:()=>({storyTime:'2026-11-16T20:00'}),
  uid:(prefix='')=>prefix+Math.random(),actor:()=>null,subjectOfAccount:()=>({}),
  publicAccountInfo:()=>'',clean:(value,len=300)=>String(value||'').trim().slice(0,len),
  parse:raw=>JSON.parse(raw),actionState:p=>p.actions||{},
  isOwnComment:preview.isOwnComment,
  mutate:async fn=>fn(q),
  feedback:()=>{},render:()=>{},window:{confirm:()=>true},data:()=>q
 };
 const code=section(weibo,' async function replacePostComments(',' async function action(');
 const helpers=new Function('env','with(env){'+code+'return {replacePostComments,deleteOwnComment,loadFullComments};}')(env);
 return {helpers,post,q,state,calls,notices,busy};
}

test('one explicit API request fills 46 original comments + one user comment to 47',async()=>{
 const post={id:'p47',author:'测试博主',text:'生活日常',
  commentCount:47,comments:[
   {id:'c1',name:'路人',text:'第一'}, {id:'c2',name:'路人2',text:'第二'},
   {id:'c3',name:'路人3',text:'第三'},ownComment()
  ],actions:{comments:[ownComment()]}};
 const h=harness(post,()=>({comments:Array.from({length:43},(_,i)=>({name:'网友'+i,text:'观点'+i}))}));
 await h.helpers.loadFullComments(post);
 assert.equal(h.calls.length,1);
 assert.equal(post.comments.length,47);
 assert.equal(post.commentCount,47);
 assert.equal(post.actions.commentsLoaded,true);
 assert.equal(post.comments.filter(x=>x.isMine).length,1);
});

test('a multi-million-comment post loads at most 120 entries and retains its true total',async()=>{
 const post={id:'big',author:'大账号',text:'热点讨论',commentCount:23000000,
  comments:[{id:'c1',name:'观众',text:'评论'},{id:'c2',name:'观众2',text:'评论'},
    {id:'c3',name:'观众3',text:'评论'},ownComment()],
  actions:{comments:[ownComment()]}};
 const h=harness(post,()=>({comments:Array.from({length:116},(_,i)=>({name:'路人'+i,text:'评论'+i}))}));
 await h.helpers.loadFullComments(post);
 assert.equal(h.calls.length,1);
 assert.equal(post.comments.length,120);
 assert.equal(post.commentCount,23000000);
 assert.equal(post.actions.commentsLoaded,true);
});

test('removing a user comment updates count and clears dangling reply-to relations',async()=>{
 const post={id:'delete-me',author:'作者',text:'帖文',commentCount:47,
  comments:[{id:'a',name:'网友',text:'原评论'},ownComment('remove'),{id:'reply',name:'作者',text:'回复',replyTo:'remove'}],
  actions:{comments:[ownComment('remove')]}};
 const h=harness(post,()=>({comments:[]}));
 await h.helpers.deleteOwnComment(post,'remove');
 assert.equal(post.commentCount,46);
 assert.ok(!post.comments.some(c=>c.id==='remove'));
 assert.equal(post.comments.find(c=>c.id==='reply').replyTo,undefined);
 assert.equal(post.actions.comments.length,0);
 assert.equal(h.calls.length,0);
});
