/* 咕叽聊群聊：群消息仅属于当前剧情存档，所有发言独立归属成员。 */
export function createGroupsModule(api){
 const el=(tag,cls='',text='')=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
 const state={active:'',busy:false,status:'',manage:false,avatarDraft:'',fromMessageList:false};
 const scrollByGroup=new Map();let lastView='';
 const host=()=>api.getNodes()?.groupsContent;
 const ctx=()=>api.context();
 const root=()=>api.readRootData(ctx());
 const groups=()=>Array.isArray(root().groupChats)?root().groupChats:[];
 const people=()=>api.galleryPeople().filter(p=>p.id!=='user'&&api.isPhoneFriend(p.id));
 const scope=()=>ctx()?.chatMetadata;
 const uid=()=> 'grp-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
 const button=(label,action,id='')=>{const b=el('button','lp-group-button',label);b.type='button';b.dataset.groupAction=action;if(id)b.dataset.groupId=id;return b;};
 const who=id=>id==='user'?'我':api.galleryPeople().find(x=>x.id===id)?.name||'已退出成员';
 function status(text,error=false){state.status=text;api.notifyInteraction?.(text,error?'error':'success');render();}
 function render(){
  const target=host();if(!target)return;
  const view=state.active?(state.manage?'manage:':'chat:')+state.active:'directory';
  if(lastView&&lastView!==view)scrollByGroup.set(lastView,target.scrollTop);
  const top=lastView===view?target.scrollTop:(scrollByGroup.get(view)||0);
  target.replaceChildren();
  lastView=view;target.scrollTop=top;
  const group=groups().find(g=>g.id===state.active);
  if(group){
   const heading=el('div','lp-group-header');
   if(group.avatar){const avatar=el('img','lp-group-avatar');avatar.src=group.avatar;avatar.alt='群聊头像';heading.append(avatar);}
   heading.append(el('strong','',group.name||'群聊'),el('small','',group.members.map(who).join('、')),
    button(state.manage?'完成管理':'管理群聊','manage'));target.append(heading);
   if(state.manage){
    const form=el('div','lp-group-create'),name=el('input');name.dataset.groupInput='editName';name.maxLength=40;name.value=group.name||'';name.placeholder='群聊名称';
    const avatar=el('input');avatar.type='file';avatar.accept='image/png,image/jpeg,image/webp';avatar.dataset.groupAvatar='true';
    form.append(el('strong','','群聊资料'),name,el('p','','修改群头像'),avatar,el('p','','管理成员（至少保留两人）'));
    const available=new Map([...group.members.map(id=>[id,{id,name:who(id)}]),...people().map(p=>[p.id,p])]);
    for(const person of available.values()){
     const label=el('label','lp-group-choice'),check=el('input');check.type='checkbox';check.dataset.groupEditMember='true';check.value=person.id;check.checked=group.members.includes(person.id);
     label.append(check,document.createTextNode(person.name));form.append(label);
    }
    form.append(button('保存群资料','save-manage'));target.append(form);
    if(state.status)target.append(el('p','lp-group-feedback',state.status));
    target.scrollTop=top;
    return;
   }
   const feed=el('div','lp-group-messages');
   for(const msg of group.messages||[]){
    const item=el('article','lp-group-message'+(msg.from==='user'?' mine':''));
    item.append(el('strong','',who(msg.from)),el('p','',msg.text||''));
    if(msg.sharePost){
     const quote=el('div','lp-group-share');quote.append(el('strong','',msg.sharePost.author||'群星'),el('p','',msg.sharePost.text||''));
     if(msg.sharePost.image){const img=el('img');img.src=msg.sharePost.image;img.alt='群星分享图片';quote.append(img);}
     item.append(quote);
     const view=button('查看分享内容','view-share',msg.id);item.append(view);
    }
    if(msg.images?.length)for(const src of msg.images){const img=el('img','lp-group-photo');img.src=src;img.alt='群聊照片';item.append(img);}
    feed.append(item);
   }
   if(!feed.children.length)feed.append(el('p','lp-album-empty','群聊刚刚建立。'));
   target.append(feed);
   const compose=el('div','lp-group-composer'),input=el('textarea');input.rows=2;input.maxLength=1000;input.dataset.groupInput='message';input.placeholder='发送群聊消息';
   compose.append(input,button('发送','send'),button(state.busy?'正在生成…':'生成成员回复','generate'));
   target.append(compose);
   if(state.status)target.append(el('p','lp-group-feedback',state.status));
   feed.scrollTop=feed.scrollHeight;
   target.scrollTop=top;
   return;
  }
  target.append(el('h3','','群聊'),el('p','lp-group-intro','群成员只读取本群公开的消息，不会得知彼此的私聊记录。'));
  const list=el('div','lp-group-list');
  for(const group of groups()){
   const row=button((group.name||'群聊')+' · '+(group.messages?.length||0)+' 条消息','open',group.id);
   list.append(row);
  }
  target.append(list);
  if(!groups().length)target.append(el('p','lp-album-empty','暂无群聊'));
  const create=el('div','lp-group-create'),name=el('input');name.dataset.groupInput='name';name.maxLength=40;name.placeholder='群聊名称';
  create.append(el('strong','','新建群聊'),name,el('p','','选择至少两名已添加的好友：'));
  for(const person of people()){
   const label=el('label','lp-group-choice'),check=el('input');check.type='checkbox';check.value=person.id;check.dataset.groupMember='true';
   label.append(check,document.createTextNode(person.name));create.append(label);
  }
  create.append(button('建立群聊','create'));target.append(create);
  if(state.status)target.append(el('p','lp-group-feedback',state.status));
  target.scrollTop=top;
 }
 async function mutate(fn){
  const meta=scope(),r=structuredClone(root());r.groupChats=Array.isArray(r.groupChats)?r.groupChats:[];
  fn(r.groupChats,r);
  if(scope()!==meta)throw Error('已切换剧情存档，取消群聊写入');
  await api.writeData(ctx(),{...r,__contactId:'primary'});
  api.refreshChatList?.();
 }
 async function shareToGroup(groupId,post){
  const group=groups().find(g=>g.id===groupId);if(!group)throw Error('群聊不存在');
  await mutate(all=>{
   const target=all.find(g=>g.id===groupId);
   target.messages||=[];
   target.messages.push({id:uid(),from:'user',text:'[群星分享] '+(post.author||'用户')+' 的动态',sharePost:{id:post.id,author:post.author,text:post.text,handle:post.handle,image:post.image||''},storyTime:root().storyTime||'',createdAt:new Date().toISOString()});
  });
  state.active=groupId;state.manage=false;render();
 }
 async function send(){
  const group=groups().find(g=>g.id===state.active),input=host()?.querySelector('[data-group-input="message"],[data-group-input="message"]');
  const text=input?.value?.trim();if(!group||!text)return;
  await mutate(all=>{
   const g=all.find(x=>x.id===group.id);g.messages.push({id:uid(),from:'user',text:text.slice(0,1000),storyTime:root().storyTime||'',createdAt:new Date().toISOString()});
   g.messages=g.messages.slice(-180);
  });
  state.status='';render();
 }
 async function generate(){
  const group=groups().find(g=>g.id===state.active);if(!group||state.busy)return;
  const meta=scope();state.busy=true;state.status='正在生成群聊回复';render();
  try{
   const roster=group.members.filter(id=>api.isPhoneFriend(id)).map(id=>{
    const char=api.contactCharacter(ctx(),id);
    return {id,name:who(id),description:[char?.data?.description||char?.description,char?.data?.personality||char?.personality,char?.data?.scenario||char?.scenario].filter(Boolean).join('\n').slice(0,1600),
     photos:(api.galleryPhotosForMember?.(id)||[]).slice(0,8).map(p=>({id:p.id,description:p.description||p.title||'照片'}))};
   });
   if(!roster.length)throw Error('群聊中没有可回复的好友');
   const history=(group.messages||[]).slice(-22).map(m=>({speaker:m.from,text:String(m.text||'').slice(0,800),sharePost:m.sharePost?{author:m.sharePost.author,text:m.sharePost.text}:undefined}));
   const sys='你正在生成完全虚构的多人聊天。用户是独立参与者；禁止新增用户的言行、心理，禁止读心，禁止知道不在群里的私聊内容。每位成员都有独立人设与知识，发言必须是成员本人合理决定；不要求所有成员轮流回复，也允许本轮无人回复。群成员与他们的设定并非该角色能够看到的其他人的私密资料。如成员有已允许私聊使用的本人相册照片，可在其消息中使用 [[photo:照片ID]]，且仅使用该成员名下照片；不强制发送。仅返回JSON：{"messages":[{"speaker":"成员ID","text":"回复"}]}。只能使用给出的成员ID，最多5条，不能输出 user 的话。';
   const raw=await api.phoneGenerate(ctx(),{task:'chat',systemPrompt:sys,prompt:[{role:'user',content:JSON.stringify({storyTime:root().storyTime,members:roster,history})}]},api.readRootData(ctx()));
   if(scope()!==meta)return;
   const text=api.stripModelReasoning?.(raw)||raw;
   const match=String(text).match(/\{[\s\S]*\}/);if(!match)throw Error('群聊回复不是合法 JSON');
   const parsed=JSON.parse(match[0]);
   const messages=(Array.isArray(parsed.messages)?parsed.messages:[]).filter(m=>roster.some(p=>p.id===m.speaker)&&typeof m.text==='string'&&m.text.trim()).slice(0,5);
   if(messages.length)await mutate(all=>{
    const g=all.find(x=>x.id===group.id);
    for(const message of messages){
     const memberPhotos=api.galleryPhotosForMember?.(message.speaker)||[];
     const match=message.text.match(/\[\[photo:([^\]\r\n]+)\]\]/);
     const photo=match?memberPhotos.find(p=>p.id===match[1]):null;
     const text=message.text.replace(/\[\[photo:[^\]\r\n]+\]\]/g,'').trim();
     if(text||photo)g.messages.push({id:uid(),from:message.speaker,text:text.slice(0,1000),
       ...(photo?{images:[photo.image]}:{}),storyTime:root().storyTime||'',createdAt:new Date().toISOString()});
    }
    g.messages=g.messages.slice(-180);
   });
   state.status=messages.length?'已收到 '+messages.length+' 条群聊回复':'成员本轮没有回复';
  }catch(error){state.status='生成失败：'+String(error.message||error);}
  finally{state.busy=false;if(scope()===meta)render();}
 }
 async function handleClick(e){
  const button=e.target.closest('button[data-group-action]');if(!button||state.busy)return false;
  const act=button.dataset.groupAction,id=button.dataset.groupId;
  if(act==='manage'){state.manage=!state.manage;state.avatarDraft='';state.status='';render();}
  else if(act==='save-manage'){
   const name=host()?.querySelector('[data-group-input="editName"]')?.value?.trim()||'群聊';
   const members=[...host().querySelectorAll('input[data-group-edit-member]:checked')].map(x=>x.value);
   if(members.length<2){status('至少保留两名群成员',true);return true;}
   try{await mutate(all=>{const g=all.find(x=>x.id===state.active);if(!g)throw Error('群聊不存在');g.name=name;g.members=members;if(state.avatarDraft)g.avatar=state.avatarDraft;});
     state.manage=false;state.avatarDraft='';state.status='群资料已保存';render();}
   catch(e){status('修改失败：'+String(e.message||e),true);}
  }
  else if(act==='view-share'){const group=groups().find(g=>g.id===state.active),msg=group?.messages?.find(m=>m.id===id);if(msg?.sharePost)api.openSharedPost?.(msg.sharePost,'groups');}
  else if(act==='open'){state.active=id;state.manage=false;state.status='';render();}
  else if(act==='back'){state.active='';state.manage=false;state.avatarDraft='';state.status='';render();}
  else if(act==='create'){
   const name=host()?.querySelector('[data-group-input="name"]')?.value?.trim()||'新的群聊';
   const members=[...host().querySelectorAll('input[data-group-member]:checked')].map(x=>x.value);
   if(members.length<2){status('请至少选择两名好友',true);return true;}
   try{let id=uid();await mutate(all=>all.push({id,name,members,messages:[],createdAt:new Date().toISOString()}));state.active=id;state.status='';render();}
   catch(err){status('创建群聊失败：'+String(err.message||err),true);}
  }else if(act==='send')await send();
  else if(act==='generate')await generate();
  else return false;
  return true;
 }
 async function handleFile(event){
  const input=event.target.closest('input[data-group-avatar]');if(!input)return false;
  const file=input.files?.[0];input.value='';if(!file)return false;
  try{
   state.avatarDraft=await api.encodeAvatarPhoto(file);
   const header=host()?.querySelector('.lp-group-header');
   if(header){let img=header.querySelector('.lp-group-avatar');if(!img){img=el('img','lp-group-avatar');header.prepend(img);}img.src=state.avatarDraft;img.alt='群聊新头像预览';}
   state.status='已选择头像，点击保存群资料后生效';
  }catch(e){state.status='头像处理失败：'+String(e.message||e);}
  return true;
 }
 function open(options={}){
  const direct=options?.groupId&&groups().some(g=>g.id===options.groupId);
  state.active=direct?options.groupId:'';
  state.fromMessageList=!!(direct&&options.origin==='messages');
  state.manage=false;state.status='';render();
 }
 function back(){
  if(state.manage){state.manage=false;state.avatarDraft='';render();return true;}
  if(!state.active)return false;
  if(state.fromMessageList){state.active='';state.fromMessageList=false;return false;}
  state.active='';render();return true;
 }
 return {open,back,render,handleClick,handleFile,shareToGroup};
}
