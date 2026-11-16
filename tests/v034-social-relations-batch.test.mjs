import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const index=read('index.js'),album=read('album.js'),groups=read('groups.js'),
 weibo=read('weibo.js'),bootstrap=read('bootstrap.js'),css=read('style.css');
const manifest=JSON.parse(read('manifest.json'));

test('v0.34.0 cache keys, module syntax and all new controls',()=>{
 assert.equal(manifest.version,'0.34.0');
 assert.match(bootstrap,/index\.js\?v=0\.34\.0/);
 for(const module of ['album','groups','weibo'])
  assert.ok(index.includes(module+'.js?v=0.34.0'));
 for(const source of [index,album,groups,weibo,bootstrap])
  assert.doesNotThrow(()=>new Function(source.replace(/^export /gm,'')));
 const controls=['profileTabDetails','profileTabRelation','profileRelationPane','relationAuto',
  'relationManual','relationChoice','relationSave','relationDetect',
  'groupOptions','albumOptions','momentHistoryMode'];
 for(const name of controls){
  assert.ok(index.includes('data-lp="'+name+'"'),name+' markup');
  assert.ok(index.includes("'"+name+"'"),name+' mapped');
 }
});

test('contacts, persona display, saved manual/auto relationship and both timeline directions',()=>{
 assert.match(index,/let profileReturnScreen='contacts'/);
 assert.match(index,/profile:profileReturnScreen/);
 assert.match(index,/function phoneRelationshipFor\(/);
 assert.match(index,/function confirmPhoneManualRelationship\(/);
 assert.match(index,/function detectPhoneRelationship\(/);
 assert.match(index,/phoneRelationshipStates/);
 assert.match(index,/checkedMainline/);
 assert.match(index,/checkedMessages/);
 assert.match(index,/__contactId:PRIMARY_CONTACT_ID\}\);\s*if\(sameSession\(session\)\)/);
 assert.match(index,/ex:'前任'/);
 assert.match(index,/crush:'暗恋对象'/);
 assert.match(index,/角色暗恋 user/);
 assert.match(index,/小手机时间可能早于或晚于酒馆正文/);
 assert.match(index,/好感度阈值/);
 assert.match(index,/readExternalMemory\(/);
 assert.match(index,/function phoneUserDisplayName\(/);
 assert.match(index,/nodes\.profileRelationNames\.textContent=contact\.name\+' 与 '\+persona\.name/);
 assert.doesNotMatch(index,/手动关系不会随剧情自动更新。建议开启自动识别。\\n\\n点击「确定」/);
});

test('Moments allow real user photo, avatar, inline comment, own post editing and multi-contact history',()=>{
 assert.match(index,/function momentActorAvatar\(/);
 assert.match(index,/lp-moment-author-row/);
 assert.match(index,/lp-moment-comment-input/);
 assert.match(index,/function openMomentEditDialog\(/);
 assert.match(index,/authorId==='user'/);
 assert.match(index,/phoneUserDisplayName\(ctx\)/);
 assert.match(index,/async function encodeMomentPhoto\(/);
 assert.match(index,/image_url/);
 assert.match(index,/showMomentImageUnavailable\(/);
 assert.match(index,/禁止为了凑热闹让所有人集体嘲讽或攻击 user/);
 assert.match(index,/momentHistoryMode/);
 assert.match(index,/randomMode\?registered/);
 assert.match(index,/comments\.length<5/);
 assert.match(index,/if\(comments\.length<5\|\|!comments\.some/);
 assert.match(css,/\.lp-moment-camera\{/);
 assert.match(css,/position:absolute;z-index:7/);
 assert.match(css,/\.lp-moment-author-avatar/);
});

test('album portable template, safety permissions, isolated manual and JSON/ZIP batch import',()=>{
 assert.match(album,/gujiguji-album-v1/);
 assert.match(album,/function exportAlbumTemplate\(/);
 assert.match(album,/async function extractZipFiles\(/);
 assert.match(album,/async function prepareBatch\(/);
 assert.match(album,/ZIP图片体积或内容无效/);
 assert.match(album,/ownerId/);
 assert.match(album,/if\(state\.mode==='manual'&&files\.length!==1\)/);
 assert.match(album,/state\.mode==='files'/);
 assert.match(album,/resolveAlbumText/);
 assert.match(album,/固定 NPC、临时 NPC/);
 assert.match(album,/包括网友、粉丝和黑粉/);
 assert.match(album,/与 \{\{user\}\} 私聊/);
 assert.doesNotMatch(album,/此设置只影响导入前弹窗/);
 assert.match(css,/data-album-dialog-field="disableWarning"\]:checked/);
});

test('groups use actor quote IDs, manage records and allow invite; Qunxing random batch uses saved character accounts',()=>{
 for(const token of ['lp-group-chat-feed','lp-group-sender-avatar','lp-group-reply-quote','lp-group-invite',
  'lp-group-record-actions','newBatch','delete-group','clear-records','copy-records','export-records'])
  assert.ok(groups.includes(token),token);
 assert.match(groups,/最多8条/);
 assert.match(weibo,/generateRandomHistory/);
 assert.match(weibo,/byPerson/);
 assert.match(weibo,/Math\.max\(10,Math\.min\(50/);
 assert.match(weibo,/subjectOfAccount\(a\)\.type!=='organization'/);
 assert.match(weibo,/valid\.length<10/);
 assert.doesNotMatch(weibo,/feedback\('正在刷新'\+name\+'帖子…'\);render\(\)/);
});

test('group replies resolve to earlier messages from the same generation batch',async()=>{
 class N{
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.scrollTop=0;this.value='';this.classList={add(){}};}
  append(...xs){this.children.push(...xs);}
  prepend(...xs){this.children.unshift(...xs);}
  replaceChildren(...xs){this.children=[...xs];}
 }
 const document={createElement:tag=>new N(tag),createTextNode:txt=>({textContent:txt})};
 const create=new Function('document','structuredClone',groups.replace(/^export /gm,'')+'return createGroupsModule;')(document,structuredClone);
 const ctx={chatMetadata:{}},target=new N('div');
 let stored={storyTime:'2026-11-17T09:00',groupChats:[{id:'g1',name:'寝室群',members:['primary','npc:b'],messages:[]}]};
 const api={context:()=>ctx,getNodes:()=>({groupsContent:target}),readRootData:()=>stored,
  writeData:async(_ctx,data)=>{stored=data;},galleryPeople:()=>[
   {id:'primary',name:'角色A'},{id:'npc:b',name:'角色B'}],
  isPhoneFriend:()=>true,memberAvatar:()=>'',setGroupTitle:()=>{},setGroupOptionsVisible:()=>{},
  contactCharacter:()=>({data:{description:'测试人物设定'}}),
  phoneGenerate:async()=>JSON.stringify({messages:[
   {speaker:'primary',text:'第一句'},{speaker:'npc:b',text:'回复第一句',replyTo:'0'}]}),
  stripModelReasoning:x=>x,refreshChatList:()=>{},notifyInteraction:()=>{}};
 const mod=create(api);
 mod.open({groupId:'g1'});
 await mod.handleClick({target:{closest:()=>({dataset:{groupAction:'generate',groupId:''}})}});
 const saved=stored.groupChats[0].messages;
 assert.equal(saved.length,2);
 assert.equal(saved[0].from,'primary');
 assert.equal(saved[1].from,'npc:b');
 assert.equal(saved[1].replyTo,saved[0].id);
});
