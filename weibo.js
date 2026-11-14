/* 群星 · story-aware public social feed. Persists identities and interactions per story chat. */
export function createWeiboModule(api) {
 const state={scope:'',tab:'home',detail:'',topic:null,subview:'',posts:{home:[],nearby:[]},trends:[],nearbyTrends:[],loading:false,attempted:{},token:0,editing:'',avatarDraft:'',avatarOwnerDraft:'',candidates:[],scanLoading:false,scanMessage:''};
 let writes=Promise.resolve(), autoBusy=false;
 const context=()=>api.context(), nodes=()=>api.getNodes(), root=()=>api.readRootData(context());
 const uid=(prefix='qx')=>prefix+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
 const scope=()=>[context()?.characterId,context()?.chatId,context()?.groupId].join(':');
 const el=(tag,cls='',value='')=>{const x=document.createElement(tag);if(cls)x.className=cls;if(value)x.textContent=value;return x;};
 const defaults={autoEnabled:false,autoEveryMinutes:180,nearbyHint:''};
 const clean=(s,n=100)=>String(s||'').trim().slice(0,n);
 const data=()=>{
  const r=root(),q=r.qunxing||{};
  return {profile:{nickname:api.currentPersona(context())?.name||context()?.name1||'我',handle:'',bio:'',avatar:'',followers:0,...q.profile},
   accounts:Array.isArray(q.accounts)?q.accounts:[],
   following:Array.isArray(q.following)?q.following:[],
   posts:Array.isArray(q.posts)?q.posts:[],topicDetails:q.topicDetails&&typeof q.topicDetails==='object'?q.topicDetails:{},
   trends:Array.isArray(q.trends)?q.trends:[],nearbyTrends:Array.isArray(q.nearbyTrends)?q.nearbyTrends:[],
   settings:{...defaults,...q.settings},lastAutoStoryMinute:Number(q.lastAutoStoryMinute)||0};
 };
 async function mutate(change){
  const task=writes.then(async()=>{
   const c=context(),r=structuredClone(api.readRootData(c)),q=data();
   const result=change(q,r);
   r.qunxing=q;
   await api.writeData(c,{...r,__contactId:'primary'});
   return result;
  });
  writes=task.catch(()=>{});
  return task;
 }
 const feedback=s=>{if(nodes()?.weiboFeedback)nodes().weiboFeedback.textContent=s;};
 function reset(){
  const next=scope();if(next===state.scope)return;
  state.scope=next;state.tab='home';state.detail='';state.topic=null;state.subview='';state.posts={home:[],nearby:[]};state.candidates=[];state.scanMessage='';state.scanLoading=false;
  state.trends=[];state.nearbyTrends=[];state.attempted={};state.loading=false;state.token++;
 }
 const actionState=p=>data().posts.find(x=>x.id===p.id)?.actions||p.actions||{};
 const actor=p=>data().accounts.find(a=>(p.authorId&&a.id===p.authorId)||(p.author&&a.name===p.author)||(p.handle&&a.handle===p.handle));
 function allPosts(){
  const q=data();
  const legacy=(Array.isArray(root().weiboSaved)?root().weiboSaved:[]).filter(p=>p?.id).map(p=>({...p,zone:p.zone||'world'}));
  const cached=Object.values(q.topicDetails).flatMap(t=>Array.isArray(t?.posts)?t.posts:[]);
  const combined=[...q.posts,...legacy,...state.posts.home,...state.posts.nearby,...cached,...(state.topic?.posts||[])],seen=new Set();
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
  const comments=(Array.isArray(p.comments)?p.comments:[]).map(c=>({id:uid('c'),name:clean(c.name||c.author||'网友',40),text:clean(c.text||c.content,350)})).filter(c=>c.text).slice(0,12);
  return {id:uid('post'),author,handle:acct?.handle||handle,authorId:acct?.id||'',avatar:acct?.avatar||'',category:clean(p.category||'日常',24),
   text,comments,likes:Math.max(0,Math.min(9999999,Number(p.likes)||0)),zone,time:root().storyTime||'',actions:{}};
 }
 function prompt(count,zone,topic='',withTrend=false){
  const q=data(),r=root(),char=api.selectedCharacter(context()),nearby=zone==='nearby';
  const accounts=q.accounts.slice(0,25).map(a=>(a.name+'（@'+(a.handle||a.id)+'；'+(a.kind||'人物')+'；'+(a.publicFigure?'公众人物；':'')+clean(a.bio,90)+'）')).join('、');
  const followed=q.accounts.filter(a=>q.following.includes(a.id)).map(a=>a.name).join('、');
  const known=(r.contacts||[]).slice(0,20).map(a=>a.name+'：'+clean(a.description,90)).join('；');
  const interactions=q.posts.filter(p=>(p.actions?.comments||[]).length).slice(-3).map(p=>p.author+':'+clean(p.text,60)).join(' / ');
  const scene=clean(api.storyContext?.()||'',2200);
  const media=nearby?'校园、公司、剧组、社团、朋友圈、同事、校内论坛、附近生活':'娱乐圈、社会、科技、时尚、体育、影视、游戏、音乐、生活、新闻';
  return [
   '你正在生成故事世界的公共社交平台「群星」信息流。剧情时间：'+(r.storyTime||'未设定')+'。区域：'+(nearby?'周边，围绕用户和角色所处学校/公司/剧组/熟人社会':'世界，面向广泛社会')+'。',
   '当前主角：'+(char?.name||'未选择')+'。角色资料：'+clean(char?.description,850)+'。已知人物：'+known,
   '用户手动建立的群星账号（这些身份不可随意改名、捏造性格）：'+(accounts||'尚未建立')+'。已关注：'+(followed||'无')+'。周边补充设定：'+clean(q.settings.nearbyHint,220)+'。',
   '近期剧情（仅作为已发生事件的依据）：'+scene+'。用户已经公开互动的动态：'+interactions,
   '遵循角色的职业、公众身份与社交边界。已建立的公众人物可以被媒体、粉丝、社交圈讨论，也可能合理上热搜，但不必每次上；普通人不要被无端全国关注。',
   '绝不把私聊、内心想法、未公开的恋爱关系或未发生的剧情编成公开事实。用户行为只能依据已明确发生的内容。允许陌生网友讨论无关话题，不能每条都围绕角色。',
   '内容应包含'+media+'等领域。'+(nearby?'如果没有明确校园/公司地点，不要虚构具体地名；可写故事环境中的日常近况。':'世界版普通推荐帖子不是热搜榜，避免全是重大新闻。'),
   topic?'本次围绕话题：'+topic:'',
   '只输出合法 JSON：{"posts":[{"author":"作者昵称","handle":"@账号","category":"分类","text":"微博正文","likes":28,"comments":[{"name":"评论者","text":"评论内容"}]}],"trending":[{"title":"话题标题","category":"分类"}]}。',
   '生成 '+count+' 条不重复的帖子，每条建议 3～6 条观点不同的评论。'+(withTrend?'另生成 15 条多样化热搜话题，可有少量与已知公众人物有关。':'trending 可为空数组。'),
   'JSON 尽量紧凑，不要 markdown、不输出思维过程。'
  ].filter(Boolean).join('\n');
 }
 async function generate(zone='home',topic=''){
  reset();if(state.loading)return;
  if(!api.selectedCharacter(context())){feedback('请先选择故事角色');return;}
  const name=zone==='nearby'?'周边':'世界',token=++state.token,session=state.scope;
  state.loading=true;feedback('正在刷新'+name+'内容…');render();
  const arr=[],trends=[];
  try{
   for(let i=0;i<2;i++){
    let response;
    try{response=await api.phoneGenerate(context(),{systemPrompt:'只输出合法 JSON，不输出分析。',prompt:[{role:'user',content:prompt(5,zone,topic,i===0)}]},api.readData(context()));}
    catch(e){if(!arr.length)throw e;api.recordError('群星部分刷新',e);break;}
    if(session!==scope()||token!==state.token)return;
    const parsed=parse(response);
    arr.push(...(Array.isArray(parsed.posts)?parsed.posts:[]).map(p=>normalize(p,zone)).filter(Boolean).slice(0,5));
    if(i===0)for(const v of (Array.isArray(parsed.trending)?parsed.trending:[]).slice(0,20)){
     const title=clean(v.title||v,65);if(title&&!trends.some(x=>x.title===title))trends.push({title,category:clean(v.category||'热门',22)});
    }
   }
   if(arr.length<3)throw Error('有效内容不足，请重新刷新');
   const slot=zone==='nearby'?'nearby':'home';
   state.posts[slot]=[...state.posts[slot],...arr].slice(-80);
   if(trends.length){if(zone==='nearby')state.nearbyTrends=trends;else state.trends=trends;}
   await mutate(q=>{
    if(trends.length){if(zone==='nearby')q.nearbyTrends=trends;else q.trends=trends;}
    // Followed-account posts are part of the continuing story, not one-time random feed.
    for(const p of arr)if(p.authorId&&q.following.includes(p.authorId)&&!q.posts.some(x=>x.id===p.id))q.posts.push(p);
    q.posts=q.posts.slice(-180);
   });
   feedback('已更新 '+arr.length+' 条'+name+'动态');
   api.recordActivity('群星刷新',name+'：'+arr.length+' 条','success');
  }catch(e){feedback('刷新失败：'+String(e.message||e));api.recordError('群星生成',e);}
  finally{state.loading=false;if(state.tab!=='me')render();else if(nodes()?.weiboGenerate)nodes().weiboGenerate.disabled=false;}
 }

 const topicKey=(zone,title)=>JSON.stringify([zone,title]);
 async function openTopic(title,zone='home'){
  reset();
  const key=topicKey(zone,title),cached=data().topicDetails[key];
  state.detail='';
  state.topic={title,zone,key,summary:cached?.summary||'',posts:cached?.posts||[],loading:false,error:''};
  render();
  if(!cached?.posts?.length)await loadTopic();
 }
 async function loadTopic(){
  const t=state.topic;if(!t||t.loading)return;
  const session=scope(),key=t.key;
  t.loading=true;t.error='';render();
  try{
   const raw=await api.phoneGenerate(context(),{systemPrompt:'只输出有效 JSON。',prompt:[{role:'user',content:
    prompt(4,t.zone,t.title,false)+'\n现在是打开「'+t.title+'」话题详情页，不是刷新首页。请针对该话题生成4条不同视角的帖子，每条附3至6条评论。返回 JSON：{"summary":"话题概况","posts":[{"author":"昵称","text":"正文","comments":[{"name":"网友","text":"评论"}]}]}。请不要编造未公开的私事。'}]},api.readData(context()));
   if(session!==scope()||state.topic?.key!==key)return;
   const parsed=parse(raw),posts=(Array.isArray(parsed.posts)?parsed.posts:[])
    .map(p=>normalize(p,t.zone==='nearby'?'nearby':'world')).filter(Boolean).slice(0,6);
   if(!posts.length)throw Error('话题没有生成有效讨论');
   const summary=clean(parsed.summary,500);
   await mutate(q=>{
    const details={...q.topicDetails,[key]:{title:t.title,zone:t.zone,summary,posts}};
    const keys=Object.keys(details);
    if(keys.length>30)for(const old of keys.slice(0,keys.length-30))delete details[old];
    q.topicDetails=details;
   });
   if(state.topic?.key===key)state.topic={...t,summary,posts,loading:false,error:''};
  }catch(e){
   if(state.topic?.key===key){t.error='加载话题失败：'+String(e.message||e);t.loading=false;}
   api.recordError('群星话题',e);
  }finally{if(state.topic?.key===key){state.topic.loading=false;render();}}
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
  const comments=el('div','lp-wb-comments');
  for(const c of (detailed?(p.comments||[]):(p.comments||[]).slice(0,3))){
   const line=el('p');line.append(el('b','',c.name+'：'),document.createTextNode(c.text));
   comments.append(line);
  }
  if(comments.childNodes.length)box.append(comments);
  const a=actionState(p),actions=el('div','lp-wb-actions');
  actions.append(control('♡ '+((p.likes||0)+(a.liked?1:0)),'like',p.id,a.liked),
   control('评论','detail',p.id),control('转发','repost',p.id,a.reposted),control('收藏','favorite',p.id,a.favorited));
  box.append(actions);
  if(!detailed)box.append(control('查看详情','detail',p.id));
  return box;
 }
 function heading(title,subtitle=''){const d=el('div','lp-wb-section-heading');d.append(el('strong','',title));if(subtitle)d.append(el('small','',subtitle));return d;}
 function trendList(parent,list,zone){
  if(!list.length){parent.append(el('p','lp-wb-empty','刷新后显示热门话题'));return;}
  list.forEach((t,i)=>{
   const b=el('button','lp-wb-hot-item');b.type='button';b.dataset.wbTopic=t.title;b.dataset.wbZone=zone;
   b.append(el('strong','',String(i+1)),el('span','',t.title),el('small','',t.category||''));parent.append(b);
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
   wrap.append(el('div','lp-wb-stats','粉丝 '+q.profile.followers+'　·　关注 '+q.following.length+
    '　·　动态 '+q.posts.filter(p=>p.actions?.owned).length));
   const menu=el('div','lp-wb-me-menu');
   for(const [key,label] of Object.entries(names)){
    const item=control(label,'subview',key);
    item.append(el('span','lp-wb-menu-arrow','›'));menu.append(item);
   }
   wrap.append(menu);return;
  }
  const bar=el('div','lp-wb-subpage-bar');
  bar.append(control('‹ 返回','backMe'),el('strong','',names[state.subview]||'群星'));
  wrap.append(bar);
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
   const arr=state.subview==='interactions'?allPosts().filter(p=>isSaved(actionState(p))):
    q.posts.filter(p=>p.actions?.owned);
   for(const p of arr.slice().reverse())wrap.append(card(p,false));
   if(!arr.length)wrap.append(el('p','lp-wb-empty','暂无内容'));
  }
 }

 const field=(parent,label,name,value='',type='text')=>{
  const row=el('label','lp-wb-field');row.append(el('span','',label));
  const input=document.createElement('input');input.type=type;input.dataset.wbField=name;
  if(type==='checkbox')input.checked=Boolean(value);else input.value=String(value??'');
  row.append(input);parent.append(row);return input;
 };

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
  field(form,'粉丝数量（故事设定）','ownerFollowers',q.profile.followers,'number');
  avatarPicker(form,'更换我的群星头像','ownerAvatar',state.avatarOwnerDraft||q.profile.avatar,q.profile.nickname);
  form.append(control('保存个人资料','saveProfile'));parent.append(form);
 }
 function renderSettings(parent,q){
  parent.append(heading('群星设置','所有身份与数据按当前故事存档保存'));
  const controls=el('div','lp-wb-editor');
  field(controls,'允许角色按剧情时间主动发布','autoEnabled',q.settings.autoEnabled,'checkbox');
  const interval=field(controls,'发布检测间隔（剧情分钟）','autoEveryMinutes',q.settings.autoEveryMinutes,'number');interval.min='30';interval.max='10080';
  field(controls,'周边环境补充（校园／公司／剧组等）','nearbyHint',q.settings.nearbyHint);
  controls.append(control('保存设置','saveSettings'),control('测试角色自主发布','testAuto'));
  parent.append(controls,heading('管理角色账号','手动绑定角色、NPC、媒体和粉丝账号；不依赖角色卡预设'));
  for(const a of q.accounts){
   const line=el('div','lp-wb-account-line');line.append(avatar(a.avatar,a.name));
   line.append(el('span','',a.name+' · '+(a.handle||'未设ID')+' · '+(a.kind||'人物')));
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
    scanner.append(heading('待确认账号（'+state.candidates.length+'）','编辑身份信息后勾选，未勾选的不会创建账号'));
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
     for(const [key,label,value,type] of [
      ['name','账号名称',existing?.name||candidate.name,'text'],
      ['handle','群星 ID',existing?.handle||candidate.handle||'','text'],
      ['kind','身份类型',existing?.kind||candidate.kind||'角色','text'],
      ['bio','公开简介（请自行审阅）',existing?.bio||candidate.bio||'','text'],
      ['publicFigure','公众人物',existing?.publicFigure||candidate.publicFigure||false,'checkbox']]){
       const item=field(row,label,'candidate-'+index+'-'+key,value,type);
       item.dataset.wbCandidateField=key;
     }
     scanner.append(row);
    });
    scanner.append(control('保存勾选的账号','saveCandidates'));
   }
   parent.append(scanner);
  const active=q.accounts.find(a=>a.id===state.editing)||{};
  if(state.editing==='new'||active.id){
   const form=el('div','lp-wb-editor');form.append(heading(active.id?'编辑账号':'新增账号'));
   field(form,'角色／账号名称','accountName',active.name||'');
   field(form,'群星 ID（例如 @example）','accountHandle',active.handle||'');
   field(form,'职业、性格与公开身份','accountBio',active.bio||'');
   field(form,'身份类型（角色／NPC／媒体／粉丝）','accountKind',active.kind||'角色');
   field(form,'是否为公众人物','accountPublic',active.publicFigure||false,'checkbox');
   field(form,'粉丝数量','accountFollowers',active.followers||0,'number');
   avatarPicker(form,'更换角色账号头像','accountAvatar',state.avatarDraft||active.avatar||'',active.name||'角色');
   form.append(control('保存角色账号','saveAccount'));parent.append(form);
  }
 }

 function render(){
  const n=nodes();if(!n?.weiboFeed)return;
  reset();
  n.weiboGenerate.disabled=state.loading;
  n.weiboGenerate.textContent=state.tab==='nearby'?'刷新周边':state.tab==='discover'?'刷新热搜':'刷新更多';
  n.weiboTabs.querySelectorAll('[data-weibo-tab]').forEach(b=>b.classList.toggle('selected',b.dataset.weiboTab===state.tab));
  const expanded=Boolean(state.detail||state.topic);
  const panels={home:n.weiboFeed,discover:n.weiboHot,nearby:n.weiboNearby,compose:n.weiboCompose,me:n.weiboMe};
  Object.entries(panels).forEach(([key,node])=>{
   node.hidden=key!==state.tab||expanded;
   if(['home','discover','nearby','me'].includes(key))node.replaceChildren();
  });
  n.weiboDetail.hidden=!expanded;
  n.weiboDetail.replaceChildren();
  n.weiboDetailBack.hidden=!expanded;
  n.weiboRefreshBox.hidden=expanded||!['home','discover','nearby'].includes(state.tab);
  n.weiboFeedback.hidden=!n.weiboFeedback.textContent;
  if(expanded){
   n.weiboDetail.append(n.weiboDetailBack);
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
    if(t.loading)n.weiboDetail.append(el('p','lp-wb-empty','正在生成该话题下的帖子和评论…'));
    if(t.error)n.weiboDetail.append(el('p','lp-wb-topic-error',t.error));
    if(t.error||(!t.loading&&!t.posts.length))n.weiboDetail.append(control('重新加载话题','retryTopic'));
    for(const p of t.posts){
     n.weiboDetail.append(card(p,true),control('查看评论并参与讨论','detail',p.id));
    }
   }
   n.weiboGenerate.hidden=true;
   n.weiboRefreshBox.append(n.weiboGenerate);
   return;
  }
  if(state.tab==='home'){
   const q=data(),seen=new Set(),all=[...state.posts.home,...q.posts.filter(p=>p.zone!=='nearby').slice().reverse(),...(root().weiboSaved||[])];
   for(const p of all)if(p?.id&&!seen.has(p.id)){seen.add(p.id);n.weiboFeed.append(card(p,false));}
   if(!seen.size)n.weiboFeed.append(el('p','lp-wb-empty','点击下方按钮，查看故事世界的最新动态'));
  }else if(state.tab==='discover'){
   n.weiboHot.append(heading('世界热搜','公共话题与热门讨论'));
   trendList(n.weiboHot,state.trends.length?state.trends:data().trends,'home');
  }else if(state.tab==='nearby'){
   n.weiboNearby.append(heading('周边','校园、公司、剧组与身边的人'));
   const trends=state.nearbyTrends.length?state.nearbyTrends:data().nearbyTrends;
   if(trends.length){n.weiboNearby.append(heading('周边热议'));trendList(n.weiboNearby,trends,'nearby');}
   const list=[...state.posts.nearby,...data().posts.filter(p=>p.zone==='nearby').slice().reverse()];
   const seen=new Set();for(const p of list)if(!seen.has(p.id)){seen.add(p.id);n.weiboNearby.append(card(p,false));}
   if(!list.length)n.weiboNearby.append(el('p','lp-wb-empty','刷新周边，查看身边的动态'));
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
  
if(type==='subview'){state.subview=id;state.editing='';render();nodes().weiboMe.parentElement.scrollTop=0;return;}
  if(type==='backMe'){state.subview='';state.editing='';render();nodes().weiboMe.parentElement.scrollTop=0;return;}
  if(type==='retryTopic'){await loadTopic();return;}
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
    chosen.push({name,handle:value('handle'),kind:value('kind')||'角色',
      bio:value('bio'),publicFigure:value('publicFigure')});
   }
   if(!chosen.length){feedback('请先勾选要保存的候选账号');return;}
   await mutate(q=>{
    for(const candidate of chosen){
     const old=q.accounts.find(x=>x.name===candidate.name||(candidate.handle&&x.handle===candidate.handle));
     const next={...old,...candidate,id:old?.id||uid('account'),followers:old?.followers||0,
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
   await mutate(q=>{q.profile={...q.profile,nickname:clean(v('ownerName')?.value,35)||'我',
    handle:clean(v('ownerHandle')?.value,45),bio:clean(v('ownerBio')?.value,240),
    followers:Math.max(0,Number(v('ownerFollowers')?.value)||0),avatar:draft||q.profile.avatar};});
   state.avatarOwnerDraft='';feedback('个人资料已保存');render();return;
  }
  if(type==='saveAccount'){
   const wrap=nodes().weiboMe,v=n=>wrap.querySelector('[data-wb-field="'+n+'"]');
   const name=clean(v('accountName')?.value,42);if(!name){feedback('请填写账号名称');return;}
   const edit=state.editing;const avatarDraft=state.avatarDraft;
   await mutate(q=>{
    const old=q.accounts.find(x=>x.id===edit)||{};
    const next={...old,id:old.id||uid('account'),name,handle:clean(v('accountHandle')?.value,45),bio:clean(v('accountBio')?.value,450),
     kind:clean(v('accountKind')?.value,25)||'角色',publicFigure:!!v('accountPublic')?.checked,
     followers:Math.max(0,Number(v('accountFollowers')?.value)||0),avatar:avatarDraft||old.avatar||'',source:'manual'};
    q.accounts=old.id?q.accounts.map(a=>a.id===old.id?next:a):[...q.accounts,next];
   });
   state.editing='';state.avatarDraft='';feedback('角色账号已保存');render();return;
  }
  const p=byId(id);if(!p)return;
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
   else if(type==='repost')change={reposted:!a.reposted};
   else return;
   await persistAction(p,change);
   if(type==='repost'&&change.reposted){
    const d=structuredClone(root());api.publishPhoneAppEvent(d,{app:'weibo',action:'reposted',id:p.id,detail:'转发 '+p.author+'：'+clean(p.text,110)});
    await api.writeData(context(),{...d,__contactId:'primary'});
   }
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
 function selectTab(t){
  const alias={feed:'home',hot:'discover',saved:'me'};
  t=alias[t]||t;
  if(['home','discover','nearby','compose','me'].includes(t)){
   if(t!==state.tab)feedback('');
   if(t==='me'&&state.tab==='me')state.subview='';
    if(t!=='me')state.subview='';
    state.tab=t;state.detail='';state.topic=null;render();
    if(nodes()?.weiboFeed?.parentElement)nodes().weiboFeed.parentElement.scrollTop=0;
   if((t==='home'||t==='discover')&&!state.attempted.world){state.attempted.world=true;void generate('home');}
   if(t==='nearby'&&!state.attempted.nearby){state.attempted.nearby=true;void generate('nearby');}
  }
 }
 function back(){
  if(state.detail)state.detail='';
  else if(state.topic)state.topic=null;
  else if(state.subview)state.subview='';
  render();
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
   const raw=await api.phoneGenerate(context(),{systemPrompt:'扮演指定角色在故事世界的公开社交账号上自主发帖；只输出正文或 [SKIP]。',prompt:[{role:'user',
    content:'故事时间：'+scene+'。群星账号：'+account.name+'，身份 '+account.kind+'，'+account.bio+'，公众人物：'+(account.publicFigure?'是':'否')+
     '。近期剧情：'+clean(api.storyContext?.()||'',1400)+'。结合职业、性格、公共活动和时间线决定此时是否发布一条公开动态。不得公开私聊秘密，不得杜撰用户行为、未发生事件或已确定恋情。可以不发，输出 [SKIP]。否则只输出一条 20～180 字的社交动态，不要额外解释。'}]},api.readData(context()));
   if(scope()!==state.scope)return;
   const body=clean(api.stripModelReasoning(raw),450);
   if(!body||/^\[SKIP\]$/i.test(body)){if(force)feedback(account.name+' 选择暂不发布');return;}
   const post={id:uid('post'),author:account.name,handle:account.handle,authorId:account.id,avatar:account.avatar||'',
    category:account.kind,text:body,comments:[],likes:0,time:scene,zone:'world',autoPublished:true,actions:{}};
   await mutate(s=>{s.posts.push(post);s.posts=s.posts.slice(-180);});
   feedback(account.name+' 已发布新动态');api.recordActivity('群星主动发帖',account.name+' 发布动态','success');render();
  }catch(e){feedback('主动发布失败：'+String(e.message||e));api.recordError('群星主动发帖',e);}
  finally{autoBusy=false;}
 }
 function open(){reset();render();if(!state.attempted.world){state.attempted.world=true;void generate('home');}}
 return {open,render,generate,selectTab,back,publish,handleClick,handleFile,tick,state,parse,normalize};
}
