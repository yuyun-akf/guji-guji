import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const weibo=readFileSync(new URL('../weibo.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');
const manifest=JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url),'utf8'));
const part=(a,b)=>index.slice(index.indexOf(a),index.indexOf(b,index.indexOf(a)));

const detector=new Function(part('const NPC_RELATIONS =','function mergeNpcCandidates(')+
  'return {extractNpcCandidatesFromText,npcEntryKeywords,npcEntryHeaderCandidates,likelyNpcPersonalName,cleanNpcName,npcExplicitNames};')();
const merge=(items,root,primary)=>{
 const seen=new Set([primary,...(root?.contacts||[]).map(c=>c.name)]);
 return items.filter(item=>{
  if(!item?.name||seen.has(item.name))return false;
  seen.add(item.name);return true;
 }).slice(0,45);
};

test('v0.36.3: modules load with updated cache keys and two explicit scan modes',()=>{
 assert.equal(manifest.version,'0.36.3');
 assert.doesNotThrow(()=>new Function(index.replace(/^export /gm,'')));
 assert.doesNotThrow(()=>new Function(weibo.replace(/^export /gm,'')));
 for(const p of ['weibo.js','album.js','groups.js'])assert.ok(index.includes(p+'?v=0.36.3'));
 assert.match(index,/data-lp="npcAiScanButton"/);
 assert.match(index,/scanNpcUI\('rules'\)/);
 assert.match(index,/scanNpcUI\('ai'\)/);
 assert.match(weibo,/scanAccountsAI/);
 assert.match(weibo,/cachedScanAccounts/);
 assert.match(css,/grid-template-columns:minmax\(0,1fr\) 96px/);
 assert.match(css,/width:96px;min-width:96px/);
});

test('rule scanner: real names from content, worldbook titles and keywords; no 兼同学',()=>{
 const find=text=>detector.extractNpcCandidatesFromText(text,'世界书','林知远').map(p=>p.name);
 assert.deepEqual(find('林知远的同事，习惯早起散步。'),[]);
 assert.deepEqual(find('梁佑宁（小梁），男，31岁，林知远的助理。'),['梁佑宁']);
 assert.deepEqual(find('林知远的母亲谢雨晴，社区志愿者。'),['谢雨晴']);
 assert.deepEqual(find('姓名：乔向晨\n身份：大学室友。'),['乔向晨']);
 const keys=detector.npcEntryKeywords({key:['乔向晨','学委'],keysecondary:['第五人格']});
 assert.deepEqual(keys,['乔向晨','学委','第五人格']);
 assert.deepEqual(detector.npcEntryHeaderCandidates({
  title:'词条18｜大学室友｜乔向晨／原学委',keys,profileEntry:true,
  content:'乔向晨，女，大学室友。',name:'世界书'
 },'林知远').map(c=>c.name),['乔向晨']);
 assert.equal(detector.likelyNpcPersonalName('兼同学'),'');
 assert.equal(detector.likelyNpcPersonalName('欧阳明'),'欧阳明');
});

test('shared scanner: the same character card works across distinct story chats without changing contacts',()=>{
 const settings={gujiguji:{}};
 const base={extensionSettings:settings,characterId:4,saveCount:0,
  saveSettingsDebounced(){this.saveCount++;},chatMetadata:{}};
 const one={...base,chatId:'one'};
 const two={...base,chatId:'two'};
 let active=one;
 const facade=new Function('qunxingAccountCardKey','mergeNpcCandidates','getCharacterName',
  'selectedCharacter','readRootData','personaNames','scanNpcSources','context','SETTINGS_KEY',
  part('const NPC_SCAN_CATALOG_VERSION=','function sameNpcScanSession(')+
  'return {readSharedNpcScan,saveSharedNpcScan,visibleSharedNpcScan,clearSharedNpcScan};')(
    ctx=>'card:'+ctx.characterId,merge,()=> '林知远',()=>({name:'林知远'}),
    ctx=>({contacts:ctx.chatId==='two'?[{name:'谢雨晴'}]:[]}),()=>new Set(),
    async()=>({candidates:[]}),()=>active,'gujiguji');
 facade.saveSharedNpcScan([{name:'谢雨晴',source:'世界书',description:'社区志愿者',relation:'母亲'}],one);
 assert.equal(facade.readSharedNpcScan(two)[0].name,'谢雨晴');
 assert.equal(facade.visibleSharedNpcScan(two).length,0,'already-added contact hidden only from chat-add options');
 assert.equal(facade.readSharedNpcScan(two).length,1,'shared catalog still contains contacts for Qunxing');
 assert.equal(facade.clearSharedNpcScan(two),true);
 assert.equal(facade.readSharedNpcScan(one).length,0);
 assert.equal(one.saveCount,1);
});

test('AI scan: a single explicit API call, no hallucinated name, and no auto account creation',async()=>{
 let count=0;
 const source={
  data:{name:'林知远',description:'',extensions:{world:'测试世界书'}},
  name:'林知远'
 };
 const ctx={characters:[source],characterId:0,
  async loadWorldInfo(){return {entries:[{comment:'词条03｜NPC｜谢雨晴',
   key:['谢雨晴','谢老师'],content:'谢雨晴，社区志愿者，林知远的母亲。'}]};}};
 const scan=new Function('selectedCharacter','personaNames','currentPersona','embeddedCharacterLore',
  'getCharacterName','npcEntryKeywords','extractNpcCandidatesFromText','npcEntryHeaderCandidates','npcExplicitNames',
  'cleanNpcName','mergeNpcCandidates','phoneGenerate','stripModelReasoning','readRootData',
  part('async function scanNpcSources(','function readSharedNpcScan(')+'return scanNpcSources;')(
   c=>c.characters[c.characterId],()=>new Set(),()=>({}),()=>[],
   c=>c.data?.name||c.name,detector.npcEntryKeywords,detector.extractNpcCandidatesFromText,
   detector.npcEntryHeaderCandidates,detector.npcExplicitNames,detector.cleanNpcName,merge,
   async(c,opts)=>{count++;assert.equal(opts.task,'default');
    return JSON.stringify({people:[
      {name:'谢雨晴',relation:'林知远的母亲',description:'社区志愿者'},
      {name:'虚构人',relation:'',description:'资料里不存在'}
    ]});},
   s=>s,()=>({contacts:[]}));
 const result=await scan(ctx,'','ai');
 assert.equal(count,1);
 assert.deepEqual(result.candidates.map(c=>c.name),['谢雨晴']);
 assert.equal(result.worlds,1);
 assert.equal(result.aiTruncated,false);
 assert.match(index,/saveSharedNpcScan\(result.candidates,ctx\)/);
 assert.match(weibo,/保存勾选的账号/);
});

test('regression: aliases, sex preferences and abstract labels never become standalone people',()=>{
 const source={profileEntry:true,title:'词条17｜关系｜程雨竹',
  content:'姓名：程雨竹\n性别：男\n年龄：41岁\n身份/职业：公园管理员\n性格：耐心',
  keys:['程雨竹','小程','程同学','程仔','小程在看书'],name:'人物资料'};
 assert.deepEqual(detector.npcEntryHeaderCandidates(source,'林知远').map(x=>x.name),['程雨竹']);
 for(const [title,content,keys] of [
  ['词条07｜生活｜晨练与方言习惯','日常生活，林知远记录了方言习惯。',['方言习惯']],
  ['词条08｜工作｜社区馆开放安排','林知远提醒访客留意开放日期。',['开放日期']],
  ['词条09｜工作｜社区馆与志愿服务','志愿小组负责书架整理。',['经纪团队']],
  ['词条31｜爱好｜个人偏好','围棋是一种休闲爱好。',['围棋']]
 ]){
  assert.deepEqual(detector.npcEntryHeaderCandidates({profileEntry:true,title,content,keys,name:'test'},'林知远'),[]);
  assert.deepEqual(detector.extractNpcCandidatesFromText(content,'test','林知远'),[]);
 }
 assert.deepEqual(detector.extractNpcCandidatesFromText('林知远的同事，习惯早起散步。','test','林知远'),[]);
});
test('old surname-keyword cache cannot reappear after new scan',()=>{
 const ctx={extensionSettings:{gujiguji:{npcRoleScanCatalog:{
  'card:7':{candidates:[{name:'小程'},{name:'开放日期'},{name:'围棋'}]}
 }}},characterId:7,chatId:'c',saveSettingsDebounced(){}};
 const facade=new Function('qunxingAccountCardKey','mergeNpcCandidates','getCharacterName',
  'selectedCharacter','readRootData','personaNames','scanNpcSources','context','SETTINGS_KEY',
  part('const NPC_SCAN_CATALOG_VERSION=','function sameNpcScanSession(')+
  'return {readSharedNpcScan,saveSharedNpcScan};')(
   c=>'card:'+c.characterId,merge,()=> '林知远',()=>({name:'林知远'}),
   ()=>({contacts:[]}),()=>new Set(),async()=>({candidates:[]}),()=>ctx,'gujiguji');
 assert.deepEqual(facade.readSharedNpcScan(ctx),[]);
 facade.saveSharedNpcScan([{name:'程雨竹',description:'具名人物',source:'NPC'}],ctx);
 assert.deepEqual(facade.readSharedNpcScan(ctx).map(c=>c.name),['程雨竹']);
 assert.equal(ctx.extensionSettings.gujiguji.npcRoleScanCatalog['card:7'].version,2);
});
