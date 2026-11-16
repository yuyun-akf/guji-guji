import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const weibo=readFileSync(new URL('../weibo.js',import.meta.url),'utf8');
const album=readFileSync(new URL('../album.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');
const manifest=JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url),'utf8'));
const clone=x=>JSON.parse(JSON.stringify(x));

test('v0.32.0 sources parse and all module import URLs use the updated cache key',()=>{
 assert.equal(manifest.version,'0.32.0');
 for(const source of [index,weibo,album])assert.doesNotThrow(()=>new Function(source.replace(/^export /gm,'')));
 for(const src of ['weibo.js','album.js','groups.js'])assert.ok(index.includes(src+'?v=0.32.0'));
});

test('followers are a social count, not 人, with compact 万/亿 labels',()=>{
 const a=weibo.indexOf(' const FOLLOWER_FACTORS='),b=weibo.indexOf(' const data=()=>',a);
 const helper=new Function(weibo.slice(a,b)+'return {formatFollowers,parseFollowerValue};')();
 assert.equal(helper.formatFollowers(1),'1粉丝');
 assert.equal(helper.formatFollowers(9999),'9999粉丝');
 assert.equal(helper.formatFollowers(10000),'1万粉丝');
 assert.equal(helper.formatFollowers(35000000),'3500万粉丝');
 assert.equal(helper.formatFollowers(120000000),'1.2亿粉丝');
 assert.equal(helper.parseFollowerValue('4612.73','wan'),46127300);
 assert.match(weibo,/\['person','粉丝'\]/);
 assert.doesNotMatch(weibo,/\['person','人'\]/);
});

test('album has a unified one-to-ten photo picker with folder destination and preview',()=>{
 assert.match(album,/lp-album-picker/);
 assert.match(album,/file\.multiple=true/);
 assert.match(album,/function handleChange\(event\)/);
 assert.match(album,/data-album-field="target"/);
 assert.match(album,/state\.selectedFiles/);
 assert.match(album,/lp-album-preview/);
 assert.match(index,/albumController\?\.handleChange\(event\)/);
 assert.match(css,/\.lp-album-folder-grid/);
});

test('settings no longer contain the duplicate run-log entry or inactive API apps',()=>{
 const start=index.indexOf('<select data-lp="apiTask">');
 const end=index.indexOf('</select>',start);
 const list=index.slice(start,end);
 for(const label of ['chat','weibo','takeout','autonomy','memory'])assert.match(list,new RegExp('value="'+label+'"'));
 for(const label of ['calendar','wallet','shopping','theme','settings','diagnostics'])assert.doesNotMatch(list,new RegExp('value="'+label+'"'));
 assert.doesNotMatch(index,/settingsOpenDiagnostics/);
 assert.match(index,/独立的「运行日志」App/);
});

test('API sites are grouped by URL and key rather than displayed as model presets',()=>{
 assert.match(index,/function savedApiSites\(/);
 assert.match(index,/function resolveSavedSite\(/);
 assert.match(index,/s\.profileIds\.includes\(value\)/);
 assert.match(index,/api\/secrets\/read/);
 assert.match(index,/api\/backends\/chat-completions\/status/);
 assert.match(index,/getTavernRequestHeaders/);
 assert.match(index,/service\.sendRequest\(site\.profileId/);
});

test('Qunxing toolbar stays in one row and share menu includes both destinations',()=>{
 assert.match(weibo,/lp-wb-actions lp-wb-actions-inline/);
 assert.match(weibo,/lp-wb-inline-comment/);
 assert.match(weibo,/shareMenu/);
 assert.match(weibo,/转发到我的群星/);
 assert.match(weibo,/发送到咕叽聊/);
 assert.match(css,/\.lp-wb-actions\.lp-wb-actions-inline\{[\s\S]*flex-wrap:nowrap/);
 assert.doesNotMatch(weibo,/control\('评论','detail'/);
});

test('Nearby is a mix of location context and followed authors with campus emphasis',()=>{
 assert.doesNotMatch(weibo,/n\.weiboNearby\.append\(heading\('周边'/);
 assert.match(weibo,/state\.posts\.home\.filter\(followed\)/);
 assert.match(weibo,/校园日常占多数/);
 assert.match(weibo,/表白墙、选课考试、老师答疑/);
 assert.match(weibo,/被关注者不要求位于附近/);
});

test('Qunxing account search/profile works without paying to generate a heat list',async()=>{
 assert.match(weibo,/renderAccountSearch\(n\.weiboHot\)/);
 assert.match(weibo,/renderAccountProfile\(n\.weiboDetail\)/);
 assert.match(weibo,/handleInput\(event\)/);
 assert.match(weibo,/followAccount/);
 assert.match(index,/weiboController\?\.handleInput\(e\)/);
 const source=weibo.replace('export function createWeiboModule','function createWeiboModule')
  .replace('return {open,render,','return {action,accountHistory,open,render,');
 const make=new Function('document','structuredClone',source+'\nreturn createWeiboModule;')({visibilityState:'visible'},clone);
 const ctx={chatId:'story',characterId:0,chatMetadata:{}};
 let root={storyTime:'2026-11-15T20:00',contacts:[],messages:[],qunxing:{
  accounts:[{id:'actor',name:'林知远',handle:'@sample_account',kind:'角色',profession:'演员',source:'manual',followers:35000000}],
  posts:[],profile:{nickname:'u'},following:[]}};
 const app=make({context:()=>ctx,getNodes:()=>({weiboFeed:null}),readRootData:()=>root,readData:()=>root,
  writeData:async(_ctx,data)=>{root=data;},selectedCharacter:()=>({name:'林知远'}),
  currentPersona:()=>({name:'u'}),stripModelReasoning:s=>s,
  phoneGenerate:async()=>JSON.stringify({posts:[{text:'今天的一个普通下午',likes:1,comments:[{name:'甲',text:'收到'},{name:'乙',text:'很好'}]}]}),
  recordActivity:()=>{},recordError:()=>{},notifyInteraction:()=>{}});
 await app.action('followAccount','actor');
 assert.deepEqual(root.qunxing.following,['actor']);
 await app.action('openAccount','actor');
 assert.equal(app.state.profileAccount,'actor');
 app.state.subview='settings';
 await app.action('manageHistory','actor');
 await app.action('generateAccountHistory','actor');
 assert.equal(root.qunxing.posts.filter(p=>p.backfilled).length,1);
 assert.equal(app.accountHistory(root.qunxing.accounts[0]).length,1);
 await app.action('unfollowAccount','actor');
 assert.deepEqual(root.qunxing.following,[]);
});
