import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const weibo=readFileSync(new URL('../weibo.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');
const manifest=JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url),'utf8'));

function story(){
 const ctx={characterId:0,chatId:'test',chatMetadata:{}};
 let db={storyTime:'2026-11-16T20:00',contacts:[],messages:[],qunxing:{
  accounts:[{id:'actor',name:'林知远',source:'manual',followers:46127300}],posts:[],following:[]}};
 const code=weibo.replace('export function createWeiboModule','function createWeiboModule')
  .replace('return {open,render,','return {action,normalize,open,render,');
 const make=new Function('document','structuredClone',code+'\nreturn createWeiboModule;')(
  {visibilityState:'visible'},x=>JSON.parse(JSON.stringify(x)));
 const app=make({context:()=>ctx,getNodes:()=>({weiboFeed:null}),readRootData:()=>db,readData:()=>db,
  writeData:async(_,value)=>{db=value;},currentPersona:()=>({name:'我'}),selectedCharacter:()=>({name:'林知远'})});
 return {app,data:()=>db};
}
test('v0.25 cache markers and no-obstruction top-center feedback',()=>{
 assert.equal(manifest.version,'0.36.1');
 assert.match(index,/weibo\.js\?v=0\.35\.0/);
 assert.match(css,/lpTouchRipple 450ms/);
 assert.match(css,/lpLikeParticle 420ms/);
 assert.match(css,/lpCheckDraw 300ms/);
 assert.match(css,/top:max\(12px/);
});
test('group entry comes after new friends in contacts, not messages',()=>{
 const m=index.indexOf('data-lp-screen="chatList"');
 const c=index.indexOf('data-lp-screen="contacts"',m);
 const friends=index.indexOf('data-lp-open="requests"',c);
 const group=index.indexOf('data-lp-open="groups"',c);
 assert.ok(m>=0&&c>m&&friends>c&&group>friends);
 assert.equal(index.slice(m,c).includes('data-lp-open="groups"'),false);
});
test('temporary NPC stats are model-scaled; commentless posts cannot enter feed',()=>{
 const {app}=story(),comments=[{name:'甲',text:'好'},{name:'乙',text:'谢谢'}];
 const p=app.normalize({author:'沪上气象小助手',text:'降温提醒',followers:520000,
  accountLikes:1850000,accountComments:41000,followingCount:130,likes:23500,comments},'world');
 assert.equal(p.followers,520000);
 assert.equal(p.accountLikes,1850000);
 assert.equal(p.accountComments,41000);
 assert.equal(app.normalize({author:'路人',text:'没评论',comments:[]},'world'),null);
 assert.ok(app.normalize({author:'林知远',text:'工作日常',likes:300,comments},'world').likes>14000);
});
test('public profile cannot manage history; settings manager can',async()=>{
 const h=story();
 await h.app.action('openAccount','actor');
 assert.equal(h.app.state.adminHistoryAccount,'');
 await h.app.action('saveHistoryPost','actor');
 assert.equal(h.data().qunxing.posts.length,0);
 await h.app.action('manageHistory','actor');
 assert.equal(h.app.state.adminHistoryAccount,'');
 h.app.state.subview='settings';
 await h.app.action('manageHistory','actor');
 assert.equal(h.app.state.adminHistoryAccount,'actor');
 h.app.back();assert.equal(h.app.state.adminHistoryAccount,'');
});
test('Qunxing account edit has a separate view and back leads to settings',async()=>{
 const {app}=story();app.state.subview='settings';
 await app.action('editAccount','actor');
 assert.equal(app.state.subview,'accountEditor');
 assert.equal(app.state.editing,'actor');
 app.back();assert.equal(app.state.subview,'settings');
});
