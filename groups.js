/* 咕叽聊群聊：群消息仅属于当前剧情存档，所有发言独立归属成员。 */
export function createGroupsModule(api){
 const el=(tag,cls='',text='')=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
 const state={active:'',busy:false,status:'',manage:false,avatarDraft:'',fromMessageList:false,quoteId:''};
 const scrollByGroup=new Map();let lastView='';
 const host=()=>api.getNodes()?.groupsContent;
 const ctx=()=>api.context();
 const root=()=>api.readRootData(ctx());
 const groups=()=>Array.isArray(root().groupChats)?root().groupChats:[];
 const people=()=>api.galleryPeople().filter(p=>p.id!=='user'&&api.isPhoneFriend(p.id));
 const scope=()=>ctx()?.chatMetadata;
 const uid=()=> 'grp-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
 const button=(label,action,id='')=>{const b=el('button','lp-group-button',label);b.type='button';b.dataset.groupAction=action;if(id)b.dataset.groupId=id;return b;};
 const who=id=>id==='user'?(api.userPhoneName?.()||'我'):api.galleryPeople().find(x=>x.id===id)?.name||'已退出成员';
 const groupTitle=g=>g.remark||g.name||'群聊';
 function groupRecords(g){return (g.messages||[]).map(m=>who(m.from)+'：'+String(m.text||'[图片]')).join('\n');}
 function groupHeader(t){api.setGroupTitle?.(t||'群聊');}
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
   groupHeader(groupTitle(group));api.setGroupOptionsVisible?.(true);
   if(state.manage){
    const form=el('div','lp-group-create lp-group-settings');
    const heading=el('h3','','群聊设置');form.append(heading);
    const name=el('input');name.dataset.groupInput='editName';name.maxLength=40;name.value=group.name||'';name.placeholder='群名称';
    const remark=el('input');remark.dataset.groupInput='editRemark';remark.maxLength=40;remark.value=group.remark||'';remark.placeholder='群聊备注';
    const avatar=el('input');avatar.type='file';avatar.accept='image/png,image/jpeg,image/webp';avatar.dataset.groupAvatar='true';
    form.append(el('label','','群名称'),name,el('label','','群聊备注'),remark,el('label','','群头像'),avatar);
    const memberGrid=el('div','lp-group-member-grid');
    for(const id of group.members){
     const member=el('div','lp-group-member-tile'),src=api.memberAvatar?.(id);
     if(src){const img=el('img');img.src=src;img.alt=who(id);member.append(img);}
     member.append(el('span','',who(id)));memberGrid.append(member);
    }
    form.append(el('strong','','群聊成员（'+group.members.length+'）'),memberGrid);
    for(const id of group.members){
     const label=el('label','lp-group-choice'),check=el('input');
     check.type='checkbox';check.value=id;check.checked=true;check.dataset.groupEditMember='true';
     label.append(check,document.createTextNode(who(id)));form.append(label);
    }
    const invite=el('details','lp-group-invite');invite.append(el('summary','','邀请好友加入群聊'));
    const available=people().filter(p=>!group.members.includes(p.id));
    for(const person of available){
     const label=el('label','lp-group-choice'),check=el('input');check.type='checkbox';check.value=person.id;check.dataset.groupInvite='true';
     label.append(check,document.createTextNode(person.name));invite.append(label);
    }
    if(!available.length)invite.append(el('p','lp-album-empty','暂无可邀请好友'));
    form.append(invite,button('保存群设置','save-manage'));
    const records=el('div','lp-group-record-actions');
    records.append(el('strong','','管理聊天记录'),button('复制聊天记录','copy-records'),
     button('导出聊天记录','export-records'),button('清空聊天记录','clear-records'),
     button('删除群聊','delete-group'),button('返回聊天','manage'));
    form.append(records);target.append(form);
    if(state.status)target.append(el('p','lp-group-feedback',state.status));
    target.scrollTop=top;return;
   }
   const feed=el('div','lp-group-messages lp-group-chat-feed'),messageMap=new Map((group.messages||[]).map(m=>[m.id,m]));
   for(const msg of group.messages||[]){
    const row=el('div','lp-group-message-row'+(msg.from==='user'?' mine':''));
    const src=api.memberAvatar?.(msg.from);
    if(src){const face=el('img','lp-group-sender-avatar');face.src=src;face.alt=who(msg.from);row.append(face);}
    const item=el('article','lp-group-message'+(msg.from==='user'?' mine':''));
    item.append(el('strong','lp-group-sender-name',who(msg.from)));
    const parent=messageMap.get(msg.replyTo);
    if(parent)item.append(el('div','lp-group-reply-quote',who(parent.from)+'：'+String(parent.text||'[图片]').slice(0,100)));
    if(msg.text)item.append(el('p','lp-group-message-text',msg.text));
    if(msg.sharePost){
     const quote=el('div','lp-group-share');quote.append(el('strong','',msg.sharePost.author||'群星'),el('p','',msg.sharePost.text||''));
     if(msg.sharePost.image){const image=el('img');image.src=msg.sharePost.image;image.alt='群星分享图片';quote.append(image);}
     item.append(quote,button('查看分享内容','view-share',msg.id));
    }
    if(msg.images?.length)for(const image of msg.images){const img=el('img','lp-group-photo');img.src=image;img.alt='群聊照片';item.append(img);}
    item.append(button('引用','quote',msg.id));row.append(item);feed.append(row);
   }
   if(!feed.children.length)feed.append(el('p','lp-album-empty','群聊刚刚建立。'));
   target.append(feed);
   const compose=el('div','lp-group-composer');
   const targetMsg=messageMap.get(state.quoteId);
   if(targetMsg){const quote=el('div','lp-group-compose-quote','引用 '+who(targetMsg.from)+'：'+String(targetMsg.text||'[图片]').slice(0,95));
    quote.append(button('×','cancel-quote'));compose.append(quote);}
   const input=el('textarea');input.rows=2;input.maxLength=1000;input.dataset.groupInput='message';input.placeholder='发送群聊消息';
   const actions=el('div','lp-group-send-actions');
   actions.append(button('发送','send'),button(state.busy?'正在生成…':'生成成员回复','generate'));
   compose.append(input,actions);target.append(compose);
   if(state.status)target.append(el('p','lp-group-feedback',state.status));
   feed.scrollTop=feed.scrollHeight;
   target.scrollTop=top;return;
  }
  groupHeader('群聊');api.setGroupOptionsVisible?.(false);
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
  const replyTo=(group.messages||[]).some(m=>m.id===state.quoteId)?state.quoteId:'';
  await mutate(all=>{
   const g=all.find(x=>x.id===group.id);g.messages.push({id:uid(),from:'user',text:text.slice(0,1000),...(replyTo?{replyTo}:{}),storyTime:root().storyTime||'',createdAt:new Date().toISOString()});
   g.messages=g.messages.slice(-180);
  });
  state.status='';state.quoteId='';render();
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
   const history=(group.messages||[]).slice(-30).map(m=>({id:m.id,speaker:m.from,text:String(m.text||'').slice(0,800),replyTo:m.replyTo||'',sharePost:m.sharePost?{author:m.sharePost.author,text:m.sharePost.text}:undefined}));
   const sys='你正在生成完全虚构的多人聊天。用户是独立参与者；禁止新增用户的言行、心理，禁止读心，禁止知道不在群里的私聊内容。每位成员都有独立人设与知识，发言必须是成员本人合理决定；不要求所有成员轮流回复，也允许本轮无人回复。群成员与他们的设定并非该角色能够看到的其他人的私密资料。如成员有已允许私聊使用的本人相册照片，可在其消息中使用 [[photo:照片ID]]，且仅使用该成员名下照片；不强制发送。允许群成员交错发言、互相回应与引用群内已发生的消息，不能强制轮流。一条回复可通过 replyTo 引用给出的历史消息ID，也可以引用本轮前面消息的索引（从0开始）。仅返回JSON：{"messages":[{"speaker":"成员ID","text":"回复","replyTo":"可选引用ID或本轮索引"}]}。只能使用给出的成员ID，最多8条，不能输出 user 的话。';
   const raw=await api.phoneGenerate(ctx(),{task:'chat',systemPrompt:sys,prompt:[{role:'user',content:JSON.stringify({storyTime:root().storyTime,members:roster,history})}]},api.readRootData(ctx()));
   if(scope()!==meta)return;
   const text=api.stripModelReasoning?.(raw)||raw;
   const match=String(text).match(/\{[\s\S]*\}/);if(!match)throw Error('群聊回复不是合法 JSON');
   const parsed=JSON.parse(match[0]);
   const messages=(Array.isArray(parsed.messages)?parsed.messages:[]).filter(m=>roster.some(p=>p.id===m.speaker)&&typeof m.text==='string'&&m.text.trim()).slice(0,8);
   if(messages.length)await mutate(all=>{
    const g=all.find(x=>x.id===group.id),newBatch=[];
    for(const message of messages){
     const memberPhotos=api.galleryPhotosForMember?.(message.speaker)||[];
     const match=message.text.match(/\[\[photo:([^\]\r\n]+)\]\]/);
     const photo=match?memberPhotos.find(p=>p.id===match[1]):null;
     const text=message.text.replace(/\[\[photo:[^\]\r\n]+\]\]/g,'').trim();
     if(text||photo){
      const ref=String(message.replyTo||'');
      const original=(g.messages||[]).find(m=>m.id===ref)||
       (/^\d+$/.test(ref)?newBatch[Number(ref)]:null);
      const saved={id:uid(),from:message.speaker,text:text.slice(0,1000),
        ...(original?{replyTo:original.id}:{}),
       ...(photo?{images:[photo.image]}:{}),storyTime:root().storyTime||'',createdAt:new Date().toISOString()};g.messages.push(saved);newBatch.push(saved);}
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
   const remark=host()?.querySelector('[data-group-input="editRemark"]')?.value?.trim()||'';
   const members=[...new Set([...host().querySelectorAll('input[data-group-edit-member]:checked')].map(x=>x.value).concat([...host().querySelectorAll('input[data-group-invite]:checked')].map(x=>x.value)))];
   if(members.length<2){status('至少保留两名群成员',true);return true;}
   try{await mutate(all=>{const g=all.find(x=>x.id===state.active);if(!g)throw Error('群聊不存在');g.name=name;g.remark=remark;g.members=members;if(state.avatarDraft)g.avatar=state.avatarDraft;});
     state.manage=false;state.avatarDraft='';state.status='群资料已保存';render();}
   catch(e){status('修改失败：'+String(e.message||e),true);}
  }
  else if(act==='quote'){state.quoteId=id;render();host()?.querySelector('[data-group-input="message"]')?.focus();}
  else if(act==='cancel-quote'){state.quoteId='';render();}
  else if(act==='copy-records'){
   const group=groups().find(g=>g.id===state.active);
   try{await navigator.clipboard.writeText(groupRecords(group));status('群聊记录已复制');}
   catch(error){status('复制失败：'+String(error.message||error),true);}
  }
  else if(act==='export-records'){
   const group=groups().find(g=>g.id===state.active);
   const json=JSON.stringify({name:group.name,remark:group.remark||'',members:group.members,messages:group.messages},null,2);
   const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
   const a=el('a');a.href=url;a.download=(group.name||'群聊')+'.json';document.body.append(a);a.click();a.remove();
   setTimeout(()=>URL.revokeObjectURL(url),1000);status('群聊记录已导出');
  }
  else if(act==='clear-records'){
   if(!window.confirm('清空这个群的所有聊天记录？此操作不可恢复。'))return true;
   await mutate(all=>{const g=all.find(x=>x.id===state.active);g.messages=[];});state.quoteId='';status('群聊记录已清空');
  }
  else if(act==='delete-group'){
   if(!window.confirm('删除这个群聊及全部聊天记录？此操作不可恢复。'))return true;
   await mutate(all=>{const n=all.findIndex(g=>g.id===state.active);if(n>=0)all.splice(n,1);});
   state.active='';state.manage=false;groupHeader('群聊');render();
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
  state.manage=false;state.quoteId='';state.status='';render();
 }
 function openMenu(){if(!state.active)return;state.manage=true;state.status='';render();}
 function back(){
  if(state.manage){state.manage=false;state.avatarDraft='';render();return true;}
  if(!state.active)return false;
  if(state.fromMessageList){state.active='';state.fromMessageList=false;return false;}
  state.active='';render();return true;
 }
 return {open,openMenu,back,render,handleClick,handleFile,shareToGroup};
}
