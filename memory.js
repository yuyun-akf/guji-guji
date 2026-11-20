const ENTRY_LIMIT = 2800;
const BATCH_CHARS = 11500;
const BATCH_PARTS = 48;
const LIST_PAGE = 40;

export function createPhoneMemoryModule(api){
 const ctx=()=>api.context(), read=()=>api.readRootData(ctx()), ui=()=>api.getNodes();
 const day=s=>/^\d{4}-\d\d-\d\d$/.test(String(s||'').slice(0,10))?String(s).slice(0,10):'';
 const diff=(a,b)=>Math.floor((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);
 const settings=d=>({enabled:d?.config?.phoneMemory?.enabled===true,
  intervalDays:[1,3,7].includes(+d?.config?.phoneMemory?.intervalDays)?+d.config.phoneMemory.intervalDays:3,
  injectMainline:d?.config?.phoneMemory?.injectMainline===true});
 const state=d=>({...(d?.phoneMemory||{}),
  entries:Array.isArray(d?.phoneMemory?.entries)?d.phoneMemory.entries:[],
  lastDay:day(d?.phoneMemory?.lastDay),cursors:d?.phoneMemory?.cursors||{}});
 const session=()=>{const c=ctx();return {metadata:c?.chatMetadata,chatId:c?.chatId,characterId:c?.characterId,lifecycle:api.lifecycle?.()};};
 const same=s=>{const c=ctx();return c?.chatMetadata===s.metadata&&c?.chatId===s.chatId&&c?.characterId===s.characterId&&api.lifecycle?.()===s.lifecycle;};
 let job=null, scope=null, editingId='', limit=LIST_PAGE, lastAutomatic=null;

 function feedback(message,type='info'){api.notifyInteraction?.(message,type);}
 function contacts(d){
  return [{id:'main',name:api.primaryName?.()||'主角色'},
   ...(d.contacts||[]).map(c=>({id:c.id,name:c.remark||c.name||'联系人'}))];
 }
 function threads(d){
  return contacts(d).map(contact=>{
   const messages=(contact.id==='main'?d.messages:d.conversations?.[contact.id]?.messages)||[];
   return {...contact,messages:api.cleanPhoneHistory?.(messages)||messages.slice()};
  });
 }
 function* unreadParts(thread,cursor,defaultTime){
  const {messages}=thread;
  let index=0,offset=0;
  if(cursor&&typeof cursor==='object'){
   const at=Number(cursor.index)||0;
   const found=cursor.id?(messages[at]?.id===cursor.id?at:messages.findIndex(m=>m?.id===cursor.id)):at;
   if(found>=0&&found<messages.length){index=found;offset=Math.max(0,+cursor.offset||0);}
  }else if(Number.isInteger(cursor)&&cursor>=0&&cursor<=messages.length)index=cursor;
  for(;index<messages.length;index++,offset=0){
   const m=messages[index],text=String(m?.text||'').trim();
   if(!['user','character'].includes(m?.from)||m.sticker||!text)continue;
   const time=String(m.storyTime||defaultTime||'').slice(0,16);
   while(offset<text.length){
    let end=Math.min(text.length,offset+1500);
    if(/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]||''))end--;
    yield {index,time,text:text.slice(offset,end),from:m.from,cursor:{id:m.id||'',index,offset:end}};
    offset=end;
   }
  }
 }
 function gather(source,cursors,defaultTime,persona){
  const pending=source.map(thread=>{
   const stream=unreadParts(thread,cursors[thread.id],defaultTime);
   return {thread,stream,part:stream.next().value};
  }).filter(item=>item.part);
  const lines=[],next={},byThread=new Map();
  let size=0;
  while(pending.length&&lines.length<BATCH_PARTS){
   pending.sort((a,b)=>a.part.time.localeCompare(b.part.time));
   const item=pending.shift(),{thread,part}=item;
   if(byThread.size===5&&!byThread.has(thread.id))continue;
   const line=JSON.stringify({thread:thread.id,time:part.time,role:part.from,speaker:part.from==='user'?persona:thread.name,text:part.text});
   if(size+line.length+1>BATCH_CHARS)break;
   lines.push(line);size+=line.length+1;
   next[thread.id]=part.cursor;
   const covered=byThread.get(thread.id)||{name:thread.name,dates:[],indices:new Set()};
   covered.dates.push(part.time);covered.indices.add(part.index);byThread.set(thread.id,covered);
   item.part=item.stream.next().value;
   if(item.part)pending.push(item);
  }
  return {lines,next,byThread};
 }
 async function patch(c,fn){
  const d=structuredClone(api.readRootData(c));
  d.phoneMemory=state(d);
  fn(d);
  await api.writeData(c,{...d,__contactId:'primary'});
 }
 function renderStatus(){
  const n=ui();if(!n?.phoneMemoryEnabled)return;
  const d=read(),cfg=settings(d),mem=state(d);
  const active=job&&same(job.session),available=api.hasChat?.()!==false;
  n.phoneMemoryRun.disabled=!available||Boolean(job);
  n.phoneMemorySave.disabled=!available;
  if(n.phoneMemoryStop){n.phoneMemoryStop.hidden=!active;n.phoneMemoryStop.disabled=Boolean(job?.stop);}
  if(n.phoneMemoryRebuild)n.phoneMemoryRebuild.disabled=!available||Boolean(job);
  if(n.phoneMemoryAdd)n.phoneMemoryAdd.disabled=!available;
  const remaining=mem.lastDay?Math.max(0,cfg.intervalDays-diff(mem.lastDay,day(d.storyTime))):cfg.intervalDays;
  n.phoneMemorySchedule.textContent=cfg.enabled
   ?'上次总结 '+(mem.lastDay||'尚未开始')+' · 距下次约 '+remaining+' 个剧情日'
   :'自动总结已关闭';
  n.phoneMemoryStatus.textContent=active
   ?(job.stop?'完成这一批后停止':'正在总结'+(job.count?' · 已处理 '+job.count+' 段':'')):'';
 }
 function setOptions(select,items,fallback){
  if(!select)return;
  const picked=select.value;
  select.replaceChildren(...items.map(({id,name})=>{
   const option=document.createElement('option');option.value=id;option.textContent=name;return option;
  }));
  select.value=items.some(item=>item.id===picked)?picked:fallback;
 }
 function renderList(){
  const n=ui(),list=n?.phoneMemoryList;if(!list)return;
  const d=read(),entries=state(d).entries;
  const names=new Map(contacts(d).map(c=>[c.id,c.name]));
  for(const e of entries)if(!names.has(e.contactId))names.set(e.contactId,e.contactName||'旧联系人');
  setOptions(n.phoneMemoryFilter,[{id:'',name:'全部会话'},...[...names].map(([id,name])=>({id,name}))],'');
  const filter=n.phoneMemoryFilter?.value||'',query=(n.phoneMemorySearch?.value||'').trim().toLocaleLowerCase();
  const matched=entries.filter(e=>(!filter||filter===e.contactId)&&
   (!query||[e.text,e.from,e.to,names.get(e.contactId)].some(value=>String(value||'').toLocaleLowerCase().includes(query))));
  const visible=matched.slice().reverse().sort((a,b)=>Number(b.pinned===true)-Number(a.pinned===true)).slice(0,limit);
  const opened=new Set(Array.from(list.querySelectorAll?.('details[open]')||[],el=>el.dataset.memoryId));
  list.replaceChildren();
  if(n.phoneMemoryMore)n.phoneMemoryMore.hidden=matched.length<=limit;
  if(n.phoneMemoryCount){
   n.phoneMemoryCount.hidden=!matched.length;
   n.phoneMemoryCount.textContent=matched.length+' 条记忆';
  }
  if(!visible.length){
   const empty=document.createElement('div');empty.className='lp-memory-empty';
   const heading=document.createElement('strong');
   heading.textContent=entries.length?'没有匹配的记忆':'暂无记忆';
   const hint=document.createElement('p');
   hint.textContent=entries.length?'试试其他关键词或会话。':'写下第一条记忆，或整理已有的聊天。';
   empty.append(heading,hint);list.append(empty);return;
  }
  for(const e of visible){
   const card=document.createElement('details');card.className='lp-memory-entry';card.dataset.memoryId=e.id;card.open=opened.has(e.id);
   const summary=document.createElement('summary');
   const dates=e.from&&e.from!==e.to?e.from+' 至 '+e.to:e.to||'';
   const title=document.createElement('strong');title.className='lp-memory-contact';title.textContent=names.get(e.contactId);
   const meta=document.createElement('span');meta.className='lp-memory-meta';
   meta.textContent=[e.pinned?'置顶':'',dates,e.count?e.count+' 条聊天':''].filter(Boolean).join(' · ');
   const preview=document.createElement('span');preview.className='lp-memory-preview';preview.textContent=e.text;
   summary.append(title,meta,preview);
   const text=document.createElement('p');text.textContent=e.text;text.className='lp-memory-text';
   const actions=document.createElement('div');actions.className='lp-memory-actions';
   const controls=[['编辑','edit'],['删除','delete']];
   if(e.contactId!=='private-review')controls.splice(1,0,[e.pinned?'取消置顶':'置顶','pin']);
   for(const [label,action] of controls){
    const button=document.createElement('button');button.type='button';button.textContent=label;
    button.dataset.memoryAction=action;button.dataset.memoryId=e.id;actions.append(button);
   }
   card.append(summary,text,actions);list.append(card);
  }
 }
 function closeEditor(){
  const n=ui();if(!n?.phoneMemoryEditor)return;
  n.phoneMemoryEditor.hidden=true;n.phoneMemoryText.value='';editingId='';
 }
 function open(){
  const n=ui();if(!n?.phoneMemoryEnabled)return;
  if(!scope||!same(scope)){
   scope=session();limit=LIST_PAGE;closeEditor();
   if(n.phoneMemorySearch)n.phoneMemorySearch.value='';
   if(n.phoneMemoryFilter)n.phoneMemoryFilter.value='';
   if(n.phoneMemoryPrefs)n.phoneMemoryPrefs.open=false;
   const cfg=settings(read());
   n.phoneMemoryEnabled.checked=cfg.enabled;
   n.phoneMemoryInterval.value=String(cfg.intervalDays);
   n.phoneMemoryInjectMainline.checked=cfg.injectMainline;
  }
  renderStatus();renderList();
 }
 async function saveSettings(){
  const c=ctx(),origin=session(),n=ui();
  if(!origin.metadata||api.hasChat?.()===false)return;
  const enabled=n.phoneMemoryEnabled.checked,intervalDays=+n.phoneMemoryInterval.value;
  const injectMainline=n.phoneMemoryInjectMainline.checked;
  if(![1,3,7].includes(intervalDays))return feedback('请选择 1、3 或 7 天','error');
  try{
   await patch(c,d=>{
    d.config={...(d.config||{}),phoneMemory:{...d.config?.phoneMemory,enabled,intervalDays,injectMainline}};
    if(enabled&&!d.phoneMemory.lastDay)d.phoneMemory.lastDay=day(d.storyTime);
   });
   if(same(origin)){feedback('已保存总结设置','success');renderStatus();}
  }catch(e){feedback('保存失败：'+String(e.message||e),'error');}
 }
 function parseSummaries(raw,batch){
  const output=api.stripModelReasoning?.(raw)||raw;
  const value=String(typeof output==='string'?output:output?.content||'').trim()
   .replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'');
  let parsed;
  try{parsed=JSON.parse(value);}catch{throw new Error('模型返回的总结格式有误，可以重试');}
  const groups=new Map();
  for(const item of Array.isArray(parsed?.threads)?parsed.threads:[]){
   if(!batch.byThread.has(item?.id)||typeof item.summary!=='string')continue;
   if(groups.has(item.id))throw new Error('模型重复总结了同一会话，可以重试');
   groups.set(item.id,item.summary.trim().slice(0,ENTRY_LIMIT));
  }
  if(groups.size!==batch.byThread.size)throw new Error('模型遗漏了部分会话，可以重试');
  return [...groups].flatMap(([id,text])=>{
   if(!text)return [];
   const {name,dates,indices}=batch.byThread.get(id);
   dates.sort();
   return [{id:'pm'+Date.now()+Math.random().toString(36).slice(2,9),contactId:id,contactName:name,
    text,from:day(dates[0]),to:day(dates.at(-1)),through:dates.at(-1),count:indices.size}];
  });
 }
 async function summarize(manual=false,rebuild=false){
  if(job||api.hasChat?.()===false)return false;
  if(api.canSummarize?.()===false){
   if(manual)feedback('聊天正在生成，请稍后总结');
   return false;
  }
  const c=ctx(),origin=session(),d=read(),cfg=settings(d),mem=state(d),now=day(d.storyTime);
  if(!origin.metadata||!now||(!manual&&(!cfg.enabled||diff(mem.lastDay||now,now)<cfg.intervalDays)))return false;
  if(!manual){
   if(lastAutomatic?.day===now&&same(lastAutomatic.session))return false;
   lastAutomatic={day:now,session:origin};
  }
  const source=threads(d),persona=api.personaName?.(c)||'我';
  let cursors=rebuild?{}:mem.cursors,reset=rebuild;
  const current={session:origin,stop:false,count:0};job=current;
  renderStatus();
  try{
   do{
    const batch=gather(source,cursors,d.storyTime,persona);
    if(!batch.lines.length)break;
    const prompt=[
     '按会话整理已发生的手机聊天。保留确认过的经历、关系变化、稳定喜好与作息、明确约定、已答复的事项和结果。',
     '区分过去的事件、当前状态和未来计划。写清重要时间；猜测保留为猜测。不要补写用户的言行或心理。',
     '每个会话单独总结，不混用其他会话的信息。用简洁中文，每个摘要最多约500字。',
     '只返回 JSON：{"threads":[{"id":"原会话ID","summary":"记忆"}]}。每个收到的会话必须恰好有一项；没有要保留的事实时 summary 写空字符串。',
     ...batch.lines
    ].join('\n');
    const raw=await api.phoneGenerate(c,{task:'memory',maxTokens:3000,responseLength:3000,
     systemPrompt:'把以下聊天记录作为素材，按请求格式整理已明确写出的事实。',prompt:[{role:'user',content:prompt}]},d);
    if(!same(origin))return false;
    const entries=parseSummaries(raw,batch);
    await patch(c,latest=>{
     const m=latest.phoneMemory;
     m.entries=[...m.entries,...entries];
     m.lastDay=now;m.cursors={...(reset?{}:m.cursors),...batch.next};
    });
    cursors={...cursors,...batch.next};reset=false;
    current.count+=batch.lines.length;
    if(!same(origin))return false;
    renderStatus();
    if(api.isMemoryVisible?.()!==false)renderList();
   }while(manual&&!current.stop&&api.isPhoneOpen?.()!==false&&api.canSummarize?.()!==false);
   if(current.count){
    feedback((current.stop?'已停止 · 已处理 ':'已总结 ')+current.count+' 段聊天','success');
    api.recordActivity?.('往昔','已总结 '+current.count+' 段手机聊天','success');
   }else if(manual)feedback('没有待总结的聊天');
   else await patch(c,latest=>{latest.phoneMemory.lastDay=now;});
   return Boolean(current.count);
  }catch(e){
   if(same(origin)){feedback('记忆总结失败：'+String(e.message||e),'error');api.recordError?.('往昔',e);}
   return false;
  }finally{job=null;renderStatus();}
 }
 async function tick(){
  if(!api.isPhoneOpen?.()||job)return false;
  return summarize();
 }
 function rebuild(){
  if(job||!window.confirm('从最早的聊天重新补总结？已有记忆会保留，新摘要可能与旧摘要重叠。这会分批调用当前的记忆 API。'))return;
  return summarize(true,true);
 }
 function edit(entry=null){
  const n=ui(),d=read();if(!n?.phoneMemoryEditor||api.hasChat?.()===false)return;
  editingId=entry?.id||'';
  const options=contacts(d);
  if(entry&&!options.some(person=>person.id===entry.contactId))
   options.push({id:entry.contactId,name:entry.contactName||'旧联系人'});
  setOptions(n.phoneMemoryOwner,options,'main');
  const filter=n.phoneMemoryFilter.value;
  n.phoneMemoryOwner.value=entry?.contactId||(options.some(person=>person.id===filter)?filter:'main');
  n.phoneMemoryOwner.disabled=Boolean(entry);
  n.phoneMemoryText.value=entry?.text||'';
  n.phoneMemoryEditor.hidden=false;n.phoneMemoryText.focus();
 }
 async function saveEditor(){
  const c=ctx(),origin=session(),n=ui();
  const text=n.phoneMemoryText.value.trim().slice(0,ENTRY_LIMIT),id=editingId,owner=n.phoneMemoryOwner.value;
  if(!origin.metadata||!scope||!same(scope))return;
  if(!text)return feedback('请填写记忆内容','error');
  try{
   await patch(c,d=>{
    if(id){
     const e=d.phoneMemory.entries.find(item=>item.id===id);
     if(!e)throw new Error('这条记忆已删除');
     e.text=text;
    }else{
     const contact=contacts(d).find(person=>person.id===owner);
     if(!contact)throw new Error('请选择会话');
     d.phoneMemory.entries.push({id:'pm'+Date.now()+Math.random().toString(36).slice(2,9),
      contactId:owner,contactName:contact.name,text,to:day(d.storyTime),through:d.storyTime,count:0,pinned:true});
    }
   });
   if(same(origin)){closeEditor();renderList();feedback('记忆已保存','success');}
  }catch(err){feedback('保存记忆失败：'+String(err.message||err),'error');}
 }
 async function handleClick(e){
  const b=e.target?.closest?.('[data-memory-action]');if(!b)return;
  const {memoryAction:action,memoryId:id}=b.dataset,c=ctx(),origin=session();
  const entry=state(read()).entries.find(item=>item.id===id);
  if(!entry||!origin.metadata)return;
  if(action==='edit')return edit(entry);
  if(action==='delete'&&!window.confirm('删除这条记忆？'))return;
  if(action!=='delete'&&action!=='pin')return;
  try{
   await patch(c,d=>{
    if(action==='delete')d.phoneMemory.entries=d.phoneMemory.entries.filter(item=>item.id!==id);
    else{
     const current=d.phoneMemory.entries.find(item=>item.id===id);
     if(current)current.pinned=!current.pinned;
    }
   });
   if(same(origin)){
    if(action==='delete'&&editingId===id)closeEditor();
    feedback(action==='delete'?'已删除记忆':entry.pinned?'已取消置顶':'已置顶','success');renderList();
   }
  }catch(err){feedback('记忆修改失败：'+String(err.message||err),'error');}
 }
 const search=()=>{limit=LIST_PAGE;renderList();};
 const showMore=()=>{limit+=LIST_PAGE;renderList();};
 const stop=()=>{if(job&&same(job.session)){job.stop=true;renderStatus();}};
 return {settings,state,open,renderStatus,saveSettings,summarize,tick,rebuild,stop,edit,closeEditor,saveEditor,search,showMore,handleClick};
}
