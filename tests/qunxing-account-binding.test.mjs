import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../weibo.js',import.meta.url),'utf8');
const bridge=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
const begin=source.indexOf(' const subjectChoices='),end=source.indexOf(' const data=()=>',begin);
function helpers(){
 const api={accountSubjects:()=>[{id:'primary',name:'宁肆锦'},{id:'npc:1',name:'林助理'},{id:'npc:2',name:'林助理'}],
  selectedCharacter:()=>({name:'宁肆锦'})};
 return new Function('api','context','clean',
  source.slice(begin,end)+'return {subjectChoices,subjectOfAccount,subjectValue,readSubject,savedProfession};')(
  api,()=>({}), (text,length=100)=>String(text||'').trim().slice(0,length));
}
const factory=new Function('document','structuredClone',
 source.replace('export function createWeiboModule','function createWeiboModule').replace('return {open,render,','return {action,open,render,')
 +'\nreturn createWeiboModule;')({visibilityState:'visible'},clone);

function mock(){
 const ctx={chatId:'story-1',chatMetadata:{}};
 let root={messages:[],contacts:[{id:'npc:1',name:'林助理'}],
  qunxing:{posts:[],accounts:[],profile:{},following:[]}};
 let shared=[];
 const fields={accountSubject:'primary',accountName:'宁肆锦',accountHandle:'@ning',accountProfession:'演员',
  accountBio:'我不搞抽象搞什么',accountFollowers:'3500',accountFollowersUnit:'wan'};
 const nodes={weiboFeed:null,weiboMe:{querySelector:selector=>{
   const name=selector.match(/data-wb-field="([^"]+)"/)?.[1];
   return name==='accountPublic'?{checked:true}:name in fields?{value:fields[name]}:null;
 }}};
 const controller=factory({context:()=>ctx,getNodes:()=>nodes,readRootData:()=>root,readData:()=>root,
  writeData:async(_,next)=>{root=next;},currentPersona:()=>({name:'我'}),
  selectedCharacter:()=>({name:'宁肆锦'}),
  accountSubjects:()=>[{id:'primary',name:'宁肆锦'},{id:'npc:1',name:'林助理'}],
  readSharedAccounts:()=>shared,saveSharedAccounts:async next=>{shared=clone(next);},
  notifyInteraction:()=>{}});
 return {controller,ctx,fields,root:()=>root,shared:()=>shared};
}
test('故事人物绑定是实名主体，不再依赖自由文本身份类型',()=>{
 const h=helpers(),list=h.subjectChoices();
 assert.deepEqual(list.map(x=>x.value),['primary','npc:'+encodeURIComponent('林助理'),'organization']);
 assert.deepEqual(h.readSubject('primary',list),{type:'primary',name:'宁肆锦'});
 assert.deepEqual(h.readSubject('npc:'+encodeURIComponent('林助理'),list),{type:'npc',name:'林助理'});
 assert.deepEqual(h.readSubject('organization',list),{type:'organization',name:''});
 assert.throws(()=>h.readSubject('npc:injected',list),/有效/);
 assert.match(bridge,/accountSubjects:\(\)=>/);
});
test('旧账号不重新创建；保留原签名，并从已有职业类型读取职业',()=>{
 const h=helpers();
 const old={id:'old',name:'宁肆锦',kind:'演员',bio:'我不搞抽象搞什么，搞你受得了吗？',
  followers:42865700,source:'manual'};
 assert.deepEqual(h.subjectOfAccount(old),{type:'primary',name:'宁肆锦'});
 assert.equal(h.savedProfession(old),'演员');
 assert.equal(old.bio,'我不搞抽象搞什么，搞你受得了吗？');
 assert.equal(h.subjectOfAccount({name:'校园表白墙',kind:'媒体'}).type,'organization');
 assert.deepEqual(h.subjectOfAccount({name:'林助理',kind:'NPC'}),{type:'npc',name:'林助理'});
});
test('主角、NPC、独立组织绑定均保存职业、签名和整数粉丝数；共享账号跨剧情存档',async()=>{
 const h=mock(),check=[];
 for(const [binding,name,job,bio,n,unit] of [
  ['primary','宁肆锦','演员','我不搞抽象搞什么','3500','wan'],
  ['npc:'+encodeURIComponent('林助理'),'林助理','演员助理','忙到飞起','125','person'],
  ['organization','校园表白墙','校园信息平台','欢迎投稿','1.5','wan']
 ]){
  Object.assign(h.fields,{accountSubject:binding,accountName:name,accountProfession:job,accountBio:bio,
   accountFollowers:n,accountFollowersUnit:unit});
  h.controller.state.editing='new';await h.controller.action('saveAccount');
  check.push(h.shared().find(x=>x.name===name));
 }
 assert.deepEqual(check.map(x=>x.subject.type),['primary','npc','organization']);
 assert.deepEqual(check.map(x=>x.kind),['角色','NPC','组织']);
 assert.deepEqual(check.map(x=>x.profession),['演员','演员助理','校园信息平台']);
 assert.deepEqual(check.map(x=>x.bio),['我不搞抽象搞什么','忙到飞起','欢迎投稿']);
 assert.deepEqual(check.map(x=>x.followers),[35000000,125,15000]);
 const otherChat={...h.ctx,chatId:'story-2',chatMetadata:{}};
 assert.equal(h.shared()[0].name,'宁肆锦');
 assert.equal(otherChat.chatId,'story-2');
 assert.equal(h.root().qunxing.accounts.length,3);
});
test('账户绑定未知人物时阻止保存，不改变现有数据',async()=>{
 const h=mock();h.controller.state.editing='new';
 h.fields.accountSubject='npc:'+encodeURIComponent('凭空造的人物');
 await h.controller.action('saveAccount');
 assert.equal(h.shared().length,0);
 assert.equal(h.root().qunxing.accounts.length,0);
});
test('公开职业/个性签名分栏，原身份类型文本框已移除',()=>{
 assert.match(source,/subjectField\(form,'绑定故事人物／账号主体','accountSubject'/);
 assert.match(source,/field\(form,'职业／公开身份','accountProfession'/);
 assert.match(source,/field\(form,'个性签名','accountBio'/);
 assert.match(source,/subjectField\(row,'绑定故事人物／账号主体','candidate-'/);
 assert.doesNotMatch(source,/field\(form,'身份类型/);
 assert.doesNotMatch(source,/field\(form,'职业、性格与公开身份'/);
});
