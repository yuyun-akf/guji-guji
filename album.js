/* 咕叽咕机共享素材库：角色卡人物相册与现代世界公共相册。 */
export function createAlbumModule(api){
 const el=(tag,cls='',value='')=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value)n.textContent=value;return n;};
 const state={level:'root',owner:'',folder:'',mode:'files',busy:false,message:'',editing:'',selectedFiles:[]};
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
 function render(){
  const wrap=host();if(!wrap)return;
  const oldTop=wrap.scrollTop;
  wrap.replaceChildren();
  if(state.level==='root'){
   wrap.append(pane('相册','当前人物相册按角色卡保存；现代世界相册跨角色卡共享。'));
   const grid=el('div','lp-album-folder-grid');
   const shared=api.worldPhotos?.()||[];
   grid.append(tile('世界相册',shared.length+' 张公共资源','owner',worldId,shared.find(p=>validImage(p.image))?.image));
   for(const person of people()){
    const entries=(api.sharedPhotos?.()||[]).filter(p=>p.owner===person.id||(p.ownerName===person.name&&p.owner!=='user'));
    grid.append(tile(person.name,entries.length+' 张照片','owner',person.id,entries.find(p=>validImage(p.image))?.image));
   }
   wrap.append(grid);
  }else if(state.level==='owner'){
   const entries=ownerPhotos();
   wrap.append(pane(ownerName(),world()?'世界通用素材 · 所有角色可用':'所有照片允许本人使用；子相册控制其他账号的调用范围。'));
   wrap.append(button('root','‹ 返回人物与世界相册'));
   const grid=el('div','lp-album-folder-grid');
   for(const key of folders()){
    const pics=entries.filter(p=>photoFolder(p)===key&&validImage(p.image));
    grid.append(tile(labelOf(key),pics.length+' 张','folder',key,pics.find(p=>validImage(p.image))?.image));
   }
   grid.append(tile('添加照片','手动录入／批量导入／AI 识图','import'));
   if(world())grid.append(tile('新建子相册','自定义名称','newFolder'));
   wrap.append(grid);
  }else if(state.level==='folder'){
   wrap.append(pane(ownerName()+' · '+labelOf(state.folder),photos().length+' 张 · 可修改资料、删除或移动照片'));
   wrap.append(button('owner','‹ 返回子相册'));
   const list=el('div','lp-album-grid');
   for(const photo of photos()){
    const card=el('article','lp-album-card'),img=el('img');
    img.src=photo.image;img.alt=photo.description||photo.title||'图片';img.loading='lazy';
    const info=el('div','lp-album-info');
    info.append(el('strong','',photo.title||'未命名图片'));
    if(photo.description)info.append(el('p','',photo.description));
    if(photo.usage)info.append(el('small','','用途：'+photo.usage));
    const actions=el('div','lp-album-actions');
    actions.append(button('edit','编辑资料',photo.id),button('move','移动分类',photo.id),button('delete','删除',photo.id));
    if(state.editing===photo.id){
     const form=el('div','lp-album-edit-form');
     for(const [key,label,value]of [['title','名称',photo.title],['description','描述',photo.description],...(state.folder==='表情包'?[['usage','表情包用途',photo.usage]]:[])]){
      const field=el('label','lp-album-field',label);
      const input=key==='description'||key==='usage'?el('textarea'):el('input');
      input.dataset.albumEdit=key;input.value=value||'';field.append(input);form.append(field);
     }
     form.append(button('saveEdit','保存修改',photo.id),button('cancelEdit','取消'));
     info.append(form);
    }
    card.append(img,info,actions);list.append(card);
   }
   if(!photos().length)list.append(el('p','lp-album-empty','这个子相册还没有图片。返回上一页，从「添加照片」导入即可。'));
   wrap.append(list);
  }else if(state.level==='import'){
   wrap.append(pane('添加照片','进入哪个相册就自动获得对应权限，导入后可移动。'));
   wrap.append(button('owner','‹ 返回子相册'));
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
  wrap.scrollTop=oldTop;
 }
 async function encode(file){
  if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file?.type)||file.size>12*1024*1024)
   throw Error('仅支持12MB以内的 JPG、PNG、WebP 或 GIF 图片');
  const raw=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('图片读取失败'));r.readAsDataURL(file);});
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
   for(const f of files){images.push(await encode(f));if(signature!==api.albumScope?.())throw Error('角色卡已切换，停止导入');}
   let labels=[];
   if(state.mode==='ai'){
    state.message='正在一次识别 '+images.length+' 张图片…';render();
    labels=await api.identifyPhotos(images,files.map(f=>f.name),folder==='表情包');
    if(!Array.isArray(labels)||!labels.length)throw Error('识图没有返回可用结果，未保存图片');
    if(typeof window!=='undefined'&&window.confirm&&!window.confirm('已识别 '+labels.length+' 张。确认保存到「'+labelOf(folder)+'」？保存后可以逐张修改名称与描述。'))return;
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
   if(owner===worldId)await api.saveWorldPhotos([...old,...added]);
   else await api.saveSharedPhotos([...old,...added]);
   state.selectedFiles=[];state.folder=folder;state.level='folder';state.editing='';
   hint('已导入 '+added.length+' 张图片');
  }catch(error){hint('导入失败：'+String(error.message||error),true);}
  finally{state.busy=false;}
 }
 async function saveEdited(photo){
  const form=host()?.querySelector('.lp-album-edit-form');if(!form)return;
  const val=key=>form.querySelector('[data-album-edit="'+key+'"]')?.value?.trim()||'';
  const patch={...photo,title:val('title').slice(0,60),description:val('description').slice(0,500)};
  if(photoFolder(photo)==='表情包')patch.usage=val('usage').slice(0,160);
  const list=world()?(api.worldPhotos?.()||[]):(api.sharedPhotos?.()||[]);
  const next=list.map(p=>p.id===photo.id?patch:p);
  if(world())await api.saveWorldPhotos(next);else await api.saveSharedPhotos(next);
  state.editing='';hint('图片资料已更新');
 }
 async function remove(photo){
  if(!window.confirm('删除这张照片？已经发送的聊天或已发布动态不会删除。'))return;
  const list=world()?(api.worldPhotos?.()||[]):(api.sharedPhotos?.()||[]);
  const next=list.filter(p=>p.id!==photo.id);
  if(world())await api.saveWorldPhotos(next);else await api.saveSharedPhotos(next);
  hint('照片已删除');
 }
 async function move(photo){
  const allowed=folders();
  const label=allowed.map(labelOf).join('、');
  const selected=window.prompt('移动到哪个子相册？可选：'+label,labelOf(photoFolder(photo)));
  if(selected===null)return;
  const target=allowed.find(k=>k===selected||labelOf(k)===selected.trim());
  if(!target)return hint('请输入有效的子相册名称',true);
  const list=world()?(api.worldPhotos?.()||[]):(api.sharedPhotos?.()||[]);
  const next=list.map(p=>p.id===photo.id?{...p,folder:target,access:world()?'public':target==='public'?'public':target==='private'?'private':'chat'}:p);
  if(world())await api.saveWorldPhotos(next);else await api.saveSharedPhotos(next);
  hint('已移动到「'+labelOf(target)+'」');
 }
 async function handleClick(event){
  const b=event.target.closest?.('[data-album-action]');if(!b||state.busy)return false;
  const type=b.dataset.albumAction,id=b.dataset.albumId;
  if(type==='root'){state.level='root';state.owner='';state.folder='';state.message='';render();return true;}
  if(type==='owner'){state.level='owner';state.folder='';state.editing='';render();return true;}
  if(type==='folder'){state.folder=id;state.level='folder';state.editing='';render();return true;}
  if(type==='import'){state.level='import';state.mode='files';state.selectedFiles=[];render();return true;}
  if(type==='mode'){state.mode=id;render();return true;}
  if(type==='newFolder'){
   const name=window.prompt('输入世界相册子相册名称（不超过20字）','');
   if(name?.trim()){const list=[...folders()];if(!list.includes(name.trim())){await api.saveWorldFolders([...list,name.trim().slice(0,20)]);hint('子相册已添加');}}
   return true;
  }
  if(type==='upload'){await upload();return true;}
  if(type==='cancelEdit'){state.editing='';render();return true;}
  const photo=ownerPhotos().find(p=>p.id===id);if(!photo)return false;
  try{
   if(type==='edit'){state.editing=id;render();}
   else if(type==='saveEdit')await saveEdited(photo);
   else if(type==='delete')await remove(photo);
   else if(type==='move')await move(photo);
   else return false;
  }catch(error){hint('照片操作失败：'+String(error.message||error),true);}
  return true;
 }
 function handleChange(event){
  if(!event.target?.matches?.('[data-album-field="files"]'))return false;
  state.selectedFiles=[...(event.target.files||[])];if(state.selectedFiles.length>10){
   state.selectedFiles=state.selectedFiles.slice(0,10);state.message='一次最多选择10张图片，已取前10张';
  }
  render();return true;
 }
 function open(){state.level='root';state.owner='';state.folder='';state.message='';render();}
 return {open,render,handleClick,handleChange,state};
}
