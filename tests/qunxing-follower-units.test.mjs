import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../weibo.js',import.meta.url),'utf8');
const start=source.indexOf(' const FOLLOWER_FACTORS=');
const end=source.indexOf(' const data=()=>',start);
const units=new Function(source.slice(start,end)+'return {followerParts,formatFollowers,parseFollowerValue,readFollowerField};')();

test('粉丝编辑器可用 粉丝、万、亿，内部数量均为整数',()=>{
 assert.equal(units.parseFollowerValue('3500','wan'),35000000);
 assert.equal(units.parseFollowerValue('1.2','yi'),120000000);
 assert.equal(units.parseFollowerValue('12.5','wan'),125000);
 assert.equal(units.parseFollowerValue('35000000','person'),35000000);
 assert.equal(units.parseFollowerValue('0','wan'),0);
});
test('旧粉丝数字可自动预填合适单位且回存不丢失精度',()=>{
 for(const count of [0,89,9999,10000,32000000,35001234,120000000,987654321]){
  const {value,unit}=units.followerParts(count);
  assert.equal(units.parseFollowerValue(value,unit),count);
 }
 assert.deepEqual(units.followerParts(35000000),{value:'3500',unit:'wan'});
 assert.deepEqual(units.followerParts(120000000),{value:'1.2',unit:'yi'});
});
test('粉丝展示有单位而非完整长数字',()=>{
 assert.equal(units.formatFollowers(35000000),'3500万粉丝');
 assert.equal(units.formatFollowers(120000000),'1.2亿粉丝');
 assert.equal(units.formatFollowers(9500),'9,500粉丝');
 assert.equal(units.formatFollowers(125000),'12.5万粉丝');
});
test('无效、负数或溢出输入必须拒绝，不能静默存0',()=>{
 for(const value of ['', '-1','1e6','一千万','3.2.1','Infinity']){
  assert.throws(()=>units.parseFollowerValue(value,'wan'),/粉丝/);
 }
 assert.throws(()=>units.parseFollowerValue('1','invalid'),/单位/);
 assert.throws(()=>units.parseFollowerValue('999999999999999','yi'),/范围/);
});
test('三个账号编辑入口共用单位控件，用户修改后保存真实人数',async()=>{
 const names=['ownerFollowers','accountFollowers','candidate-0-followers'];
 for(const name of names)assert.ok(source.includes("'"+name+"'")||name.startsWith('candidate-'),name);
 assert.match(source,/followerField\(form,'粉丝数量（故事设定）','ownerFollowers'/);
 assert.match(source,/followerField\(form,'粉丝数量','accountFollowers'/);
 assert.match(source,/followerField\(row,label,'candidate-'/);
 assert.match(source,/readFollowerField\(row,'candidate-'/);
 const records={ownerName:{value:'我'},ownerHandle:{value:'@me'},ownerBio:{value:'故事'},
  ownerFollowers:{value:'1.2'},ownerFollowersUnit:{value:'yi'},
  accountName:{value:'林知远'},accountHandle:{value:'@sample_account'},accountBio:{value:'演员'},
  accountKind:{value:'角色'},accountPublic:{checked:true},accountFollowers:{value:'3500'},accountFollowersUnit:{value:'wan'}};
 let saved={qunxing:{profile:{},accounts:[],posts:[]},messages:[],contacts:[]};
 const ctx={characterId:0,chatId:'draft',chatMetadata:{},characters:[{name:'林知远'}]};
 const actionFactory=new Function('document','structuredClone',source.replace(/^export /gm,'').replace('return {open,render,','return {action,open,render,')+'\nreturn createWeiboModule;');
 const writer=actionFactory({visibilityState:'visible'},x=>JSON.parse(JSON.stringify(x)))({
  context:()=>ctx,getNodes:()=>({weiboFeed:null,weiboMe:{querySelector:selector=>{
   const key=selector.match(/data-wb-field="([^"]+)"/)?.[1];return records[key]||null;
  }}}),
  readRootData:()=>saved,currentPersona:()=>({name:'我'}),
  writeData:async(_ctx,next)=>{saved=next;},notifyInteraction:()=>{}
 });
 await writer.action('saveProfile');
 assert.equal(saved.qunxing.profile.followers,120000000);
 writer.state.editing='new';
 await writer.action('saveAccount');
 assert.equal(saved.qunxing.accounts[0].followers,35000000);
});
