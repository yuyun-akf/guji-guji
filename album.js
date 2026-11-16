/* 咕叽咕机共享素材库：角色卡人物相册与现代世界公共相册。 */
export function createAlbumModule(api){
 const el=(tag,cls='',value='')=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value)n.textContent=value;return n;};
 const state={level:'root',owner:'',folder:'',mode:'files',busy:false,message:'',editing:'',selectedFiles:[],pending:null,navReset:false,dialog:null,warningShown:false};
 const host=()=>api.getNodes()?.albumContent;
 const people=()=>api.galleryPeople();
 const worldId='world';
 const defaultFolders=['风景','家居','美食','游戏','角色图','表情包'];
 const characterFolders=[['public','公开相册'],['daily','日常相册'],['private','私密相册']];
 const validImage=s=>typeof s==='string'&&/^data:image\/(?:jpeg|png|webp|gif);base64,/.test(s);
 const world=()=>state.owner===worldId;
 const folders=()=>world()?(api.worldFolders?.()||defaultFolders):characterFolders.map(x=>x[0]);
 const ownerName=()=>world()?'世界相册':people().find(p=>p.id===state.owner)?.name||'人物相册';
 const labelOf=id=>world()?id:characterFolders.find(x=>x[0]===id)?.[1]||id;
 const legacyFolder=p=>p.folder||(p.access==='public'?'public':p.access==='private'?'daily':'daily');
 const photoFolder=p=>world()?(p.folder||'风景'):legacyFolder(p);
 const ownerPhotos=()=>world()?(api.worldPhotos?.()||[]):(api.sharedPhotos?.()||[]).filter(p=>p.owner===state.owner||(p.ownerName===ownerName()&&p.owner!=='user'));
 const photos=()=>ownerPhotos().filter(p=>photoFolder(p)===state.folder&&validImage(p.image));
 const button=(action,label,id='')=>{const b=el('button','lp-album-action',label);b.type='button';b.dataset.albumAction=action;if(id)b.dataset.albumId=id;return b;};
 const pane=(title,subtitle='')=>{const node=el('div','lp-album-header');node.append(el('strong','',title));if(subtitle)node.append(el('small','',subtitle));return node;};
 const hint=(message,error=false)=>{state.message=message;api.notifyInteraction?.(message,error?'error':'success');render();};
 const tile=(title,sub,action,id='',cover='')=>{
  const b=button(action,'',id);b.classList.add('lp-album-folder');
  if(validImage(cover)){const i=el('img','lp-album-folder-cover');i.src=cover;i.alt='';b.append(i);}
  else b.append(el('span','lp-album-folder-symbol',action==='import'?'＋':'▧'));
  const copy=el('span','lp-album-folder-copy');copy.append(el('strong','',title),el('small','',sub));b.append(copy);return b;
 };
 const readFiles=()=>state.selectedFiles.slice();
 const warningText='请勿上传涉及个人隐私、真人画师作品或未经授权的图片；建议只上传本人有权使用的 AI 生成图片。';
 const safetyDisabled=()=>api.safetyWarningDisabled?.()===true;
 function enterImport(){state.dialog=null;state.level='import';state.mode='files';state.selectedFiles=[];state.navReset=true;render();}
 function requestImport(){if(!safetyDisabled()&&!state.warningShown){state.dialog={type:'warning'};render();}else enterImport();}
 function openOptions(){state.dialog={type:'options'};render();}
 function endPhoneSession(){state.warningShown=false;state.dialog=null;state.selectedFiles=[];}
 function renderDialog(wrap){
  if(!state.dialog)return;
  const data=state.dialog,overlay=el('div','lp-album-overlay'),dialog=el('section','lp-album-dialog');
  dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
  const titles={warning:'图片导入安全提醒',options:'相册说明与安全提醒',edit:'编辑图片资料',move:'移动图片分类',cover:'设置封面',delete:'删除图片'};
  const title=el('h3','',titles[data.type]||'相册操作');dialog.setAttribute('aria-label',title.textContent);dialog.append(title);
  const note=msg=>dialog.append(el('p','lp-album-dialog-note',msg));
  const field=(key,label,value='',kind='input')=>{
   const box=el('label','lp-album-field',label),input=el(kind);input.dataset.albumDialogField=key;
   if(kind==='textarea')input.rows=3;if(kind!=='select')input.value=String(value||'');
   box.append(input);dialog.append(box);return input;
  };
  const actions=el('div','lp-album-dialog-actions'),finish=label=>actions.append(button('dialogApply',label));
  if(data.type==='warning'){
   note(warningText);note('每次重新打开咕叽咕机后，首次进入图片导入页面时显示一次。');
   actions.append(button('dialogClose','取消'));finish('我已知晓，继续导入');
  }else if(data.type==='options'){
   note('相册素材只在情境相关时调用；不同子相册的使用范围如下：');
   for(const [label,description] of [
    ['世界相册','现代世界跨角色卡共享，风景、家居、美食、游戏及角色图等素材可供相关角色使用'],
    ['公开相册','其他角色可在相关聊天或动态中引用'],
    ['日常相册','仅相册所属角色可在聊天或动态中使用'],
    ['私密相册','仅在所属角色与 user 私聊时使用'],
    ['表情包','作为表情图片资源使用，不按普通照片调用']
   ]){const p=el('p','lp-album-access-note');p.append(el('strong','',label+'：'),document.createTextNode(description));dialog.append(p);}
   const toggle=field('disableWarning','永久关闭导入前安全提醒');toggle.type='checkbox';toggle.checked=safetyDisabled();
   note('此设置只影响导入前弹窗；相册主页的安全提醒始终保留。');
   actions.append(button('dialogClose','取消'));finish('保存设置');
  }else{
   const photo=ownerPhotos().find(p=>p.id===data.photoId);if(!photo){state.dialog=null;return;}
   if(data.type==='edit'){
    field('title','图片名称',photo.title||'');field('description','图片描述',photo.description||'','textarea');
    if(photoFolder(photo)==='表情包')field('usage','表情包用途',photo.usage||'','textarea');
    actions.append(button('dialogClose','取消'));finish('保存修改');
   }else if(data.type==='move'){
    const select=field('folder','移动到子相册','','select');
    for(const id of folders()){const o=el('option','',labelOf(id));o.value=id;select.append(o);}
    select.value=photoFolder(photo);actions.append(button('dialogClose','取消'));finish('确认移动');
   }else if(data.type==='cover'){
    const select=field('coverTarget','设置为哪个封面','','select');
    for(const [id,label] of [['owner',world()?'世界相册封面':'人物相册封面'],['folder','当前子相册封面']]){
     const o=el('option','',label);o.value=id;select.append(o);
    }
    actions.append(button('dialogClose','取消'));finish('确认设置');
   }else if(data.type==='delete'){
    note('确定删除「'+(photo.title||'未命名图片')+'」？删除后无法恢复，已发送的聊天或动态不会同步删除。');
    actions.append(button('dialogClose','取消'));finish('确认删除');
   }
  }
  dialog.append(actions);overlay.append(dialog);wrap.append(overlay);
 }
 function render(){
  const wrap=host();if(!wrap)return;
  const oldTop=wrap.scrollTop;
  // A changed role-card must never expose the previous card's cached navigation.
  if(state.owner&&state.owner!=='world'&&!people().some(person=>person.id===state.owner)){
   state.level='root';state.owner='';state.folder='';state.pending=null;state.selectedFiles=[];state.navReset=true;
  }
  wrap.dataset.albumOwner=state.owner;wrap.dataset.albumLevel=state.level;
  wrap.replaceChildren();
  if(state.level==='root'){
   wrap.append(el('p','lp-album-safety-note',warningText));
   const grid=el('div','lp-album-folder-grid');
   const shared=api.worldPhotos?.()||[];
   grid.append(tile('世界相册',shared.length+' 张公共资源','owner',worldId,api.coverFor?.(worldId,'')||shared.find(p=>validImage(p.image))?.image));
   for(const person of people()){
    const entries=(api.sharedPhotos?.()||[]).filter(p=>p.owner===person.id||(p.ownerName===person.name&&p.owner!=='user'));
    grid.append(tile(person.name,entries.length+' 张照片','owner',person.id,api.coverFor?.(person.id,'')||entries.find(p=>validImage(p.image))?.image));
   }
   wrap.append(grid);
  }else if(state.level==='owner'){
   const entries=ownerPhotos();
   wrap.append(pane(ownerName()));
   
   const grid=el('div','lp-album-folder-grid');
   for(const key of folders()){
    const pics=entries.filter(p=>photoFolder(p)===key&&validImage(p.image));
    grid.append(tile(labelOf(key),pics.length+' 张','folder',key,api.coverFor?.(state.owner,key)||pics.find(p=>validImage(p.image))?.image));
   }
   grid.append(tile('添加照片','手动录入／批量导入／AI 识图','import'));
   if(world())grid.append(tile('新建子相册','自定义名称','newFolder'));
   wrap.append(grid);
  }else if(state.level==='folder'){
   wrap.append(pane(labelOf(state.folder),photos().length+' 张照片'));
   
   const list=el('div','lp-album-grid');
   for(const photo of photos()){
    const card=el('article','lp-album-card'),img=el('img');
    img.src=photo.image;img.alt=photo.description||photo.title||'图片';img.loading='lazy';
    const info=el('div','lp-album-info');
    info.append(el('strong','',photo.title||'未命名图片'));
    if(photo.description)info.append(el('p','',photo.description));
    if(photo.usage)info.append(el('small','','用途：'+photo.usage));
    const actions=el('div','lp-album-actions');
    actions.append(button('edit','编辑',photo.id),button('move','移动',photo.id),button('cover','设为封面',photo.id),button('delete','删除',photo.id));
    card.append(img,info,actions);list.append(card);
   }
   if(!photos().length)list.append(el('p','lp-album-empty','这个子相册还没有图片。返回上一页，从「添加照片」导入即可。'));
   wrap.append(list);
  }else if(state.level==='review'){
   wrap.append(pane('检查 AI 识图结果','逐张修改名称与描述，确认后一次性保存。'));
   const pending=state.pending;
   if(!pending){state.level='owner';render();return;}
   
   const list=el('div','lp-album-review-list');
   pending.images.forEach((src,index)=>{
    const card=el('div','lp-album-review-card'),img=el('img');img.src=src;img.alt='识图预览';
    const fields=el('div','lp-album-review-fields');
    for(const [key,label,value]of [
      ['title','图片名称',pending.labels[index]?.title||pending.files[index].name.replace(/\.[^.]+$/,'')],
      ['description','可见内容描述',pending.labels[index]?.description||''],
      ...(pending.folder==='表情包'?[['usage','表情包用途',pending.labels[index]?.usage||'']]:[])
    ]){
     const field=el('label','lp-album-field',label);
     const input=key==='description'?el('textarea'):el('input');
     input.dataset.albumReview=key;input.dataset.albumIndex=String(index);input.value=String(value);
     field.append(input);fields.append(field);
    }
    card.append(img,fields);list.append(card);
   });
   wrap.append(list,button('saveReview','确认导入 '+pending.images.length+' 张图片'));
  }else if(state.level==='import'){
   wrap.append(pane('添加照片','进入哪个相册就自动获得对应权限，导入后可移动。'));
   
   const form=el('div','lp-album-form');
   const target=el('select');target.dataset.albumField='target';
   for(const key of folders()){const option=el('option','',labelOf(key));option.value=key;target.append(option);}
   target.value=state.folder&&folders().includes(state.folder)?state.folder:folders()[0];
   const row=el('label','lp-album-field','目标子相册');row.append(target);form.append(row);
   const modes=el('div','lp-album-mode-row');
   for(const [mode,label]of [['manual','手动补录'],['files','批量导入'],['ai','AI 识图']]){
    const b=button('mode',label,mode);if(state.mode===mode)b.classList.add('selected');modes.append(b);
   }
   form.append(modes);
   const picker=el('label','lp-album-picker');picker.append(el('strong','','选择照片（1～10张）'));
   const file=el('input');file.type='file';file.accept='image/jpeg,image/png,image/webp,image/gif';file.multiple=true;file.dataset.albumField='files';
   picker.append(file);form.append(picker);
   const preview=el('div','lp-album-preview');preview.dataset.albumPreview='true';
   for(const file of readFiles()){const i=el('div','lp-album-file-name',file.name);preview.append(i);}
   form.append(preview);
   if(state.mode!=='ai'){
    for(const [key,label,placeholder]of [['title','统一名称（选填，单张更适用）','留空使用文件名'],['description','图片内容描述（选填）','可在导入后逐张修改'],...(target.value==='表情包'?[['usage','表情包用途（选填）','例如开心、吐槽']]:[])]){
     const box=el('label','lp-album-field',label),input=el('input');input.dataset.albumField=key;input.placeholder=placeholder;box.append(input);form.append(box);
    }
   }else form.append(el('p','lp-settings-hint','所选1～10张将一次发送给当前支持识图的模型，返回后可检查逐张名称、描述和表情包用途；不会自动发布。'));
   form.append(button('upload',state.busy?'正在处理…':state.mode==='ai'?'调用 API 识图并导入':'保存到所选相册'));
   wrap.append(form);
  }
  if(state.message)wrap.append(el('p','lp-album-feedback',state.message));
   renderDialog(wrap);
  wrap.scrollTop=state.navReset?0:oldTop;state.navReset=false;
 }
 async function encode(file,sticker=false){
  if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file?.type)||file.size>12*1024*1024)
   throw Error('仅支持12MB以内的 JPG、PNG、WebP 或 GIF 图片');
  const raw=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('图片读取失败'));r.readAsDataURL(file);});
  // Keep the original bytes for small stickers: GIF animation and transparent
  // PNG/WebP reactions must not silently turn into flattened JPEG stills.
  if(sticker&&raw.length<=500000)return raw;
  if(sticker&&file.type==='image/gif')throw Error('动态图超过表情包容量限制，请选择350KB以内的GIF');
  const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error('无法解码图片'));i.src=raw;});
  const canvas=document.createElement('canvas'),scale=Math.min(1,900/Math.max(img.width,img.height));
  canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
  canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
  for(const quality of [.8,.65,.5,.38]){
   const result=canvas.toDataURL('image/jpeg',quality);if(result.length<=420000)return result;
  }
  throw Error('图片太大，压缩后仍超过容量限制');
 }
 async function upload(){
  if(state.busy)return;
  const wrap=host(),files=readFiles();
  if(!files.length)return hint('请先选择至少一张图片',true);
  if(files.length>10)return hint('一次最多导入10张，请分批处理',true);
  const folder=wrap?.querySelector('[data-album-field="target"]')?.value||folders()[0];
  const title=wrap?.querySelector('[data-album-field="title"]')?.value?.trim()||'';
  const description=wrap?.querySelector('[data-album-field="description"]')?.value?.trim()||'';
  const usage=wrap?.querySelector('[data-album-field="usage"]')?.value?.trim()||'';
  const owner=state.owner,signature=api.albumScope?.(),old=owner===worldId?(api.worldPhotos?.()||[]):(api.sharedPhotos?.()||[]);
  state.busy=true;state.message='正在读取 '+files.length+' 张图片…';
  // Do not call render before the File input has been read; selected File objects
  // remain in state across render and asynchronous model requests.
  try{
   const images=[];
   for(const f of files){images.push(await encode(f,folder==='表情包'));if(signature!==api.albumScope?.())throw Error('角色卡已切换，停止导入');}
   let labels=[];
   if(state.mode==='ai'){
    state.message='正在一次识别 '+images.length+' 张图片…';render();
    labels=await api.identifyPhotos(images,files.map(f=>f.name),folder==='表情包');
    if(!Array.isArray(labels)||!labels.length)throw Error('识图没有返回可用结果，未保存图片');
    state.pending={images,files,labels,owner,folder,signature};
    state.level='review';state.navReset=true;state.message='';
    render();return;
   }
   const added=images.map((image,index)=>{
    const meta=labels[index]||{};
    const result={id:'ph-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10),
     owner,ownerName:ownerName(),folder,
     title:String(meta.title||title||files[index].name.replace(/\.[^.]+$/,'')).slice(0,60),
     description:String(meta.description||description||'').slice(0,500),
     ...(folder==='表情包'?{usage:String(meta.usage||usage||'').slice(0,160)}:{}),
     access:world()?'public':folder==='public'?'public':folder==='private'?'private':'chat',image};
    return result;
   });
   if(folder==='表情包'&&old.filter(p=>p.folder==='表情包').length+added.length>100)
    throw Error('世界相册表情包最多100张，请删除或分批整理');
   if(owner===worldId)await api.saveWorldPhotos([...old,...added]);
   else await api.saveSharedPhotos([...old,...added]);
   state.selectedFiles=[];state.folder=folder;state.level='folder';state.editing='';
   hint('已导入 '+added.length+' 张图片');
  }catch(error){hint('导入失败：'+String(error.message||error),true);}
  finally{state.busy=false;}
 }
 async function saveEdited(photo){
  const form=host()?.querySelector('.lp-album-dialog');if(!form)return;
  const val=key=>form.querySelector('[data-album-dialog-field="'+key+'"]')?.value?.trim()||'';
  const patch={...photo,title:val('title').slice(0,60),description:val('description').slice(0,500)};
  if(photoFolder(photo)==='表情包')patch.usage=val('usage').slice(0,160);
  const list=world()?(api.worldPhotos?.()||[]):(api.sharedPhotos?.()||[]);
  const next=list.map(p=>p.id===photo.id?patch:p);
  if(world())await api.saveWorldPhotos(next);else await api.saveSharedPhotos(next);
  state.dialog=null;hint('图片资料已更新');
 }
 async function remove(photo){
  
  const list=world()?(api.worldPhotos?.()||[]):(api.sharedPhotos?.()||[]);
  const next=list.filter(p=>p.id!==photo.id);
  if(world())await api.saveWorldPhotos(next);else await api.saveSharedPhotos(next);
  state.dialog=null;hint('照片已删除');
 }
 async function move(photo){
  const target=host()?.querySelector('[data-album-dialog-field="folder"]')?.value;
  if(!folders().includes(target))return hint('请选择有效的子相册',true);
  const list=world()?(api.worldPhotos?.()||[]):(api.sharedPhotos?.()||[]);
  const next=list.map(p=>p.id===photo.id?{...p,folder:target,access:world()?'public':target==='public'?'public':target==='private'?'private':'chat'}:p);
  if(world())await api.saveWorldPhotos(next);else await api.saveSharedPhotos(next);
  state.dialog=null;hint('已移动到「'+labelOf(target)+'」');
 }
 async function saveReview(){
  if(state.busy||!state.pending)return;
  const pending=state.pending;
  if(pending.signature!==api.albumScope?.())return hint('角色卡已切换，停止导入',true);
  const wrap=host(),pictures=pending.images.map((image,index)=>{
   const val=key=>wrap?.querySelector('[data-album-review="'+key+'"][data-album-index="'+index+'"]')?.value?.trim()||'';
   return {id:'ph-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10),
    owner:pending.owner,ownerName:ownerName(),folder:pending.folder,
    title:val('title').slice(0,60),description:val('description').slice(0,500),
    ...(pending.folder==='表情包'?{usage:val('usage').slice(0,160)}:{}),
    access:pending.owner==='world'?'public':pending.folder==='public'?'public':pending.folder==='private'?'private':'chat',image};
  });
  state.busy=true;
  try{
   if(pending.folder==='表情包'&&(api.worldPhotos?.()||[]).filter(p=>p.folder==='表情包').length+pictures.length>100)
    throw Error('世界相册表情包最多100张');
   if(world())await api.saveWorldPhotos([...(api.worldPhotos?.()||[]),...pictures]);
   else await api.saveSharedPhotos([...(api.sharedPhotos?.()||[]),...pictures]);
   state.pending=null;state.selectedFiles=[];state.folder=pending.folder;
   state.level='folder';state.navReset=true;hint('已导入 '+pictures.length+' 张识图照片');
  }catch(error){hint('保存识图结果失败：'+String(error.message||error),true);}
  finally{state.busy=false;}
 }
 async function handleClick(event){
  const b=event.target.closest?.('[data-album-action]');if(!b||state.busy)return false;
  const type=b.dataset.albumAction,id=b.dataset.albumId;
  if(type==='root'){state.level='root';state.owner='';state.folder='';state.message='';state.navReset=true;render();return true;}
  if(type==='owner'){if(id)state.owner=id;state.level='owner';state.folder='';state.editing='';state.pending=null;state.navReset=true;render();return true;}
  if(type==='folder'){state.folder=id;state.level='folder';state.editing='';state.navReset=true;render();return true;}
  if(type==='import'){requestImport();return true;}
  if(type==='mode'){state.mode=id;render();return true;}
  if(type==='newFolder'){
   const name=window.prompt('输入世界相册子相册名称（不超过20字）','');
   if(name?.trim()){const list=[...folders()];if(!list.includes(name.trim())){await api.saveWorldFolders([...list,name.trim().slice(0,20)]);hint('子相册已添加');}}
   return true;
  }
  if(type==='upload'){await upload();return true;}
  if(type==='saveReview'){await saveReview();return true;}
  if(type==='dialogClose'){state.dialog=null;render();return true;}
   if(type==='dialogApply'){
    const data=state.dialog;if(!data)return true;
    if(data.type==='warning'){state.warningShown=true;enterImport();return true;}
    if(data.type==='options'){
     const disabled=Boolean(host()?.querySelector('[data-album-dialog-field="disableWarning"]')?.checked);
     try{await api.saveSafetyWarningDisabled?.(disabled);state.dialog=null;hint('相册设置已保存');}
     catch(error){hint('设置保存失败：'+String(error.message||error),true);}
     return true;
    }
    const photo=ownerPhotos().find(p=>p.id===data.photoId);if(!photo){state.dialog=null;render();return true;}
    try{
     if(data.type==='edit')await saveEdited(photo);
     else if(data.type==='move')await move(photo);
     else if(data.type==='delete')await remove(photo);
     else if(data.type==='cover'){
      const scope=host()?.querySelector('[data-album-dialog-field="coverTarget"]')?.value;
      if(scope!=='owner'&&scope!=='folder')throw Error('请选择封面类型');
      await api.saveCover?.(state.owner,scope==='owner'?'':state.folder,photo.id);
      state.dialog=null;hint('封面设置已保存');
     }
    }catch(error){hint('照片操作失败：'+String(error.message||error),true);}
    return true;
   }
   const photo=ownerPhotos().find(p=>p.id===id);if(!photo)return false;
   if(['edit','move','cover','delete'].includes(type)){state.dialog={type,photoId:id};render();return true;}
   return false;
 }
 function handleChange(event){
  if(event.target?.matches?.('[data-album-field="target"]')){
   state.folder=event.target.value;render();return true;
  }
  if(!event.target?.matches?.('[data-album-field="files"]'))return false;
  state.selectedFiles=[...(event.target.files||[])];if(state.selectedFiles.length>10){
   state.selectedFiles=state.selectedFiles.slice(0,10);state.message='一次最多选择10张图片，已取前10张';
  }
  render();return true;
 }
 function back(){
  if(state.dialog){state.dialog=null;render();return true;}
   if(state.level==='root')return false;
  if(state.level==='folder'||state.level==='import'||state.level==='review'){
   state.level='owner';state.pending=null;state.editing='';state.folder='';state.navReset=true;
  }else{state.level='root';state.owner='';state.folder='';state.navReset=true;}
  render();return true;
 }
 function open(){state.level='root';state.owner='';state.folder='';state.dialog=null;state.message='';state.navReset=true;render();}
 return {open,openOptions,endPhoneSession,render,handleClick,handleChange,back,state};
}
