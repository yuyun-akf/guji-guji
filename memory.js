
export function createPhoneMemoryModule(api){
 const ctx=()=>api.context(), read=()=>api.readRootData(ctx()), ui=()=>api.getNodes();
 const day=s=>/^\d{4}-\d\d-\d\d$/.test(String(s||'').slice(0,10))?String(s).slice(0,10):'';
 const diff=(a,b)=>Math.floor((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);
 const settings=d=>({enabled:d?.config?.phoneMemory?.enabled===true,
  intervalDays:[1,3,7].includes(+d?.config?.phoneMemory?.intervalDays)?+d.config.phoneMemory.intervalDays:3,
  injectMainline:d?.config?.phoneMemory?.injectMainline===true});
 const state=d=>({entries:Array.isArray(d?.phoneMemory?.entries)?d.phoneMemory.entries.slice(-60):[],
  lastDay:day(d?.phoneMemory?.lastDay),cursors:d?.phoneMemory?.cursors||{}});
 let working=false;
 function feedback(s,type='info'){
  const node=ui()?.phoneMemoryStatus;
  if(node)node.textContent='';
  if(s&&type!=='pending')api.notifyInteraction?.(s,type);
 }
 function gather(d,cursors){
  const threads=[{id:'main',name:api.primaryName?.()||'主角色',msgs:d.messages||[]},
   ...(d.contacts||[]).map(c=>({id:c.id,name:c.remark||c.name||'联系人',
    msgs:d.conversations?.[c.id]?.messages||[]}))];
  const lines=[],next={};
  for(const thread of threads){
   const msgs=Array.isArray(thread.msgs)?thread.msgs:[];
   const from=Math.max(0,Math.min(msgs.length,+cursors[thread.id]||0));
   next[thread.id]=msgs.length;
   for(const m of msgs.slice(from)){
    if(!['user','character'].includes(m?.from)||!String(m.text||'').trim())continue;
    lines.push({contactId:thread.id,contactName:thread.name,time:String(m.storyTime||d.storyTime||'').slice(0,19),
     who:thread.name+'/'+(m.from==='user'?'user':'角色'),text:String(m.text).slice(0,650)});
   }
  }
  lines.sort((a,b)=>a.time.localeCompare(b.time));
  return {lines:lines.slice(-90),next};
 }
 async function patch(fn){
  const c=ctx(),d=structuredClone(api.readRootData(c));
  d.phoneMemory={...state(d)};fn(d);await api.writeData(c,{...d,__contactId:'primary'});
 }
 function render(){
  const n=ui();if(!n?.phoneMemoryEnabled)return;
  const d=read(),cfg=settings(d),mem=state(d);
  n.phoneMemoryEnabled.checked=cfg.enabled;
  n.phoneMemoryInterval.value=String(cfg.intervalDays);
  n.phoneMemoryInjectMainline.checked=cfg.injectMainline;
  n.phoneMemoryRun.disabled=working;n.phoneMemorySave.disabled=working;
  const remaining=mem.lastDay?Math.max(0,cfg.intervalDays-diff(mem.lastDay,day(d.storyTime))):cfg.intervalDays;
  n.phoneMemorySchedule.textContent=cfg.enabled
   ?'上次处理：'+(mem.lastDay||'尚未开始')+'；距下次自动总结约 '+remaining+' 个剧情日'
   :'自动总结已关闭；已保存记忆仍会保留';
  n.phoneMemoryStatus.textContent='';
  const list=n.phoneMemoryList;if(!list)return;
  list.replaceChildren();
  if(!mem.entries.length){const p=document.createElement('p');p.textContent='暂无手机记忆，可设置周期或手动总结。';list.append(p);return;}
  for(const e of mem.entries.slice().reverse()){
   const d=document.createElement('details');d.className='lp-memory-entry';
   const summary=document.createElement('summary');summary.textContent=(e.contactName||'小手机')+' · '+e.from+' — '+e.to+' · '+e.count+' 条';
   const p=document.createElement('p');p.textContent=e.text;p.className='lp-memory-text';
   const input=document.createElement('textarea');input.hidden=true;input.value=e.text;input.maxLength=2800;
   const actions=document.createElement('div');actions.className='lp-memory-actions';
   for(const [label,act] of [['编辑','edit'],['保存修改','save'],['删除','delete']]){
    const b=document.createElement('button');b.type='button';b.textContent=label;
    b.dataset.memoryAction=act;b.dataset.memoryId=e.id;if(act==='save')b.hidden=true;actions.append(b);
   }
   d.append(summary,p,input,actions);list.append(d);
  }
 }
 async function saveSettings(){
  if(working)return feedback('记忆总结进行中，请完成后再设置','error');
  const n=ui(),enabled=n.phoneMemoryEnabled.checked,intervalDays=+n.phoneMemoryInterval.value;
  if(![1,3,7].includes(intervalDays))return feedback('请选择 1、3 或 7 天','error');
  try{
   await patch(d=>{
    const old=settings(d);
    d.config={...(d.config||{}),phoneMemory:{enabled,intervalDays,
     injectMainline:n.phoneMemoryInjectMainline.checked}};
    if(enabled&&!old.enabled&&!d.phoneMemory.lastDay)d.phoneMemory.lastDay=day(d.storyTime);
   });
   feedback('记忆设置已保存','success');render();
  }catch(e){feedback('保存失败：'+String(e.message||e),'error');}
 }
 async function summarize(manual=false){
  if(working)return false;
  const c=ctx(),origin=c?.chatMetadata,chatId=c?.chatId,characterId=c?.characterId;
  const d=read(),cfg=settings(d),mem=state(d),now=day(d.storyTime);
  if(!now||(!manual&&!cfg.enabled))return false;
  const start=mem.lastDay||now;
  if(!manual&&diff(start,now)<cfg.intervalDays)return false;
  const {lines,next}=gather(d,mem.cursors);
  if(!lines.length){
   if(manual)feedback('没有新的聊天内容需要总结');
   else try{await patch(d=>{d.phoneMemory.lastDay=now;d.phoneMemory.cursors=next;});}
    catch(e){api.recordError?.('手机记忆时间锚点',e);}
   return false;
  }
  working=true;feedback('正在独立总结手机记忆…','pending');render();
  try{
   const prompt=[
    '总结以下已发生的手机聊天事实，不要扮演角色，不要推进剧情。',
    '禁止替 user 补写心理、动机、言行；未经证实的猜测必须写明未证实。',
    '只保留确认过的事件、关系阶段、约定和待解决问题，不能添加没有发生的事。',
    '故事时间：'+start+' 至 '+now+'。请用简洁中文分别总结各个聊天对象，每个摘要最多500字。',
    '不同聊天对象的私聊绝不能混入其他聊天对象的记忆。每个 thread id 保持原样。',
    '只输出 JSON：{"threads":[{"id":"main或npc:id","summary":"总结"}]}。每个出现的对话对象各一条，没有事实可不总结。',
    ...lines.map(x=>'thread='+x.contactId+'｜'+x.time+'｜'+x.who+'：'+x.text)
   ].join('\n').slice(0,13500);
   const raw=await api.phoneGenerate(c,{task:'memory',maxTokens:2200,responseLength:2200,
    systemPrompt:'只总结已明确写出的剧情事实。',prompt:[{role:'user',content:prompt}]},d);
   if(ctx()?.chatMetadata!==origin||ctx()?.chatId!==chatId||ctx()?.characterId!==characterId)return false;
   const output=api.stripModelReasoning?.(raw)||raw;
   const text=String(typeof output==='string'?output:output?.content||'')
    .replace(/<think>[\s\S]*?<\/think>/gi,'').trim();
   if(text.length<10)throw new Error('API 未返回可用的记忆摘要');
   const byId=new Map();
   for(const line of lines)byId.set(line.contactId,line.contactName);
   let parsed;
   try{
    const json=text.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'');
    parsed=JSON.parse(json);
   }catch{parsed=null;}
   let entries=(Array.isArray(parsed?.threads)?parsed.threads:[])
    .filter(item=>byId.has(item?.id)&&typeof item.summary==='string'&&item.summary.trim().length>8)
    .map(item=>({contactId:item.id,contactName:byId.get(item.id),text:item.summary.trim().slice(0,2200)}));
   if(!entries.length&&byId.size===1){
    const [contactId,contactName]=byId.entries().next().value;
    entries=[{contactId,contactName,text:text.slice(0,2200)}];
   }
   // When a model fails to separate multiple private chats, keep the summary
   // only for manual review; NEVER inject it into a character's context.
   if(!entries.length&&byId.size>1)
    entries=[{contactId:'private-review',contactName:'待人工核对（不注入角色）',text:text.slice(0,2200)}];
   await patch(latest=>{
    const m=latest.phoneMemory;
    m.entries=[...m.entries,...entries.map(entry=>({
     ...entry,id:'pm'+Date.now()+Math.random().toString(36).slice(2,7),
     from:start,to:now,count:lines.filter(l=>l.contactId===entry.contactId).length||lines.length
    }))].slice(-60);
    m.lastDay=now;m.cursors={...m.cursors,...next};
   });
   feedback('已保存 '+lines.length+' 条聊天的记忆总结','success');
   api.recordActivity?.('独立记忆','已总结 '+lines.length+' 条手机聊天','success');
   return true;
  }catch(e){feedback('记忆总结失败：'+String(e.message||e),'error');api.recordError?.('手机记忆',e);return false;}
  finally{working=false;render();}
 }
 async function tick(){
  if(!api.isPhoneOpen?.()||working)return false;
  return summarize(false);
 }
 async function handleClick(e){
  const b=e.target?.closest?.('[data-memory-action]');if(!b)return;
  const action=b.dataset.memoryAction,id=b.dataset.memoryId,card=b.closest('.lp-memory-entry');
  if(action==='edit'){
   card.querySelector('textarea').hidden=false;
   card.querySelector('.lp-memory-text').hidden=true;
   card.querySelector('[data-memory-action="save"]').hidden=false;return;
  }
  if(action==='delete'&&!window.confirm('确定删除这条手机记忆？'))return;
  if(action==='save'&&!card.querySelector('textarea').value.trim())return feedback('记忆不能为空','error');
  try{
   await patch(d=>{
    if(action==='delete')d.phoneMemory.entries=d.phoneMemory.entries.filter(x=>x.id!==id);
    else d.phoneMemory.entries=d.phoneMemory.entries.map(x=>x.id===id
     ?{...x,text:card.querySelector('textarea').value.trim().slice(0,2800)}:x);
   });
   feedback(action==='delete'?'已删除记忆':'记忆修改已保存','success');render();
  }catch(err){feedback('记忆修改失败：'+String(err.message||err),'error');}
 }
 return {settings,state,render,saveSettings,summarize,tick,handleClick};
}
