/* 群星 · character-card accounts + per-story persistent generated feeds and interactions. */
export function createWeiboModule(api) {
 const state={scope:'',tab:'home',detail:'',topic:null,profileAccount:'',adminHistoryAccount:'',historyEditingId:'',historyFormOpen:false,searchQuery:'',sharingId:'',subview:'',posts:{home:[],nearby:[]},trends:[],nearbyTrends:[],loading:false,hotLoading:false,attempted:{},token:0,sessionId:0,headline:'',hotBundles:{},queuedNearby:false,confirming:false,editing:'',avatarDraft:'',avatarOwnerDraft:'',candidates:[],scanLoading:false,scanMessage:''};
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
  if(total>=100000000)return (total/100000000).toLocaleString('zh-CN',{useGrouping:false,maximumFractionDigits:2})+'亿粉丝';
  if(total>=10000)return (total/10000).toLocaleString('zh-CN',{useGrouping:false,maximumFractionDigits:2})+'万粉丝';
  return String(total)+'粉丝';
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

 // Existing public account history predates the current feed; never infer totals
 // only from one newly observed post.
 const countValue=v=>v==null||v===''||!Number.isSafeInteger(Number(v))||Number(v)<0?null:Number(v);
 const stableSeed=str=>{let h=2166136261;for(const c of String(str||'')){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return(h>>>0)/4294967295;};
 const estimateMetrics=(account,{correctImplausible=false}={})=>{
  const fans=countValue(account?.followers)??0,seed=stableSeed([account?.handle,account?.name,account?.kind].join('|'));
  const media=/媒体|新闻|日报|观察|资讯|传媒|官方|工作室|报社|平台/.test([account?.name,account?.profession,account?.kind].join(' '));
  const base=fans?Math.round(fans*(media?2.1+seed*7.0:.9+seed*5.1)):0;
  const reportedLikes=countValue(account?.likesTotal);
  const likesTotal=reportedLikes!=null&&!correctImplausible?reportedLikes:Math.max(reportedLikes??0,base);
  const reportedComments=countValue(account?.commentsTotal);
  const commentsTotal=reportedComments!=null&&!correctImplausible?reportedComments:
   Math.max(reportedComments??0,likesTotal?Math.round(likesTotal*(.014+seed*.045)):0);
  return {likesTotal,commentsTotal,followingCount:countValue(account?.followingCount)??(fans?Math.round(35+seed*410):0)};
 };
 const operatorMode=account=>['self','team','joint','other'].includes(account?.operatorMode)?account.operatorMode:'self';
 const accountOperatorGuide=account=>{
  const mode=operatorMode(account);
  return mode==='team'?'工作室／经纪团队运营，官方公告与宣传为主，不默认每条都是本人亲写':
   mode==='joint'?'本人和团队共同运营，依照具体帖子区分发布者':
   mode==='other'?'由'+(clean(account?.operatorName,70)||'指定运营者')+'运营，不冒充本人':
   '账号由本人运营，依照绑定人物性格发文';
 };
 const publicAccountInfo=account=>{
  const detail=(account?.name||'')+'（@'+(account?.handle||account?.id)+'；'+publicAccountDescription(account)+'；'+accountOperatorGuide(account)+'）';
  return (account?.identityVisibility||'public')==='public'?detail:
   (account?.name||'匿名账号')+'（@'+(account?.handle||account?.id)+'；'+publicAccountDescription(account)+'；真实身份未公开，不得将此账号与其他角色关联）';
 };

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
  state.scope=next;state.tab='home';state.detail='';state.topic=null;state.profileAccount='';state.adminHistoryAccount='';state.historyEditingId='';state.historyFormOpen=false;state.searchQuery='';state.sharingId='';state.subview='';
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
  state.detail='';state.topic=null;state.profileAccount='';state.historyEditingId='';state.historyFormOpen=false;state.sharingId='';state.subview='';state.tab='home';
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
   if(posts!==null){
     feeds[kind]=posts;
     // Keep the public history of known/followed authors when their feed refreshes.
     for(const post of posts){
      const author=accountForPost(post,q.accounts);
      if(author&&(author.source==='manual'||q.following.includes(author.id))&&!q.posts.some(old=>old.id===post.id))
       q.posts.push({...post,authorId:author.id});
     }
     q.posts=q.posts.slice(-300);
    }
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
 const accountForPost=(p,accounts=data().accounts)=>{
  if(p.authorId){const match=accounts.find(a=>a.id===p.authorId);if(match)return match;}
  if(p.handle){const match=accounts.find(a=>a.handle&&a.handle===p.handle);if(match)return match;}
  const names=accounts.filter(a=>p.author&&a.name===p.author);return names.length===1?names[0]:null;
 };
 const isPermanentPost=(p,q=data())=>{
  const account=accountForPost(p,q.accounts);
  return Boolean(p?.actions?.owned||p?.autoPublished||p?.manuallyCurated||p?.backfilled||p?.repostOf||
   account&&(account.source==='manual'||q.following.includes(account.id)));
 };
 const actor=p=>{const list=data().accounts;if(p.authorId){const a=list.find(x=>x.id===p.authorId);if(a)return a;}if(p.handle){const a=list.find(x=>x.handle&&x.handle===p.handle);if(a)return a;}const found=list.filter(x=>p.author&&x.name===p.author);return found.length===1?found[0]:null;};
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
  const accounts=data().accounts,matching=accounts.filter(a=>a.name===author);
  const acct=accounts.find(a=>handle&&a.handle&&a.handle===handle)||(matching.length===1?matching[0]:null);
  const comments=(Array.isArray(p.comments)?p.comments:[]).map(c=>
   typeof c==='string'?{id:uid('c'),name:'网友',text:clean(c,350)}:
   {id:uid('c'),name:clean(c?.name||c?.author||'网友',40),text:clean(c?.text||c?.content,350)}
  ).filter(c=>c.text).slice(0,12);
  if(comments.length<2)return null;
  const requestedLikes=countValue(p.likes);
  const guessedFollowers=Math.max(100,Math.round((requestedLikes||120)*(10+Math.random()*18)));
  const followers=acct?.followers??countValue(p.followers)??guessedFollowers;
  const floor=followers>=100000?Math.floor(followers*(.0015+stableSeed(author+handle)*.0025)):0;
  const likes=Math.max(requestedLikes??0,floor);
  const baseline=estimateMetrics({...p,name:author,handle,followers,
   profession:acct?.profession||p.category,kind:acct?.kind||p.category,
   likesTotal:acct?.likesTotal??p.accountLikes,commentsTotal:acct?.commentsTotal??p.accountComments,
   followingCount:acct?.followingCount??p.followingCount},{correctImplausible:!acct});
  const commentCount=Math.max(comments.length,countValue(p.commentCount)??Math.round(likes*(.015+stableSeed(text)*.032)));
  return {id:uid('post'),author,handle:acct?.handle||handle,authorId:acct?.id||'',avatar:acct?.avatar||'',category:clean(p.category||'日常',24),
   text,comments,likes:Math.min(9999999999,likes),commentCount,
   followers,accountLikes:baseline.likesTotal,accountComments:baseline.commentsTotal,followingCount:baseline.followingCount,
   zone,time:root().storyTime||'',actions:{}};
 }
 function prompt(count,zone,topic='',withTrend=false){
  const q=data(),r=root(),char=api.selectedCharacter(context()),nearby=zone==='nearby';
  const accounts=q.accounts.slice(0,25).map(publicAccountInfo).join('、');
  const followed=q.accounts.filter(a=>q.following.includes(a.id)).map(a=>a.name).join('、');
  const known=(r.contacts||[]).slice(0,18).map(a=>a.name+'：'+clean(a.description,80)).join('；');
  const contextText=clean(api.storyContext?.()||'',2100);
  return [
   '你正在生成完全虚构的剧情世界社交平台「群星」内容。故事日期：'+(r.storyTime||'未设定')+'。',
   '范围：'+(nearby?'周边与关注：同时包含身边人的动态和 user 关注的账号公开帖子；被关注者不要求位于附近。校园、公司、剧组、社团、邻里与朋友等':'世界：新闻、社会、影视、生活、时尚、体育、游戏、科技、音乐等公共动态')+'。',
   '主角：'+(char?.name||'未选择')+'；角色简介：'+clean(char?.description,750)+'；已知人物：'+known+'。',
   '已建立的公众/普通账号：'+(accounts||'暂无')+'；用户关注：'+(followed||'暂无')+'；周边补充设定：'+clean(q.settings.nearbyHint,210)+'。',
   '近期剧情：'+contextText+'。必须区分已公开事实与私聊秘密；绝不杜撰用户言行、心理、地下恋情、未发生事件。',
   '允许陌生网友完全讨论无关主题，勿全围绕角色。公众人物可以合理上热搜，但不要每条都写成公共事件。',
   '营造真实复杂的互联网：多数网友正常且观点各异，偶尔可以有0至1个理直气壮、反常识到令人怀疑的“神人”发言，让其他网友有自然吐槽或反驳；题材随机覆盖职场、学习、生活、饭圈、科技、性别刻板印象等，不要总围绕男女关系，也不要把偏激观点当事实。',
   '每条帖子配2至5条不同语气的评论，允许争论与冷幽默、网络流行语，但不要每条都是段子。',
   '账号早已在世界里长期运营，不是第一次刷到才注册！输出粉丝followers、历史累计获赞accountLikes、累计获评accountComments、关注followingCount、本帖likes和本帖评论总数commentCount。80万粉丝成熟媒体号累计获赞通常有几十万到千万以上，不能只计算本条新帖。评论列表展示2到5条样本即可，不等于评论总数。临时账号只属于本轮浏览，无需永久登记。',
   nearby?'若角色或 user 仍在校（从资料判断，不能直接假设已毕业），校园日常占多数：表白墙、选课考试、老师答疑、寝室、社团活动、求助和吐槽；其他帖子可来自已关注账号以及工作、剧组、生活圈。不得把远方已关注者说成就在附近；不凭空编造真实城市、学校名或隐私。':'全球动态有大小事之分，不要人人都在热榜。',
   topic?'帖子主题：'+topic:'',
   '只输出合法紧凑 JSON：{"posts":[{"author":"作者昵称","handle":"@账号","category":"类别","text":"正文","followers":36000,"followingCount":80,"accountLikes":258000,"accountComments":5900,"likes":2300,"commentCount":128,"comments":[{"name":"评论昵称","text":"内容"}]}],"headline":"本轮公开热议话题"}。',
   '生成'+count+'条相互独立、有作者、正文和评论的帖子。headline仅是一个简短话题标题，用于小手机桌面入口，不要返回整张热榜。不要markdown、不要思维过程。'
  ].filter(Boolean).join('\n');
 }
 function hotPrompt(){
  const q=data(),r=root(),char=api.selectedCharacter(context());
  return [
   '为完全虚构的剧情社交平台「群星」一次性生成完整世界热搜榜。剧情时间：'+(r.storyTime||'未设置')+'。',
   '主角：'+(char?.name||'未选择')+'；角色公开身份：'+clean(char?.description,650)+'。',
   '故事已知人物：'+(r.contacts||[]).slice(0,15).map(p=>p.name+'：'+clean(p.description,65)).join('、')+'。',
   '已知公开账号：'+q.accounts.slice(0,20).map(publicAccountInfo).join('、')+'。近期剧情：'+clean(api.storyContext?.()||'',1400)+'。',
   '所有话题和帖子都是故事中的公开内容，严禁曝光私聊、未公开身份、用户内心或虚构尚未发生的事件；普通人不可无缘无故成为全国热点。',
   '热榜15条内容需分布在社会、影视、生活、搞笑、教育、科技、时尚、体育、游戏、音乐、娱乐等领域，不要15条都围绕主角。',
   '每条热搜都必须同时给出标题、摘要、至少1篇完整帖子以及对应2至3条不同立场的评论；允许部分热搜有2篇帖子，但请优先确保15条齐全。',
   '所有账号早已存在，需分别生成followers、followingCount、accountLikes、accountComments、likes和commentCount非负整数。媒体号80万粉丝的历史累计获赞通常至少几十万，不能把累计当成单篇赞数；评论列表仅展示样本。临时账号不用永久登记。',
   '偶尔最多1条热搜或评论可以出现离谱却很自信的“神人”观点，其他网友可以反驳或吐槽；不能每条都刻意降智，不局限于性别话题。',
   '只能调用这一次生成完成热榜与其讨论内容，点击具体话题时不允许还需要额外生成。',
   '请仅输出JSON，不要markdown：{"topics":[{"title":"热搜短标题","category":"分类","summary":"一两句背景","posts":[{"author":"网友昵称","handle":"@账号","category":"分类","text":"完整帖子","followers":120000,"followingCount":200,"accountLikes":400000,"accountComments":8000,"likes":12900,"commentCount":860,"comments":[{"name":"网友","text":"评论"}]}]}]}。',
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
 function authorButton(account,post){
  const btn=el('button','lp-wb-author-link',post.author||account?.name||'群星用户');
  btn.type='button';btn.dataset.wbAction=account?'openAccount':'openPostAuthor';
  btn.dataset.wbPost=account?.id||post.id;
  return btn;
 }
 function accountMatches(post,account){
  if(!post||!account)return false;
  if(post.authorId)return post.authorId===account.id;
  if(post.handle&&account.handle)return post.handle===account.handle;
  // Name fallback is safe only if it identifies one unambiguous account.
  return Boolean(post.author&&post.author===account.name&&
   data().accounts.filter(a=>a.name===account.name).length===1);
 }
 function accountHistory(account){
  const q=data(),cached=q.generated?.feeds||{};
  const pool=[...q.posts,...state.posts.home,...state.posts.nearby,
   ...(cached.home||[]),...(cached.nearby||[])],seen=new Set();
  return pool.filter(p=>p?.id&&accountMatches(p,account)&&!seen.has(p.id)&&seen.add(p.id))
   .sort((a,b)=>(Date.parse(b.time)||0)-(Date.parse(a.time)||0));
 }
 function renderAccountSearch(parent){
  const pane=el('div','lp-wb-account-search');
  const input=document.createElement('input');input.type='search';input.dataset.wbAccountSearch='true';
  input.placeholder='搜索昵称或群星 ID';input.value=state.searchQuery;
  input.setAttribute('aria-label','搜索群星账号');input.autocomplete='off';
  const result=el('div','lp-wb-account-search-results');
  result.dataset.wbSearchResults='true';
  pane.append(input,result);parent.append(pane);renderAccountSearchResults(result);
 }
 function renderAccountSearchResults(container){
  if(!container)return;
  container.replaceChildren();
  const query=state.searchQuery.trim().toLocaleLowerCase();
  if(!query){
   container.append(el('small','lp-wb-search-hint','输入昵称或群星 ID，查找并关注已有账号'));
   return;
  }
  const q=data(),list=q.accounts.filter(a=>[a.name,a.handle].some(
   value=>String(value||'').toLocaleLowerCase().includes(query))).slice(0,15);
  if(!list.length){
   container.append(el('small','lp-wb-search-hint','没有匹配账号；仅能搜索已建立的角色与关注账号'));
   return;
  }
  for(const a of list){
   const row=el('div','lp-wb-search-result');
   const open=control('','openAccount',a.id);
   open.classList.add('lp-wb-search-person');
   const details=el('span','lp-wb-search-person-text');
   details.append(el('strong','',a.name),el('small','',a.handle||'未设置群星 ID'));
   open.append(avatar(a.avatar,a.name),details);
   const followed=q.following.includes(a.id);
   const follow=control(followed?'已关注':'＋关注',followed?'unfollowAccount':'followAccount',a.id);
   follow.classList.add('lp-wb-search-follow');
   row.append(open,follow);container.append(row);
  }
 }

 const parseCommentLines=value=>{
  return String(value||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean).slice(0,50)
   .map(line=>{
    const index=line.search(/[:：]/);
    return {id:uid('comment'),name:index>0?clean(line.slice(0,index),40):'网友',
     text:clean(index>0?line.slice(index+1):line,350)};
   }).filter(x=>x.text);
 };
 const commentsToLines=comments=>(comments||[]).map(c=>c.name+'：'+c.text).join('\n');
 const historicalLikeRange=followers=>{
  const n=Math.max(0,Number(followers)||0);
  if(n>=1000000)return {min:Math.max(1000,Math.floor(n*.0005)),max:Math.max(100000,Math.floor(n*.06))};
  return {min:0,max:Math.max(30,Math.floor(n*.5))};
 };
 function renderHistoryEditor(container,account,history){
  const record=history.find(x=>x.id===state.historyEditingId);
  const panel=el('details','lp-wb-history-editor');
  panel.open=Boolean(state.historyFormOpen||state.historyEditingId);
  panel.append(el('summary','','＋ 历史帖管理 · 代发／修改／按要求生成'));
  panel.append(el('small','lp-wb-history-hint',
   '仅影响当前剧情存档中的群星资料；手动填写不会调用模型，AI 生成需主动点击。'));
  const form=el('div','lp-wb-history-form');
  const field=(name,title,value='',type='text')=>{
   const label=el('label','lp-wb-history-field');
   label.append(el('span','',title));
   const input=type==='textarea'?document.createElement('textarea'):document.createElement('input');
   if(type!=='textarea')input.type=type;
   input.dataset.wbHistoryField=name;input.value=String(value??'');
   label.append(input);form.append(label);return input;
  };
  const base=root().storyTime||'';
  const fallback=Number.isFinite(Date.parse(base))?new Date(Date.parse(base)-86400000).toISOString().slice(0,16):'';
  field('time','发布时间（故事时间）',(record?.time&&record.time!=='历史动态'?record.time:fallback).slice(0,16),'datetime-local');
  field('text','帖子正文（以该角色账号发布）',record?.text||'','textarea');
  field('likes','点赞数（可以手动指定）',record?.likes??'','number');
  field('comments','评论（每行一条，例如 粉丝甲：内容）',commentsToLines(record?.comments),'textarea');
  const row=el('div','lp-wb-history-actions');
  row.append(control(record?'保存历史帖修改':'以该角色身份添加历史帖',
   'saveHistoryPost',account.id));
  if(record)row.append(control('取消编辑','cancelHistoryEdit',account.id),
   control('删除这条历史帖','deleteHistoryPost',record.id));
  form.append(row);
  const promptLabel=el('label','lp-wb-history-field');
  promptLabel.append(el('span','','AI 生成额外要求（可选）'));
  const requirements=document.createElement('textarea');requirements.dataset.wbHistoryField='instructions';
  requirements.placeholder='例如：三条剧组日常，语气符合角色卡，不写恋爱内容；评论以粉丝为主';
  promptLabel.append(requirements);form.append(promptLabel);
  const countLabel=el('label','lp-wb-history-field');
  countLabel.append(el('span','','一次生成几条'));
  const select=document.createElement('select');select.dataset.wbHistoryField='count';
  for(const n of [1,3,5]){const option=document.createElement('option');option.value=n;option.textContent=n+' 条';select.append(option);}
  select.value='3';countLabel.append(select);form.append(countLabel);
  form.append(control('按上述要求生成历史帖（调用模型）','generateAccountHistory',account.id));
  panel.append(form);container.append(panel);
 }
 function renderAccountHistoryManager(container){
  const account=data().accounts.find(a=>a.id===state.adminHistoryAccount);
  if(!account){container.append(el('p','lp-wb-empty','该角色账号无法管理'));return;}
  const history=accountHistory(account);
  container.append(heading(account.name+' · 历史帖管理','仅当前故事存档 · 可代发／修改／按要求生成'));
  renderHistoryEditor(container,account,history);
  container.append(heading('已保存的公开帖子','点击编辑后在上方修改，其他入口只允许浏览'));
  for(const post of history.slice(0,80)){
   container.append(card(post,false),control('编辑此条历史帖','editHistoryPost',post.id));
  }
  if(!history.length)container.append(el('p','lp-wb-empty','尚无历史公开动态，可在上方代发或生成。'));
 }
 function renderAccountProfile(container){
  const p=state.profileAccount;
  const source=p.startsWith('post:')?byId(p.slice(5)):null;
  const account=source?actor(source)||{id:p,name:source.author,handle:source.handle||'',avatar:source.avatar||'',followers:source.followers??null,followingCount:source.followingCount??null,likesTotal:source.accountLikes??null,commentsTotal:source.accountComments??null}:data().accounts.find(a=>a.id===p);
  if(!account){container.append(el('p','lp-wb-empty','账号已删除或不可读取'));return;}
  const q=data(),history=accountHistory(account),totals=estimateMetrics(account);
  const head=el('div','lp-wb-account-page'),intro=el('div','lp-wb-account-intro');
  intro.append(avatar(account.avatar,account.name));
  const meta=el('div','lp-wb-account-meta'),detail=el('div','lp-wb-account-details');
  detail.append(el('strong','',account.name),el('small','',account.handle||'尚未设置群星 ID'));
  if(savedProfession(account))detail.append(el('small','',savedProfession(account)));
  if((account.identityVisibility||'public')==='public'){
   const label={self:'本人运营',team:'工作室／团队运营',joint:'本人及团队共同运营',other:'指定运营者'}[operatorMode(account)];
   if(label)detail.append(el('small','',label));
  }
  meta.append(detail);
  const followed=q.following.includes(account.id),buttons=el('div','lp-wb-profile-buttons');
  if(account.id!=='self')buttons.append(control(followed?'已关注':'＋关注',
   followed?'unfollowAccount':'followAccount',account.id));
  meta.append(buttons);intro.append(meta);head.append(intro);
  if(account.bio)head.append(el('p','lp-wb-account-bio',account.bio));
  const knownLikes=history.reduce((n,item)=>n+Math.max(0,Number(item.likes)||0),0);
  const knownComments=history.reduce((n,item)=>n+(item.comments?.length||0),0);
  const stats=el('div','lp-wb-account-stats');
  const pretty=value=>formatFollowers(value).replace(/粉丝$/,'');
  const display=[
   ['粉丝',account.followers==null?'未设置':formatFollowers(account.followers)],
   ['关注',pretty(totals.followingCount)],
   ['获赞',pretty(Math.max(totals.likesTotal,knownLikes))],
   ['获评',pretty(Math.max(totals.commentsTotal,knownComments))]
  ];
  for(const [label,value] of display){const tile=el('div');tile.append(el('strong','',value),el('small','',label));stats.append(tile);}
  head.append(stats);container.append(head);
  container.append(heading('公开动态','按已保存的故事时间排序'));
  for(const item of history.slice(0,80)){
   container.append(card(item,false));
  }
  if(!history.length)container.append(el('p','lp-wb-empty','还没有记录该账号的公开动态。'));

 }
 function card(p,detailed=false){
  const box=el('article','lp-wb-card');
  const acct=actor(p),top=el('div','lp-wb-head'),author=el('div','lp-wb-author');
  author.append(authorButton(acct,p),el('small','',((acct?.handle||p.handle)||'@群星用户')+' · '+(p.category||'日常')));
  const avatarLink=control('',acct?'openAccount':'openPostAuthor',acct?.id||p.id);avatarLink.classList.add('lp-wb-avatar-button');avatarLink.append(avatar(acct?.avatar||p.avatar,p.author));
  top.append(avatarLink,author);
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
  if(p.commentCount!=null&&Number(p.commentCount)>0)
   box.append(el('div','lp-wb-comment-total','评论 '+Number(p.commentCount).toLocaleString('zh-CN')));
  const a=actionState(p),actions=el('div','lp-wb-actions lp-wb-actions-inline');
  const like=control((a.liked?'♥ ':'♡ ')+((p.likes||0)+(a.liked?1:0)),'like',p.id,a.liked);
  like.title=a.liked?'取消点赞':'点赞';like.classList.add('lp-wb-action-compact');
  like.dataset.touchEffect='like';like.setAttribute('aria-pressed',String(Boolean(a.liked)));
  const favorite=control(a.favorited?'★':'☆','favorite',p.id,a.favorited);
  favorite.title=a.favorited?'取消收藏':'收藏';favorite.setAttribute('aria-label',favorite.title);
  favorite.setAttribute('aria-pressed',String(Boolean(a.favorited)));
  favorite.dataset.touchEffect='favorite';
  favorite.classList.add('lp-wb-action-compact','lp-wb-favorite-icon');
  const share=control('分享','shareMenu',p.id);
  share.classList.add('lp-wb-action-compact');
  const comment=el('div','lp-wb-inline-comment');
  const input=document.createElement('input');input.type='text';input.maxLength=500;
  input.placeholder='评论…';input.dataset.wbCommentFor=p.id;input.setAttribute('aria-label','写评论');
  const send=control('↗','sendComment',p.id);send.title='发送评论';send.setAttribute('aria-label','发送评论');
  comment.append(input,send);
  actions.append(like,favorite,share,comment);box.append(actions);
  if(state.sharingId===p.id){
   const menu=el('div','lp-wb-share-menu');
   menu.append(control('转发到我的群星','repost',p.id,a.reposted),control('发送到咕叽聊','shareChat',p.id));
   box.append(menu);
  }
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
   wrap.append(el('div','lp-wb-stats',formatFollowers(q.profile.followers)+'　·　关注 '+q.following.length+
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
  else if(state.subview==='accountEditor')renderAccountEditor(wrap,q);
  else if(state.subview==='profile')renderProfile(wrap,q);
  else if(state.subview==='following'){
   wrap.append(heading('关注列表','取消关注不删除已经保存的账号资料'));
   const list=q.accounts.filter(a=>q.following.includes(a.id));
   for(const a of list){
    const line=el('div','lp-wb-account-line lp-wb-follow-row');
    const open=control('','openAccount',a.id);
    open.classList.add('lp-wb-follow-link');
    open.setAttribute('aria-label','打开 '+a.name+' 的个人主页');
    open.append(avatar(a.avatar,a.name),el('span','',a.name+' '+(a.handle||'')));
    line.append(open,control('取消关注','unfollowAccount',a.id));wrap.append(line);
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
 const selectField=(parent,label,name,value,options)=>{
  const row=el('label','lp-wb-field');row.append(el('span','',label));
  const input=document.createElement('select');input.dataset.wbField=name;
  for(const [key,text] of options){const option=document.createElement('option');option.value=key;option.textContent=text;input.append(option);}
  input.value=value;row.append(input);parent.append(row);return input;
 };
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
   for(const [value,display] of [['person','粉丝'],['wan','万'],['yi','亿']]){
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
 function renderAccountEditor(parent,q){
  const active=q.accounts.find(a=>a.id===state.editing)||{};
  if(state.editing==='new'||active.id){
   const form=el('div','lp-wb-editor');form.append(heading(active.id?'编辑账号':'新增账号'));
   subjectField(form,'绑定故事人物／账号主体','accountSubject',active);
   form.append(el('small','lp-wb-bind-note','绑定关系仅用于关联角色卡和世界书人物；公开主页显示的是昵称、职业和个性签名。'));
   field(form,'账号昵称','accountName',active.name||'');
   field(form,'群星 ID（例如 @example）','accountHandle',active.handle||'');
   field(form,'职业／公开身份','accountProfession',savedProfession(active));
   field(form,'个性签名','accountBio',active.bio||'');
   field(form,'是否为公众人物','accountPublic',active.publicFigure||false,'checkbox');
   selectField(form,'账号运营方式','accountOperatorMode',operatorMode(active),[
    ['self','本人运营'],['team','工作室／经纪团队运营'],['joint','本人及团队共同运营'],['other','其他指定运营者']
   ]);
   field(form,'指定运营者（选择其他时填写）','accountOperatorName',active.operatorName||'');
   selectField(form,'账号真实身份公开程度','accountIdentityVisibility',active.identityVisibility||'public',[
    ['public','公开：账号身份可知'],
    ['private','不公开：私人小号'],
    ['limited','仅指定知情者知晓']
   ]);
   field(form,'指定知情者（可选，仅用于内部剧情）','accountIdentityKnownTo',active.identityKnownTo||'');
   form.append(el('small','lp-wb-bind-note','同一人物可绑定多个独立账号；私人小号不会自动暴露与其他账号的关联。'));
   followerField(form,'粉丝数量','accountFollowers',active.followers||0);
   const extraFields=[['accountFollowing','关注数量（选填）',active.followingCount],
    ['accountLikes','累计获赞（选填）',active.likesTotal],
    ['accountComments','累计获评（选填）',active.commentsTotal]];
   for(const [key,label,value] of extraFields){const input=field(form,label,key,value??'','number');input.min='0';input.step='1';}
   form.append(el('small','lp-wb-bind-note','关注／累计获赞／累计获评可留空：根据粉丝数量和账号类型自动估算既有历史数据；手动填写优先。'));
   avatarPicker(form,'更换角色账号头像','accountAvatar',state.avatarDraft||active.avatar||'',active.name||'角色');
   form.append(control('保存群星账号','saveAccount'));parent.append(form);
  }
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
   const line=el('div','lp-wb-account-line lp-wb-managed-account');
   const identity=el('div','lp-wb-managed-identity');
   identity.append(avatar(a.avatar,a.name));
   const summary=el('div','lp-wb-managed-summary');
   summary.append(el('strong','',a.name),el('small','',(a.handle||'未设ID')+' · '+(savedProfession(a)||(subjectOfAccount(a).type==='organization'?'组织账号':'故事人物'))+' · '+formatFollowers(a.followers)));
   identity.append(summary);
   const actions=el('div','lp-wb-managed-actions');
   actions.append(control('主页','openAccount',a.id),control('编辑','editAccount',a.id),
    control('历史帖管理','manageHistory',a.id),control('删除','deleteAccount',a.id));
   line.append(identity,actions);parent.append(line);
  }
  parent.append(control('＋ 新建账号','newAccount'));
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
  parent.append(scanner);
 }

 function render(){
  const n=nodes();if(!n?.weiboFeed)return;
  reset();
  const pageNames={mine:'我的动态',interactions:'我的互动',following:'关注列表',profile:'个人资料',settings:'群星设置',accountEditor:'编辑群星账号'};
  if(n.title)n.title.textContent=state.adminHistoryAccount?'历史帖管理':state.profileAccount?'个人主页':state.detail?'动态详情':state.topic?'热搜详情':state.tab==='me'&&state.subview?(pageNames[state.subview]||'群星'):'群星';
  n.weiboGenerate.disabled=state.loading||state.hotLoading;
  n.weiboGenerate.textContent=state.tab==='nearby'?'刷新周边帖子':state.tab==='discover'?'重新生成15条热搜':'刷新更多';
  n.weiboTabs.querySelectorAll('[data-weibo-tab]').forEach(b=>b.classList.toggle('selected',b.dataset.weiboTab===state.tab));
  const expanded=Boolean(state.adminHistoryAccount||state.profileAccount||state.detail||state.topic);
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
   if(state.adminHistoryAccount)renderAccountHistoryManager(n.weiboDetail);
   else if(state.profileAccount){
    renderAccountProfile(n.weiboDetail);
   }else if(state.detail){
    const p=byId(state.detail);
    if(p){
     n.weiboDetail.append(card(p,true));
     // 评论输入框已整合到帖子操作栏。
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
   renderAccountSearch(n.weiboHot);
   n.weiboHot.append(heading('世界热搜','公共话题与热门讨论'));
   if(state.hotLoading)n.weiboHot.append(el('p','lp-wb-empty','正在一次生成15条热搜、帖子及评论…'));
   trendList(n.weiboHot,state.trends,'home');
  }else if(state.tab==='nearby'){
   if(state.loading&&state.attempted.nearby)n.weiboNearby.append(el('p','lp-wb-empty','正在生成周边动态及评论…'));
   const q=data(),followed=p=>q.following.some(id=>{
    const a=q.accounts.find(x=>x.id===id);
    return a&&(p.authorId===id||(a.handle&&p.handle===a.handle)||p.author===a.name);
   });
   const list=[...state.posts.nearby,
    ...q.posts.filter(p=>followed(p)||p.zone==='nearby'&&(p.actions?.owned||p.autoPublished)).slice(-35).reverse(),
    ...state.posts.home.filter(followed)];
   const seen=new Set();for(const p of list)if(!seen.has(p.id)){seen.add(p.id);n.weiboNearby.append(card(p,false));}
   if(!list.length&&!state.loading)n.weiboNearby.append(el('p','lp-wb-empty','点击刷新周边，生成身边人的帖子和评论'));
  }else if(state.tab==='me')renderMine(n);
  const target={home:n.weiboFeed,discover:n.weiboHot,nearby:n.weiboNearby}[state.tab];
  if(target){n.weiboGenerate.hidden=false;n.weiboGenerate.classList.add('lp-wb-refresh-button');target.append(n.weiboGenerate);}
  else{n.weiboGenerate.hidden=true;n.weiboRefreshBox.append(n.weiboGenerate);}
 }

 async function followPost(p,enabled){
  await mutate(q=>{
   let account=accountForPost(p,q.accounts);
   if(!account&&enabled){
    account={id:uid('account'),name:p.author,handle:p.handle||'',avatar:p.avatar||'',bio:'',kind:'网友',publicFigure:false,followers:p.followers??0,followingCount:p.followingCount??null,likesTotal:p.accountLikes??null,commentsTotal:p.accountComments??null,source:'follow'};
    q.accounts.push(account);
   }
   if(!account)return;
   if(enabled){q.following=[...new Set([...q.following,account.id])];
    if(!q.posts.some(x=>x.id===p.id))q.posts.push({...p,authorId:account.id});}
   else q.following=q.following.filter(x=>x!==account.id);
  });
 }
 async function persistAction(p,change){
  const apply=post=>{
   const patch={...change};delete patch.newComment;
   post.actions={...(post.actions||{}),...patch};
   if(change.newComment){
    post.comments=[...(post.comments||[]),change.newComment];
    post.commentCount=Math.max(post.comments.length,Number(post.commentCount||0)+1);
   }
  };
  await mutate(q=>{
   const permanent=isPermanentPost(p,q);
   let stored=q.posts.find(x=>x.id===p.id);
   if(permanent){
    if(!stored){stored={...p,actions:{}};q.posts.push(stored);}
    apply(stored);q.posts=q.posts.slice(-180);
   }else if(stored&&!stored.actions?.owned){
    // Migration cleanup for old versions which persisted every liked random user.
    q.posts=q.posts.filter(x=>x.id!==p.id);
   }
   for(const feed of Object.values(q.generated?.feeds||{})){
    if(Array.isArray(feed))for(const post of feed)if(post.id===p.id)apply(post);
   }
   for(const topic of Object.values(q.generated?.hotBundles||{})){
    if(Array.isArray(topic?.posts))for(const post of topic.posts)if(post.id===p.id)apply(post);
   }
  });
  const observed=new Set();
  for(const feed of [state.posts.home,state.posts.nearby,...Object.values(state.hotBundles).map(x=>x?.posts||[]),state.topic?.posts||[]]){
   for(const post of feed||[])if(post.id===p.id&&!observed.has(post)){apply(post);observed.add(post);}
  }
  if(!observed.has(p))apply(p);
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
if(type==='subview'){state.subview=id;state.profileAccount='';state.editing='';render();nodes().weiboMe.parentElement.scrollTop=0;return;}
  if(type==='backMe'){state.subview=state.subview==='accountEditor'?'settings':'';state.editing='';render();nodes().weiboMe.parentElement.scrollTop=0;return;}
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
    const candidateInfo=state.candidates[Number(row.dataset.wbCandidate)];
    chosen.push({name,handle:value('handle'),subject,
     kind:subject.type==='primary'?'角色':subject.type==='organization'?'组织':'NPC',
     profession:value('profession'),bio:value('bio'),publicFigure:value('publicFigure'),followers,
     ...(subject.type==='npc'&&candidateInfo?.reference?{roleBrief:clean(candidateInfo.reference,1000)}:{})});
   }
   if(!chosen.length){feedback('请先勾选要保存的候选账号');return;}
   await mutate(q=>{
    for(const candidate of chosen){
     const old=q.accounts.find(x=>x.name===candidate.name||(candidate.handle&&x.handle===candidate.handle));
     const sameSubject=old?.subject?.type===candidate.subject.type&&old?.subject?.name===candidate.subject.name;
     const next={...old,...candidate,id:old?.id||uid('account'),
      roleBrief:candidate.subject.type==='npc'?(candidate.roleBrief??(sameSubject?old.roleBrief||'':'')):'',
      avatar:old?.avatar||'',source:'manual'};
     q.accounts=old?q.accounts.map(x=>x.id===old.id?next:x):[...q.accounts,next];
    }
   });
   state.candidates=[];state.scanMessage='已保存 '+chosen.length+' 个已确认账号，未勾选的没有写入。';
   feedback(state.scanMessage);render();return;
  }
  if(type==='manageHistory'){
   const account=data().accounts.find(a=>a.id===id);
   if(!account||state.subview!=='settings')return;
   state.adminHistoryAccount=id;state.profileAccount='';state.historyEditingId='';state.historyFormOpen=true;
   state.detail='';state.topic=null;render();
   if(nodes()?.weiboDetail)nodes().weiboDetail.scrollTop=0;
   return;
  }
  if(type==='backAccountEditor'){state.editing='';state.avatarDraft='';state.subview='settings';render();return;}
  if(type==='openAccount'||type==='openPostAuthor'){
   const post=type==='openPostAuthor'?byId(id):null;
   state.profileAccount=post?'post:'+post.id:id;
   state.adminHistoryAccount='';state.historyEditingId='';state.historyFormOpen=false;
   state.detail='';state.topic=null;state.sharingId='';render();return;
  }
  if(type==='followAccount'){
   if(id.startsWith('post:')){
    const post=byId(id.slice(5));if(post){await followPost(post,true);state.profileAccount=data().accounts.find(a=>a.name===post.author)?.id||id;}
   }else await mutate(q=>{if(q.accounts.some(a=>a.id===id))q.following=[...new Set([...q.following,id])];});
   render();return;
  }
  if(type==='editHistoryPost'){
   const found=byId(id);
   const owner=data().accounts.find(a=>a.id===state.adminHistoryAccount);
   if(!found||!owner||!accountMatches(found,owner))return;
   state.historyEditingId=id;state.historyFormOpen=true;render();return;
  }
  if(type==='cancelHistoryEdit'){
   state.historyEditingId='';state.historyFormOpen=true;render();return;
  }
  if(type==='saveHistoryPost'){
   const owner=data().accounts.find(a=>a.id===id);
   if(!owner||state.adminHistoryAccount!==id)return;
   const form=nodes()?.weiboDetail;
   const get=name=>form?.querySelector('[data-wb-history-field="'+name+'"]')?.value||'';
   const text=clean(get('text'),1000),time=get('time').trim();
   if(!text){feedback('请填写历史帖子正文');return;}
   const story=Date.parse(root().storyTime||''),stamp=Date.parse(time);
   if(time&&(!Number.isFinite(stamp)||(Number.isFinite(story)&&stamp>story))){
    feedback('历史帖发布时间必须是有效的故事时间，且不能晚于当前剧情');return;
   }
   const rawLikes=get('likes').trim();
   if(rawLikes&&!/^\d+$/.test(rawLikes)){feedback('点赞数必须为非负整数');return;}
   const likes=rawLikes?Number(rawLikes):0;
   if(!Number.isSafeInteger(likes)||likes>9999999999){feedback('点赞数超出允许范围');return;}
   const comments=parseCommentLines(get('comments'));
   const selected=state.historyEditingId,original=selected?byId(selected):null;
   if(selected&&(!original||!accountMatches(original,owner)))return;
   const post={...(original||{}),id:original?.id||uid('post'),
    author:owner.name,authorId:owner.id,handle:owner.handle,avatar:owner.avatar,
    category:original?.category||'历史公开动态',text,likes,comments,
    time:time||original?.time||'历史动态',zone:'world',actions:original?.actions||{},
    manuallyCurated:true,backfilled:original?.backfilled??true};
   await mutate(q=>{
    const index=q.posts.findIndex(x=>x.id===post.id);
    if(index>=0)q.posts[index]=post;else q.posts.push(post);
    for(const feed of Object.values(q.generated?.feeds||{})){
     if(Array.isArray(feed)){const position=feed.findIndex(x=>x.id===post.id);if(position>=0)feed[position]=post;}
    }
    q.posts=q.posts.slice(-300);
   });
   for(const feed of [state.posts.home,state.posts.nearby]){
    const i=feed.findIndex(x=>x.id===post.id);if(i>=0)feed[i]=post;
   }
   state.historyEditingId='';state.historyFormOpen=false;
   feedback(original?'历史帖子已更新':'已代该角色保存历史帖子');render();return;
  }
  if(type==='deleteHistoryPost'){
   const post=byId(id),owner=data().accounts.find(a=>a.id===state.adminHistoryAccount);
   if(!post||!owner||!accountMatches(post,owner))return;
   if(typeof window!=='undefined'&&typeof window.confirm==='function'&&!window.confirm('删除这条角色历史帖？此操作只影响当前剧情存档。'))return;
   await mutate(q=>{
    q.posts=q.posts.filter(p=>p.id!==id);
    for(const feed of Object.values(q.generated?.feeds||{}))
     if(Array.isArray(feed)){const index=feed.findIndex(p=>p.id===id);if(index>=0)feed.splice(index,1);}
   });
   state.posts.home=state.posts.home.filter(x=>x.id!==id);
   state.posts.nearby=state.posts.nearby.filter(x=>x.id!==id);
   state.historyEditingId='';state.historyFormOpen=false;
   feedback('历史帖已删除');render();return;
  }
  if(type==='generateAccountHistory'){
   const account=data().accounts.find(a=>a.id===id);
   if(!account||state.adminHistoryAccount!==id)return;
   const details=nodes()?.weiboDetail;
   const extra=clean(details?.querySelector('[data-wb-history-field="instructions"]')?.value,1400);
   const count=Math.max(1,Math.min(5,Number(details?.querySelector('[data-wb-history-field="count"]')?.value)||3));
   const session=scope(),scene=root().storyTime||'';
   const cardSetting=clean([api.accountSubjectContext?.(subjectOfAccount(account))||'',account.roleBrief||''].filter(Boolean).join('\n'),4500);
   const recent=accountHistory(account).slice(0,12).map(p=>clean(p.text,140)).join('；');
   const contextText=clean(api.storyContext?.()||'',1200);
   const range=historicalLikeRange(account.followers);
   feedback('正在按人物设定及你的要求生成历史公开动态…');
   try{
    const prompt=[
     '角色账号：'+account.name+'；职业：'+savedProfession(account)+'；签名：'+account.bio,
     '公开人物：'+(account.publicFigure?'是':'否')+'；粉丝：'+formatFollowers(account.followers),
     '绑定的角色卡／NPC设定（性格、言谈、行为边界必须遵守）：'+(cardSetting||'以账号设定为准，不补写未知设定'),
     '账号运营方式：'+accountOperatorGuide(account)+'；身份公开程度：'+(account.identityVisibility||'public')+
      '；指定知情者：'+(account.identityKnownTo||'无')+'。私人小号不可自动公开和官方大号的关联。',
     '当前故事时间：'+scene+'；已知剧情：'+contextText,
     '此前已发布的内容（避免重复）：'+(recent||'暂无'),
     '用户本次生成的明确要求（优先执行，不能覆盖故事已确定事实）：'+(extra||'以符合角色性格的日常公开动态为主'),
     '生成 '+count+' 条该角色在故事当前时间之前公开发布的旧帖。应像真人发的不同时间的帖子，不要都像搞笑段子，不要重复同一口癖；不能代替 user 言行，不能编造重大工作、恋情或私生活。',
     '每条都要有 2~6 条符合互联网语境的真实评论，不得输出空评论数组。评论者视角应独立，有粉丝或路人正常互动，允许不同看法。',
     account.publicFigure&&Number(account.followers)>=1000000?
       '已知账号为公众人物，互动量必须与 '+formatFollowers(account.followers)+' 相符。普通公开帖子点赞一般在 '+
        range.min+'～'+range.max+' 之间，可按话题热度浮动；不要生成几百赞零评论的量级。':'点赞数根据账号类型和受众规模合理变化，不要一律几百或几万。',
     '必须只返回合法 JSON：{"posts":[{"text":"帖子正文","likes":10000,"daysAgo":1,"comments":[{"name":"评论者","text":"评论内容"},{"name":"另一位评论者","text":"另一条评论"}]}]}。',
     'daysAgo 是距当前剧情日 1～60 天的整数；所有内容必须先于故事当前时间，不得输出 Markdown 或额外解释。'
    ].join('\n');
    const raw=await api.phoneGenerate(context(),{
     task:'weibo',maxTokens:Math.min(7000,1400+count*900),
     systemPrompt:'你要根据绑定人物的全部明确设定创作虚构社交账号历史发帖；严格遵守角色性格、故事事实与已知公开信息。每条必须有正文、合理点赞数、评论列表。只返回合法 JSON。',
     prompt:[{role:'user',content:prompt}]
    },api.readData(context()));
    if(scope()!==session)return;
    const parsed=parse(raw),rows=Array.isArray(parsed.posts)?parsed.posts.slice(0,count):[];
    const stamp=Date.parse(scene),valid=[];
    for(let i=0;i<rows.length;i++){
     const p=rows[i],text=clean(p?.text,1000);
     if(!text)continue;
     const comments=(Array.isArray(p?.comments)?p.comments:[]).map(c=>
      typeof c==='string'?{id:uid('comment'),name:'网友',text:clean(c,350)}:
      {id:uid('comment'),name:clean(c?.name||'网友',40),text:clean(c?.text,350)}
     ).filter(c=>c.text).slice(0,8);
     // Missing comments is not silently accepted as a completed generated history post.
     if(comments.length<2)continue;
     const sourceLikes=Math.floor(Number(p.likes));
     const likes=Number.isSafeInteger(sourceLikes)?
      Math.min(range.max,Math.max(range.min,sourceLikes)):
      Math.min(range.max,Math.max(range.min,Math.round(Number(account.followers||0)*.002)));
     const ago=Number.isSafeInteger(Number(p.daysAgo))?
      Math.max(1,Math.min(60,Number(p.daysAgo))):i+1;
     const time=Number.isFinite(stamp)?new Date(stamp-ago*86400000).toISOString().slice(0,16):'历史动态';
     valid.push({id:uid('post'),author:account.name,authorId:account.id,
      handle:account.handle,avatar:account.avatar,category:'历史公开动态',
      text,likes,comments,time,zone:'world',actions:{},backfilled:true});
    }
    if(!valid.length)throw Error('模型没有返回至少两条评论的有效历史帖；未写入任何帖子。可补充要求后重新生成');
    await mutate(q=>{
     if(!q.accounts.some(a=>a.id===id))return;
     q.posts.push(...valid);q.posts=q.posts.slice(-300);
    });
    state.historyEditingId='';state.historyFormOpen=false;
    feedback('已保存 '+valid.length+' 条符合评论要求的历史帖'+(valid.length<rows.length?'；忽略了缺少评论的结果':''));
   }catch(e){feedback('生成历史动态失败：'+String(e.message||e));}
   render();return;
  }
  if(type==='newAccount'||type==='editAccount'){
   state.editing=type==='newAccount'?'new':id;state.avatarDraft='';state.subview='accountEditor';
   state.profileAccount='';state.adminHistoryAccount='';state.detail='';state.topic=null;
   render();
   if(nodes()?.weiboMe?.parentElement)nodes().weiboMe.parentElement.scrollTop=0;
   return;
  }
  if(type==='deleteAccount'){
   if(typeof window!=='undefined'&&typeof window.confirm==='function'&&!window.confirm('删除该群星账号？此操作无法撤销。'))return;
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
   const readOptional=key=>{
    const value=v(key)?.value?.trim();if(!value)return null;
    const n=Number(value);if(!Number.isSafeInteger(n)||n<0)throw Error('关注／获赞／获评需填写非负整数');
    return n;
   };
   let followers,subject,followingCount,likesTotal,commentsTotal;
   try{
    followers=readFollowerField(wrap,'accountFollowers');
    subject=readSubject(v('accountSubject')?.value,
     subjectChoices(previous?.subject?.name?[previous.subject.name]:previous?.name?[previous.name]:[]));
    followingCount=readOptional('accountFollowing');likesTotal=readOptional('accountLikes');commentsTotal=readOptional('accountComments');
   }catch(error){feedback(error.message);return;}
   const mode=v('accountOperatorMode')?.value||'self';
   const operatorName=clean(v('accountOperatorName')?.value,70);
   const visibility=v('accountIdentityVisibility')?.value||'public';
   if(mode==='other'&&!operatorName){feedback('请填写指定运营者的姓名');return;}
   if(!['self','team','joint','other'].includes(mode)||!['public','private','limited'].includes(visibility)){
    feedback('账号运营方式或身份可见范围无效');return;
   }
   const handle=clean(v('accountHandle')?.value,45);
   if(handle&&data().accounts.some(a=>a.id!==edit&&a.handle===handle)){
    feedback('群星 ID 已被另一账号使用，请更换');return;
   }
   await mutate(q=>{
    const old=q.accounts.find(x=>x.id===edit)||{};
    const sameSubject=old.subject?.type===subject.type&&old.subject?.name===subject.name;
    const next={...old,id:old.id||uid('account'),name,handle,bio:clean(v('accountBio')?.value,450),
     operatorMode:mode,operatorName,identityVisibility:visibility,
     identityKnownTo:clean(v('accountIdentityKnownTo')?.value,180),
     roleBrief:subject.type==='npc'&&sameSubject?(old.roleBrief||''):'',
     subject,kind:subject.type==='primary'?'角色':subject.type==='organization'?'组织':'NPC',
     profession:clean(v('accountProfession')?.value,80),followingCount,likesTotal,commentsTotal,publicFigure:!!v('accountPublic')?.checked,
     followers,avatar:avatarDraft||old.avatar||'',source:'manual'};
    q.accounts=old.id?q.accounts.map(a=>a.id===old.id?next:a):[...q.accounts,next];
   });
   state.editing='';state.avatarDraft='';state.subview='settings';feedback('群星账号已保存');render();return;
  }
  const p=byId(id);if(!p)return;
  if(type==='shareMenu'){state.sharingId=state.sharingId===p.id?'':p.id;render();return;}
  if(type==='shareChat'){state.sharingId='';api.sharePost?.(p);return;}
  if(type==='share'){api.sharePost?.(p);return;}
  if(type==='detail'){state.detail=id;render();return;}
  if(type==='follow'||type==='unfollow'){await followPost(p,type==='follow');render();return;}
  if(type==='sendComment'){
   const input=nodes().weiboDetail?.querySelector('[data-wb-comment-for="'+p.id+'"]')||
    nodes().weiboFeed?.querySelector('[data-wb-comment-for="'+p.id+'"]')||
    nodes().weiboNearby?.querySelector('[data-wb-comment-for="'+p.id+'"]')||
    nodes().weiboHot?.querySelector('[data-wb-comment-for="'+p.id+'"]');
   const text=clean(input?.value,500);if(!text)return;
   const c={id:uid('comment'),name:data().profile.nickname||'我',text};
   await persistAction(p,{comments:[...(actionState(p).comments||[]),c],newComment:c});
   if(isPermanentPost(p)){
    const d=structuredClone(root());api.publishPhoneAppEvent(d,{app:'weibo',action:'commented',id:c.id,detail:'评论 '+p.author+'：'+text,reference:p.id});
    await api.writeData(context(),{...d,__contactId:'primary'});
   }
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
   state.tab='discover';state.detail='';state.topic=null;state.profileAccount='';state.adminHistoryAccount='';state.subview='';
   feedback('');render();return;
  }
  if(t!==state.tab)feedback('');
  if(t==='me'&&state.tab==='me')state.subview='';
  if(t!=='me')state.subview='';
  state.tab=t;state.detail='';state.topic=null;state.profileAccount='';state.adminHistoryAccount='';state.sharingId='';render();
  if(nodes()?.weiboFeed?.parentElement)nodes().weiboFeed.parentElement.scrollTop=0;
  if(t==='home'&&!state.attempted.world){state.attempted.world=true;void generate('home');}
  if(t==='nearby'&&!state.attempted.nearby){
   state.attempted.nearby=true;void generate('nearby');
  }
 }
 function back(){
   if(state.adminHistoryAccount){state.adminHistoryAccount='';state.historyEditingId='';state.historyFormOpen=false;}
   else if(state.profileAccount)state.profileAccount='';
   else if(state.detail)state.detail='';
   else if(state.topic)state.topic=null;
   else if(state.subview==='accountEditor'){state.subview='settings';state.editing='';}
   else if(state.subview)state.subview='';
   else return false;
   render();return true;
  }
 function handleInput(event){
  if(!event.target?.matches?.('[data-wb-account-search]'))return false;
  state.searchQuery=event.target.value||'';
  renderAccountSearchResults(event.target.parentElement?.querySelector('[data-wb-search-results]'));
  return true;
 }
 function handleKeydown(event){
  if(event.key!=='Enter'||!event.target?.matches?.('[data-wb-comment-for]'))return false;
  event.preventDefault();
  void action('sendComment',event.target.dataset.wbCommentFor).catch(e=>feedback('评论失败：'+String(e.message||e)));
  return true;
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
  const accounts=q.accounts.filter(a=>a.source==='manual'&&a.kind!=='网友');if(!accounts.length){if(force)feedback('请先在「我 → 群星设置」添加账号');return;}
  if(!force&&q.lastAutoStoryMinute&&now-q.lastAutoStoryMinute<every)return;
  autoBusy=true;
  try{
   const index=q.posts.filter(p=>p.autoPublished).length%accounts.length,account=accounts[index];
   // Mark attempted story time before generation to avoid duplicate posts and billing.
   await mutate(s=>{s.lastAutoStoryMinute=now;});
   const photos=api.photosForAccount?.(account.name)||[];
   const subjectContext=clean(api.accountSubjectContext?.(subjectOfAccount(account))||account.roleBrief||'',1400);
   const albumGuide=photos.slice(0,12).map(p=>p.id+'：'+(p.description||p.title||'照片')).join('；');
   const raw=await api.phoneGenerate(context(),{task:'autonomy',systemPrompt:'扮演指定账号主体（故事人物或组织）在剧情世界的公开社交账号上自主发帖；只输出正文或 [SKIP]。遵守账号绑定人物的职业、已知设定或组织性质，不混淆不同人物身份。如有适合的账号主体公开相册照片，可以在文末加 [[photo:照片ID]]；不能编造照片ID。',prompt:[{role:'user',
    content:'故事时间：'+scene+'。群星账号：'+account.name+'，职业／公开资料 '+publicAccountDescription(account)+'，账号主体 '+(subjectOfAccount(account).type==='organization'?'组织账号':'故事人物')+'，公众人物：'+(account.publicFigure?'是':'否')+
     '。账号运营方式：'+accountOperatorGuide(account)+'。账号身份公开程度：'+(account.identityVisibility||'public')+
      '；知情者：'+(account.identityKnownTo||'无')+'。绑定人物设定（仅用于保持角色一致，不代表全部内容可公开）：'+subjectContext+
      '。可用公开相册照片：'+albumGuide+'。近期剧情：'+clean(api.storyContext?.()||'',1400)+
      '。结合职业、性格、公共活动和时间线决定是否发布。私人小号不得自动暴露和绑定人物、官方大号的关系。不得公开私聊秘密，不得杜撰用户行为、未发生事件或已确定恋情。可以不发，输出 [SKIP]。否则只输出一条 20～180 字的社交动态，不要额外解释。'}]},api.readData(context()));
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
 return {open,render,generate,generateHot,confirmHotSearch,endPhoneSession,headline,selectTab,back,publish,publishAlbumPhoto,handleClick,handleInput,handleKeydown,handleFile,tick,state,parse,normalize,openTopic};
}
