import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const index=read('index.js'),album=read('album.js'),
 groups=read('groups.js'),css=read('style.css'),bootstrap=read('bootstrap.js');

test('v0.36.4 module syntax and cache keys',()=>{
 const manifest=JSON.parse(read('manifest.json'));
 assert.equal(manifest.version,'0.36.4');
 assert.match(bootstrap,/index\.js\?v=0\.36\.4&contact-ui=1/);
 for(const part of ['album','weibo','groups'])
  assert.ok(index.includes(part+'.js?v=0.36.4'));
 for(const source of [index,album,groups,read('weibo.js'),bootstrap])
  assert.doesNotThrow(()=>new Function(source.replace(/^export /gm,'')));
});

test('a card can bind acquaintances scanned from other social directories',()=>{
 const source=index.slice(index.indexOf('function roleFriendCatalog('),index.indexOf('function roleFriendsStore('));
 const catalog=new Function('galleryPeople','readSharedNpcScan','visibleSharedNpcScan',
  'sharedQunxingAccounts',source+'\nreturn roleFriendCatalog;')(
   ()=>[{id:'user',name:'我'},{id:'primary',name:'顾明舟'}],
   ()=>[{name:'陈之恒',description:'扫描候选'}],
   ()=>[{name:'许小川',description:'关联世界书'}],
   ()=>[{subject:{type:'npc',name:'姜乐'},roleBrief:'另一位故事人物'}]
  );
 const options=catalog({});
 assert.deepEqual(options.map(x=>x.name).sort(),['顾明舟','陈之恒','姜乐','许小川'].sort());
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
