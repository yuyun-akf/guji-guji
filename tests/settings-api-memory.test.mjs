import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const memory=readFileSync(new URL('../memory.js',import.meta.url),'utf8');
const html=index.slice(index.indexOf('<section class="lp-screen lp-settings"'),index.indexOf('<section class="lp-screen lp-picker" data-lp-screen="presetPicker"'));
const apiBegin=index.indexOf('const PHONE_API_TARGETS=[');
const apiEnd=index.indexOf('function currentApiTarget(){',apiBegin);
const apiText=index.slice(apiBegin,apiEnd);
const noSecretFetch=async()=>({ok:true,json:async()=>({api_key_custom:[]})});
const apiFactory=new Function('apiSessionId','context','transientApiKeys','transientApiKeyUrls','URL','fetch',
 apiText+'return {readApiOptions,availableConnectionProfiles,savedApiSites,phoneGenerate,apiKeySlot};');
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
  'phoneMemoryStatus','phoneMemorySchedule','phoneMemoryRun','phoneMemorySave','phoneMemoryList',
  'phoneMemoryFilter','phoneMemorySearch','phoneMemoryEditor','phoneMemoryOwner','phoneMemoryText','phoneMemoryMore']
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
 const payloads=[];
 const make=new Function('document','window','structuredClone',
  memory.replace(/^export /gm,'')+'\nreturn createPhoneMemoryModule;');
 const controller=make({createElement:dom},{confirm:()=>true},clone)({
  context:()=>ctx,readRootData:()=>data,getNodes:()=>nodes,
  writeData:async(_c,next)=>{data=next;},
  stripModelReasoning:raw=>raw,isPhoneOpen:()=>true,recordError:()=>{},
  phoneGenerate:async(_ctx,options)=>{
   modelCalls++;
   payloads.push(options.prompt[0].content);
   if(typeof response==='function')return response(options);
   return response||JSON.stringify({threads:contacts?[
    {id:'main',summary:'主角色与用户确认了看展计划，没有其他承诺。'},
    {id:'npc:alice',summary:'艾丽丝和用户提到周六保密的事项。'}
   ]:[{id:'main',summary:'用户确定计划看展览，尚无其他具体约定。'}]});
  }
 });
 return {controller,ctx,nodes,read:()=>data,set:(fn)=>fn(data),
  calls:()=>modelCalls,payloads,respond:value=>{response=value;}};
}
test('the desktop opens the independent memory app and Settings offers a tutorial',()=>{
 const settings=html.split('data-lp-screen="memory"')[0];
 const groups=[...settings.matchAll(/data-settings-category="([^"]+)"/g)].map(x=>x[1]);
 assert.deepEqual(groups,['system','api','chat','presets','tutorial']);
 assert.doesNotMatch(settings,/data-lp-open="memory"/);
 assert.match(settings,/data-settings-nav="tutorial"[^>]*><span>使用教程/);
 assert.match(index,/key:'memory',screen:'memory',name:'往昔'/);
 assert.match(index,/memory:'home'/);
 for(const name of ['lockEnabled','clockMode','floatingLauncher','apiTask','apiMode','apiProfile','apiTest',
  'presetSource','worldBookList','messageStyle','phoneMemoryInterval','phoneMemoryList','readMainlineMemory'])
  assert.ok(html.includes('data-lp="'+name+'"'),name);
 assert.match(index,/if\(goSettingsBack\(\)\)return;/);
 assert.match(index,/nodes\.settingsMenu\.addEventListener/);
});
test('per-app routing inherits global or overrides with saved profiles/custom API',async()=>{
 const keys=new Map([['1::chat-a::memory','SECRET']]),sent=[];
 const ctx={characterId:1,chatId:'chat-a',mainApi:'openai',
  getRequestHeaders:()=>({'Content-Type':'application/json'}),
  ConnectionManagerRequestService:{
   getSupportedProfiles:()=>[{id:'p2',name:'测试站点',model:'model-2',mode:'cc'}],
   getProfile:()=>({id:'p2',name:'测试站点',model:'model-2',api:'custom',
    'api-url':'https://saved.example.test/v1','secret-id':'secret-id-2'}),
   sendRequest:async(...args)=>{sent.push({kind:'profile',args});return {content:'PROFILE OK'};}
  },
  ChatCompletionService:{sendRequest:async payload=>{sent.push({kind:'custom',payload});return {content:'CUSTOM OK'};}},
  generateRaw:async()=>{sent.push({kind:'inherit'});return 'DEFAULT OK';}
 };
 const api=apiFactory(c=>c.characterId+'::'+c.chatId,()=>ctx,keys,new Map([['1::chat-a::memory','https://example.test/v1']]),MiniURL,noSecretFetch);
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
 const api=apiFactory(()=> 'scope',()=>ctx,new Map(),new Map(),MiniURL,noSecretFetch);
 await assert.rejects(()=>api.phoneGenerate(ctx,{task:'weibo',prompt:'test'},
  {config:{api:{mode:'inherit'},apiRoutes:{weibo:{mode:'profile',profileId:'gone'}}}}),/站点.*失效/);
});
test('saved connection errors log the underlying cause without credentials or echoed request content',async()=>{
 const cause=new Error('HTTP 400 {"api_key":"test-secret","messages":[{"content":"private-fixture"}]}');
 const ctx={
  getRequestHeaders:()=>({'Content-Type':'application/json'}),
  ConnectionManagerRequestService:{
   getSupportedProfiles:()=>[{id:'p2',name:'测试站点'}],
   getProfile:()=>({api:'custom','api-url':'https://saved.example.test/v1',model:'test-model'}),
   sendRequest:async()=>{throw new Error('API request failed',{cause});}
  }
 };
 const api=apiFactory(()=> 'scope',()=>ctx,new Map(),new Map(),MiniURL,noSecretFetch);
 const entries=[];
 const start=index.indexOf('function redactDiagnostic('),end=index.indexOf('function renderDiagnostics(',start);
 const recordError=new Function('diagnostics','DIAGNOSTIC_LIMIT','renderDiagnostics','notifyInteraction','console',
  index.slice(start,end)+'return recordError;')(entries,10,()=>{},()=>{},{error(){}});
 await assert.rejects(()=>api.phoneGenerate(ctx,{task:'chat',prompt:'fixture'},
  {config:{apiRoutes:{chat:{mode:'profile',profileId:'p2'}}}}),error=>{
   const status=recordError('生成角色回复',error);
   assert.match(status,/API request failed.*HTTP 400/);
   assert.equal(entries[0].code,'400');
   assert.match(entries[0].detail,/\[已隐藏的请求内容\]/);
   assert.doesNotMatch(entries[0].detail,/test-secret|private-fixture/);
   return true;
  });
});
test('independent API secret is never forwarded to a different destination',async()=>{
 const ctx={ChatCompletionService:{sendRequest:async()=>{throw Error('should not send request');}}};
 const api=apiFactory(()=> 'scope',()=>ctx,
  new Map([['scope::memory','SECRET']]),new Map([['scope::memory','https://old.example/v1']]),MiniURL,noSecretFetch);
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
 h.respond(()=>deferred);
 const pending=h.controller.summarize(true);
 h.set(d=>d.messages.push({id:'new',from:'user',storyTime:'2026-11-16T12:00',text:'稍后再聊'}));
 release(JSON.stringify({threads:[{id:'main',summary:'已经确认看展。'}]}));
 assert.equal(await pending,true);
 assert.equal(h.read().messages.length,2);
 assert.equal(h.read().phoneMemory.cursors.main.index,0);
 await h.controller.summarize(true);
 assert.match(h.payloads[1],/稍后再聊/);
 assert.doesNotMatch(h.payloads[1],/我今天确定去看展览/);
});
test('manual batches cover old and new history, including the end of long messages',async()=>{
 const h=memoryHarness();
 const notes=Array.from({length:65},(_,i)=>({id:'old'+i,contactId:'main',text:'旧记忆'+i}));
 h.set(d=>{
  d.phoneMemory={entries:notes,cursors:{}};
  d.messages=Array.from({length:100},(_,i)=>({id:'m'+i,from:'user',storyTime:d.storyTime,
   text:'记录-'+String(i).padStart(3,'0')+'。'+(i===0?'甲'.repeat(16000)+'长消息结尾':'日常消息')}));
 });
 assert.equal(await h.controller.summarize(true),true);
 const merged=h.payloads.join('\n');
 for(let i=0;i<100;i++)assert.equal(merged.split('记录-'+String(i).padStart(3,'0')+'。').length,2);
 assert.match(merged,/长消息结尾/);
 assert.match(h.payloads[0],/记录-000/);
 assert.equal(h.read().phoneMemory.cursors.main.id,'m99');
 assert.deepEqual(h.read().phoneMemory.entries.slice(0,65),notes);
 assert.equal(await h.controller.summarize(true),false);
});
test('rebuilding legacy progress keeps the archive and stopping leaves the next batch available',async()=>{
 const h=memoryHarness();
 const edited={id:'edited',contactId:'main',text:'手动修订的旧摘要',pinned:true};
 h.set(d=>{
  d.messages=Array.from({length:60},(_,i)=>({id:'m'+i,from:'user',text:'旧聊天-'+String(i).padStart(2,'0')}));
  d.phoneMemory={cursors:{main:60},entries:[edited]};
 });
 const response=JSON.stringify({threads:[{id:'main',summary:'重新整理了旧事。'}]});
 h.respond(()=>{h.controller.stop();return response;});
 assert.equal(await h.controller.rebuild(),true);
 assert.equal(h.calls(),1);
 assert.equal(h.read().phoneMemory.cursors.main.id,'m47');
 assert.deepEqual(h.read().phoneMemory.entries[0],edited);
 h.respond(response);
 assert.equal(await h.controller.summarize(true),true);
 assert.match(h.payloads[1],/旧聊天-48/);
 assert.doesNotMatch(h.payloads[1],/旧聊天-47/);
 assert.equal(h.read().phoneMemory.cursors.main.id,'m59');
});
test('omitted summary conversations stay queued and switching chats discards in-flight results',async()=>{
 const h=memoryHarness(1,true);
 h.respond(JSON.stringify({threads:[{id:'main',summary:'约好看展。'}]}));
 assert.equal(await h.controller.summarize(true),false);
 assert.equal(h.read().phoneMemory,undefined);
 let release;
 h.respond(()=>new Promise(resolve=>{release=resolve;}));
 const pending=h.controller.summarize(true);
 h.ctx.chatMetadata={storage:2};h.ctx.chatId='chat-b';
 release(JSON.stringify({threads:[{id:'main',summary:'约好看展。'},{id:'npc:alice',summary:'事项保密。'}]}));
 assert.equal(await pending,false);
 assert.equal(h.read().phoneMemory,undefined);
});
test('memory recall keeps pinned and relevant old notes within budget and excludes other chats and future events',()=>{
 const begin=index.indexOf('function phoneMemoryText('),end=index.indexOf('function syncMainlinePrompt(',begin);
 const output=new Function('PRIMARY_CONTACT_ID',index.slice(begin,end)+'return phoneMemoryText;')('primary');
 const recent=Array.from({length:12},(_,i)=>({contactId:'main',text:'最近对话'+i+'。'.repeat(600),to:'2026-11-02'}));
 const data={storyTime:'2026-11-16T12:00',phoneMemory:{entries:[
  {contactId:'main',pinned:true,to:'2026-11-01',text:'重点约定'},
  {contactId:'main',to:'2026-10-01',text:'夜班后才睡觉，已解释过原因。'},
  ...recent,{contactId:'npc:alice',text:'另一位联系人的私事'},
  {contactId:'private-review',text:'不可注入的旧混合摘要'},
  {contactId:'main',to:'2026-11-16',through:'2026-11-16T18:00',text:'今晚之后的事'}]}};
 const prompt=output(data,'primary',1600,'说到夜班后的作息');
 assert.match(prompt,/重点约定/);assert.match(prompt,/夜班后才睡觉/);assert.match(prompt,/最近对话11/);
 assert.doesNotMatch(prompt,/另一位|混合摘要|今晚之后/);
 assert.doesNotMatch(output(data),/混合摘要/);
});
test('manual entries are scoped to the chosen contact and can be edited and unpinned',async()=>{
 const h=memoryHarness(1,true);
 h.controller.open();
 h.nodes.phoneMemoryFilter.value='npc:alice';h.controller.search();h.controller.edit();
 h.nodes.phoneMemoryText.value='周五见面';
 await h.controller.saveEditor();
 const first=h.read().phoneMemory.entries[0];
 assert.equal(first.contactId,'npc:alice');assert.equal(first.pinned,true);
 const click=action=>h.controller.handleClick({target:{closest:()=>({dataset:{memoryAction:action,memoryId:first.id}})}});
 await click('edit');
 h.nodes.phoneMemoryText.value='改到周六见面';
 await h.controller.saveEditor();
 await click('pin');
 const updated=h.read().phoneMemory.entries[0];
 assert.equal(updated.text,'改到周六见面');assert.equal(updated.pinned,false);
 await click('delete');
 assert.equal(h.read().phoneMemory.entries.length,0);
});
