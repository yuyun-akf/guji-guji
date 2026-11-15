import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');
const weibo=readFileSync(new URL('../weibo.js',import.meta.url),'utf8');

test('three new permanent palettes use the supplied exact six colors',()=>{
 for(const id of ['concept-violet','concept-coral','concept-amber'])assert.ok(index.includes(id));
 for(const hex of ['#ffffff','#f2edd0','#d9deef','#ead78f','#aca8cd','#5f508a',
  '#f7e8e8','#cce2da','#8ec9b7','#df8d8e','#bc535d',
  '#e5f2fe','#f0e2cd','#ccd0e5','#f6d476','#dea246'])assert.ok(index.includes(hex),hex);
 assert.ok(index.includes('nodes.themeDelete.disabled=isBuiltInPalette(theme.palette)'));
 assert.ok(css.includes('.lp-inline-quote{background:var(--lp-ice)'));
 assert.ok(css.includes('.lp-payment-card.lp-payment-expired'));
});
test('lock keypad reduces horizontal column distance but retains 11px vertical spacing',()=>{
 assert.match(css,/\.lp-lock-keypad \{width:min\(100%,280px\)/);
 assert.ok(css.includes('justify-items:center;gap:11px 8px;'));
});
test('companion day count follows story date with the first day counted as one',()=>{
 const begin=index.indexOf('function storyCompanionDays(');
 const end=index.indexOf('function renderDesktop(){',begin);
 assert.ok(begin>=0&&end>begin);
 const fn=new Function('localDateTime',index.slice(begin,end)+'return storyCompanionDays;')(()=>'2026-11-15T09:46');
 assert.equal(fn({storyTime:'2025-12-17T19:50',messages:[{storyTime:'2025-12-17T12:00'}]}),1);
 assert.equal(fn({storyTime:'2025-12-18T01:27',messages:[{storyTime:'2025-12-17T12:00'}]}),2);
 assert.equal(fn({storyTime:'2025-12-19T01:27',messages:[{storyTime:'2025-12-17T12:00'}]}),3);
});
test('Qunxing repost is mirrored to user feed; undo and clear preserve original owned post',async()=>{
 const make=new Function('document','window','structuredClone',
  weibo.replace('export function createWeiboModule','function createWeiboModule')
   .replace('return {open,render,','return {action,open,render,')+'\nreturn createWeiboModule;');
 const root={version:1,storyTime:'2025-12-18T01:27',messages:[],contacts:[],qunxing:{
  posts:[{id:'p1',author:'虚构媒体',text:'新剧动态',zone:'world',actions:{}},
   {id:'mine',author:'用户',text:'我的原创内容',zone:'world',actions:{owned:true}}],
  accounts:[],following:[],profile:{nickname:'用户',handle:'@user'}
 }};
 const context={characterId:0,chatId:'a',chatMetadata:{db:root}};
 const events=[];
 const app=make({visibilityState:'visible'},{confirm:()=>true},structuredClone)({
  context:()=>context,getNodes:()=>null,readRootData:()=>context.chatMetadata.db,
  readData:()=>context.chatMetadata.db,currentPersona:()=>({name:'用户'}),
  selectedCharacter:()=>({name:'角色'}),
  writeData:async(_,d)=>{delete d.__contactId;context.chatMetadata.db=d;},
  publishPhoneAppEvent:(_d,e)=>events.push(e)
 });
 await app.action('repost','p1');
 assert.equal(context.chatMetadata.db.qunxing.posts.filter(p=>p.repostOf==='p1'&&p.actions.owned).length,1);
 await app.action('repost','p1');
 assert.equal(context.chatMetadata.db.qunxing.posts.filter(p=>p.repostOf==='p1').length,0);
 await app.action('like','p1');
 await app.action('clearInteractions');
 const posts=context.chatMetadata.db.qunxing.posts;
 assert.ok(posts.some(p=>p.id==='mine'&&p.actions.owned));
 assert.ok(!posts.some(p=>p.id==='p1'));
 assert.equal(events.length,1);
});
test('Qunxing new feed keeps historical interactions outside recommendation view',()=>{
 assert.ok(weibo.includes("async function persistGenerated(kind,extra={})"));
 assert.ok(weibo.includes("data().generated"));
 assert.ok(!weibo.includes('Only closing the entire phone clears transient generated content.'));
 assert.ok(weibo.includes("p.actions?.owned||p.autoPublished"));
 assert.ok(weibo.includes("clearInteractions"));
});
