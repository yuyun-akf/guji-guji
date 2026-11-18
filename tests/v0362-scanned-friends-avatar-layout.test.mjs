import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const index=read('index.js'),groups=read('groups.js'),album=read('album.js'),css=read('style.css');

test('v0.36.3 compiles the edited module files',()=>{
 for(const code of [index,groups,album])
  assert.doesNotThrow(()=>new Function(code.replace(/^export /gm,'')));
});

test('scanned but unimported characters can be bound as a role friend and used in Moments',()=>{
 const source=index.slice(index.indexOf('function roleFriendCatalog('),index.indexOf('function renderRoleFriends('));
 const factory=new Function('galleryPeople','readSharedNpcScan','visibleSharedNpcScan','sharedQunxingAccounts','qunxingAccountCardKey','SETTINGS_KEY','contactDisplayName',
  source+'\nreturn {roleFriendCatalog,roleFriendsOf,roleFriendGuest,roleFriendActorId};');
 const ctx={extensionSettings:{gujiguji:{roleFriendsByCard:{cardA:{
  '林知远':{known:['唐晓禾'],custom:[]}
 }}}}};
 const api=factory(
  ()=>[{id:'user',name:'我'},{id:'primary',name:'林知远'}],
  ()=>[{name:'唐晓禾',description:'从故事资料中扫描出来的朋友'}],
  ()=>[],()=>null,
  ()=>'cardA','gujiguji',(_,id)=>id
 );
 assert.equal(api.roleFriendCatalog(ctx).find(p=>p.name==='唐晓禾').scanned,true);
 assert.deepEqual(api.roleFriendsOf(ctx,'primary').known,['唐晓禾']);
 const token=api.roleFriendActorId('roleknown','林知远',0);
 assert.equal(api.roleFriendGuest(ctx,token).name,'唐晓禾');
 assert.match(api.roleFriendGuest(ctx,token).description,/扫描出来/);
 assert.match(index,/knownOutsideContacts=known\.known\.flatMap/);
 assert.match(index,/roleFriendCatalog\(ctx\)/);
});

test('Moments commenter names and colon stay inline',()=>{
 assert.match(index,/row\.append\(line\)/);
 assert.match(index,/line\.append\(nameNode,document\.createTextNode/);
 assert.match(css,/\.lp-moment-comment\{\s*display:block!important/);
 assert.match(css,/\.lp-moment-comment>\.lp-moment-comment-line\{/);
});

test('group avatar can be uploaded with a native tap and saved',()=>{
 assert.match(groups,/const pick=el\('div','lp-group-avatar-pick'\)/);
 assert.match(groups,/pickBox\.append\(pick,avatar/);
 assert.match(groups,/avatar\.addEventListener\('change'/);
 assert.match(groups,/event\.stopPropagation\(\);void handleFile\(event\)/);
 assert.match(groups,/if\(state\.avatarDraft\)g\.avatar=state\.avatarDraft/);
 assert.match(css,/\.lp-group-avatar-picker \.lp-group-avatar-native-input\{\s*position:static!important/);
 assert.match(css,/pointer-events:auto!important/);
});

test('album review keeps image left centered and removes only selected image',()=>{
 assert.match(album,/const visual=el\('div','lp-album-review-visual'\)/);
 assert.match(album,/card\.append\(visual,fields,remove\)/);
 assert.match(album,/button\('removeReviewCandidate','×'/);
 assert.match(album,/api\.deleteLegacySticker\?\.\(id\)/);
 assert.doesNotMatch(album,/从此张起批量删除|type==='deleteFrom'/);
 assert.match(css,/\.lp-album-review-visual\{[\s\S]*?align-items:center/);
 assert.match(css,/\.lp-album-review-card \.lp-album-review-remove\{\s*position:absolute/);
});
