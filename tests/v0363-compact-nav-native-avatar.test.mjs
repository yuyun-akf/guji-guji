import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const index=read('index.js'),album=read('album.js'),
 groups=read('groups.js'),css=read('style.css'),bootstrap=read('bootstrap.js');

test('module syntax and bootstrap version agree with the manifest',()=>{
 const manifest=JSON.parse(read('manifest.json'));
 assert.ok(bootstrap.includes("const VERSION = '"+manifest.version+"'"));
 assert.ok(bootstrap.includes("index.js?v="+manifest.version+"'"));
 assert.ok(index.includes('memory.js?v=0.37.0'));
 assert.ok(index.includes('weibo.js?v=0.36.6&'));
 assert.ok(index.includes('album.js?v=0.36.4'));
 assert.ok(index.includes('groups.js?v='+manifest.version));
 for(const source of [index,album,groups,read('weibo.js'),read('memory.js'),bootstrap])
  assert.doesNotThrow(()=>new Function(source.replace(/^export /gm,'')));
});

test('update notice checks for a newer version and announces it once per session',async()=>{
 const notices=[],storage=new Map();
 const installed=JSON.parse(read('manifest.json')).version;
 const [major,minor,patch]=installed.split('.').map(Number);
 const newer=[major,minor,patch+10].join('.');
 let version=newer,requests=0;
 const check=()=>{
  const sandbox={
   AbortController,document:{addEventListener(){}},toastr:{info:text=>notices.push(text)},
   sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
   async fetch(url,options){
    assert.equal(new URL(url).pathname,'/yuyun-akf/guji-guji/main/manifest.json');
    assert.equal(options.credentials,'omit');
    requests++;
    return {ok:true,json:async()=>({version})};
   },
  };
  return vm.runInNewContext(bootstrap.replace(/^export /gm,'')+'\ncheckForUpdate;',sandbox);
 };
 const active=check();
 await Promise.all([active(),active()]);
 assert.equal(requests,1);
 await check()();
 assert.deepEqual(notices,['咕叽咕机 v'+newer+' 已发布，请到「管理扩展」更新。']);
 version=installed;
 await check()();
 assert.equal(notices.length,1);
});

test('a card can bind acquaintances scanned from other social directories',()=>{
 const source=index.slice(index.indexOf('function roleFriendCatalog('),index.indexOf('function roleFriendsStore('));
 const catalog=new Function('galleryPeople','readSharedNpcScan','visibleSharedNpcScan',
  'sharedQunxingAccounts',source+'\nreturn roleFriendCatalog;')(
   ()=>[{id:'user',name:'我'},{id:'primary',name:'林知远'}],
   ()=>[{name:'唐晓禾',description:'扫描候选'}],
   ()=>[{name:'许小川',description:'关联世界书'}],
   ()=>[{subject:{type:'npc',name:'姜乐'},roleBrief:'另一位故事人物'}]
  );
 const options=catalog({});
 assert.deepEqual(options.map(x=>x.name).sort(),['林知远','唐晓禾','姜乐','许小川'].sort());
 assert.ok(options.filter(x=>x.scanned).every(x=>x.id.startsWith('scanned:')));
});

test('Moments author and punctuation share one inline layout item',()=>{
 assert.match(index,/line\.append\(nameNode,document\.createTextNode/);
 assert.match(index,/row\.append\(line\)/);
 assert.match(css,/\.lp-moment-comment>\.lp-moment-comment-line\{/);
 assert.match(css,/\.lp-moment-comment\{\s*display:block!important/);
});

test('group avatar uses an actual visible file chooser and change handler',()=>{
 assert.match(groups,/pickBox\.append\(pick,avatar/);
 assert.match(groups,/pick\.addEventListener\('click',\(\)=>avatar\.click\(\)\)/);
 assert.match(groups,/avatar\.addEventListener\('change'/);
 assert.match(groups,/if\(state\.avatarDraft\)g\.avatar=state\.avatarDraft/);
 assert.match(css,/\.lp-group-avatar-picker \.lp-group-avatar-native-input\{\s*position:static!important/);
 assert.match(css,/opacity:1!important;pointer-events:auto!important/);
});

test('album review remains two-column, supports single delete and leaves processing state',()=>{
 assert.match(album,/card\.append\(visual,fields,remove\)/);
 assert.match(album,/api\.deleteLegacySticker\?\.\(id\)/);
 assert.doesNotMatch(album,/deleteFrom|从此张起批量删除/);
 assert.match(css,/grid-template-columns:minmax\(75px,27%\) minmax\(0,1fr\)/);
 assert.match(css,/\.lp-album-review-visual\{[\s\S]*?align-items:center!important/);
 assert.equal((album.match(/state\.busy=false;\s*\/\/ A render made during an async operation/g)||[]).length,3);
 assert.match(css,/max-height:62px!important/);
 assert.match(css,/:focus-visible\{\s*outline:none!important/);
});
