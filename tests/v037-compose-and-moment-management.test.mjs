import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const index=read('index.js'),weibo=read('weibo.js'),css=read('style.css');
function section(source,begin,end){
 const first=source.indexOf(begin),last=source.indexOf(end,first+begin.length);
 assert.ok(first>=0&&last>first,'missing anchors: '+begin+' / '+end);
 return source.slice(first,last);
}

test('群星发布按钮与上传图片在同一行且靠右，图片有右上角删除按钮',()=>{
 const markup=section(index,'<div data-lp="weiboCompose"','<div data-lp="weiboMe"');
 assert.match(markup,/class="lp-wb-compose-actions">[\s\S]*?data-wb-field="composePhoto"[\s\S]*?data-lp="weiboPublish"/);
 const preview=section(weibo,'async function readComposePhoto(','function handleFile(');
 assert.match(preview,/control\('×','removeComposePhoto'\)/);
 assert.match(preview,/frame\.append\(image,remove\)/);
 const remove=section(weibo,"if(type==='removeComposePhoto')","if(type==='clearInteractions')");
 assert.match(remove,/state\.composePhoto=''/);
 assert.match(remove,/replaceChildren\(\)/);
 assert.match(css,/\.lp-wb-compose-actions\{[\s\S]*?display:flex;align-items:center;justify-content:space-between/);
 assert.match(css,/\.lp-wb-compose-photo-remove\{[\s\S]*?position:absolute;top:6px;right:6px/);
});

test('朋友圈所有帖子均能编辑或删除，操作写入当前存档',()=>{
 const menu=section(index,'function renderMoments(ctx){','function openMomentEditDialog(');
 assert.match(menu,/momentButton\('生成角色互动'/);
 assert.match(menu,/momentButton\('编辑该条帖子'/);
 assert.match(menu,/momentButton\('删除此条朋友圈'/);
 assert.doesNotMatch(menu,/补齐评论/);
 const editor=section(index,'function openMomentEditDialog(','async function editMoments(');
 assert.match(editor,/findIndex\(p=>p\.id===post\.id\)/);
 assert.doesNotMatch(editor,/p\.authorId==='user'/);
 assert.match(editor,/data\.moments\.splice\(idx,1\)/);
 assert.match(editor,/data\.moments\[idx\]\.text=textArea\.value/);
 assert.match(editor,/await editMoments\(ctx,data=>/);
});

test('手动生成朋友圈互动不再要求至少五条评论',()=>{
 const task=section(index,'function momentBatchTask(','function parseMomentBatch(');
 const batch=section(index,'async function runMomentBatch(','async function tickMomentInteractions(');
 assert.match(task,/没有最低评论条数/);
 assert.doesNotMatch(task,/needed|至少新增/);
 assert.doesNotMatch(batch,/有效评论不足五句|\.length<5/);
 assert.match(batch,/if\(count\)\{/);
});
