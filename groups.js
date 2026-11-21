/* 咕叽聊群聊：群消息仅属于当前剧情存档，所有发言独立归属成员。 */
export function createGroupsModule(api){
 const el=(tag,cls='',text='')=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
 const state={active:'',busy:false,status:'',manage:false,avatarDraft:'',fromMessageList:false,quoteId:'',tool:'',draft:''};
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
 const quoteText=(message,hidePhotoDescription=false)=>api.messageQuoteText?.(message,hidePhotoDescription)||String(message.text||'[图片]');
 const recallText=message=>(message.from==='user'?'你':who(message.from))+'撤回了一条消息';
 const quoteLabel=(message,hidePhotoDescription=false)=>message.recalledAt?quoteText(message):who(message.from)+'：'+quoteText(message,hidePhotoDescription);
 function groupRecords(g){return (g.messages||[]).map(m=>m.recalledAt?recallText(m):quoteLabel(m)).join('\n');}
 function groupHeader(t){api.setGroupTitle?.(t||'群聊');}
 function status(text,error=false){state.status='';api.notifyInteraction?.(text,error?'error':'success');render();}
 function render(){
  const target=host();if(!target)return;
  const view=state.active?(state.manage?'manage:':'chat:')+state.active:'directory';
  if(lastView&&lastView!==view)scrollByGroup.set(lastView,target.scrollTop);
  const top=lastView===view?target.scrollTop:(scrollByGroup.get(view)||0);
  target.replaceChildren();
  lastView=view;target.scrollTop=top;
  const group=groups().find(g=>g.id===state.active);
  target.dataset.groupView=group?(state.manage?'manage':'chat'):'directory';
  if(group){
   groupHeader(groupTitle(group));api.setGroupOptionsVisible?.(true);
   if(state.manage){
    const form=el('div','lp-group-create lp-group-settings');
    const heading=el('h3','','群聊设置');form.append(heading);
    const name=el('input');name.dataset.groupInput='editName';name.maxLength=40;name.value=group.name||'';name.placeholder='群名称';
    const remark=el('input');remark.dataset.groupInput='editRemark';remark.maxLength=40;remark.value=group.remark||'';remark.placeholder='群聊备注';
    const avatar=el('input');avatar.type='file';avatar.accept='image/png,image/jpeg,image/webp,image/gif';
    avatar.dataset.groupAvatar='true';avatar.classList.add('lp-group-avatar-native-input');
    avatar.setAttribute('aria-label','上传群聊头像');
    // Direct change handling preserves the selected file on mobile WebViews and
    // does not rely solely on the phone shell's delegated change listener.
    avatar.addEventListener('change',event=>{event.stopPropagation();void handleFile(event);});
    const avatarRow=el('div','lp-group-avatar-editor');
    const preview=el('img','lp-group-avatar lp-group-avatar-preview');
    const avatarSource=state.avatarDraft||group.avatar||'';
    preview.alt='群头像预览';if(avatarSource)preview.src=avatarSource;
    preview.hidden=!avatarSource;
    const empty=el('span','lp-group-avatar-placeholder','群');
    empty.hidden=!!avatarSource;
    const pick=el('div','lp-group-avatar-pick');
    pick.append(el('span','lp-group-avatar-pick-label',avatarSource?'更换群头像':'上传群头像'));
    // Keep an actual, visible file input. Hidden/overlay pickers are unreliable
    // in several Android WebView file-chooser implementations.
    const pickBox=el('div','lp-group-avatar-picker');
    pickBox.append(pick,avatar,el('small','lp-group-avatar-hint',
     state.avatarDraft?'已选中图片，保存群设置后生效':'点击「选择文件」从手机相册上传 JPG、PNG、WebP 或 GIF'));
    pick.addEventListener('click',()=>avatar.click());
    avatarRow.append(preview,empty,pickBox);
    form.append(el('label','','群名称'),name,el('label','','群聊备注'),remark,el('label','','群头像'),avatarRow);
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
    
    target.scrollTop=top;return;
   }
   // Use the same row/body/bubble vocabulary and geometry as private chats.
   const feed=el('div','lp-group-messages lp-group-chat-feed'),messageMap=new Map((group.messages||[]).map(m=>[m.id,m]));
   const stickerCatalog=(group.messages||[]).some(message=>message.from!=='user'&&/表情包|\[\[sticker/i.test(message.text))
    ?api.stickerLibrary?.()||[]:[];
   for(const saved of group.messages||[]){
    if(saved.recalledAt){feed.append(el('div','lp-recall-notice',recallText(saved)));continue;}
    const msg=saved.from!=='user'?(api.renderLegacyPhoneSticker?.(saved,stickerCatalog)||saved):saved;
    const mine=msg.from==='user';
    const row=el('div','lp-message lp-group-chat-row '+(mine?'lp-mine':'lp-theirs'));
    const src=api.memberAvatar?.(msg.from);
    const face=el('img','lp-group-sender-avatar');face.src=src||'/img/ai4.png';face.alt=who(msg.from);
    const body=el('div','lp-message-body');
    if(!mine)body.append(el('small','lp-group-sender-name',who(msg.from)));
    const parent=msg.replyTo&&messageMap.get(msg.replyTo),quote=parent?quoteLabel(parent,true):msg.replyQuote;
    const bubble=el('div','lp-bubble lp-group-bubble'+(msg.sticker&&!quote?' lp-sticker-only':''));
    if(quote)bubble.append(el('div','lp-inline-quote',quote.slice(0,180)));
    const text=api.visiblePhoneMessageText?.(msg)??(msg.sticker?'':msg.text);
    if(msg.voice)bubble.append(api.renderVoiceMessage(text));
    else if(text)bubble.append(el('span','lp-group-message-text',text));
    if(msg.sharePost){
     const quote=el('div','lp-group-share');quote.append(el('strong','',msg.sharePost.author||'群星'),el('p','',msg.sharePost.text||''));
     if(msg.sharePost.image){const image=el('img');image.src=msg.sharePost.image;image.alt='群星分享图片';quote.append(image);}
     bubble.append(quote,button('查看分享内容','view-share',msg.id));
    }
    for(const image of [...(msg.images||[]),...(msg.image?[msg.image]:[]),...(msg.stickerImages||[])]){
     const img=el('img','lp-chat-image lp-group-photo');img.src=image;
     img.alt=msg.sticker||msg.stickerImages?.includes(image)?'表情包图片':'群聊照片';bubble.append(img);
    }
    body.append(bubble);
    const actions=el('div','lp-group-message-actions');
    const quoteButton=button('引用','quote',msg.id);quoteButton.classList.add('lp-group-quote-action');actions.append(quoteButton);
    if(api.canRecallMessage?.(msg,'user'))actions.append(button('撤回','recall',msg.id));
    body.append(actions);
    row.append(face,body);feed.append(row);
   }
   if(!feed.children.length)feed.append(el('p','lp-album-empty','群聊刚刚建立。'));
   target.append(feed);
   const compose=el('div','lp-group-composer lp-group-chat-compose');
   const targetMsg=messageMap.get(state.quoteId);
   if(targetMsg&&!targetMsg.recalledAt){const quote=el('div','lp-group-compose-quote','引用 '+quoteLabel(targetMsg,true).slice(0,95));
    quote.append(button('×','cancel-quote'));compose.append(quote);}
   const controls=el('div','lp-group-composer-controls');
   const emoji=button('☺','emoji');emoji.classList.add('lp-tool-btn','lp-group-tool-btn');
   const input=el('textarea');input.rows=1;input.maxLength=1000;input.dataset.groupInput='message';
   input.placeholder='发送消息';input.value=state.draft;
   input.addEventListener('input',()=>{state.draft=input.value;});
   const more=button('＋','more');more.classList.add('lp-tool-btn','lp-group-tool-btn');
   const actions=el('div','lp-group-send-actions');
   actions.append(button('发送','send'),button(state.busy?'正在生成…':'生成','generate'));
   controls.append(emoji,input,more,actions);compose.append(controls);
   if(state.tool==='emoji'){
    const picker=el('div','lp-group-emoji-panel lp-emoji-panel');
    for(const sticker of (api.stickerLibrary?.()||[])){
     const choice=button('','sticker',sticker.id);choice.classList.add('lp-group-sticker-button');
     choice.title=sticker.label;choice.setAttribute('aria-label','发送表情包：'+sticker.label);
     const thumb=el('img');thumb.src=sticker.image;thumb.alt=sticker.label;choice.append(thumb);picker.append(choice);
    }
    if(!picker.children.length)picker.append(el('small','','相册中暂无表情包'));
    compose.append(picker);
   }
   if(state.tool==='more'){
    const tools=el('div','lp-group-tools-menu');
    const picker=el('label','lp-group-choose-photo','＋ 发送图片');
    const file=el('input');file.type='file';file.accept='image/png,image/jpeg,image/webp,image/gif';
    file.dataset.groupPhoto='true';picker.append(file);tools.append(picker);compose.append(tools);
   }
   target.append(compose);
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
 async function sendGroupMessage(groupId,text,extra={}){
  if(!groupId||!text)return;
  await mutate(all=>{
   const g=all.find(item=>item.id===groupId);if(!g)throw Error('群聊不存在');
   g.messages||=[];
   const target=g.messages.find(m=>m.id===state.quoteId&&!m.recalledAt);
   g.messages.push({id:uid(),from:'user',text:text.slice(0,1000),...extra,
    ...(target?{replyTo:target.id,replyQuote:quoteLabel(target).slice(0,180)}:{}),
    storyTime:root().storyTime||'',createdAt:new Date().toISOString()});
   g.messages=g.messages.slice(-180);
  });
  if(state.active===groupId){state.quoteId='';state.draft='';state.tool='';render();}
 }
 async function send(){
  const input=host()?.querySelector('[data-group-input="message"]');
  await sendGroupMessage(state.active,input?.value?.trim());
 }
 async function generate(){
  const group=groups().find(g=>g.id===state.active);if(!group||state.busy)return;
  const meta=scope();state.busy=true;state.status='正在生成群聊回复';render();
  try{
   const roster=group.members.filter(id=>api.isPhoneFriend(id)).map(id=>{
    const char=api.contactCharacter(ctx(),id);
    return {id,name:who(id),description:[char?.data?.description||char?.description,char?.data?.personality||char?.personality,char?.data?.scenario||char?.scenario].filter(Boolean).join('\n').slice(0,1600),
     relationToUser:api.memberRelationship?.(id)||'',
     photos:(api.galleryPhotosForMember?.(id)||[]).slice(0,8).map(p=>({id:p.id,description:p.description||p.title||'照片'}))};
   });
   if(!roster.length)throw Error('群聊中没有可回复的好友');
   const history=(group.messages||[]).slice(-30).map(m=>m.recalledAt?{speaker:m.from,text:'[撤回了一条消息]'}
    :{id:m.id,speaker:m.from,text:quoteText(m).slice(0,800),replyTo:m.replyTo||'',
      sharePost:m.sharePost?{author:m.sharePost.author,text:m.sharePost.text}:undefined});
   const catalog=api.stickerLibrary?.()||[];
   const sys=[
    '你正在生成虚构群聊。群成员只知道群消息，各有独立人设和知识，可以交错发言或选择暂不发言。不能代替用户说话、行动或描写用户的心理。',
    '仅返回 JSON 对象，messages 数组最多8条。普通消息格式为 {"speaker":"成员ID","text":"消息"}。语音在同一格式增加 "type":"voice"，text 写语音原文。',
    '仅在贴合语境时添加 "replyTo"，可引用用户、其他成员或自己已发的消息。值为给出的群历史消息 ID，或本轮 messages 数组中较早项的从零开始的整数索引。',
    '撤回自己的普通消息用 {"speaker":"成员ID","type":"recall","messageId":"历史消息ID或本轮较早项的索引"}。',
    '照片用 [[photo:照片ID]]，只能使用发言者获准用于本群的照片。speaker 必须为已提供的角色成员 ID。',
    api.stickerPrompt?.(api.chooseStickerCandidates?.(catalog,{messages:history})||[]),
   ].filter(Boolean).join('\n');
   const raw=await api.phoneGenerate(ctx(),{task:'chat',systemPrompt:sys,prompt:[{role:'user',content:JSON.stringify({storyTime:root().storyTime,members:roster,history})}]},api.readRootData(ctx()));
   if(scope()!==meta||!groups().some(g=>g.id===group.id))return;
   const rawJson=String(api.stripModelReasoning?.(raw)||raw).match(/\{[\s\S]*\}/);
   if(!rawJson)throw Error('群聊回复不是合法 JSON');
   const parsed=JSON.parse(rawJson[0]);
   const candidates=Array.isArray(parsed.messages)?parsed.messages.slice(0,8):[];
   const historyIds=new Set(history.filter(item=>item.id).map(item=>item.id));
   if(candidates.length)await mutate(all=>{
    const g=all.find(x=>x.id===group.id),newBatch=[];
    g.messages||=[];
    const resolve=ref=>{
     const key=String(ref??'').trim();
     const id=historyIds.has(key)?key:/^\d+$/.test(key)?newBatch[Number(key)]:null;
     return id?g.messages.find(m=>m.id===id&&!m.recalledAt):null;
    };
    for(const [position,message] of candidates.entries()){
     if(!message||!roster.some(p=>p.id===message.speaker)||!g.members.includes(message.speaker))continue;
     if(message.type==='recall'){
      const target=resolve(message.messageId);
      if(target)api.recallPhoneMessage(g.messages,target.id,message.speaker);
      continue;
     }
     if(typeof message.text!=='string')continue;
     const available=api.galleryPhotosForMember?.(message.speaker)||[],images=[];
     const text=message.text.replace(/\[\[photo:([^\]\r\n]+)\]\]/g,(token,id)=>{
      const photo=available.find(item=>item.id===id.trim());
      if(photo&&images.length<9)images.push(photo.image);
      return '';
     }).trim();
     const content=api.parseMessageStickers?.(text,catalog)||{text};
     if(!content.text&&!images.length)continue;
     const parent=resolve(message.replyTo);
     const saved={id:uid(),from:message.speaker,...content,text:(content.text||'[图片]').slice(0,1000),
      ...(parent?{replyTo:parent.id,replyQuote:quoteLabel(parent).slice(0,180)}:{}),
      ...(images.length?{images}:{}),...(message.type==='voice'&&content.text&&!content.sticker?{voice:true}:{}),
      storyTime:root().storyTime||'',createdAt:new Date().toISOString()};
     g.messages.push(saved);newBatch[position]=saved.id;
    }
    g.messages=g.messages.slice(-180);
   });
  }catch(error){if(scope()===meta)api.notifyInteraction?.('生成失败：'+String(error.message||error),'error');}
  finally{state.busy=false;if(scope()===meta)render();}
 }
 async function handleClick(e){
  const button=e.target.closest('button[data-group-action]');if(!button||state.busy)return false;
  const act=button.dataset.groupAction,id=button.dataset.groupId;
  if(act==='emoji'||act==='more'){
   state.tool=state.tool===act?'':act;render();
  }
  else if(act==='sticker'){
   const sticker=(api.stickerLibrary?.()||[]).find(item=>item.id===id);
   if(sticker&&state.active){
    const draft=state.draft.trim();
    const extra=draft?{stickerImages:[sticker.image],stickerName:sticker.label}
     :{sticker:true,images:[sticker.image],stickerName:sticker.label};
    try{await sendGroupMessage(state.active,draft||'[表情包：'+sticker.label+']',extra);}
    catch(error){status('发送表情包失败：'+String(error.message||error),true);}
   }
  }
  else if(act==='manage'){state.manage=!state.manage;state.avatarDraft='';state.status='';render();}
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
  else if(act==='recall'){
   try{
    await mutate(all=>{
     const g=all.find(item=>item.id===state.active);
     if(g)api.recallPhoneMessage(g.messages||[],id,'user');
    });
    if(state.quoteId===id)state.quoteId='';
    render();
   }catch(error){status('撤回消息失败：'+String(error.message||error),true);}
  }
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
  else if(act==='open'){state.active=id;state.manage=false;state.status='';state.tool='';state.draft='';render();}
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
  const input=event.target.closest('input[data-group-avatar],input[data-group-photo]');
  if(!input)return false;
  const file=input.files?.[0],photo=input.hasAttribute('data-group-photo');
  input.value='';if(!file)return false;
  try{
   const image=await api.encodeAvatarPhoto(file);
   if(photo){
    if(!state.active)return true;
    await mutate(all=>{
     const g=all.find(p=>p.id===state.active);if(!g)return;
     g.messages.push({id:uid(),from:'user',text:'[图片]',images:[image],
      storyTime:root().storyTime||'',createdAt:new Date().toISOString()});
     g.messages=g.messages.slice(-180);
    });
    state.tool='';render();
   }else{
    state.avatarDraft=image;
    const preview=host()?.querySelector('.lp-group-avatar-preview');
    if(preview){preview.src=state.avatarDraft;preview.hidden=false;}
    const placeholder=host()?.querySelector('.lp-group-avatar-placeholder');
    if(placeholder)placeholder.hidden=true;
    const hint=host()?.querySelector('.lp-group-avatar-hint');
    if(hint)hint.textContent='已选择图片，点击「保存群设置」生效';
    const pickText=host()?.querySelector('.lp-group-avatar-pick-label');
    if(pickText)pickText.textContent='更换群头像';
    state.status='已选择群头像，点击保存群设置后生效';
   }
  }catch(e){status((photo?'发送图片':'头像处理')+'失败：'+String(e.message||e),true);}
  return true;
 }
 function open(options={}){
  const direct=options?.groupId&&groups().some(g=>g.id===options.groupId);
  state.active=direct?options.groupId:'';
  state.fromMessageList=!!(direct&&options.origin==='messages');
  state.manage=false;state.quoteId='';state.status='';state.tool='';state.draft='';render();
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
