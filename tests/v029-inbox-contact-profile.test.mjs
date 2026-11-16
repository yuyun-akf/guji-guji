import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const groups=readFileSync(new URL('../groups.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');
const bootstrap=readFileSync(new URL('../bootstrap.js',import.meta.url),'utf8');
const manifest=JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url),'utf8'));
const section=(start,end)=>index.slice(index.indexOf(start),index.indexOf(end,index.indexOf(start)));

test('v0.35.0: scripts parse with matching dynamic import and manifest versions',()=>{
 assert.equal(manifest.version,'0.35.0');
 for(const src of [index,groups,bootstrap])assert.doesNotThrow(()=>new Function(src.replace(/^export /gm,'')));
 assert.match(bootstrap,/index\.js\?v=0\.35\.0/);
 assert.match(index,/groups\.js\?v=0\.35\.0/);
});

test('unbounded pins persist independently for private conversations and group chats',async()=>{
 const store={pinnedChats:Array.from({length:31},(_,i)=>'contact:npc:'+i)};
 const ctx={chatMetadata:{}};
 const pin=new Function('busy','context','selectedCharacter','readRootData','writeData','mounted',
  'nodes','contactCharacter','readData','renderChatLists','recordError','setStatus','PRIMARY_CONTACT_ID','structuredClone',
  section('const phoneThreadPinKey=','function renderChatLists(')+
  'return {pinnedChatIds,togglePhoneThreadPin,phoneThreadPinKey};')(
   false,()=>ctx,()=>({name:'主角色'}),()=>store,async(_,data)=>{Object.assign(store,data);},
   false,null,()=>({}),()=>({}),()=>{},()=>{},()=>{},'primary',value=>JSON.parse(JSON.stringify(value)));
 assert.equal(pin.pinnedChatIds(store).length,31);
 await pin.togglePhoneThreadPin(pin.phoneThreadPinKey('group','bedroom'));
 assert.equal(store.pinnedChats.length,32);
 assert.equal(store.pinnedChats[0],'group:bedroom');
 await pin.togglePhoneThreadPin('group:bedroom');
 assert.equal(store.pinnedChats.length,31);
 assert.ok(store.pinnedChats.includes('contact:npc:0'));
 assert.match(index,/groupChats/);
 assert.match(index,/lp-thread-wrap/);
});

test('group direct-open supports one-back return to inbox while directory keeps its own back',()=>{
 class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.className='';this.value='';}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
 }
 const document={createElement:tag=>new Element(tag),createTextNode:text=>text};
 const data={groupChats:[{id:'g1',name:'寝室群',members:['c1','c2'],messages:[]}]};
 const host=new Element('div');
 const create=new Function('document',groups.replace(/^export /gm,'')+'return createGroupsModule;')(document);
 const module=create({getNodes:()=>({groupsContent:host}),context:()=>({chatMetadata:{}}),
  readRootData:()=>data,galleryPeople:()=>[{id:'c1',name:'同学甲'},{id:'c2',name:'同学乙'}],
  isPhoneFriend:()=>true});
 module.open({groupId:'g1',origin:'messages'});
 assert.equal(module.back(),false,'direct group returns to message list');
 module.open({groupId:'g1',origin:'directory'});
 assert.equal(module.back(),true,'directory group returns to directory');
 assert.equal(module.back(),false,'then exits group app');
 assert.match(index,/controller\.open\(\{groupId:id,origin:'messages'\}\)/);
 assert.match(index,/groups:groupsReturnScreen/);
});

test('bulk scanned NPC import creates incoming friend requests, not existing friends',async()=>{
 const fields={name:'唐嘉仪',relation:'面具甲的室友',description:'大学室友的完整人物资料'};
 const row={querySelector(selector){
  const key=selector.match(/data-npc-field="([^"]+)"/)?.[1];
  return key?{value:fields[key]}:null;
 }};
 const check={dataset:{npcCandidate:'0'},closest:()=>row};
 const nodes={npcCandidates:{querySelectorAll:()=>[check]},npcScanState:{textContent:''}};
 const ctx={chatMetadata:{}},data={contacts:[],conversations:{}};
 let written;
 const candidate={name:'唐嘉仪',source:'世界书',description:'大学室友的完整人物资料'};
 const fn=new Function('busy','npcScanning','npcScanSession','sameNpcScanSession','nodes',
  'context','readRootData','selectedCharacter','getCharacterName','cleanNpcName','personaNames',
  'npcCandidates','window','writeData','renderNpcCandidates','render','setScreen','setStatus',
  'recordError','PRIMARY_CONTACT_ID','structuredClone',section('async function saveSelectedNpcCandidates()','function populateNpcWorldSelect()')+
  'return saveSelectedNpcCandidates;')(
  false,false,{},()=>true,nodes,()=>ctx,()=>data,()=>({name:'主角色'}),()=> '主角色',
  x=>x,()=>new Set(),[candidate],{confirm:()=>true},
  async(_,value)=>{written=value;},()=>{},()=>{},()=>{},()=>{},()=>{},'primary',value=>JSON.parse(JSON.stringify(value)));
 await fn();
 assert.equal(written.contacts.length,1);
 const id=written.contacts[0].id;
 assert.equal(written.conversations[id].friendship.state,'incoming');
 assert.equal(written.conversations[id].friendEvents[0].to,'incoming');
 assert.match(index,/对方向你发送了好友申请/);
});

test('contact profile uses a full-dossier modal and clickable avatar, without duplicate user-avatar inputs',()=>{
 const start=index.indexOf('<section class="lp-screen lp-profile"');
 const stop=index.indexOf('<section class="lp-screen lp-chat"',start);
 const html=index.slice(start,stop);
 assert.match(html,/data-lp="profileAvatarAction"/);
 assert.match(html,/data-lp="profileRoleOpen"/);
 assert.doesNotMatch(html,/data-lp="profileDescription"/,'full biography moved outside hero and profile section');
 assert.doesNotMatch(html,/data-lp="avatarUserFile"/);
 assert.doesNotMatch(html,/lp-profile-upload/);
 assert.match(index,/data-lp="profileRoleDialog"/);
 assert.match(index,/data-lp="profileDescription"/);
 assert.match(index,/data-lp="profileChooseAvatar"/);
 assert.match(index,/nodes\.profileRoleOpen\.addEventListener/);
 assert.match(index,/nodes\.avatarCharFile\.addEventListener/);
 assert.match(css,/\.lp-profile-role-content\s*\{/);
 assert.match(css,/\.lp-profile-overlay\[hidden\]/);
});
