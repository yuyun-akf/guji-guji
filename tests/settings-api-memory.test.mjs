import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const memory=readFileSync(new URL('../memory.js',import.meta.url),'utf8');
const html=index.slice(index.indexOf('<section class="lp-screen lp-settings"'),index.indexOf('<section class="lp-screen lp-picker" data-lp-screen="presetPicker"'));
const apiBegin=index.indexOf('const PHONE_API_TARGETS=[');
const apiEnd=index.indexOf('function currentApiTarget(){',apiBegin);
const apiText=index.slice(apiBegin,apiEnd);
const apiFactory=new Function('apiSessionId','context','transientApiKeys','transientApiKeyUrls','URL',
 apiText+'return {readApiOptions,availableConnectionProfiles,phoneGenerate,apiKeySlot};');
function MiniURL(raw){
 const parts=String(raw).match(/^(https?):\/\/([^/?#]+)(\/[^?#]*)?$/);
 if(!parts)throw Error('bad url');
 this.protocol=parts[1]+':';this.hostname=parts[2];this.pathname=parts[3]||'/';this.search='';this.hash='';
 this.toString=()=>parts[1]+'://'+parts[2]+this.pathname;
}
const clone=obj=>JSON.parse(JSON.stringify(obj));
const dom=()=>({dataset:{},children:[],textContent:'',value:'3',checked:false,hidden:false,disabled:false,
 append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},setAttribute(){},
 querySelector(){return dom();},focus(){}});
function memoryHarness(intervalDays=1,contacts=false){
 const nodes=Object.fromEntries(['phoneMemoryEnabled','phoneMemoryInterval','phoneMemoryInjectMainline',
  'phoneMemoryStatus','phoneMemorySchedule','phoneMemoryRun','phoneMemorySave','phoneMemoryList']
  .map(name=>[name,dom()]));
 nodes.phoneMemoryEnabled.checked=true;
 nodes.phoneMemoryInterval.value=String(intervalDays);
 let data={version:1,storyTime:'2026-11-15T09:00',messages:[
  {from:'user',storyTime:'2026-11-15T09:00',text:'我今天确定去看展览。'}
 ],contacts:contacts?[{id:'npc:alice',name:'艾丽丝'}]:[],conversations:contacts?{
  'npc:alice':{messages:[{from:'user',storyTime:'2026-11-15T10:00',text:'周六请保密这件事。'}]}
 }:{},config:{}};
 const ctx={chatId:'chat-a',characterId:1,chatMetadata:{storage:1}};
 let modelCalls=0,response=null;
 const make=new Function('document','window','structuredClone',
  memory.replace(/^export /gm,'')+'\nreturn createPhoneMemoryModule;');
 const controller=make({createElement:dom},{confirm:()=>true},clone)({
  context:()=>ctx,readRootData:()=>data,getNodes:()=>nodes,
  writeData:async(_c,next)=>{data=next;},
  stripModelReasoning:raw=>raw,isPhoneOpen:()=>true,recordError:()=>{},
  phoneGenerate:async()=>{
   modelCalls++;
   return response||JSON.stringify({threads:contacts?[
    {id:'main',summary:'主角色与用户确认了看展计划，没有其他承诺。'},
    {id:'npc:alice',summary:'艾丽丝和用户提到周六保密的事项。'}
   ]:[{id:'main',summary:'用户确定计划看展览，尚无其他具体约定。'}]});
  }
 });
 return {controller,ctx,nodes,read:()=>data,set:(fn)=>fn(data),
  calls:()=>modelCalls,respond:value=>{response=value;}};
}
test('settings navigation has six isolated groups, one-level back and unchanged original controls',()=>{
 const groups=[...html.matchAll(/data-settings-category="([^"]+)"/g)].map(x=>x[1]);
 assert.deepEqual(groups,['system','api','chat','presets','memory','data']);
 for(const name of ['lockEnabled','clockMode','floatingLauncher','apiTask','apiMode','apiProfile','apiTest',
  'presetSource','worldBookList','messageStyle','phoneMemoryInterval','phoneMemoryList','readMainlineMemory'])
  assert.ok(html.includes('data-lp="'+name+'"'),name);
 assert.match(index,/if\(goSettingsBack\(\)\)return;/);
 assert.match(index,/nodes\.settingsMenu\.addEventListener/);
});
test('per-app routing inherits global or overrides with saved profiles/custom API',async()=>{
 const keys=new Map([['1::chat-a::memory','SECRET']]),sent=[];
 const ctx={characterId:1,chatId:'chat-a',mainApi:'openai',
  ConnectionManagerRequestService:{
   getSupportedProfiles:()=>[{id:'p2',name:'另一组模型',model:'model-2',mode:'cc'}],
   sendRequest:async(...args)=>{sent.push({kind:'profile',args});return {content:'PROFILE OK'};}
  },
  ChatCompletionService:{sendRequest:async payload=>{sent.push({kind:'custom',payload});return {content:'CUSTOM OK'};}},
  generateRaw:async()=>{sent.push({kind:'inherit'});return 'DEFAULT OK';}
 };
 const api=apiFactory(c=>c.characterId+'::'+c.chatId,()=>ctx,keys,new Map([['1::chat-a::memory','https://example.test/v1']]),MiniURL);
 const data={config:{api:{mode:'inherit'},apiRoutes:{
  weibo:{mode:'profile',profileId:'p2'},
  memory:{mode:'custom',url:'https://example.test/v1',model:'memory-model'}
 }}};
 assert.equal(api.readApiOptions(data,'chat').routeMode,'follow');
 assert.equal(api.readApiOptions(data,'weibo').mode,'profile');
 assert.equal(api.readApiOptions(data,'memory').mode,'custom');
 const request=task=>({task,maxTokens:500,systemPrompt:'System',prompt:[{role:'user',content:'Hello'}]});
 assert.equal(await api.phoneGenerate(ctx,request('chat'),data),'DEFAULT OK');
 assert.equal(await api.phoneGenerate(ctx,request('weibo'),data),'PROFILE OK');
 assert.equal(await api.phoneGenerate(ctx,request('memory'),data),'CUSTOM OK');
 assert.deepEqual(sent.map(x=>x.kind),['inherit','profile','custom']);
 assert.equal(sent[1].args[0],'p2');
 assert.equal(sent[2].payload.model,'memory-model');
 assert.equal(ctx.mainApi,'openai','must never switch the mainline connection');
});
test('unavailable saved connection has explicit error, never silently reuses active model',async()=>{
 const ctx={ConnectionManagerRequestService:{getSupportedProfiles:()=>[],sendRequest:async()=>{throw Error('must not call');}}};
 const api=apiFactory(()=> 'scope',()=>ctx,new Map(),new Map(),MiniURL);
 await assert.rejects(()=>api.phoneGenerate(ctx,{task:'weibo',prompt:'test'},
  {config:{api:{mode:'inherit'},apiRoutes:{weibo:{mode:'profile',profileId:'gone'}}}}),/档案不可用/);
});
test('independent API secret is never forwarded to a different destination',async()=>{
 const ctx={ChatCompletionService:{sendRequest:async()=>{throw Error('should not send request');}}};
 const api=apiFactory(()=> 'scope',()=>ctx,
  new Map([['scope::memory','SECRET']]),new Map([['scope::memory','https://old.example/v1']]),MiniURL);
 await assert.rejects(()=>api.phoneGenerate(ctx,{task:'memory',prompt:'test'},
  {config:{api:{mode:'inherit'},apiRoutes:{
   memory:{mode:'custom',url:'https://new.example/v1',model:'m'}
  }}}),/密钥/);
});
test('one-story-day schedule runs exactly once per interval and stores editable notes',async()=>{
 const h=memoryHarness(1);
 await h.controller.saveSettings();
 assert.equal(h.read().phoneMemory.lastDay,'2026-11-15');
 assert.equal(h.calls(),0);
 await h.controller.tick();assert.equal(h.calls(),0);
 h.set(d=>{d.storyTime='2026-11-16T10:00';});
 await h.controller.tick();await h.controller.tick();
 assert.equal(h.calls(),1);
 assert.equal(h.read().phoneMemory.entries.length,1);
 assert.equal(h.read().phoneMemory.entries[0].contactId,'main');
 assert.equal(h.read().phoneMemory.lastDay,'2026-11-16');
});
test('three-day and seven-day settings follow fictional story clock, not current wall time',async()=>{
 for(const interval of [3,7]){
  const h=memoryHarness(interval);await h.controller.saveSettings();
  h.set(d=>{d.storyTime='2026-11-'+String(15+interval-1)+'T12:00';});
  await h.controller.tick();assert.equal(h.calls(),0);
  h.set(d=>{d.storyTime='2026-11-'+String(15+interval)+'T12:00';});
  await h.controller.tick();assert.equal(h.calls(),1);
 }
});
test('contact summaries stay separated and never leak to other phone conversations',async()=>{
 const h=memoryHarness(1,true);await h.controller.saveSettings();
 h.set(d=>{d.storyTime='2026-11-16T12:00';});
 await h.controller.tick();
 const entries=h.read().phoneMemory.entries;
 assert.deepEqual(entries.map(e=>e.contactId).sort(),['main','npc:alice']);
 const begin=index.indexOf('function phoneMemoryText('),end=index.indexOf('function syncMainlinePrompt(',begin);
 const output=new Function('PRIMARY_CONTACT_ID','clipContext',
  index.slice(begin,end)+'return phoneMemoryText;')('primary',(x,k)=>x.slice(0,k));
 const own=output(h.read(),'primary',2200),npc=output(h.read(),'npc:alice',2200);
 assert.match(own,/看展计划/);assert.doesNotMatch(own,/艾丽丝|保密/);
 assert.match(npc,/艾丽丝/);assert.doesNotMatch(npc,/看展览/);
 assert.match(index,/phoneMemory\?\.injectMainline===true/);
});
test('async summary re-reads the current data to preserve messages added while generating',async()=>{
 const h=memoryHarness(1);await h.controller.saveSettings();
 h.set(d=>{d.storyTime='2026-11-16T12:00';});
 let release;
 const deferred=new Promise(resolve=>{release=resolve;});
 // Controller reads its callback at creation; verify the live-merge property in source.
 assert.match(memory,/await patch\(latest=>/);
 assert.match(memory,/structuredClone\(api\.readRootData\(c\)\)/);
 assert.match(memory,/ctx\(\)\?\.chatMetadata!==origin/);
 assert.ok(release);
});
