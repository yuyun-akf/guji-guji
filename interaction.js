/* Shared interaction system for every GujiGuji app. No SillyTavern data is modified here. */
export const MOTION_OPTIONS=new Set(['off','gentle','standard']);

export function createInteractionController({getRoot,getNodes,getMode,onError}){
 let boundRoot=null,pressed=null,toastTimer=null,portal=null;
 const configured=()=>MOTION_OPTIONS.has(getMode?.())?getMode():'standard';
 const mode=()=>{
  try{if(typeof window!=='undefined'&&window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return 'off';}
  catch{}
  return configured();
 };
 function sync(){
  const root=getRoot();if(root)root.dataset.motion=mode();
  const select=getNodes()?.interactionMotion;if(select)select.value=configured();
 }
 function dismiss(){
  if(toastTimer){clearTimeout(toastTimer);toastTimer=null;}
  const el=getNodes()?.interactionFeedback;
  if(el){el.hidden=true;el.textContent='';}
 }
 function toast(message,kind='info'){
  const root=getRoot(),el=getNodes()?.interactionFeedback;
  if(!el||!root?.classList?.contains('lp-open'))return;
  const text=String(message||'').trim().slice(0,115);if(!text)return;
  if(toastTimer){clearTimeout(toastTimer);toastTimer=null;}
  el.hidden=false;el.textContent=text;
  el.dataset.kind=['success','pending','error'].includes(kind)?kind:'info';
  if(kind!=='pending')toastTimer=setTimeout(()=>{
   if(getNodes()?.interactionFeedback===el){el.hidden=true;el.textContent='';}
   toastTimer=null;
  },kind==='error'?3600:2300);
 }
 function fromStatus(message,kind='info'){
  if(!message)return;
  const flavor=kind==='error'?'error':/正在|加载中|保存中|生成中|请求中/.test(message)?'pending':
   /成功|完成|已|保存|恢复/.test(message)?'success':'info';
  toast(message,flavor);
 }
 const target=e=>{
  const el=e.target?.closest?.('button,summary,[role="button"]');
  return el&&getRoot()?.contains?.(el)&&!el.disabled&&
   el.getAttribute?.('aria-disabled')!=='true'?el:null;
 };
 function release(){pressed?.classList?.remove?.('lp-press-down');pressed=null;}
 function bind(root=getRoot()){
  if(!root||root===boundRoot)return;
  boundRoot=root;
  root.addEventListener('pointerdown',e=>{
   if(e.button!==undefined&&e.button!==0)return;
   release();const el=target(e);
   if(el&&mode()!=='off'){pressed=el;el.classList.add('lp-press-down');}
  },true);
  for(const type of ['pointerup','pointercancel','pointerleave'])
   root.addEventListener(type,release,true);
  root.addEventListener('pointermove',e=>{if(e.buttons===0)release();},true);
  root.addEventListener('keydown',e=>{
   if(e.key!=='Enter'&&e.key!==' ')return;
   const el=target(e);
   if(el&&mode()!=='off'){release();pressed=el;el.classList.add('lp-press-down');}
  },true);
  root.addEventListener('keyup',release,true);
  root.addEventListener('click',e=>{
   const el=target(e);release();
   if(!el||mode()==='off')return;
   el.classList.remove('lp-press-bounce');
   // Force the CSS keyframe to replay on repeated taps.
   void el.offsetWidth;
   el.classList.add('lp-press-bounce');
   setTimeout(()=>el.classList?.remove?.('lp-press-bounce'),mode()==='gentle'?165:240);
  },true);
  sync();
 }
 function capture(tile){
  const icon=tile?.querySelector?.('.lp-desktop-app-icon');
  const rect=icon?.getBoundingClientRect?.();
  return rect?.width>=12&&rect?.height>=12?{rect,icon:icon.cloneNode(true)}:null;
 }
 function stopPortal(){
  if(!portal)return;
  const current=portal;portal=null;
  if(current.timer)clearTimeout(current.timer);
  try{current.animation?.cancel?.();}catch{}
  current.element?.remove?.();
  if(current.section?.style)current.section.style.opacity='';
  current.dialog?.classList?.remove?.('lp-portal-running');
 }
 function transition(origin,direction,screen){
  const root=getRoot();if(mode()==='off'||!origin||!root)return false;
  const dialog=root.querySelector?.('.lp-panel'),rect=dialog?.getBoundingClientRect?.();
  if(!rect?.width||!rect?.height||typeof dialog.animate!=='function')return false;
  const x=origin.rect.left-rect.left,y=origin.rect.top-rect.top;
  if(!Number.isFinite(x)||!Number.isFinite(y))return false;
  stopPortal();
  const el=document.createElement('div');el.className='lp-app-portal';
  el.setAttribute('aria-hidden','true');
  if(origin.icon){origin.icon.classList?.add?.('lp-app-portal-icon');el.append(origin.icon);}
  dialog.append(el);
  const section=direction==='open'?root.querySelector?.('[data-lp-screen="'+screen+'"]'):null;
  const ms=mode()==='gentle'?200:310;
  const small={left:Math.max(0,x)+'px',top:Math.max(0,y)+'px',
   width:origin.rect.width+'px',height:origin.rect.height+'px',borderRadius:'14px',opacity:1};
  const large={left:'0px',top:'0px',width:rect.width+'px',
   height:rect.height+'px',borderRadius:'22px',opacity:1};
  if(section?.style)section.style.opacity='0';
  dialog.classList?.add?.('lp-portal-running');
  let animation;
  try{animation=el.animate(direction==='open'
   ?[small,{...large,offset:.72},{...large,opacity:0,offset:1}]
   :[large,{...large,offset:.25},small],
   {duration:ms,easing:'cubic-bezier(.22,.72,.18,1)',fill:'forwards'});}
  catch(err){
   el.remove();if(section?.style)section.style.opacity='';
   dialog.classList.remove('lp-portal-running');
   onError?.('页面展开动画',err);return false;
  }
  const current={element:el,animation,section,dialog,timer:null};portal=current;
  if(section?.style)current.timer=setTimeout(()=>{
   if(portal===current)section.style.opacity='';
  },Math.round(ms*.7));
  const finish=()=>{
   if(portal!==current)return;
   portal=null;if(current.timer)clearTimeout(current.timer);
   el.remove();if(section?.style)section.style.opacity='';
   dialog.classList.remove('lp-portal-running');
  };
  animation.onfinish=finish;animation.oncancel=finish;
  return true;
 }
 function subScreen(screen){
  if(mode()==='off')return;
  const node=getRoot()?.querySelector?.('[data-lp-screen="'+screen+'"]');
  try{node?.animate?.([{opacity:0,transform:'translateY(9px)'},{opacity:1,transform:'translateY(0)'}],
   {duration:mode()==='gentle'?135:190,easing:'ease-out'});}catch{}
 }
 function navigate({previous,screen,origin}){
  if(previous===screen||screen==='lock'||previous==='lock')return;
  if(previous==='home'&&origin){if(transition(origin,'open',screen))return;}
  if(screen==='home'){
   const tile=getRoot()?.querySelector?.('.lp-home button[data-lp-open="'+previous+'"]');
   if(transition(capture(tile),'close',previous))return;
  }
  subScreen(screen);
 }
 function shutdown(){release();stopPortal();dismiss();boundRoot=null;}
 return {bind,sync,toast,fromStatus,capture,navigate,shutdown,mode};
}
