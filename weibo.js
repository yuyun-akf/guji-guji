/* Ephemeral Weibo feed: only user-interacted posts persist in chat metadata. */
export function createWeiboModule(api){
 const state={scope:'',posts:[],trends:[],tab:'feed',detail:'',loading:false,token:0,attempted:false};
 const ctx=()=>api.context(),nodes=()=>api.getNodes(),root=()=>api.readRootData(ctx());
 const saved=()=>Array.isArray(root().weiboSaved)?root().weiboSaved:[];
 const uid=()=>('wb'+Date.now().toString(36)+Math.random().toString(36).slice(2,9));
 const scope=()=>[ctx()?.characterId,ctx()?.chatId,ctx()?.groupId].join(':');
 const el=(tag,cls='',str='')=>{const e=document.createElement(tag);e.className=cls;e.textContent=str;return e;};
 const byId=id=>[...state.posts,...saved()].find(p=>p.id===id);
 const flags=p=>saved().find(x=>x.id===p.id)?.actions||p.actions||{};
 const interacted=a=>!!(a?.liked||a?.favorited||a?.reposted||a?.owned||(a?.comments||[]).length);
 function reset(){const next=scope();if(next!==state.scope){
  state.scope=next;state.posts=[];state.trends=[];state.detail='';state.tab='feed';state.token++;state.attempted=false;}}
 function parse(raw){
  const text=api.stripModelReasoning(typeof raw==='string'?raw:String(raw?.content||'')).trim();
  const start=text.indexOf('{'),end=text.lastIndexOf('}');
  if(start<0||end<=start)throw Error('模型没有返回帖子 JSON');
  try{return JSON.parse(text.slice(start,end+1));}catch{throw Error('模型返回的 JSON 不完整');}
 }
 function normalize(p){
  if(!p||!Array.isArray(p.comments))return null;
  const name=String(p.author||p.name||'').trim().slice(0,40);
  const text=String(p.text||p.content||'').trim().slice(0,1000);
  const comments=p.comments.map(c=>({id:uid(),name:String(c.name||c.author||'网友').slice(0,35),
   text:String(c.text||c.content||'').trim().slice(0,300)})).filter(x=>x.text).slice(0,12);
  if(!name||!text||comments.length<5)return null;
  return {id:uid(),author:name,handle:String(p.handle||'').slice(0,30),
   category:String(p.category||'日常').slice(0,25),text,comments,likes:Math.max(0,Number(p.likes)||0),
   time:String(root().storyTime||''),actions:{liked:false,favorited:false,reposted:false,comments:[],owned:false}};
 }
 function prompt(count,topic,needsHot){
  const data=root(),known=(data.contacts||[]).slice(0,12).map(p=>p.name||'').filter(Boolean);
  const char=api.selectedCharacter(ctx())?.name||'';
  const sections=['娱乐圈','电竞','二次元','游戏','社会新闻','校园','科技','搞笑','体育','时尚','影视','生活'];
  return [
   '生成故事世界中一个真实感强的开放式微博平台信息流，时间：'+data.storyTime+'。角色：'+[char,...known].join('、')+'。',
   '大多数内容与 user、char 无关；允许大量自由创造的陌生网友、媒体、博主和粉丝。领域覆盖'+sections.join('、')+'。',
   topic?'本批围绕热搜话题：'+topic:'本批混合多个领域，避免每条都写给 user。',
   state.trends.length?'既有热搜可延续：'+state.trends.slice(0,8).map(x=>x.title).join('、'):'',
   '只返回一个完整 JSON 对象，不要解释、内部分析或代码块。',
   '格式：{"posts":[{"author":"昵称","handle":"@账号","category":"电竞","text":"正文","likes":80,"comments":[{"name":"网友甲","text":"评论"}]}],"trending":[{"title":"热搜标题","category":"分类"}]}',
   '必须生成 '+count+' 条不同的帖子，每帖至少 5 条各有观点的评论（建议 6 条）。',
   needsHot?'同时生成 15 条不同领域热搜。':'trending 可以是空数组。',
   '尽量简洁确保 JSON 不截断；讨论允许分歧、玩梗和不相关的路人。'
  ].filter(Boolean).join('\n');
 }
 async function generate(topic=''){
  reset();if(state.loading)return;
  if(!api.selectedCharacter(ctx())){nodes().weiboFeedback.textContent='请先选择角色';return;}
  const token=++state.token,where=state.scope,posts=[],hot=[];
  state.loading=true;nodes().weiboFeedback.textContent='生成 10 条新微博…';render();
  try{
   for(let batch=0;batch<2;batch++){
    const raw=await api.phoneGenerate(ctx(),{systemPrompt:'只输出合法 JSON，不输出分析。',
      prompt:[{role:'user',content:prompt(5,topic,batch===0)}]},api.readData(ctx()));
    if(where!==scope()||token!==state.token)return;
    const result=parse(raw);
    const valid=(Array.isArray(result.posts)?result.posts:[]).map(normalize).filter(Boolean);
    if(valid.length<5)throw Error('第 '+(batch+1)+' 批完整帖子不足 5 条（每条需至少五条评论），请重试');
    posts.push(...valid.slice(0,5));
    if(batch===0)for(const t of (Array.isArray(result.trending)?result.trending:[]).slice(0,20)){
     const title=String(t.title||t||'').trim().slice(0,65);
     if(title&&!hot.some(x=>x.title===title))hot.push({title,category:String(t.category||'热搜').slice(0,24)});
    }
   }
   if(where!==scope()||token!==state.token)return;
   if(hot.length<10)throw Error('热搜有效话题不足 10 条，请手动刷新重试');
   state.posts=posts;state.trends=hot;state.tab='feed';state.detail='';
   nodes().weiboFeedback.textContent='已更新 10 条微博';
   api.recordActivity('微博刷新','新生成 10 条，未互动帖子不持久保存','success');
  }catch(error){nodes().weiboFeedback.textContent='生成未完成：'+String(error.message||error);
   api.recordError('微博生成',error);
  }finally{state.loading=false;render();}
 }
 function btn(label,action,id,active=false){
  const e=el('button','lp-wb-action'+(active?' active':''),label);
  e.type='button';e.dataset.wbAction=action;e.dataset.wbPost=id;return e;
 }
 function card(p,detail){
  const box=el('article','lp-wb-card'),top=el('div','lp-wb-head');
  top.append(el('strong','',p.author),el('small','',p.handle+' · '+p.category));
  box.append(top,el('p','lp-wb-text',p.text));
  const comments=el('div','lp-wb-comments');
  for(const c of (detail?p.comments:p.comments.slice(0,5))){
   const line=el('p');line.append(el('b','',c.name+'：'),document.createTextNode(c.text));
   comments.append(line);
  }
  box.append(comments);
  const a=flags(p),actions=el('div','lp-wb-actions');
  actions.append(btn('♡ '+(p.likes+(a.liked?1:0)),'like',p.id,a.liked),
   btn('评论','detail',p.id),btn('转发','repost',p.id,a.reposted),btn('收藏','favorite',p.id,a.favorited));
  box.append(actions);
  if(!detail)box.append(btn('查看全部评论','detail',p.id));
  return box;
 }
 function render(){
  if(!nodes()?.weiboFeed)return;
  reset();
  const n=nodes();
  n.weiboGenerate.disabled=state.loading;
  n.weiboTabs.querySelectorAll('[data-weibo-tab]').forEach(b=>b.classList.toggle('selected',b.dataset.weiboTab===state.tab));
  n.weiboFeed.replaceChildren();n.weiboHot.replaceChildren();n.weiboDetail.replaceChildren();
  n.weiboFeed.hidden=state.tab==='hot'||!!state.detail;
  n.weiboHot.hidden=state.tab!=='hot'||!!state.detail;
  n.weiboDetail.hidden=!state.detail;n.weiboDetailBack.hidden=!state.detail;
  if(state.detail){
   const post=byId(state.detail);
   if(post){
    n.weiboDetail.append(card(post,true));
    const input=el('textarea');input.rows=2;input.maxLength=500;
    input.dataset.wbCommentInput='';input.placeholder='写下评论…';
    n.weiboDetail.append(input,btn('发表评论','sendComment',post.id));
   }
  }else if(state.tab==='hot'){
   for(const [i,t] of state.trends.entries()){
    const row=el('button','lp-wb-hot-item');row.dataset.wbTopic=t.title;
    row.append(el('strong','',String(i+1)),el('span','',t.title),el('small','',t.category));
    n.weiboHot.append(row);
   }
   if(!state.trends.length)n.weiboHot.textContent='刷新后查看热搜';
  }else{
   const posts=state.tab==='saved'?saved().slice().reverse():state.posts;
   for(const post of posts)n.weiboFeed.append(card(post,false));
   if(!posts.length)n.weiboFeed.textContent=state.tab==='saved'?'暂无互动记录':'点击刷新生成微博';
  }
 }
 async function save(post,actions){
  const d=structuredClone(root());
  d.weiboSaved=saved().filter(p=>p.id!==post.id);
  if(interacted(actions))d.weiboSaved.push({...post,actions});
  await api.writeData(ctx(),{...d,__contactId:'primary'});
  const local=state.posts.find(p=>p.id===post.id);
  if(local){local.actions=actions;local.comments=post.comments;}
 }
 async function action(type,postId){
  const p=byId(postId);if(!p||state.loading)return;
  if(type==='detail'){state.detail=postId;render();return;}
  const a=structuredClone(flags(p));
  if(type==='sendComment'){
   const input=nodes().weiboDetail.querySelector('[data-wb-comment-input]');
   if(!input?.value.trim())return;
   const c={id:uid(),name:api.currentPersona(ctx())?.name||ctx()?.name1||'我',text:input.value.trim().slice(0,500)};
   a.comments=[...(a.comments||[]),c];
   await save({...p,comments:[...p.comments,c]},a);
   const d=structuredClone(root());
   api.publishPhoneAppEvent(d,{app:'weibo',action:'commented',id:c.id,
    detail:'评论 '+p.author+' 的微博：'+c.text,reference:p.id});
   await api.writeData(ctx(),{...d,__contactId:'primary'});
  }else{
   if(type==='like')a.liked=!a.liked;
   else if(type==='favorite')a.favorited=!a.favorited;
   else if(type==='repost')a.reposted=!a.reposted;
   else return;
   await save(p,a);
   if(type==='repost'&&a.reposted){
    const d=structuredClone(root());
    api.publishPhoneAppEvent(d,{app:'weibo',action:'reposted',id:p.id,detail:'转发 '+p.author+' 的微博：'+p.text.slice(0,100)});
    await api.writeData(ctx(),{...d,__contactId:'primary'});
   }
  }
  render();
 }
 async function publish(){
  const text=nodes().weiboComposeText.value.trim();if(!text)return;
  const d=structuredClone(root()),post={id:uid(),
    author:api.currentPersona(ctx())?.name||ctx()?.name1||'我',handle:'',category:'日常',
    text:text.slice(0,1000),likes:0,comments:[],time:d.storyTime||'',
    actions:{liked:false,favorited:false,reposted:false,comments:[],owned:true}};
  d.weiboSaved=[...saved(),post];
  api.publishPhoneAppEvent(d,{app:'weibo',action:'posted',id:post.id,detail:'发布微博：'+post.text.slice(0,170)});
  await api.writeData(ctx(),{...d,__contactId:'primary'});
  state.posts.unshift(post);state.tab='feed';nodes().weiboComposeText.value='';
  nodes().weiboFeedback.textContent='发布成功';render();
 }
 function handleClick(event){
  const node=event.target.closest('[data-wb-action],[data-wb-topic]');if(!node)return false;
  if(node.dataset.wbTopic){void generate(node.dataset.wbTopic);return true;}
  void action(node.dataset.wbAction,node.dataset.wbPost).catch(e=>{
   nodes().weiboFeedback.textContent='操作失败：'+String(e.message||e);
  });
  return true;
 }
 function open(){reset();render();if(!state.attempted){state.attempted=true;void generate();}}
 function selectTab(t){if(['feed','hot','saved'].includes(t)){state.tab=t;state.detail='';render();}}
 function back(){state.detail='';render();}
 return {open,render,generate,selectTab,back,publish,handleClick,state,parse,normalize};
}
