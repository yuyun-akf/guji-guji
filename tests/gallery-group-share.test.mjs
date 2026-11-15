import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const code=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const weibo=readFileSync(new URL('../weibo.js',import.meta.url),'utf8');
const album=readFileSync(new URL('../album.js',import.meta.url),'utf8');
const groups=readFileSync(new URL('../groups.js',import.meta.url),'utf8');
const manifest=JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url),'utf8'));
const parseModule=source=>new Function(source.replace(/^export /gm,''));

test('all new JS modules parse and release version is consistent',()=>{
 for(const source of [code,weibo,album,groups])assert.doesNotThrow(()=>parseModule(source));
 assert.equal(manifest.version,'0.21.1');
 assert.match(code,/album\.js\?v=0\.21\.0/);
 assert.match(code,/groups\.js\?v=0\.21\.0/);
 assert.match(code,/weibo\.js\?v=0\.21\.0/);
});
test('API list excludes modules that never use a model',()=>{
 const list=code.slice(code.indexOf('const PHONE_API_TARGETS=['),code.indexOf('const API_TARGET_IDS=',code.indexOf('const PHONE_API_TARGETS=[')));
 for(const task of ['default','chat','weibo','takeout','autonomy','memory'])
  assert.match(list,new RegExp("\\['"+task+"'"));
 for(const task of ['calendar','wallet','shopping','theme','settings','diagnostics'])
  assert.doesNotMatch(list,new RegExp("\\['"+task+"'"));
});
test('a character-card album is shared between its chats but not another character',()=>{
 const begin=code.indexOf('function characterPhotos('),end=code.indexOf('function galleryPeople(',begin);
 assert.ok(begin>=0&&end>begin);
 const library=new Function('qunxingAccountCardKey','context','SETTINGS_KEY',code.slice(begin,end)+'return {characterPhotos,saveCharacterPhotos};')(
  c=>c.characterKey,()=>null,'gujiguji');
 const shared={gujiguji:{}},ctxA={characterKey:'card-A',extensionSettings:shared,saveSettingsDebounced(){}},
  ctxB={...ctxA,chatId:'another-story'},
  ctxC={...ctxA,characterKey:'card-C'};
 const picture='data:image/jpeg;base64,AAAA';
 const photo={id:'one',owner:'primary',title:'角色本人',description:'照片中有雾蓝色头发',image:picture,access:'chat'};
 assert.equal(library.saveCharacterPhotos([photo],ctxA),true);
 assert.equal(library.characterPhotos(ctxB).length,1);
 assert.equal(library.characterPhotos(ctxB)[0].description,'照片中有雾蓝色头发');
 assert.equal(library.characterPhotos(ctxC).length,0);
 assert.throws(()=>library.saveCharacterPhotos([{...photo,image:'data:image/jpeg;base64,'+'A'.repeat(4000001)}],ctxA),/上限/);
 assert.equal(library.characterPhotos(ctxB).length,1);
});
test('album save failure restores previously saved photos',()=>{
 const start=code.indexOf('function characterPhotos('),end=code.indexOf('function galleryPeople(',start);
 const lib=new Function('qunxingAccountCardKey','context','SETTINGS_KEY',code.slice(start,end)+'return {characterPhotos,saveCharacterPhotos};')(
  c=>c.characterKey,()=>null,'gujiguji');
 const album={id:'old',image:'data:image/jpeg;base64,AAAA'};
 const c={characterKey:'A',extensionSettings:{gujiguji:{characterPhotoAlbums:{A:[album]}}},saveSettingsDebounced(){throw Error('no disk');}};
 assert.throws(()=>lib.saveCharacterPhotos([{id:'new',image:album.image}],c),/no disk/);
 assert.deepEqual(lib.characterPhotos(c).map(x=>x.id),['old']);
});
test('a forwarded Qunxing post is an independent text and picture snapshot',()=>{
 const start=code.indexOf('function makeShareSnapshot('),end=code.indexOf('function openQunxingShare(',start);
 assert.ok(start>=0&&end>start);
 const snapshot=new Function(code.slice(start,end)+'return makeShareSnapshot;')();
 const post={id:'p1',author:'林知远',text:'今天的展览结束了',handle:'@sample_account',image:'data:image/png;base64,AAAA'};
 const saved=snapshot(post);post.text='后来被刷新覆盖了';post.image='';
 assert.equal(saved.text,'今天的展览结束了');assert.match(saved.image,/^data:image\/png;base64,/);
 assert.equal(snapshot({...post,image:'https://example.org/private.jpg'}).image,'');
});
test('private photo and sticker tags can be recognized only by allowed catalogue IDs',()=>{
 const start=code.indexOf('function parseStickerReply('),end=code.indexOf('function visibleStickerText(',start);
 assert.ok(start>=0&&end>start);
 const parse=new Function('splitPhoneReply',code.slice(start,end)+'return parseStickerReply;')(
  text=>String(text).trim()?[String(text).trim()]:[]);
 const sticker={id:'s-cat',label:'猫咪开心',image:'data:image/png;base64,AAAA'};
 const photo={id:'p-char',title:'服装照',image:'data:image/jpeg;base64,BBBB'};
 const messages=parse('你好[[sticker:s-cat]][[photo:p-char]][[photo:other]][[sticker:fake]]',{},[sticker],[photo]);
 assert.deepEqual(messages.map(m=>m.text),['你好','[表情包：猫咪开心]','[图片] 服装照']);
 assert.equal(messages[1].sticker,true);
 assert.deepEqual(messages[2].images,[photo.image]);
});
test('multi-photo chat and pre-send preview preserve the existing single-photo field',()=>{
 assert.match(code,/data-lp="chatImageInput" multiple/);
 assert.match(code,/data-lp="chatPhotoPreview"/);
 assert.match(code,/if\(files\.length>9\)/);
 assert.match(code,/images:encoded/);
 assert.match(code,/Array\.isArray\(message\.images\)/);
 assert.match(code,/message\.image\?\[message\.image\]/);
 assert.doesNotMatch(code,/setStatus\('已发送，可继续发送/);
 assert.match(code,/sharedPost/);
});
test('groups preserve a shared-post snapshot inside the current story, without a model call',async()=>{
 const factory=new Function(groups.replace(/^export /gm,'')+'return createGroupsModule;');
 const ctx={chatMetadata:{}};
 let saved={storyTime:'2026-11-15T12:00',groupChats:[
  {id:'g1',name:'朋友群',members:['primary','npc:a'],messages:[]}
 ]};
 let calls=0;
 const api={
  context:()=>ctx,getNodes:()=>({groupsContent:null}),readRootData:()=>saved,
  writeData:async(_ctx,data)=>{saved={...data};delete saved.__contactId;},
  galleryPeople:()=>[],isPhoneFriend:()=>true,contactCharacter:()=>({}),
  phoneGenerate:async()=>{calls++;throw Error('share must not call AI');}
 };
 const controller=factory(api);
 const post={id:'p2',author:'作者A',text:'原帖内容',image:'data:image/png;base64,AAAA'};
 await controller.shareToGroup('g1',post);
 assert.equal(calls,0);
 assert.equal(saved.groupChats[0].messages[0].sharePost.text,'原帖内容');
 saved.groupChats=[];assert.equal(saved.groupChats.length,0,'another story would have its own groups');
});
test('Qunxing keeps repost separate from sharing to chat or groups',()=>{
 assert.match(weibo,/control\('转发','repost'/);
 assert.match(weibo,/control\('分享','share'/);
 assert.match(weibo,/api\.sharePost\?\.\(p\)/);
 assert.match(weibo,/publishAlbumPhoto\(photo,caption\)/);
 assert.match(weibo,/photo\.owner!=='user'\|\|photo\.access!=='public'/);
 assert.match(weibo,/\[\[photo:照片ID\]\]/);
 assert.match(album,/createAlbumModule/);
});
