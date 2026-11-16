import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const paths=['index.js','weibo.js','style.css','bootstrap.js','manifest.json'];
const files=Object.fromEntries(paths.map(p=>[p,readFileSync(new URL('../'+p,import.meta.url),'utf8')]));
const weibo=files['weibo.js'],css=files['style.css'];
const slice=(text,a,b)=>{
 const start=text.indexOf(a),end=text.indexOf(b,start+a.length);
 assert.ok(start>=0&&end>start,'source anchors exist: '+a);
 return text.slice(start,end);
};
const dates=new Function(slice(weibo,' function storyMoment(',' const FOLLOWER_FACTORS=')+
 'return {storyMoment,postTimestamp,historyMomentFor};')();

test('v0.33.0: all modules load with cache-busted matching version',()=>{
 assert.equal(JSON.parse(files['manifest.json']).version,'0.33.0');
 assert.match(files['bootstrap.js'],/index\.js\?v=0\.32\.0/);
 assert.match(files['index.js'],/weibo\.js\?v=0\.32\.0/);
 for(const file of ['index.js','weibo.js','bootstrap.js'])
  assert.doesNotThrow(()=>new Function(files[file].replace(/^export /gm,'')));
});

test('all posts render exact full story year/month/day/hour/minute and avoid placeholder history tag',()=>{
 const when=dates.storyMoment('2847.1.9 21:35');
 assert.equal(when.time,'2847-01-09 21:35');
 assert.equal(dates.postTimestamp({time:'2847-01-09T21:35'}),'2847年01月09日 21:35');
 assert.equal(dates.postTimestamp({time:'2026年11月16日 09:02'}),'2026年11月16日 09:02');
 assert.equal(dates.postTimestamp({time:'历史动态'}),'发布时间未记录');
 assert.equal(dates.postTimestamp({time:''}),'发布时间未记录');
 const card=slice(weibo,' function card(p,detailed=false){',' function heading(');
 assert.match(card,/postTimestamp\(p\)/);
 assert.match(card,/p\.category!=='历史公开动态'/);
});

test('scene-relative historic post dates cannot land after current fictional timeline',()=>{
 const time='2847-01-09T14:30';
 assert.equal(dates.historyMomentFor('2847-01-08 11:20',time,5,0),'2847-01-08 11:20');
 assert.equal(dates.historyMomentFor('2847-01-10 11:20',time,1,0),'2847-01-08 14:30');
 assert.equal(dates.historyMomentFor('2847-01-09 19:00',time,1,0),'2847-01-08 14:30');
 assert.equal(dates.historyMomentFor('',time,3,0),'2847-01-06 14:30');
 assert.equal(dates.historyMomentFor('', '2847-01-09', 1,0),'2847-01-08 12:00');
 assert.equal(dates.historyMomentFor('', '未设定时间', 1,0),null);
 assert.equal(dates.storyMoment('2026-02-30 12:00'),null);
});

test('historical-post editor is an overlay dialog, edits do not expand giant inline editor',()=>{
 const editor=slice(weibo,' function renderHistoryEditor(',' function renderAccountProfile(');
 assert.match(editor,/function renderHistoryEditModal\(/);
 assert.match(editor,/aria-modal/);
 assert.match(editor,/role','dialog/);
 assert.match(editor,/historyEditorFields\(form,post\)/);
 assert.match(editor,/control\('保存修改'/);
 assert.match(editor,/control\('取消'/);
 assert.match(editor,/control\('删除这条公开帖子'/);
 assert.match(editor,/if\(state\.historyEditingId\)renderHistoryEditModal/);
 const handling=slice(weibo,"  if(type==='editHistoryPost'){","  if(type==='generateAccountHistory'){");
 assert.match(handling,/state\.historyEditingId=id;render\(\);return/);
 assert.doesNotMatch(handling,/state\.historyFormOpen=true;render\(\);return/);
 assert.match(handling,/querySelector\('\.lp-wb-history-modal'\)/);
 assert.match(css,/\.lp-wb-history-modal\{/);
 assert.match(css,/\.lp-wb-history-dialog-form \.lp-wb-history-actions\{/);
 assert.match(css,/position:sticky;bottom:0/);
});

test('AI historical generation reports immediately without navigating, and requires story date',()=>{
 const block=slice(weibo,"  if(type==='generateAccountHistory'){","  if(type==='newAccount'||type==='editAccount'){");
 assert.match(block,/if\(!storyMoment\(scene\)\)/);
 assert.match(block,/state\.historyGenerating=true/);
 assert.match(block,/state\.historyStatus='正在按人物设定/);
 assert.match(block,/feedback\(state\.historyStatus\);\s*render\(\); \/\/ Show loading immediately/);
 assert.match(block,/historyMomentFor\(p\.publishedAt,scene,p\.daysAgo,i\)/);
 assert.match(block,/historyMomentFor\('',scene,1,0\)/);
 assert.doesNotMatch(block,/category:'历史公开动态'/);
 assert.match(block,/finally\{\s*state\.historyGenerating=false;/);
 const render=slice(weibo,' function render(){',' async function followPost(');
 assert.match(render,/if\(state\.adminHistoryAccount&&state\.historyStatus\)n\.weiboFeedback\.textContent=state\.historyStatus/);
 assert.match(render,/renderAccountHistoryManager\(n\.weiboDetail\)/);
});

test('opening edit dialog creates a modal without touching scroll location',()=>{
 const source=slice(weibo,' function renderHistoryEditModal(',' function renderAccountHistoryManager(');
 const make=(tag,cls='',value='')=>({
  tag,cls,textContent:value,children:[],attributes:{},
  setAttribute(name,value){this.attributes[name]=value;},
  append(...items){this.children.push(...items);},
  addEventListener(){},
  classList:{add(){}}
 });
 const screen={children:[],append(node){this.children.push(node);}};
 const nodes=()=>({weiboDetail:{closest:()=>screen}});
 const account={id:'a',name:'作者'};
 const state={historyEditingId:'post-1'};
 const controls=[];
 const control=(label,action,id)=>{controls.push({label,action,id});return make('button');};
 const build=new Function('el','state','nodes','control','postTimestamp','historyEditorFields','action',
  source+'return renderHistoryEditModal;')(make,state,nodes,control,dates.postTimestamp,()=>{},()=>{});
 build(account,[{id:'post-1',time:'2847-01-08T10:30'}]);
 assert.equal(screen.children.length,1);
 assert.equal(screen.children[0].cls,'lp-wb-history-modal');
 assert.equal(screen.children[0].children[0].attributes['aria-modal'],'true');
 assert.deepEqual(controls.map(x=>x.action),['cancelHistoryEdit','saveHistoryPost','cancelHistoryEdit','deleteHistoryPost']);
});


test('AI historical generation immediately reports progress and saves only pre-story dates',async()=>{
 const branch=slice(weibo,"  if(type==='generateAccountHistory'){","  if(type==='newAccount'||type==='editAccount'){");
 const state={adminHistoryAccount:'actor-1',historyGenerating:false,historyStatus:'',historyInstructions:'',historyCount:'3'};
 const stored={accounts:[{id:'actor-1',name:'林知远',followers:1000000,publicFigure:true}],posts:[]};
 const traces=[];let calls=0,release;
 const deferred=new Promise(resolve=>{release=resolve;});
 const env={
  state,data:()=>stored,
  nodes:()=>({weiboDetail:{querySelector:q=>({value:q.includes('instructions')?'剧组日常':'3'})}}),
  clean:(x,n=100)=>String(x||'').slice(0,n),scope:()=> 'chat-a',
  root:()=>({storyTime:'2847-01-09T22:00'}),
  storyMoment:dates.storyMoment,historyMomentFor:dates.historyMomentFor,
  feedback:s=>traces.push(['feedback',s]),
  render:()=>traces.push(['render',state.historyStatus,state.historyGenerating]),
  api:{accountSubjectContext:()=>'',storyContext:()=>'',phoneGenerate:async()=>{calls++;return deferred;},readData:()=>({})},
  subjectOfAccount:()=>({type:'primary'}),accountHistory:()=>[],
  formatFollowers:n=>String(n),savedProfession:()=>'',accountOperatorGuide:()=>'',
  historicalLikeRange:()=>({min:1000,max:100000}),parse:JSON.parse,
  uid:p=>p+String(Math.random()).slice(2),countValue:x=>Number(x),stableSeed:()=>.1,
  mutate:async fn=>fn(stored),context:()=>({})
 };
 const run=new Function(...Object.keys(env),
  'return async function(type,id){'+branch+'};')(...Object.values(env));
 const task=run('generateAccountHistory','actor-1');
 assert.equal(calls,1);
 assert.equal(state.historyGenerating,true);
 assert.ok(traces.some(x=>x[0]==='render'&&x[2]===true));
 release(JSON.stringify({posts:[
  {text:'旧日帖子A',publishedAt:'2847-01-08 17:20',likes:10000,
   comments:[{name:'甲',text:'看到了'},{name:'乙',text:'支持'}]},
  {text:'旧日帖子B',publishedAt:'2847-01-10 12:00',daysAgo:3,likes:10001,
   comments:[{name:'甲',text:'有趣'},{name:'乙',text:'赞同'}]}
 ]}));
 await task;
 assert.equal(stored.posts.length,2);
 assert.equal(calls,1);
 assert.equal(state.historyGenerating,false);
 assert.match(state.historyStatus,/已生成并保存 2 条/);
 for(const post of stored.posts){
  assert.ok(dates.storyMoment(post.time).stamp<dates.storyMoment('2847-01-09T22:00').stamp);
  assert.notEqual(post.category,'历史公开动态');
 }
});

test('phone header back closes editor before exiting history manager',()=>{
 const body=slice(weibo,' function back(){',' function handleInput(');
 assert.match(body,/if\(state\.historyEditingId\)\{state\.historyEditingId='';render\(\);return true;\}/);
 assert.match(body,/if\(state\.adminHistoryAccount\)/);
});
