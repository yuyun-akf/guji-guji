import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const weibo=readFileSync(new URL('../weibo.js',import.meta.url),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
const profiles=[
 {id:'jiushi-gemini',api:'custom',name:'玖时 - gemini',model:'gemini-3.1-pro',
  'api-url':'https://jiushi.example/v1','secret-id':'key-jiushi'},
 {id:'jiushi-gpt',api:'custom',name:'玖时 - gpt',model:'gpt-6',
  'api-url':'https://jiushi.example/v1','secret-id':'key-jiushi'},
 {id:'piaomiao-claude',api:'custom',name:'飘渺 - claude',model:'claude-4',
  'api-url':'https://piaomiao.example/v1','secret-id':'key-piaomiao'},
 {id:'model-without-url',api:'custom',name:'只有模型名',model:'test'}
];
const secretState={api_key_custom:[
 {id:'key-jiushi',label:'玖时',active:false},
 {id:'key-piaomiao',label:'飘渺',active:false},
 {id:'key-active',label:'目前使用站点',active:true}
]};
const service={getProfile:id=>profiles.find(x=>x.id===id),
 validateProfile:()=>({selected:'openai',source:'custom'}),
 sendRequest:async()=>({content:'OK'})};
const ctx={ConnectionManagerRequestService:service,
 chatCompletionSettings:{chat_completion_source:'custom',custom_url:'https://current.example/v1',custom_model:'test-model'},
 getRequestHeaders:()=>({'Content-Type':'application/json','X-CSRF-Token':'test'})};
const start=index.indexOf('function savedApiSites('),stop=index.indexOf('function chooseApiTask(',start);
const directory=new Function('context','availableConnectionProfiles','savedSiteSecrets',
 index.slice(start,stop)+'return {savedApiSites,resolveSavedSite};')(
 ()=>ctx,()=>({profiles:profiles.map(p=>({id:p.id}))}),secretState);

test('sites: group models by saved URL + key, include current ST site, exclude pure model profiles',()=>{
 const sites=directory.savedApiSites(ctx,secretState);
 assert.equal(sites.length,3);
 const jiushi=sites.find(s=>s.url.includes('jiushi.example'));
 assert.ok(jiushi.label.includes('玖时'));
 assert.deepEqual(jiushi.models,['gemini-3.1-pro','gpt-6']);
 assert.equal(jiushi.profileIds.length,2);
 assert.equal(directory.resolveSavedSite('jiushi-gpt',ctx,secretState).id,jiushi.id,'legacy model profile maps to its site');
 assert.equal(directory.resolveSavedSite(jiushi.id,ctx,secretState).profileId,'jiushi-gemini');
 assert.equal(sites.filter(s=>s.kind==='active').length,1);
});

test('ST saved site model fetch uses server secret id rather than exposing plaintext key',async()=>{
 const start=index.indexOf('function renderSavedApiProfiles(');
 const end=index.indexOf('async function savePhoneApi(',start);
 let request;
 const original=directory.savedApiSites(ctx,secretState)[0];
 const nodes={apiProfile:{value:original.id,options:[],replaceChildren(){this.options=[];},append(o){this.options.push(o);}},
  apiProfileHint:{textContent:''},apiProfileModel:{value:'',options:[],replaceChildren(){this.options=[];},append(o){this.options.push(o);}},
  apiProfileModelManual:{value:''}};
 const context=()=>ctx;
 const fetch=async(url,options)=>{
  request={url,body:JSON.parse(options.body),headers:options.headers};
  return {ok:true,json:async()=>({data:[{id:'model-1'},{id:'model-2'}]})};
 };
 const load=new Function('nodes','context','savedApiSites','resolveSavedSite','loadSavedSiteSecretMetadata',
  'readApiOptions','readRootData','currentApiTarget','document','getTavernRequestHeaders','fetch',
  index.slice(start,end)+'return loadSavedSiteModels;')(
  nodes,context,()=>directory.savedApiSites(ctx,secretState),
  v=>directory.resolveSavedSite(v,ctx,secretState),
  async()=>secretState,()=>({profileId:original.id}),()=>({}),()=>('default'),
  {createElement:()=>({value:'',textContent:''})},async()=>ctx.getRequestHeaders(),fetch);
 await load('model-1');
 assert.equal(nodes.apiProfile.options.length,4,'blank plus 3 physical sites, not 4 model profiles');
 assert.ok(nodes.apiProfile.options.every(o=>!String(o.textContent).includes('gemini-3.1-pro')));
 assert.ok(nodes.apiProfileModel.options.some(o=>o.value==='model-2'));
 assert.equal(nodes.apiProfileModel.value,'model-1');
 assert.equal(request.url,'/api/backends/chat-completions/status');
 assert.equal(request.body.secret_id,'key-jiushi');
 assert.equal(request.body.custom_url,'https://jiushi.example/v1');
 assert.equal(request.body.api_key,undefined);
 assert.equal(request.body.key,undefined);
});

function roleApp(mockResult){
 const context={characterId:0,chatId:'a',chatMetadata:{}};
 let state={storyTime:'2026-11-15T21:00',contacts:[],messages:[],qunxing:{
  accounts:[{id:'actor',name:'宁肆锦',source:'manual',kind:'角色',profession:'演员',publicFigure:true,
   bio:'我不搞抽象搞什么',followers:42865700}],posts:[],following:['actor'],profile:{nickname:'u'}}};
 const inputs={instructions:'只写日常，不允许喵喵梗，严格按角色性格',
  count:'3',text:'代发的一条历史帖',likes:'138000',time:'2026-11-12T19:00',
  comments:'粉丝甲：终于营业了\n粉丝乙：哥今天很帅'};
 let lastPrompt='',calls=0;
 const document={visibilityState:'visible'};
 const source=weibo.replace('export function createWeiboModule','function createWeiboModule')
  .replace('return {open,render,','return {action,accountHistory,open,render,');
 const factory=new Function('document','structuredClone',source+'\nreturn createWeiboModule;')(document,clone);
 const module=factory({context:()=>context,getNodes:()=>({weiboFeed:null,weiboDetail:{
  querySelector:selector=>{
   const key=selector.match(/data-wb-history-field="([^"]+)"/)?.[1];
   return {value:inputs[key]??''};
  }}}),readRootData:()=>state,readData:()=>state,writeData:async(_ctx,updated)=>{state=updated;},
  selectedCharacter:()=>({name:'宁肆锦'}),currentPersona:()=>({name:'u'}),
  accountSubjectContext:()=> '童星演员，公开体面，私下嘴欠，讨厌损害他人的边界；知情权重要',
  storyContext:()=> '期末周，不可公开私人聊天',
  stripModelReasoning:value=>value,notifyInteraction:()=>{},recordActivity:()=>{},recordError:()=>{},
  phoneGenerate:async(_ctx,request)=>{calls++;lastPrompt=request.prompt[0].content;return JSON.stringify(mockResult());}
 });
 return {module,inputs,root:()=>state,prompt:()=>lastPrompt,calls:()=>calls};
}

test('actor history respects character context, custom instructions, huge audience, and includes real comments',async()=>{
 const h=roleApp(()=>({posts:[{text:'今天下戏吃了点东西',likes:389,daysAgo:2,
  comments:[{name:'粉丝甲',text:'终于出现了'},{name:'路人乙',text:'这句挺好笑'}]}]}));
 await h.module.action('openAccount','actor');
 await h.module.action('generateAccountHistory','actor');
 const [post]=h.root().qunxing.posts;
 assert.ok(post);
 assert.ok(post.likes>10000,'42.86m fans cannot be treated like a tiny account');
 assert.equal(post.comments.length,2);
 assert.ok(h.prompt().includes('童星演员'));
 assert.ok(h.prompt().includes('不允许喵喵梗'));
 assert.ok(h.prompt().includes('4286.57万粉丝'));
 assert.equal(h.calls(),1);
});

test('manual actor post creation and editing preserve user-chosen counts and comments',async()=>{
 const h=roleApp(()=>({posts:[]}));
 await h.module.action('openAccount','actor');
 await h.module.action('saveHistoryPost','actor');
 assert.equal(h.root().qunxing.posts.length,1);
 assert.equal(h.root().qunxing.posts[0].likes,138000);
 assert.equal(h.root().qunxing.posts[0].comments.length,2);
 const id=h.root().qunxing.posts[0].id;
 await h.module.action('editHistoryPost',id);
 h.inputs.text='修改后的历史内容';h.inputs.likes='250000';
 await h.module.action('saveHistoryPost','actor');
 assert.equal(h.root().qunxing.posts.length,1);
 assert.equal(h.root().qunxing.posts[0].likes,250000);
 assert.equal(h.root().qunxing.posts[0].text,'修改后的历史内容');
});

test('AI-generated historical posts without comments are never falsely marked complete',async()=>{
 const h=roleApp(()=>({posts:[{text:'没有评论的帖子',likes:389,comments:[]}]}));
 await h.module.action('openAccount','actor');
 await h.module.action('generateAccountHistory','actor');
 assert.equal(h.root().qunxing.posts.length,0);
});

test('following list has a full clickable account link and goes to personal homepage',async()=>{
 assert.match(weibo,/lp-wb-follow-link/);
 assert.match(weibo,/open\.setAttribute\('aria-label','打开 '/);
 assert.match(weibo,/open=control\('','openAccount',a\.id\)/);
 const h=roleApp(()=>({posts:[]}));
 await h.module.action('openAccount','actor');
 assert.equal(h.module.state.profileAccount,'actor');
 assert.equal(h.module.back(),true);
 assert.equal(h.module.state.profileAccount,'');
});
