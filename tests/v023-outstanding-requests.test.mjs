import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const weibo=readFileSync(new URL('../weibo.js',import.meta.url),'utf8');
const album=readFileSync(new URL('../album.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');
const manifest=JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url),'utf8'));
const clone=x=>JSON.parse(JSON.stringify(x));

test('v0.23.0 sources parse and all module import URLs use the updated cache key',()=>{
 assert.equal(manifest.version,'0.23.0');
 for(const source of [index,weibo,album])assert.doesNotThrow(()=>new Function(source.replace(/^export /gm,'')));
 for(const src of ['weibo.js','album.js','groups.js'])assert.ok(index.includes(src+'?v=0.23.0'));
});

test('followers are a social count, not 人, with compact 万/亿 labels',()=>{
 const a=weibo.indexOf(' const FOLLOWER_FACTORS='),b=weibo.indexOf(' const data=()=>',a);
 const helper=new Function(weibo.slice(a,b)+'return {formatFollowers,parseFollowerValue};')();
 assert.equal(helper.formatFollowers(1),'1粉丝');
 assert.equal(helper.formatFollowers(9999),'9,999粉丝');
 assert.equal(helper.formatFollowers(10000),'1万粉丝');
 assert.equal(helper.formatFollowers(35000000),'3500万粉丝');
 assert.equal(helper.formatFollowers(120000000),'1.2亿粉丝');
 assert.equal(helper.parseFollowerValue('4286.57','wan'),42865700);
 assert.match(weibo,/\['person','粉丝'\]/);
 assert.doesNotMatch(weibo,/\['person','人'\]/);
});

test('album has a recognizable tappable upload zone and a working file-change preview',()=>{
 assert.match(album,/lp-album-picker-icon/);
 assert.match(album,/file\.multiple=true/);
 assert.match(album,/function handleChange\(event\)/);
 assert.match(album,/handleChange\};/);
 assert.match(index,/albumController\?\.handleChange\(event\)/);
 assert.match(css,/\.lp-album-file-input\{[\s\S]*opacity:0/);
 assert.match(css,/\.lp-album-preview-grid/);
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

test('saved SillyTavern profiles fetch available models with secret ID, never raw key',async()=>{
 const begin=index.indexOf('async function loadSavedSiteModels('),end=index.indexOf('async function savePhoneApi(',begin);
 assert.ok(begin>0&&end>begin);
 const profiles=[{id:'p1',name:'玖时',api:'custom',model:'model-a',
  'api-url':'https://example.invalid/v1','secret-id':'server-stored-secret-reference'}];
 const service={getProfile:id=>profiles.find(x=>x.id===id),validateProfile:()=>({selected:'openai',source:'custom'})};
 const ctx={ConnectionManagerRequestService:service,getRequestHeaders:()=>({'Content-Type':'application/json','X-CSRF-Token':'test'})};
 const picker={options:[],replaceChildren(){this.options=[];},append(x){this.options.push(x);},value:'',disabled:false};
 const nodes={apiProfile:{value:'p1'},apiProfileModel:picker,apiProfileModelManual:{value:''},apiProfileHint:{textContent:''}};
 let captured;
 const mockFetch=async(url,options)=>{
  captured={url,body:JSON.parse(options.body),headers:options.headers};
  return {ok:true,json:async()=>({data:[{id:'model-b'},{id:'model-c'}]})};
 };
 const query=new Function('nodes','context','availableConnectionProfiles','document','fetch',
  index.slice(begin,end)+'return loadSavedSiteModels;')(
    nodes,()=>ctx,()=>({profiles:[{id:'p1'}]}),
    {createElement:()=>({value:'',textContent:''})},mockFetch);
 await query('model-b');
 assert.deepEqual(picker.options.map(x=>x.value),['model-a','model-b','model-c']);
 assert.equal(picker.value,'model-b');
 assert.equal(captured.url,'/api/backends/chat-completions/status');
 assert.equal(captured.body.custom_url,profiles[0]['api-url']);
 assert.equal(captured.body.secret_id,profiles[0]['secret-id']);
 assert.equal(captured.body.api_key,undefined);
 assert.equal(captured.body.key,undefined);
 assert.match(index,/cfg\.model\?\.trim\(\)\?\{model:cfg\.model\.trim\(\)\}/);
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
  accounts:[{id:'actor',name:'宁肆锦',handle:'@ning',kind:'角色',profession:'演员',source:'manual',followers:35000000}],
  posts:[],profile:{nickname:'u'},following:[]}};
 const app=make({context:()=>ctx,getNodes:()=>({weiboFeed:null}),readRootData:()=>root,readData:()=>root,
  writeData:async(_ctx,data)=>{root=data;},selectedCharacter:()=>({name:'宁肆锦'}),
  currentPersona:()=>({name:'u'}),stripModelReasoning:s=>s,
  phoneGenerate:async()=>JSON.stringify({posts:[{text:'今天的一个普通下午',likes:1}]}),
  recordActivity:()=>{},recordError:()=>{},notifyInteraction:()=>{}});
 await app.action('followAccount','actor');
 assert.deepEqual(root.qunxing.following,['actor']);
 await app.action('openAccount','actor');
 assert.equal(app.state.profileAccount,'actor');
 await app.action('generateAccountHistory','actor');
 assert.equal(root.qunxing.posts.filter(p=>p.backfilled).length,1);
 assert.equal(app.accountHistory(root.qunxing.accounts[0]).length,1);
 await app.action('unfollowAccount','actor');
 assert.deepEqual(root.qunxing.following,[]);
});
