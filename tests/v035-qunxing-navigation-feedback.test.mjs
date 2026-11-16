import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const index=read('index.js'),weibo=read('weibo.js'),album=read('album.js'),
 css=read('style.css'),bootstrap=read('bootstrap.js');
const manifest=JSON.parse(read('manifest.json'));

test('v0.35.0 release and navigational entrypoints',()=>{
 assert.equal(manifest.version,'0.35.0');
 assert.match(bootstrap,/index\.js\?v=0\.35\.0/);
 for(const item of ['album','groups','weibo'])assert.ok(index.includes(item+'.js?v=0.35.0'));
 for(const path of ['index.js','weibo.js','album.js','groups.js','bootstrap.js'])
  assert.doesNotThrow(()=>new Function(read(path).replace(/^export /gm,'')));
 assert.match(weibo,/\['新建账号','settingsScan'\]/);
 assert.match(weibo,/\['自主发布设置','settingsAutonomy'\]/);
 assert.match(weibo,/\['批量补发历史动态','settingsBatch'\]/);
 assert.match(weibo,/\['管理群星账号','settingsAccounts'\]/);
 assert.match(weibo,/\['管理动态','settingsPosts'\]/);
 assert.match(weibo,/function renderSettingsScan\(/);
 assert.match(weibo,/control\('＋ 手动新建账号','newAccount'\)/);
 assert.match(weibo,/function renderSettingsBatch\(/);
 assert.match(weibo,/function renderSettingsPosts\(/);
 assert.match(weibo,/control\('管理动态','manageHistory'/);
 assert.doesNotMatch(weibo.slice(weibo.indexOf('function renderSettings('),weibo.indexOf('function renderSettingsAutonomy(')),/互动记录管理/);
});
test('relationships, Worldview and inline Moments are actually wired',()=>{
 assert.match(index,/lp-settings-nav-disabled/);
 assert.match(index,/>世界观<small>世界观切换<\/small>/);
 assert.doesNotMatch(index,/>未开放<\/b>/);
 assert.match(index,/data-lp-screen="profileRole"/);
 assert.match(index,/profileRole:'profile'/);
 for(const item of ['classmate','roommate','alumni','coworker','boss','patron'])
  assert.ok(index.includes(item+":'"),item);
 assert.match(index,/data-lp="relationChoiceGrid"/);
 assert.match(index,/data-lp="relationDirectionFields"/);
 assert.match(index,/roleDirectionUser|relationDirectionUser/);
 assert.match(index,/暗恋对象/);
 assert.match(index,/crushOption\.textContent='暗恋对象（'/);
 assert.match(index,/lp-moment-actions-inline/);
 assert.match(index,/actions\.append\(momentButton\(liked/);
 assert.match(index,/\),editor\);/);
 assert.match(css,/\.lp-moment-actions-inline/);
 assert.match(css,/\.lp-relation-choice-grid/);
 assert.match(album,/state\.message='';api\.notifyInteraction/);
 assert.doesNotMatch(album,/wrap\.append\(el\('p','lp-album-feedback',state\.message\)\)/);
});
function harness(people=6){
 const accounts=Array.from({length:people},(_,i)=>({
  id:'a'+i,name:'角色'+i,handle:'@a'+i,
  subject:{type:'npc',name:'角色'+i},source:'manual',followers:1000+i*100
 }));
 const ctx={characterId:0,chatId:'test-035',chatMetadata:{st_little_phone_v1:{
  storyTime:'2026-11-17T12:00',qunxing:{accounts,posts:[]}
 }}};
 let requests=0,fail=false;
 const notices=[];
 const factory=new Function('document',weibo.replace('export function createWeiboModule','function createWeiboModule')
  .replace('return {open,render,','return {action,open,render,')+'\nreturn createWeiboModule;')({visibilityState:'visible'});
 const module=factory({
  context:()=>ctx,getNodes:()=>({weiboFeed:null}),
  readRootData:()=>ctx.chatMetadata.st_little_phone_v1,
  readData:()=>ctx.chatMetadata.st_little_phone_v1,
  selectedCharacter:()=>({name:'角色0'}),currentPersona:()=>({name:'用户'}),
  accountSubjectContext:()=>'',storyContext:()=>'',stripModelReasoning:x=>x,
  writeData:async(_,draft)=>{delete draft.__contactId;ctx.chatMetadata.st_little_phone_v1=draft;},
  phoneGenerate:async(_,opts)=>{
   requests++;
   if(fail)throw Error('Got response status 500');
   const sequence=JSON.parse(opts.prompt[0].content.split('禁止错配：')[1].split('\n')[0]);
   return JSON.stringify({posts:sequence.map((authorId,i)=>({
    authorId,text:'之前借来的小猫仍然是借来的 '+i,
    daysAgo:i+1,likes:45,commentCount:12,
    comments:[{name:'网友甲',text:'猫猫很可爱'},{name:'网友乙',text:'确实很可爱'}]
   }))});
  },
  notifyInteraction:(message,kind)=>notices.push({message,kind}),
  recordError:()=>{},recordActivity:()=>{}
 });
 return {module,ctx,accounts,notices,requests:()=>requests,setFail:v=>fail=v};
}
test('default ten historical posts are generated with ONE API call',async()=>{
 const h=harness(6);
 await h.module.action('generateRandomHistory');
 const posts=h.ctx.chatMetadata.st_little_phone_v1.qunxing.posts;
 assert.equal(h.requests(),1);
 assert.equal(posts.length,10);
 assert.ok(new Set(posts.map(p=>p.authorId)).size>=5);
 assert.ok(posts.every(p=>p.comments.length>=2));
 assert.equal(h.module.state.historyGenerating,false);
});
test('custom count and up-to-ten selected characters persist correctly',async()=>{
 const h=harness(12);
 h.module.state.historyBatchQuantity='custom';
 h.module.state.historyBatchCustom='13';
 h.module.state.historyBatchMode='selected';
 h.module.state.historyBatchSelectedIds=['a1','a4'];
 await h.module.action('generateRandomHistory');
 const posts=h.ctx.chatMetadata.st_little_phone_v1.qunxing.posts;
 assert.equal(h.requests(),2);
 assert.equal(posts.length,13);
 assert.deepEqual(new Set(posts.map(p=>p.authorId)),new Set(['a1','a4']));
});
test('HTTP 500 leaves historical posts untouched and releases generating state',async()=>{
 const h=harness(5);
 h.setFail(true);
 await h.module.action('generateRandomHistory');
 assert.equal(h.requests(),1);
 assert.equal(h.ctx.chatMetadata.st_little_phone_v1.qunxing.posts.length,0);
 assert.equal(h.module.state.historyGenerating,false);
 assert.ok(h.notices.some(n=>n.kind==='error'&&/500/.test(n.message)));
});
