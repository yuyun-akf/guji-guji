import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const index=read('index.js'),weibo=read('weibo.js'),
 album=read('album.js'),css=read('style.css'),bootstrap=read('bootstrap.js');
const manifest=JSON.parse(read('manifest.json'));

test('v0.36.3 cache keys and JS syntax',()=>{
 assert.equal(manifest.version,'0.36.3');
 assert.match(bootstrap,/index\.js\?v=0\.36\.1/);
 for(const name of ['album','groups','weibo'])assert.ok(index.includes(name+'.js?v=0.36.3'));
 for(const file of ['index.js','weibo.js','album.js','groups.js','bootstrap.js'])
  assert.doesNotThrow(()=>new Function(read(file).replace(/^export /gm,'')));
});

test('following rows and account drawers retain scanned results',()=>{
 assert.match(weibo,/lp-wb-follow-identity/);
 assert.match(weibo,/lp-wb-follow-handle/);
 assert.match(css,/\.lp-wb-follow-row/);
 assert.match(weibo,/function renderManualAccountDrawer/);
 assert.match(weibo,/panel\.append\(content\)/);
 assert.match(weibo,/lp-wb-manual-disclosure/);
 assert.doesNotMatch(weibo,/control\('＋ 手动新建账号','newAccount'\)/);
 assert.match(weibo,/state\.pendingExpanded=true/);
 assert.doesNotMatch(weibo,/state\.candidates=\[\];state\.scanMessage='已保存/);
 assert.match(css,/\.lp-wb-settings-menu>\.lp-wb-settings-link/);
});

test('chat image preview is independent of sticker metadata',()=>{
 const source=index.slice(index.indexOf('function chatListMessagePreview('),index.indexOf('function renderChatLists('));
 const preview=new Function(source+'\nreturn chatListMessagePreview;')();
 assert.equal(preview({text:'[表情包：猫猫走过来]',image:'data:image/png;base64,AA==',sticker:true}),'[图片]');
 assert.equal(preview({text:'[图片]',images:['a']}),'[图片]');
 assert.equal(preview({text:'[表情包：猫猫]'}),'[图片]');
 assert.equal(preview({text:'正常聊天'}),'正常聊天');
 assert.match(index,/chatListMessagePreview\(last\)/);
});

test('Moments only allows quoting author/friend, not unknown NPC',()=>{
 const source=index.slice(index.indexOf('function canReplyToMomentComment('),index.indexOf('function momentButton('));
 const fn=new Function('momentAuthorId','friendshipState','readData','validContactId','readRootData','MOMENT_USER_ID',
  source+'\nreturn canReplyToMomentComment;')(
   ()=> 'author',d=>d.state,(_,id)=>({state:id==='author'||id==='known'?'friends':'stranger'}),
   (_,id)=>['author','known'].includes(id),()=>({}), 'user');
 assert.equal(fn({}, {},{actorId:'author'}),true);
 assert.equal(fn({}, {},{actorId:'known'}),true);
 assert.equal(fn({}, {},{actorId:'stranger'}),false);
 assert.equal(fn({}, {},{actorId:'guest:temporary'}),false);
 assert.doesNotMatch(index,/row\.append\(text,momentButton\('回复'/);
 assert.match(index,/nameNode\.addEventListener\('pointerdown'/);
});

test('Moments can accumulate five comments from overlapping speakers',()=>{
 const source=index.slice(index.indexOf('function applyMomentBatch('),index.indexOf('function visibleMomentComments('));
 const apply=new Function('roleFriendGuest','contactDisplayName','momentAuthorId','charactersHaveContact',
  'visibleMomentComments','MOMENT_USER_ID',source+'\nreturn applyMomentBatch;')(
   ()=>null,(_,id)=>id,()=> 'author',()=>false,(_,post)=>post.comments,'user');
 const post={comments:[],likes:[]};
 const actions=[
  {actorId:'a',kind:'comment',text:'早安'},
  {actorId:'b',kind:'comment',text:'今天天气不错'},
  {actorId:'a',kind:'reply',replyToIndex:0,text:'我们出门吧'},
  {actorId:'b',kind:'comment',text:'记得带伞'},
  {actorId:'a',kind:'comment',text:'晚上见'}
 ];
 apply({}, {},post,['a','b'],actions);
 assert.equal(post.comments.length,5);
 assert.equal(post.comments[2].replyTo,post.comments[0].id);
 assert.match(index,/line\.textContent='♥ '\+likeCount/);
});

test('album candidate files retain good selections and show per-file errors',()=>{
 const source=album.slice(album.indexOf(' function candidateError('),album.indexOf(' function validateCandidateFiles('));
 const invalid=new Function('state',source+'\nreturn candidateError;')({mode:'ai'});
 assert.match(invalid({name:'a.png',size:13*1024*1024,type:'image/png'}),/12MB/);
 assert.equal(invalid({name:'b.png',size:100,type:'image/png'}),'');
 assert.match(invalid({name:'bad.pdf',size:100,type:'application/pdf'}),/JPG/);
 assert.match(album,/state\.selectedFiles\.push\(file\)/);
 assert.match(album,/state\.fileErrors\.set\(f,String\(error\.message\|\|error\)\)/);
 assert.match(album,/removeCandidate/);
 assert.match(album,/removeReviewCandidate/);
 assert.match(css,/lp-album-invalid/);
});
