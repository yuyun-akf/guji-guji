import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const code=read('index.js'),album=read('album.js'),css=read('style.css'),bootstrap=read('bootstrap.js');
const manifest=JSON.parse(read('manifest.json'));

test('0.36.3 version and JS module syntax stay aligned',()=>{
 assert.equal(manifest.version,'0.36.3');
 assert.match(bootstrap,/index\.js\?v=0\.35\.0/);
 for(const module of ['album','groups','weibo'])assert.ok(code.includes(module+'.js?v=0.36.3'));
 for(const source of [code,album,bootstrap])assert.doesNotThrow(()=>new Function(source.replace(/^export /gm,'')));
});

test('Gujiliao tabs, menus, custom name and Moments editor are wired',()=>{
 assert.doesNotMatch(code,/>发现<\/button>/);
 assert.equal((code.match(/>朋友圈<\/button>/g)||[]).length,4);
 assert.match(code,/data-lp-screen="discover"/);
 assert.match(code,/data-lp="momentCamera"/);
 assert.match(code,/composeScreen\.dataset\.lpScreen='momentCompose'/);
 assert.match(code,/momentCompose:'discover'/);
 assert.match(code,/data-lp-open="momentHistory">◉ 历史朋友圈/);
 assert.doesNotMatch(code,/data-lp-open="album">▧ 相册/);
 assert.doesNotMatch(code,/data-lp-open="theme">✿ 主题装扮/);
 assert.doesNotMatch(code,/data-lp-open="settings">☷ 系统设置/);
 assert.match(code,/data-lp="myNameEdit"/);
 assert.match(code,/nodes\.myNameEdit\.addEventListener/);
 assert.match(code,/function phoneUserDisplayName/);
 assert.match(code,/phoneUserNames=/);
 assert.match(code,/lp-me-persona-full/);
 assert.match(code,/momentHistoryEditingId/);
 assert.match(code,/data-moment-edit-field="text"/);
 assert.match(code,/data-moment-edit-field="time"/);
 for(const choice of ['value="1"','value="3"','value="5"'])assert.ok(code.includes(choice));
});

test('album warning, navigation and photo operations are attached to saved state',()=>{
 assert.match(code,/data-lp="albumOptions"/);
 assert.match(code,/nodes\.albumOptions\.addEventListener/);
 assert.match(code,/albumController\?\.endPhoneSession\?\.\(\)/);
 assert.match(album,/warningShown:false/);
 assert.match(album,/function endPhoneSession/);
 assert.match(album,/function requestImport/);
 assert.match(album,/function openOptions/);
 assert.match(album,/function renderDialog/);
 assert.match(album,/api\.saveSafetyWarningDisabled/);
 assert.match(album,/lp-album-safety-note/);
 assert.match(album,/data-album-dialog-field="coverTarget"/);
 assert.match(album,/\['edit','move','cover','delete'\]/);
 assert.doesNotMatch(album,/‹ 返回人物与世界相册|‹ 返回子相册/);
 assert.doesNotMatch(album,/window\.prompt\('移动到哪个子相册/);
 assert.match(css,/\.lp-album-card>img/);
 assert.match(css,/aspect-ratio:1\/1/);
 assert.match(css,/\.lp-album-overlay/);
 assert.match(css,/\.lp-me-persona-full \.lp-persona-description/);
});
