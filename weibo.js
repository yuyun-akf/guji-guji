/* 群星 · character-card accounts + per-story persistent generated feeds and interactions. */
export function createWeiboModule(api) {
 const state={scope:'',tab:'home',detail:'',topic:null,subview:'',posts:{home:[],nearby:[]},trends:[],nearbyTrends:[],loading:false,hotLoading:false,attempted:{},token:0,sessionId:0,headline:'',hotBundles:{},queuedNearby:false,confirming:false,editing:'',avatarDraft:'',avatarOwnerDraft:'',candidates:[],scanLoading:false,scanMessage:''};
 let writes=Promise.resolve(), autoBusy=false,closeHotConfirmation=null;
 const context=()=>api.context(), nodes=()=>api.getNodes(), root=()=>api.readRootData(context());
 const uid=(prefix='qx')=>prefix+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
 const scope=()=>[context()?.characterId,context()?.chatId,context()?.groupId].join(':');
 const el=(tag,cls='',value='')=>{const x=document.createElement(tag);if(cls)x.className=cls;if(value)x.textContent=value;return x;};
 const defaults={autoEnabled:false,autoEveryMinutes:180,nearbyHint:''};
 const clean=(s,n=100)=>String(s||'').trim().slice(0,n);
 // Persist integer followers only; the chosen unit only affects entry/display.
 const FOLLOWER_FACTORS={person:1,wan:10000,yi:100000000};
 const followerParts=count=>{
  const total=Math.max(0,Math.floor(Number(count)||0));
  if(total>=100000000)return {value:String(total/100000000),unit:'yi'};
  if(total>=10000)return {value:String(total/10000),unit:'wan'};
  return {value:String(total),unit:'person'};
 };
 const formatFollowers=count=>{
  const total=Math.max(0,Math.floor(Number(count)||0));
  if(total>=100000000)return (total/100000000).toLocaleString('zh-CN',{maximumFractionDigits:2})+'亿';
  if(total>=10000)return (total/10000).toLocaleString('zh-CN',{maximumFractionDigits:2})+'万';
  return total.toLocaleString('zh-CN');
 };
 const parseFollowerValue=(amount,unit='person')=>{
  const input=String(amount??'').trim();
  if(!/^\d+(?:\.\d+)?$/.test(input))throw Error('请输入有效的粉丝数量（非负数字，可带小数）');
  const factor=FOLLOWER_FACTORS[unit];
  if(!factor)throw Error('粉丝数量单位无效');
  const total=Math.round(Number(input)*factor);
  if(!Number.isSafeInteger(total)||total<0)throw Error('粉丝数量超出允许范围');
  return total;
 };
 const readFollowerField=(wrap,name)=>{
  const input=wrap?.querySelector('[data-wb-field="'+name+'"]');
  const unit=wrap?.querySelector('[data-wb-field="'+name+'Unit"]');
  return parseFollowerValue(input?.value,unit?.value||'person');
 };
 // Bind accounts to a named person across story saves or an independent organization.
 const subjectChoices=(extraNames=[])=>{
  const people=Array.isArray(api.accountSubjects?.())?api.accountSubjects():[];
  const primary=people.find(p=>p?.id==='primary')||{name:api.selectedCharacter?.(context())?.name||'当前主角色'};
  const result=[{value:'primary',type:'primary',name:primary.name,label:primary.name+'（主角色）'}];
  const seen=new Set([String(primary.name).trim().toLocaleLowerCase()]);
  for(const person of [...people.filter(p=>p.id!=='primary'),...extraNames.map(name=>({name}))]){
   const name=clean(person?.name,65),key=name.toLocaleLowerCase();
   if(!name||seen.has(key))continue;
   seen.add(key);result.push({value:'npc:'+encodeURIComponent(name),type:'npc',name,label:name+'（NPC）'});
  }
  result.push({value:'organization',type:'organization',name:'',label:'独立组织账号（媒体／表白墙／后援会等）'});
  return result;
 };
 const subjectOfAccount=account=>{
  const given=account?.subject;
  if(given&&['primary','npc','organization'].includes(given.type)){
   if(given.type==='primary')return {type:'primary',name:subjectChoices()[0].name};
   if(given.type==='organization')return {type:'organization',name:''};
   if(clean(given.name,65))return {type:'npc',name:clean(given.name,65)};
  }
  const name=clean(account?.name,65),kind=clean(account?.kind,40);
  if(name&&name===subjectChoices()[0].name)return {type:'primary',name};
  if(/^(?:媒体|粉丝|官方|组织|校园组织|机构|企业|品牌|后援会|公众账号)$/.test(kind)
      ||/官方号|后援会|表白墙|广播站|资讯号|日报/.test(name))return {type:'organization',name:''};
  return {type:'npc',name};
 };
 const subjectValue=subject=>subject?.type==='primary'?'primary':subject?.type==='organization'?'organization':'npc:'+encodeURIComponent(subject?.name||'');
 const readSubject=(raw,options)=>{
  const found=options.find(x=>x.value===raw);
  if(!found)throw Error('请选择有效的故事人物或独立组织账号');
  return {type:found.type,name:found.type==='organization'?'':found.name};
 };
 const savedProfession=account=>{
  if(typeof account?.profession==='string')return clean(account.profession,80);
  const kind=clean(account?.kind,40);
  return ['角色','NPC','人物','媒体','粉丝','组织','网友'].includes(kind)?'':kind;
 };
 const publicAccountDescription=account=>[savedProfession(account),clean(account?.bio,130)].filter(Boolean).join('；');
 const data=()=>{
  const r=root(),q=r.qunxing||{};
  // NPC/character identities are shared across chats of this character card.
  // Random followed users remain local to each story chat.
  const ownAccounts=Array.isArray(q.accounts)?q.accounts:[];
  const shared=api.readSharedAccounts?.();
  const accounts=Array.isArray(shared)
   ?[...ownAccounts.filter(a=>a?.source!=='manual'),...shared]
   :ownAccounts;
  return {profile:{nickname:api.currentPersona(context())?.name||context()?.name1||'我',handle:'',bio:'',avatar:'',followers:0,...q.profile},
   accounts,generated:q.generated&&typeof q.generated==='object'?q.generated:{},
   following:Array.isArray(q.following)?q.following:[],
   posts:Array.isArray(q.posts)?q.posts:[],topicDetails:q.topicDetails&&typeof q.topicDetails==='object'?q.topicDetails:{},
   trends:Array.isArray(q.trends)?q.trends:[],nearbyTrends:Array.isArray(q.nearbyTrends)?q.nearbyTrends:[],
   settings:{...defaults,...q.settings},lastAutoStoryMinute:Number(q.lastAutoStoryMinute)||0};
 };
 async function mutate(change){
  const c=context(),metadata=c?.chatMetadata;
  const task=writes.then(async()=>{
   if(context()?.chatMetadata!==metadata)throw Error('故事存档已切换，已取消旧存档写入');
   const r=structuredClone(api.readRootData(c)),q=data();
   const oldManual=q.accounts.filter(a=>a?.source==='manual');
   const result=change(q,r);
   r.qunxing=q;
   await api.writeData(c,{...r,__contactId:'primary'});
   const newManual=q.accounts.filter(a=>a?.source==='manual');
   if(JSON.stringify(oldManual)!==JSON.stringify(newManual))
    await api.saveSharedAccounts?.(newManual,c);
   return result;
  });
  writes=task.catch(()=>{});
  return task;
 }
 const feedback=s=>{
   if(nodes()?.weiboFeedback)nodes().weiboFeedback.textContent=s;
   if(s){
    const kind=/失败|出错|错误|无效/.test(s)?'error':
     /正在|加载中|生成中|刷新中|读取中/.test(s)?'pending':
     /已|成功|完成|保存|清空|更新/.test(s)?'success':'info';
    api.notifyInteraction?.(s,kind);
   }
  };
 function reset(){
  const next=scope();if(next===state.scope)return;
  closeHotConfirmation?.(false);
  // Migrate existing manual accounts from the current chat once per character.
  // An explicitly saved empty role directory means previously deleted accounts
  // must not be resurrected by an older story chat.
  api.ensureSharedAccounts?.();
  state.scope=next;state.tab='home';state.detail='';state.topic=null;state.subview='';
  state.candidates=[];state.scanMessage='';state.scanLoading=false;
  const stored=data().generated;
  const feeds=stored?.feeds||{};
  state.posts={
   home:Array.isArray(feeds.home)?feeds.home.slice(0,10):[],
   nearby:Array.isArray(feeds.nearby)?feeds.nearby.slice(0,12):[]
  };
  state.trends=Array.isArray(stored.trends)?stored.trends.slice(0,15):[];
  state.nearbyTrends=[];
  state.hotBundles=stored.hotBundles&&typeof stored.hotBundles==='object'?stored.hotBundles:{};
  state.headline=clean(stored.headline,60);
  state.attempted={
   world:stored.attempted?.world===true||state.posts.home.length>0,
   nearby:stored.attempted?.nearby===true||state.posts.nearby.length>0,
   hot:stored.attempted?.hot===true||state.trends.length>0
  };
  state.loading=false;state.hotLoading=false;state.queuedNearby=false;
  state.token++;state.sessionId++;
 }
 function endPhoneSession(){
  // Closing the virtual phone must NEVER erase generated posts or hot topics.
  // In-flight requests are allowed to finish and save to the same story chat.
  closeHotConfirmation?.(false);
  state.detail='';state.topic=null;state.subview='';state.tab='home';
 }
 async function persistGenerated(kind,extra={}){
  const session=scope();
  const posts=kind==='home'||kind==='nearby'
   ?structuredClone(state.posts[kind]):null;
  const trends=kind==='hot'?structuredClone(state.trends):null;
  const hotBundles=kind==='hot'?structuredClone(state.hotBundles):null;
  const attempted=state.attempted[kind==='home'?'world':kind];
  const headlineText=state.headline;
  return mutate(q=>{
   if(scope()!==session)throw Error('故事存档已切换，取消保存旧动态');
   const previous=q.generated&&typeof q.generated==='object'?q.generated:{};
   const feeds={...(previous.feeds||{})};
   if(posts!==null)feeds[kind]=posts;
   const revisions={...(previous.revisions||{})};
   revisions[kind]=Math.max(Date.now(),...Object.values(revisions).map(x=>(Number(x)||0)+1));
   q.generated={
    ...previous,feeds,
    ...(trends!==null?{trends,hotBundles}:{}),
    headline:headlineText||previous.headline||'',
    headlineRevision:extra.hotHeadline?revisions[kind]:(Number(previous.headlineRevision)||0),
    revisions,
    attempted:{...(previous.attempted||{}),[kind==='home'?'world':kind]:attempted===true}
   };
   if(extra.hotHeadline)q.hotHeadline=extra.hotHeadline;
  });
 }
 function headline(){
  reset();
  return state.trends[0]?.title||state.headline||root()?.qunxing?.hotHeadline||data().trends?.[0]?.title||'今天有什么新鲜事';
 }
 function updateHomeHeadline(){
  api.updateHomeHotSearch?.();
 }
 const actionState=p=>data().posts.find(x=>x.id===p.id)?.actions||p.actions||{};
 const actor=p=>data().accounts.find(a=>(p.authorId&&a.id===p.authorId)||(p.author&&a.name===p.author)||(p.handle&&a.handle===p.handle));
 function allPosts(){
  const q=data();
  const legacy=(Array.isArray(root().weiboSaved)?root().weiboSaved:[]).filter(p=>p?.id).map(p=>({...p,zone:p.zone||'world'}));
  const generatedHot=Object.values(state.hotBundles).flatMap(t=>t.posts||[]);
  const combined=[...q.posts,...legacy,...state.posts.home,...state.posts.nearby,...generatedHot,...(state.topic?.posts||[])],seen=new Set();
  return combined.filter(p=>p?.id&&!seen.has(p.id)&&seen.add(p.id));
 }
 function byId(id){return allPosts().find(p=>p.id===id);}
 const isSaved=a=>Boolean(a?.liked||a?.favorited||a?.reposted||a?.owned||(a?.comments||[]).length);
 function parse(raw){
  const s=api.stripModelReasoning(typeof raw==='string'?raw:String(raw?.content||'')).trim();
  const i=s.indexOf('{'),j=s.lastIndexOf('}');
  if(i<0||j<=i)throw Error('模型没有返回有效 JSON');
  try{return JSON.parse(s.slice(i,j+1));}catch{throw Error('生成的 JSON 不完整');}
 }
 function normalize(p,zone){
  if(!p||typeof p!=='object')return null;
  const author=clean(p.author||p.name,42),text=clean(p.text||p.content,1100);
  if(!author||!text)return null;
  const handle=clean(p.handle,50);
  const acct=data().accounts.find(a=>a.name===author||(handle&&a.handle===handle));
  const comments=(Array.isArray(p.comments)?p.comments:[]).map(c=>
   typeof c==='string'
    ?{id:uid('c'),name:'网友',text:clean(c,350)}
    :{id:uid('c'),name:clean(c?.name||c?.author||'网友',40),text:clean(c?.text||c?.content,350)}
  ).filter(c=>c.text).slice(0,12);
  return {id:uid('post'),author,handle:acct?.handle||handle,authorId:acct?.id||'',avatar:acct?.avatar||'',category:clean(p.category||'日常',24),
   text,comments,likes:Math.max(0,Math.min(9999999,Number(p.likes)||0)),zone,time:root().storyTime||'',actions:{}};
 }
 function prompt(count,zone,topic='',withTrend=false){
  const q=data(),r=root(),char=api.selectedCharacter(context()),nearby=zone==='nearby';
  const accounts=q.accounts.slice(0,25).map(a=>a.name+'（@'+(a.handle||a.id)+'；'+publicAccountDescription(a)+'）').join('、');
  const followed=q.accounts.filter(a=>q.following.includes(a.id)).map(a=>a.name).join('、');
  const known=(r.contacts||[]).slice(0,18).map(a=>a.name+'：'+clean(a.description,80)).join('；');
  const contextText=clean(api.storyContext?.()||'',2100);
  return [
   '你正在生成完全虚构的剧情世界社交平台「群星」内容。故事日期：'+(r.storyTime||'未设定')+'。',
   '范围：'+(nearby?'周边：学校、公司、剧组、社团、邻里与其他身边人的公开动态':'世界：新闻、社会、影视、生活、时尚、体育、游戏、科技、音乐等公共动态')+'。',
   '主角：'+(char?.name||'未选择')+'；角色简介：'+clean(char?.description,750)+'；已知人物：'+known+'。',
   '已建立的公众/普通账号：'+(accounts||'暂无')+'；用户关注：'+(followed||'暂无')+'；周边补充设定：'+clean(q.settings.nearbyHint,210)+'。',
   '近期剧情：'+contextText+'。必须区分已公开事实与私聊秘密；绝不杜撰用户言行、心理、地下恋情、未发生事件。',
   '允许陌生网友完全讨论无关主题，勿全围绕角色。公众人物可以合理上热搜，但不要每条都写成公共事件。',
   '营造真实复杂的互联网：多数网友正常且观点各异，偶尔可以有0至1个理直气壮、反常识到令人怀疑的“神人”发言，让其他网友有自然吐槽或反驳；题材随机覆盖职场、学习、生活、饭圈、科技、性别刻板印象等，不要总围绕男女关系，也不要把偏激观点当事实。',
   '每条帖子配2至5条不同语气的评论，允许争论与冷幽默、网络流行语，但不要每条都是段子。',
   nearby?'周边内容应体现身边普通人的真实生活；没有明确地点不要编造具体城市、校园或住址。':'全球动态有大小事之分，不要人人都在热榜。',
   topic?'帖子主题：'+topic:'',
   '只输出合法紧凑 JSON：{"posts":[{"author":"作者昵称","handle":"@账号","category":"类别","text":"正文","likes":32,"comments":[{"name":"评论昵称","text":"内容"}]}],"headline":"本轮公开热议话题"}。',
   '生成'+count+'条相互独立、有作者、正文和评论的帖子。headline仅是一个简短话题标题，用于小手机桌面入口，不要返回整张热榜。不要markdown、不要思维过程。'
  ].filter(Boolean).join('\n');
 }
 function hotPrompt(){
  const q=data(),r=root(),char=api.selectedCharacter(context());
  return [
   '为完全虚构的剧情社交平台「群星」一次性生成完整世界热搜榜。剧情时间：'+(r.storyTime||'未设置')+'。',
   '主角：'+(char?.name||'未选择')+'；角色公开身份：'+clean(char?.description,650)+'。',
   '故事已知人物：'+(r.contacts||[]).slice(0,15).map(p=>p.name+'：'+clean(p.description,65)).join('、')+'。',
   '已有公众账号：'+q.accounts.slice(0,20).map(a=>a.name+'：'+clean(a.bio,60)).join('、')+'。近期剧情：'+clean(api.storyContext?.()||'',1400)+'。',
   '所有话题和帖子都是故事中的公开内容，严禁曝光私聊、未公开身份、用户内心或虚构尚未发生的事件；普通人不可无缘无故成为全国热点。',
   '热榜15条内容需分布在社会、影视、生活、搞笑、教育、科技、时尚、体育、游戏、音乐、娱乐等领域，不要15条都围绕主角。',
   '每条热搜都必须同时给出标题、摘要、至少1篇完整帖子以及对应2至3条不同立场的评论；允许部分热搜有2篇帖子，但请优先确保15条齐全。',
   '偶尔最多1条热搜或评论可以出现离谱却很自信的“神人”观点，其他网友可以反驳或吐槽；不能每条都刻意降智，不局限于性别话题。',
   '只能调用这一次生成完成热榜与其讨论内容，点击具体话题时不允许还需要额外生成。',
   '请仅输出JSON，不要markdown：{"topics":[{"title":"热搜短标题","category":"分类","summary":"一两句背景","posts":[{"author":"网友昵称","handle":"@账号","category":"分类","text":"完整帖子","likes":99,"comments":[{"name":"网友","text":"评论"}]}]}]}。',
   '精确生成15个topics，标题互不重复，每个topic的posts必须非空。尽量紧凑。'
  ].join('\n');
 }
 async function generate(zone='home',topic=''){
  reset();
  if(zone==='hot')return generateHot();
  if(state.loading){
   if(zone==='nearby')state.queuedNearby=true;
   return;
  }
  if(!api.selectedCharacter(context())){feedback('请先选择故事角色');return;}
  const nearby=zone==='nearby',name=nearby?'周边':'世界';
  const session=scope(),sessionId=state.sessionId,token=++state.token;
  state.loading=true;state.attempted[nearby?'nearby':'world']=true;
  // Manual refresh replaces the selected feed immediately, before requesting
  // new posts. Original posts and interaction records are never erased here.
  state.posts[nearby?'nearby':'home']=[];
  feedback('正在刷新'+name+'帖子…');render();
  const all=[];let headlineCandidate='';
  try{
   await persistGenerated(nearby?'nearby':'home');
   if(session!==scope()||sessionId!==state.sessionId||token!==state.token)return;
   // Home feed remains a two-batch request. Nearby uses exactly ONE API call.
   for(let batch=0;batch<(nearby?1:2);batch++){
    let response;
    try{
     response=await api.phoneGenerate(context(),{
      systemPrompt:'你是虚构社交平台的帖子生成器；只返回合法JSON。',
      maxTokens:nearby?4000:2000,maxLength:nearby?4000:2000,responseLength:nearby?4000:2000,
      prompt:[{role:'user',content:prompt(nearby?12:5,zone,topic,false)}]
     },api.readData(context()));
    }catch(e){
     if(!all.length)throw e;
     api.recordError?.('群星部分刷新',e);break;
    }
    if(session!==scope()||sessionId!==state.sessionId||token!==state.token)return;
    const parsed=parse(response);
    all.push(...(Array.isArray(parsed.posts)?parsed.posts:[])
      .map(post=>normalize(post,nearby?'nearby':'world')).filter(Boolean)
      .slice(0,nearby?12:5));
    if(!nearby&&!headlineCandidate){
     headlineCandidate=clean(parsed.headline||parsed.trending?.[0]?.title||'',60);
    }
   }
   if(all.length<3)throw Error('本次有效帖子不足，请点击刷新重试');
   state.posts[nearby?'nearby':'home']=all.slice(0,nearby?12:10);
   if(headlineCandidate)state.headline=headlineCandidate;
   await persistGenerated(nearby?'nearby':'home',
    headlineCandidate?{hotHeadline:headlineCandidate}:{});
   if(headlineCandidate)updateHomeHeadline();
   feedback('已更新 '+all.length+' 条'+name+'动态');
   api.recordActivity?.('群星刷新',name+'：'+all.length+' 条','success');
  }catch(e){
   feedback('刷新失败：'+String(e.message||e));api.recordError?.('群星生成',e);
  }finally{
   if(token===state.token&&sessionId===state.sessionId){
    state.loading=false;render();
    if(state.queuedNearby){
     state.queuedNearby=false;state.attempted.nearby=false;
     if(!state.posts.nearby.length&&state.tab==='nearby')void generate('nearby');
    }
   }
  }
 }
 async function generateHot(){
  reset();if(state.hotLoading)return;
  if(!api.selectedCharacter(context())){feedback('请先选择故事角色');return;}
  const session=scope(),sessionId=state.sessionId;
  state.hotLoading=true;state.attempted.hot=true;
  // Explicit refresh replaces this list rather than appending a second set.
  state.trends=[];state.hotBundles={};state.topic=null;
  feedback('正在生成15条热搜及对应讨论…');render();
  try{
   await persistGenerated('hot');
   if(session!==scope()||sessionId!==state.sessionId)return;
   // ONE model invocation generates both the topics and their actual conversations.
   const response=await api.phoneGenerate(context(),{
    systemPrompt:'只返回紧凑且合法的JSON，不输出推理。',
    maxTokens:10000,maxLength:10000,responseLength:10000,
    prompt:[{role:'user',content:hotPrompt()}]
   },api.readData(context()));
   if(session!==scope()||sessionId!==state.sessionId)return;
   const parsed=parse(response);
   const source=Array.isArray(parsed.topics)?parsed.topics:[];
   const topics=[],bundles={};
   for(const row of source.slice(0,15)){
    const title=clean(row?.title,65);if(!title||topics.some(t=>t.title===title))continue;
    const posts=(Array.isArray(row.posts)?row.posts:[])
     .map(post=>normalize(post,'world')).filter(Boolean).slice(0,3);
    if(!posts.length||!posts.some(p=>p.comments.length))continue;
    const category=clean(row.category||'热议',22),summary=clean(row.summary,350);
    topics.push({title,category,summary,preview:clean(posts[0].text,90),postCount:posts.length});
    bundles[topicKey('home',title)]={title,zone:'home',summary,posts};
   }
   if(session!==scope()||sessionId!==state.sessionId)return;
   if(!topics.length)throw Error('热搜生成没有返回可用的帖子与评论');
   state.trends=topics;state.hotBundles=bundles;
   state.headline=topics[0].title;
   await persistGenerated('hot',{hotHeadline:topics[0].title});
   updateHomeHeadline();
   feedback('已生成 '+topics.length+'/15 条热搜及对应讨论'+(topics.length<15?'；模型返回不足15条，可手动重试':''));
   api.recordActivity?.('群星热搜','生成 '+topics.length+' 条热搜及对应帖子','success');
  }catch(error){
   feedback('热搜生成失败：'+String(error.message||error));
   api.recordError?.('群星热搜',error);
  }finally{
   if(sessionId===state.sessionId){state.hotLoading=false;render();}
  }
 }
 const topicKey=(zone,title)=>JSON.stringify([zone,title]);
 async function openTopic(title,zone='home'){
  reset();
  const item=state.hotBundles[topicKey(zone,title)];
  state.detail='';
  state.topic=item
   ?{...item,key:topicKey(zone,title),loading:false,error:''}
   :{title,zone,key:topicKey(zone,title),summary:'',posts:[],loading:false,
     error:'本轮热榜未包含这个话题的帖子，请返回热搜列表刷新。'};
  render();
 }
 async function confirmHotSearch(){
  if(state.trends.length||state.hotLoading)return true;
  if(state.confirming)return false;
  const parent=nodes()?.weiboHot?.closest?.('.lp-panel')||
   nodes()?.weiboFeed?.closest?.('.lp-panel');
  if(!parent||typeof document?.createElement!=='function'){
   return typeof window!=='undefined'&&typeof window.confirm==='function'
    ?window.confirm('查看群星热搜？将调用一次模型生成15条热搜及对应帖子、评论。'):true;
  }
  state.confirming=true;
  return new Promise(resolve=>{
   const mask=el('div','lp-wb-confirm-overlay');
   mask.setAttribute('role','presentation');
   const dialog=el('div','lp-wb-confirm-dialog');
   dialog.setAttribute('role','dialog');
   dialog.setAttribute('aria-modal','true');
   dialog.setAttribute('aria-label','查看群星热搜');
   const title=el('strong','','查看群星热搜？');
   const desc=el('p','','将调用一次 API，生成15条热搜词条及其帖子、评论。仅在你确认后请求。');
   const actions=el('div','lp-wb-confirm-actions');
   const cancel=el('button','','取消'),accept=el('button','lp-wb-confirm-yes','查看热搜');
   cancel.type='button';accept.type='button';
   let closed=false;
   const finish=ok=>{
    if(closed)return;closed=true;state.confirming=false;
    closeHotConfirmation=null;mask.remove();resolve(ok);
   };
   closeHotConfirmation=finish;
   cancel.addEventListener('click',()=>finish(false));
   accept.addEventListener('click',()=>finish(true));
   mask.addEventListener('click',event=>{if(event.target===mask)finish(false);});
   mask.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();finish(false);}
   });
   actions.append(cancel,accept);dialog.append(title,desc,actions);mask.append(dialog);
   parent.append(mask);accept.focus?.();
  });
 }
 function control(label,act,id='',active=false){
  const b=el('button','lp-wb-action'+(active?' active':''),label);
  b.type='button';b.dataset.wbAction=act;b.dataset.wbPost=id;return b;
 }
 function avatar(src,name){
  const wrap=el('span','lp-wb-avatar');
  if(typeof src==='string'&&(/^(https:\/\/|data:image\/(?:png|jpeg|webp);base64,)/.test(src))){const img=document.createElement('img');img.src=src;img.alt='';wrap.append(img);}
  else wrap.textContent=clean(name,1)||'☆';
  return wrap;
 }
 function card(p,detailed=false){
  const box=el('article','lp-wb-card');
  const acct=actor(p),top=el('div','lp-wb-head'),author=el('div','lp-wb-author');
  author.append(el('strong','',p.author),el('small','',((acct?.handle||p.handle)||'@群星用户')+' · '+(p.category||'日常')));
  top.append(avatar(acct?.avatar||p.avatar,p.author),author);
  const q=data(),stableId=acct?.id||p.authorId;
  if(!p.actions?.owned&&!q.following.includes(stableId)){
   const follow=control('＋ 关注','follow',p.id);follow.classList.add('lp-wb-follow');top.append(follow);
  }else if(q.following.includes(stableId)){top.append(control('已关注','unfollow',p.id,true));}
  box.append(top,el('p','lp-wb-text',p.text));
   if(typeof p.image==='string'&&/^data:image\/(?:jpeg|png|webp);base64,/.test(p.image)){
    const photo=el('img','lp-wb-post-image');photo.src=p.image;photo.alt='群星动态照片';photo.loading='lazy';box.append(photo);
   }
  const comments=el('div','lp-wb-comments');
  for(const c of (detailed?(p.comments||[]):(p.comments||[]).slice(0,3))){
   const line=el('p');line.append(el('b','',c.name+'：'),document.createTextNode(c.text));
   comments.append(line);
  }
  if(comments.childNodes.length)box.append(comments);
  const a=actionState(p),actions=el('div','lp-wb-actions');
  actions.append(control('♡ '+((p.likes||0)+(a.liked?1:0)),'like',p.id,a.liked),
   control('评论','detail',p.id),control('转发','repost',p.id,a.reposted),control('分享','share',p.id),control('收藏','favorite',p.id,a.favorited));
  box.append(actions);
  if(!detailed)box.append(control('查看详情','detail',p.id));
  return box;
 }
 function heading(title,subtitle=''){const d=el('div','lp-wb-section-heading');d.append(el('strong','',title));if(subtitle)d.append(el('small','',subtitle));return d;}
 function trendList(parent,list,zone){
  if(!list.length){parent.append(el('p','lp-wb-empty','刷新后显示热门话题'));return;}
  list.forEach((t,i)=>{
   const b=el('button','lp-wb-hot-item');b.type='button';b.dataset.wbTopic=t.title;b.dataset.wbZone=zone;
   b.append(el('strong','',String(i+1)),el('span','',t.title),el('small','',t.category||''));
   if(t.preview)b.append(el('p','lp-wb-hot-preview',t.preview));
   parent.append(b);
  });
 }

 function renderMine(n){
  const q=data(),wrap=n.weiboMe;wrap.replaceChildren();
  const names={mine:'我的动态',interactions:'我的互动',following:'关注列表',profile:'个人资料',settings:'群星设置'};
  if(!state.subview){
   const profile=el('div','lp-wb-profile');
   profile.append(avatar(q.profile.avatar,q.profile.nickname));
   const txt=el('div');txt.append(el('strong','',q.profile.nickname),
    el('small','',q.profile.handle||'尚未设置群星 ID'),
    el('small','',q.profile.bio||'点击个人资料修改账号信息'));
   profile.append(txt);wrap.append(profile);
   wrap.append(el('div','lp-wb-stats','粉丝 '+formatFollowers(q.profile.followers)+'　·　关注 '+q.following.length+
    '　·　动态 '+q.posts.filter(p=>p.actions?.owned).length));
   const menu=el('div','lp-wb-me-menu');
   for(const [key,label] of Object.entries(names)){
    const item=control(label,'subview',key);
    item.append(el('span','lp-wb-menu-arrow','›'));menu.append(item);
   }
   wrap.append(menu);return;
  }
  // Fixed phone title replaces the scrolling subpage heading.
  if(state.subview==='settings')renderSettings(wrap,q);
  else if(state.subview==='profile')renderProfile(wrap,q);
  else if(state.subview==='following'){
   wrap.append(heading('关注列表','取消关注不删除已经保存的账号资料'));
   const list=q.accounts.filter(a=>q.following.includes(a.id));
   for(const a of list){
    const line=el('div','lp-wb-account-line');
    line.append(avatar(a.avatar,a.name),el('span','',a.name+' '+(a.handle||'')),
      control('取消关注','unfollowAccount',a.id));wrap.append(line);
   }
   if(!list.length)wrap.append(el('p','lp-wb-empty','还没有关注任何账号'));
  }else{
   const arr=state.subview==='interactions'?allPosts().filter(p=>isSaved(actionState(p))&&!p.repostOf):
    q.posts.filter(p=>p.actions?.owned);
   if(state.subview==='interactions'&&arr.length)
    wrap.append(control('清空我的互动记录','clearInteractions'));
   for(const p of arr.slice().reverse())wrap.append(card(p,false));
   if(!arr.length)wrap.append(el('p','lp-wb-empty','暂无内容'));
  }
 }

 function subjectField(parent,label,name,account,extraNames=[]){
  const options=subjectChoices(extraNames),bound=subjectOfAccount(account),wanted=subjectValue(bound);
  if(!options.some(x=>x.value===wanted)&&bound.type==='npc'&&bound.name)
   options.splice(options.length-1,0,{value:wanted,type:'npc',name:bound.name,label:bound.name+'（已保存的人物）'});
  const row=el('label','lp-wb-field');row.append(el('span','',label));
  const select=document.createElement('select');select.dataset.wbField=name;
  for(const item of options){const option=document.createElement('option');option.value=item.value;option.textContent=item.label;select.append(option);}
  select.value=options.some(x=>x.value===wanted)?wanted:'primary';
  row.append(select);parent.append(row);return select;
 }
 const field=(parent,label,name,value='',type='text')=>{
  const row=el('label','lp-wb-field');row.append(el('span','',label));
  const input=document.createElement('input');input.type=type;input.dataset.wbField=name;
  if(type==='checkbox')input.checked=Boolean(value);else input.value=String(value??'');
  row.append(input);parent.append(row);return input;
 };

 function followerField(parent,label,name,count){
   const parts=followerParts(count);
   const row=el('div','lp-wb-field');row.append(el('span','',label));
   const controls=el('div','lp-wb-follower-input');
   const input=document.createElement('input');
   input.type='number';input.min='0';input.step='any';input.inputMode='decimal';
   input.value=parts.value;input.dataset.wbField=name;
   input.setAttribute('aria-label',label);
   const unit=document.createElement('select');
   unit.dataset.wbField=name+'Unit';unit.setAttribute('aria-label','粉丝数单位');
   for(const [value,display] of [['person','人'],['wan','万'],['yi','亿']]){
    const option=document.createElement('option');option.value=value;option.textContent=display;
    unit.append(option);
   }
   unit.value=parts.unit;
   controls.append(input,unit);row.append(controls);parent.append(row);
   return input;
 }
 function avatarPicker(parent,label,name,src='',initial=''){
  const row=el('label','lp-wb-avatar-picker');
  row.append(el('span','lp-wb-avatar-picker-title',label));
  const view=el('div','lp-wb-avatar-picker-view');
  const preview=avatar(src,initial||label);
  preview.dataset.wbAvatarPreview=name;view.append(preview);
  view.append(el('span','lp-wb-avatar-picker-hint','点击选择相册图片 · 可预览后保存'));
  row.append(view);
  const input=document.createElement('input');
  input.type='file';input.accept='image/png,image/jpeg,image/webp';
  input.dataset.wbField=name;input.setAttribute('aria-label',label);
  row.append(input);parent.append(row);
  return input;
 }
 function renderProfile(parent,q){
  parent.append(heading('编辑个人资料'));
  const form=el('div','lp-wb-editor');
  field(form,'昵称','ownerName',q.profile.nickname);
  field(form,'群星 ID','ownerHandle',q.profile.handle);
  field(form,'个人简介','ownerBio',q.profile.bio);
  followerField(form,'粉丝数量（故事设定）','ownerFollowers',q.profile.followers);
  avatarPicker(form,'更换我的群星头像','ownerAvatar',state.avatarOwnerDraft||q.profile.avatar,q.profile.nickname);
  form.append(control('保存个人资料','saveProfile'));parent.append(form);
 }
 function renderSettings(parent,q){
  parent.append(el('p','lp-wb-settings-note','角色与 NPC 账号保存后，同一张角色卡的其他聊天也可直接使用；帖子、互动与热搜仍属于当前故事存档。'));
  const controls=el('div','lp-wb-editor');
  field(controls,'允许角色按剧情时间主动发布','autoEnabled',q.settings.autoEnabled,'checkbox');
  const interval=field(controls,'发布检测间隔（剧情分钟）','autoEveryMinutes',q.settings.autoEveryMinutes,'number');interval.min='30';interval.max='10080';
  field(controls,'周边环境补充（校园／公司／剧组等）','nearbyHint',q.settings.nearbyHint);
  controls.append(control('保存设置','saveSettings'),control('测试角色自主发布','testAuto'));
  parent.append(controls);
  parent.append(heading('互动记录管理','清理当前存档里的测试互动，不影响原创动态或账号'));
  parent.append(control('清空测试互动记录','clearInteractions'));
  parent.append(heading('管理群星账号','账号绑定具体故事人物；媒体、表白墙和后援会等可建立独立组织账号'));
  for(const a of q.accounts){
   const line=el('div','lp-wb-account-line');line.append(avatar(a.avatar,a.name));
   line.append(el('span','',a.name+' · '+(a.handle||'未设ID')+' · '+(savedProfession(a)||(subjectOfAccount(a).type==='organization'?'组织账号':'故事人物'))+' · 粉丝 '+formatFollowers(a.followers)));
   line.append(control('编辑','editAccount',a.id));line.append(control('删除','deleteAccount',a.id));
   parent.append(line);
  }
  parent.append(control('＋ 新建角色账号','newAccount'));
   const scanner=el('div','lp-wb-scanner');
   scanner.append(heading('从故事资料检测账号','读取角色卡与关联世界书，仅展示候选；勾选并确认后才会保存'));
   field(scanner,'额外世界书名称（选填）','scanWorldName',state.scanWorldName||'');
   scanner.append(control(state.scanLoading?'正在检测…':'检测角色与世界书','scanAccounts'));
   if(state.scanMessage)scanner.append(el('p','lp-wb-scan-message',state.scanMessage));
   if(state.candidates.length){
    scanner.append(heading('待确认账号（'+state.candidates.length+'）','确认人物绑定、职业和个性签名后勾选；未勾选的不会保存'));
    state.candidates.forEach((candidate,index)=>{
     const existing=q.accounts.find(a=>a.name===candidate.name);
     const row=el('div','lp-wb-candidate');row.dataset.wbCandidate=String(index);
     const title=el('label','lp-wb-candidate-title');
     const choose=document.createElement('input');choose.type='checkbox';choose.dataset.wbChoose=String(index);
     title.append(choose,el('strong','',candidate.name),el('small','',existing?'已有账号 · 可更新':'新候选'));
     row.append(title,el('small','lp-wb-candidate-source','来源：'+candidate.source));
     const detail=el('details','lp-wb-candidate-reference');
     detail.append(el('summary','','查看检测到的角色资料'),el('p','',candidate.reference||'暂无进一步资料'));
     row.append(detail);
     const draft=existing||{...candidate,subject:{type:candidate.kind==='角色'?'primary':'npc',name:candidate.name}};
     subjectField(row,'绑定故事人物／账号主体','candidate-'+index+'-subject',draft,[candidate.name]);
     for(const [key,label,value,type] of [
      ['name','账号名称',existing?.name||candidate.name,'text'],
      ['handle','群星 ID',existing?.handle||candidate.handle||'','text'],
      ['profession','职业／公开身份',savedProfession(existing||candidate),'text'],
      ['bio','个性签名（公开展示）',existing?.bio||candidate.bio||'','text'],
      ['followers','粉丝数量（角色卡明确写出时才预填）',existing?.followers??candidate.followers??0,'followers'],
      ['publicFigure','公众人物',existing?.publicFigure||candidate.publicFigure||false,'checkbox']]){
       const item=type==='followers'?followerField(row,label,'candidate-'+index+'-'+key,value):field(row,label,'candidate-'+index+'-'+key,value,type);
       item.dataset.wbCandidateField=key;
     }
     scanner.append(row);
    });
    scanner.append(control('保存勾选的账号','saveCandidates'));
   }
  const active=q.accounts.find(a=>a.id===state.editing)||{};
  if(state.editing==='new'||active.id){
   const form=el('div','lp-wb-editor');form.append(heading(active.id?'编辑账号':'新增账号'));
   subjectField(form,'绑定故事人物／账号主体','accountSubject',active);
   field(form,'账号昵称','accountName',active.name||'');
   field(form,'群星 ID（例如 @example）','accountHandle',active.handle||'');
   field(form,'职业／公开身份','accountProfession',savedProfession(active));
   field(form,'个性签名','accountBio',active.bio||'');
   field(form,'是否为公众人物','accountPublic',active.publicFigure||false,'checkbox');
   followerField(form,'粉丝数量','accountFollowers',active.followers||0);
   avatarPicker(form,'更换角色账号头像','accountAvatar',state.avatarDraft||active.avatar||'',active.name||'角色');
   form.append(control('保存角色账号','saveAccount'));parent.append(form);
  }
  parent.append(scanner);
 }

 function render(){
  const n=nodes();if(!n?.weiboFeed)return;
  reset();
  const pageNames={mine:'我的动态',interactions:'我的互动',following:'关注列表',profile:'个人资料',settings:'群星设置'};
  if(n.title)n.title.textContent=state.detail?'动态详情':state.topic?'热搜详情':state.tab==='me'&&state.subview?(pageNames[state.subview]||'群星'):'群星';
  n.weiboGenerate.disabled=state.loading||state.hotLoading;
  n.weiboGenerate.textContent=state.tab==='nearby'?'刷新周边帖子':state.tab==='discover'?'重新生成15条热搜':'刷新更多';
  n.weiboTabs.querySelectorAll('[data-weibo-tab]').forEach(b=>b.classList.toggle('selected',b.dataset.weiboTab===state.tab));
  const expanded=Boolean(state.detail||state.topic);
  const panels={home:n.weiboFeed,discover:n.weiboHot,nearby:n.weiboNearby,compose:n.weiboCompose,me:n.weiboMe};
  Object.entries(panels).forEach(([key,node])=>{
   node.hidden=key!==state.tab||expanded;
   if(['home','discover','nearby','me'].includes(key))node.replaceChildren();
  });
  n.weiboDetail.hidden=!expanded;
  n.weiboDetail.replaceChildren();
  n.weiboDetailBack.hidden=true; // Fixed phone header is the only back control.
  n.weiboRefreshBox.hidden=expanded||!['home','discover','nearby'].includes(state.tab);
  n.weiboFeedback.hidden=!n.weiboFeedback.textContent;
  if(expanded){
   // No scrolling duplicate back control in detail view.
   if(state.detail){
    const p=byId(state.detail);
    if(p){
     n.weiboDetail.append(card(p,true));
     const input=document.createElement('textarea');
     input.dataset.wbCommentInput='';input.maxLength=500;input.placeholder='写下评论…';
     n.weiboDetail.append(input,control('发表评论','sendComment',p.id));
    }else n.weiboDetail.append(el('p','lp-wb-empty','这条动态暂时不可读取'));
   }else if(state.topic){
    const t=state.topic;
    n.weiboDetail.append(heading('#'+t.title+'#',t.zone==='nearby'?'周边热议':'世界热搜'));
    if(t.summary)n.weiboDetail.append(el('p','lp-wb-topic-summary',t.summary));
    if(t.error)n.weiboDetail.append(el('p','lp-wb-topic-error',t.error));
    if(t.error||(!t.posts||!t.posts.length))
     n.weiboDetail.append(control('重新生成热搜榜','retryTopic'));
    for(const p of t.posts){
     n.weiboDetail.append(card(p,true),control('查看评论并参与讨论','detail',p.id));
    }
   }
   n.weiboGenerate.hidden=true;
   n.weiboRefreshBox.append(n.weiboGenerate);
   return;
  }
  if(state.tab==='home'){
   const q=data(),seen=new Set(),all=[...state.posts.home,
    ...q.posts.filter(p=>p.zone!=='nearby'&&(p.actions?.owned||p.autoPublished)).slice(-15).reverse()];
   for(const p of all)if(p?.id&&!seen.has(p.id)){seen.add(p.id);n.weiboFeed.append(card(p,false));}
   if(!seen.size)n.weiboFeed.append(el('p','lp-wb-empty','点击下方按钮，查看故事世界的最新动态'));
  }else if(state.tab==='discover'){
   n.weiboHot.append(heading('世界热搜','公共话题与热门讨论'));
   if(state.hotLoading)n.weiboHot.append(el('p','lp-wb-empty','正在一次生成15条热搜、帖子及评论…'));
   trendList(n.weiboHot,state.trends,'home');
  }else if(state.tab==='nearby'){
   n.weiboNearby.append(heading('周边','校园、公司、剧组与身边的人'));
   if(state.loading&&state.attempted.nearby)n.weiboNearby.append(el('p','lp-wb-empty','正在生成周边动态及评论…'));
   const list=[...state.posts.nearby,
    ...data().posts.filter(p=>p.zone==='nearby'&&(p.actions?.owned||p.autoPublished)).slice(-12).reverse()];
   const seen=new Set();for(const p of list)if(!seen.has(p.id)){seen.add(p.id);n.weiboNearby.append(card(p,false));}
   if(!list.length&&!state.loading)n.weiboNearby.append(el('p','lp-wb-empty','点击刷新周边，生成身边人的帖子和评论'));
  }else if(state.tab==='me')renderMine(n);
  const target={home:n.weiboFeed,discover:n.weiboHot,nearby:n.weiboNearby}[state.tab];
  if(target){n.weiboGenerate.hidden=false;n.weiboGenerate.classList.add('lp-wb-refresh-button');target.append(n.weiboGenerate);}
  else{n.weiboGenerate.hidden=true;n.weiboRefreshBox.append(n.weiboGenerate);}
 }

 async function followPost(p,enabled){
  await mutate(q=>{
   let account=q.accounts.find(a=>a.id===p.authorId||(p.handle&&a.handle===p.handle)||a.name===p.author);
   if(!account&&enabled){
    account={id:uid('account'),name:p.author,handle:p.handle||'',avatar:p.avatar||'',bio:'',kind:'网友',publicFigure:false,followers:0,source:'follow'};
    q.accounts.push(account);
   }
   if(!account)return;
   if(enabled){q.following=[...new Set([...q.following,account.id])];
    if(!q.posts.some(x=>x.id===p.id))q.posts.push({...p,authorId:account.id});}
   else q.following=q.following.filter(x=>x!==account.id);
  });
 }
 async function persistAction(p,change){
  await mutate(q=>{
   let entry=q.posts.find(x=>x.id===p.id);
   if(!entry){entry={...p,actions:{}};q.posts.push(entry);}
   entry.actions={...(entry.actions||{}),...change};
   if(change.newComment)entry.comments=[...(entry.comments||[]),change.newComment];
   delete entry.actions.newComment;
   q.posts=q.posts.slice(-180);
  });
 }
 async function action(type,id){
  // Reading/profile/settings interactions remain available during feed generation.
  
if(type==='clearInteractions'){
   if(!window.confirm('清空当前存档的点赞、评论、收藏和转发？转发生成的「我的动态」也会移除，原创动态与关注账号会保留。此操作不可撤销。'))return;
   await mutate((q,r)=>{
    q.posts=q.posts.filter(post=>{
     if(post.repostOf)return false;
     const keep=Boolean(post.actions?.owned||post.autoPublished||
      (post.authorId&&q.following.includes(post.authorId)));
     if(keep)post.actions=post.actions?.owned?{owned:true}:{};
     return keep;
    });
    delete r.weiboSaved;
   });
   feedback('已清空当前存档的互动记录');
   render();return;
  }
if(type==='subview'){state.subview=id;state.editing='';render();nodes().weiboMe.parentElement.scrollTop=0;return;}
  if(type==='backMe'){state.subview='';state.editing='';render();nodes().weiboMe.parentElement.scrollTop=0;return;}
  if(type==='retryTopic'){state.topic=null;state.tab='discover';await generateHot();return;}
  if(type==='scanAccounts'){
   if(state.scanLoading)return;
   if(typeof api.scanAccounts!=='function'){feedback('当前无法读取角色资料');return;}
   const input=nodes().weiboMe.querySelector('[data-wb-field="scanWorldName"]');
   state.scanWorldName=clean(input?.value,120);
   const session=scope();state.scanLoading=true;state.scanMessage='正在读取角色卡和关联世界书…';render();
   try{
    const scan=await api.scanAccounts(state.scanWorldName);
    if(scope()!==session)return;
    state.candidates=Array.isArray(scan.candidates)?scan.candidates.slice(0,45):[];
    state.scanMessage='已扫描 '+(scan.scanned||0)+' 段资料、'+(scan.worlds||0)+' 本世界书；找到 '+state.candidates.length+
     ' 个候选账号。'+(scan.failures?.length?' 未读取：'+scan.failures.join('；'):'');
   }catch(e){state.scanMessage='检测失败：'+String(e.message||e);api.recordError('群星账号检测',e);}
   finally{state.scanLoading=false;if(scope()===session)render();}
   return;
  }
  if(type==='saveCandidates'){
   const selected=[...nodes().weiboMe.querySelectorAll('[data-wb-choose]:checked')];
   const chosen=[];
   for(const checkbox of selected){
    const row=checkbox.closest('[data-wb-candidate]');
    if(!row)continue;
    const value=key=>{
     const x=row.querySelector('[data-wb-candidate-field="'+key+'"]');
     return x?.type==='checkbox'?!!x.checked:clean(x?.value,key==='bio'?450:60);
    };
    const name=value('name');if(!name)continue;
    let followers;
    try{followers=readFollowerField(row,'candidate-'+row.dataset.wbCandidate+'-followers');}
    catch(error){feedback(name+'：'+error.message);return;}
    let subject;
    try{
     const raw=row.querySelector('[data-wb-field="candidate-'+row.dataset.wbCandidate+'-subject"]')?.value;
     const scanned=state.candidates[Number(row.dataset.wbCandidate)]?.name||name;
     subject=readSubject(raw,subjectChoices([scanned,name]));
    }catch(error){feedback(name+'：'+error.message);return;}
    chosen.push({name,handle:value('handle'),subject,
     kind:subject.type==='primary'?'角色':subject.type==='organization'?'组织':'NPC',
     profession:value('profession'),bio:value('bio'),publicFigure:value('publicFigure'),followers});
   }
   if(!chosen.length){feedback('请先勾选要保存的候选账号');return;}
   await mutate(q=>{
    for(const candidate of chosen){
     const old=q.accounts.find(x=>x.name===candidate.name||(candidate.handle&&x.handle===candidate.handle));
     const next={...old,...candidate,id:old?.id||uid('account'),
      avatar:old?.avatar||'',source:'manual'};
     q.accounts=old?q.accounts.map(x=>x.id===old.id?next:x):[...q.accounts,next];
    }
   });
   state.candidates=[];state.scanMessage='已保存 '+chosen.length+' 个已确认账号，未勾选的没有写入。';
   feedback(state.scanMessage);render();return;
  }
  if(type==='newAccount'){state.editing='new';state.avatarDraft='';render();return;}
  if(type==='editAccount'){state.editing=id;state.avatarDraft='';render();return;}
  if(type==='deleteAccount'){
   await mutate(q=>{q.accounts=q.accounts.filter(a=>a.id!==id);q.following=q.following.filter(x=>x!==id);});
   state.editing='';render();return;
  }
  if(type==='unfollowAccount'){await mutate(q=>{q.following=q.following.filter(x=>x!==id);});render();return;}
  if(type==='saveSettings'){
   const wrap=nodes().weiboMe;
   const v=n=>wrap.querySelector('[data-wb-field="'+n+'"]');
   const enabled=v('autoEnabled')?.checked||false;
   await mutate(q=>{
    q.settings={...q.settings,autoEnabled:enabled,autoEveryMinutes:Math.max(30,Math.min(10080,Number(v('autoEveryMinutes')?.value)||180)),
     nearbyHint:clean(v('nearbyHint')?.value,240)};
    if(enabled&&!q.lastAutoStoryMinute)q.lastAutoStoryMinute=Date.parse(root().storyTime)||Date.now();
   });feedback('群星设置已保存');render();return;
  }
  if(type==='testAuto'){await tick(true);return;}
  if(type==='saveProfile'){
   const wrap=nodes().weiboMe,v=n=>wrap.querySelector('[data-wb-field="'+n+'"]');
   const draft=state.avatarOwnerDraft;
   let followers;
   try{followers=readFollowerField(wrap,'ownerFollowers');}catch(error){feedback(error.message);return;}
   await mutate(q=>{q.profile={...q.profile,nickname:clean(v('ownerName')?.value,35)||'我',
    handle:clean(v('ownerHandle')?.value,45),bio:clean(v('ownerBio')?.value,240),
    followers,avatar:draft||q.profile.avatar};});
   state.avatarOwnerDraft='';feedback('个人资料已保存');render();return;
  }
  if(type==='saveAccount'){
   const wrap=nodes().weiboMe,v=n=>wrap.querySelector('[data-wb-field="'+n+'"]');
   const name=clean(v('accountName')?.value,42);if(!name){feedback('请填写账号名称');return;}
   const edit=state.editing;const avatarDraft=state.avatarDraft;
   const previous=data().accounts.find(a=>a.id===edit);
   let followers,subject;
   try{
    followers=readFollowerField(wrap,'accountFollowers');
    subject=readSubject(v('accountSubject')?.value,
     subjectChoices(previous?.subject?.name?[previous.subject.name]:previous?.name?[previous.name]:[]));
   }catch(error){feedback(error.message);return;}
   await mutate(q=>{
    const old=q.accounts.find(x=>x.id===edit)||{};
    const next={...old,id:old.id||uid('account'),name,handle:clean(v('accountHandle')?.value,45),bio:clean(v('accountBio')?.value,450),
     subject,kind:subject.type==='primary'?'角色':subject.type==='organization'?'组织':'NPC',
     profession:clean(v('accountProfession')?.value,80),publicFigure:!!v('accountPublic')?.checked,
     followers,avatar:avatarDraft||old.avatar||'',source:'manual'};
    q.accounts=old.id?q.accounts.map(a=>a.id===old.id?next:a):[...q.accounts,next];
   });
   state.editing='';state.avatarDraft='';feedback('角色账号已保存');render();return;
  }
  const p=byId(id);if(!p)return;
  if(type==='share'){api.sharePost?.(p);return;}
  if(type==='detail'){state.detail=id;render();return;}
  if(type==='follow'||type==='unfollow'){await followPost(p,type==='follow');render();return;}
  if(type==='sendComment'){
   const input=nodes().weiboDetail.querySelector('[data-wb-comment-input]');
   const text=clean(input?.value,500);if(!text)return;
   const c={id:uid('comment'),name:data().profile.nickname||'我',text};
   await persistAction(p,{comments:[...(actionState(p).comments||[]),c],newComment:c});
   const d=structuredClone(root());api.publishPhoneAppEvent(d,{app:'weibo',action:'commented',id:c.id,detail:'评论 '+p.author+'：'+text,reference:p.id});
   await api.writeData(context(),{...d,__contactId:'primary'});
  }else{
   const a=actionState(p);let change={};
   if(type==='like')change={liked:!a.liked};
   else if(type==='favorite')change={favorited:!a.favorited};
   else if(type==='repost'){
    const next=!a.reposted;
    await mutate(q=>{
     let original=q.posts.find(x=>x.id===p.id);
     if(!original){original={...p,actions:{}};q.posts.push(original);}
     original.actions={...(original.actions||{}),reposted:next};
     q.posts=q.posts.filter(x=>!(x.repostOf===p.id&&x.actions?.owned));
     if(next){
      const me=q.profile;
      q.posts.push({id:uid('repost'),author:me.nickname,handle:me.handle,avatar:me.avatar,
       authorId:'self',category:'转发',text:'转发自 '+p.author+'：\n'+p.text,
       comments:[],likes:0,zone:'world',time:root().storyTime||'',
       repostOf:p.id,actions:{owned:true}});
     }
     q.posts=q.posts.slice(-180);
    });
    if(next){
     const rootData=structuredClone(root());
     api.publishPhoneAppEvent(rootData,{app:'weibo',action:'reposted',id:p.id,
      detail:'转发 '+p.author+'：'+clean(p.text,110)});
     await api.writeData(context(),{...rootData,__contactId:'primary'});
    }
    feedback(next?'已转发到我的动态':'已取消转发并移除我的动态');
    render();return;
   }
   else return;
   await persistAction(p,change);

  }render();
 }
 async function publish(){
  const n=nodes(),text=clean(n.weiboComposeText?.value,1000);if(!text){feedback('请先输入内容');return;}
  const q=data(),post={id:uid('post'),author:q.profile.nickname,handle:q.profile.handle,avatar:q.profile.avatar,authorId:'self',
   category:'日常',text,comments:[],likes:0,time:root().storyTime||'',zone:'world',actions:{owned:true}};
  await mutate(d=>{d.posts.push(post);d.posts=d.posts.slice(-180);});
  const r=structuredClone(root());api.publishPhoneAppEvent(r,{app:'weibo',action:'posted',id:post.id,detail:'发布群星：'+clean(text,170)});
  await api.writeData(context(),{...r,__contactId:'primary'});
  n.weiboComposeText.value='';state.tab='home';feedback('发布成功');render();
 }
 async function publishAlbumPhoto(photo,caption){
  if(photo?.owner!=='user'||photo?.access!=='public'||typeof photo.image!=='string')
   throw Error('不能使用不属于 user 或未允许公开的相册照片');
  const me=data().profile,text=clean(caption||photo.title||'分享照片',1000);
  const post={id:uid('post'),author:me.nickname,handle:me.handle,avatar:me.avatar,
   authorId:'self',category:'图片',text,image:photo.image,comments:[],likes:0,time:root().storyTime||'',zone:'world',actions:{owned:true}};
  await mutate(q=>{q.posts.push(post);q.posts=q.posts.slice(-180);});
  feedback('相册照片已发布');state.tab='home';render();return post;
 }
 function selectTab(t){
  const alias={feed:'home',hot:'discover',saved:'me'};
  t=alias[t]||t;
  if(!['home','discover','nearby','compose','me'].includes(t))return;
  if(t==='discover'){
   void (async()=>{
    // A paid hot-trend generation must be confirmed by the user first.
    if(!state.trends.length&&!state.hotLoading&&!(await confirmHotSearch()))return;
    state.tab='discover';state.detail='';state.topic=null;state.subview='';
    feedback('');render();
    if(!state.trends.length&&!state.hotLoading)await generateHot();
   })();
   return;
  }
  if(t!==state.tab)feedback('');
  if(t==='me'&&state.tab==='me')state.subview='';
  if(t!=='me')state.subview='';
  state.tab=t;state.detail='';state.topic=null;render();
  if(nodes()?.weiboFeed?.parentElement)nodes().weiboFeed.parentElement.scrollTop=0;
  if(t==='home'&&!state.attempted.world){state.attempted.world=true;void generate('home');}
  if(t==='nearby'&&!state.attempted.nearby){
   state.attempted.nearby=true;void generate('nearby');
  }
 }
 function back(){
   if(state.detail)state.detail='';
   else if(state.topic)state.topic=null;
   else if(state.subview)state.subview='';
   else return false;
   render();return true;
  }
 function handleClick(event){
  const n=event.target?.closest?.('[data-wb-action],[data-wb-topic]');if(!n)return false;
  if(n.dataset.wbTopic!==undefined){void openTopic(n.dataset.wbTopic,n.dataset.wbZone==='nearby'?'nearby':'home');return true;}
  void action(n.dataset.wbAction,n.dataset.wbPost).catch(e=>feedback('操作失败：'+String(e.message||e)));return true;
 }
 function handleFile(event){
  const input=event.target?.closest?.('[data-wb-field="accountAvatar"],[data-wb-field="ownerAvatar"]');
  if(!input||!input.files?.[0])return false;
  const file=input.files[0];
  if(!/^image\/(?:png|jpeg|webp)$/.test(file.type)||file.size>8*1024*1024){feedback('头像请选择不超过 8MB 的图片');return true;}
  const reader=new FileReader();
  reader.onload=()=>{
   const img=new Image();
   img.onload=()=>{
    const canvas=document.createElement('canvas'),scale=Math.min(1,320/img.width,320/img.height);
    canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
    canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
    const result=canvas.toDataURL('image/webp',.8);
    if(input.dataset.wbField==='accountAvatar')state.avatarDraft=result;
    else state.avatarOwnerDraft=result;
    const preview=input.closest('.lp-wb-avatar-picker')?.querySelector('[data-wb-avatar-preview]');
    if(preview){const img=new Image();img.src=result;img.alt='已选择的头像预览';preview.replaceChildren(img);}
    feedback('头像已选择，点击保存后生效');
   };
   img.onerror=()=>feedback('头像解码失败');
   img.src=String(reader.result||'');
  };
  reader.onerror=()=>feedback('头像读取失败');
  reader.readAsDataURL(file);return true;
 }
 async function tick(force=false){
  reset();const q=data(),scene=root().storyTime||'';
  const now=Date.parse(scene),every=Math.max(30,Number(q.settings.autoEveryMinutes)||180)*60000;
  if(autoBusy||state.loading||(!force&&!q.settings.autoEnabled)||!Number.isFinite(now)||document.visibilityState==='hidden')return;
  const accounts=q.accounts.filter(a=>a.source==='manual'&&a.kind!=='网友');if(!accounts.length){if(force)feedback('请先在「我 → 群星设置」添加角色账号');return;}
  if(!force&&q.lastAutoStoryMinute&&now-q.lastAutoStoryMinute<every)return;
  autoBusy=true;
  try{
   const index=q.posts.filter(p=>p.autoPublished).length%accounts.length,account=accounts[index];
   // Mark attempted story time before generation to avoid duplicate posts and billing.
   await mutate(s=>{s.lastAutoStoryMinute=now;});
   const photos=api.photosForAccount?.(account.name)||[];
   const albumGuide=photos.slice(0,12).map(p=>p.id+'：'+(p.description||p.title||'照片')).join('；');
   const raw=await api.phoneGenerate(context(),{task:'autonomy',systemPrompt:'扮演指定角色在故事世界的公开社交账号上自主发帖；只输出正文或 [SKIP]。如有适合的本角色公开相册照片，可以在文末加 [[photo:照片ID]]；不能编造照片ID。',prompt:[{role:'user',
    content:'故事时间：'+scene+'。群星账号：'+account.name+'，职业／公开资料 '+publicAccountDescription(account)+'，账号主体 '+(subjectOfAccount(account).type==='organization'?'组织账号':'故事人物')+'，公众人物：'+(account.publicFigure?'是':'否')+
     '。可用公开相册照片：'+albumGuide+'。近期剧情：'+clean(api.storyContext?.()||'',1400)+'。结合职业、性格、公共活动和时间线决定此时是否发布一条公开动态。不得公开私聊秘密，不得杜撰用户行为、未发生事件或已确定恋情。可以不发，输出 [SKIP]。否则只输出一条 20～180 字的社交动态，不要额外解释。'}]},api.readData(context()));
   if(scope()!==state.scope)return;
   const reply=clean(api.stripModelReasoning(raw),450);
   if(!reply||/^\[SKIP\]$/i.test(reply)){if(force)feedback(account.name+' 选择暂不发布');return;}
   const requested=reply.match(/\[\[photo:([^\]\r\n]+)\]\]/);
   const chosen=requested?photos.find(p=>p.id===requested[1]):null;
   const body=reply.replace(/\[\[photo:[^\]\r\n]+\]\]/g,'').trim();
   if(!body){if(force)feedback(account.name+' 本轮没有可发送内容');return;}
   const post={id:uid('post'),author:account.name,handle:account.handle,authorId:account.id,avatar:account.avatar||'',
    category:account.kind,text:body,...(chosen?{image:chosen.image}:{}),comments:[],likes:0,time:scene,zone:'world',autoPublished:true,actions:{}};
   await mutate(s=>{s.posts.push(post);s.posts=s.posts.slice(-180);});
   feedback(account.name+' 已发布新动态');api.recordActivity('群星主动发帖',account.name+' 发布动态','success');render();
  }catch(e){feedback('主动发布失败：'+String(e.message||e));api.recordError('群星主动发帖',e);}
  finally{autoBusy=false;}
 }
 function open(options={}){
  reset();
  state.detail='';state.topic=null;state.subview='';
  // All feeds now survive entire-phone closing. Only switching to a different
  // story chat loads its own saved list; manual refresh replaces the current tab.
  state.tab=options.tab==='discover'?'discover':'home';
  render();
  if(state.tab==='discover'){
   if(options.confirmed&&!state.trends.length&&!state.hotLoading)
    void generateHot();
  }else if(!state.attempted.world){
   state.attempted.world=true;void generate('home');
  }
 }
 return {open,render,generate,generateHot,confirmHotSearch,endPhoneSession,headline,selectTab,back,publish,publishAlbumPhoto,handleClick,handleFile,tick,state,parse,normalize,openTopic};
}
