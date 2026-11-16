/* 相册：角色卡共享的有归属、用途和发布权限的图片资料。 */
export function createAlbumModule(api){
 const el=(tag,className='',value='')=>{const n=document.createElement(tag);if(className)n.className=className;if(value)n.textContent=value;return n;};
 const state={busy:false,message:''};
 const host=()=>api.getNodes()?.albumContent;
 const items=()=>api.sharedPhotos();
 const people=()=>api.galleryPeople();
 const safePhoto=photo=>photo&&typeof photo.image==='string'&&/^data:image\/(?:jpeg|png|webp);base64,/.test(photo.image);
 const nameFor=photo=>photo.ownerName||people().find(p=>p.id===photo.owner)?.name||'未知人物';
 function say(message,error=false){
  state.message=message;api.notifyInteraction?.(message,error?'error':'success');render();
 }
 const action=(name,label,id)=>{const b=el('button','lp-album-action',label);b.type='button';b.dataset.albumAction=name;if(id)b.dataset.albumId=id;return b;};
 const field=(title,input)=>{const label=el('label','lp-album-field');label.append(document.createTextNode(title),input);return label;};
 function render(){
  const wrap=host();if(!wrap)return;
  const previousTop=wrap.scrollTop;
  wrap.replaceChildren();
  const header=el('div','lp-album-header');
  header.append(el('strong','','故事相册'),el('small','','图片按角色卡保存；发送和发帖记录仍属于当前剧情存档。'));
  wrap.append(header);
  const form=el('div','lp-album-form'), file=el('input');file.type='file';file.accept='image/jpeg,image/png,image/webp';file.multiple=true;file.dataset.albumField='files';
  file.className='lp-album-file-input';
  const picker=el('label','lp-album-picker');
  picker.setAttribute('aria-label','点击选择照片，可多选');
  const pickerIcon=el('span','lp-album-picker-icon','▧');
  const pickerTitle=el('strong','','＋ 选择照片');
  const pickerHint=el('small','lp-album-picker-hint','点击这里从手机相册选择 · 支持多选 JPG / PNG / WebP');
  picker.append(pickerIcon,pickerTitle,pickerHint,file);
  const preview=el('div','lp-album-preview');
  preview.dataset.albumPreview='true';preview.hidden=true;
  const owner=el('select');owner.dataset.albumField='owner';
  for(const person of people()){const option=el('option','',person.name);option.value=person.id;owner.append(option);}
  const caption=el('input');caption.dataset.albumField='description';caption.maxLength=240;caption.placeholder='外貌、衣着、场景等可核对的图片描述';
  const title=el('input');title.dataset.albumField='title';title.maxLength=60;title.placeholder='照片名称（可选）';
  const access=el('select');access.dataset.albumField='access';
  for(const [id,label] of [['private','仅人物资料，不公开'],['chat','允许在聊天中发送'],['public','允许在聊天、群星与朋友圈使用']]){
   const o=el('option','',label);o.value=id;access.append(o);
  }
  access.value='chat';
  form.append(picker,preview,field('照片属于谁',owner),field('照片名称',title),field('图片内容 / 外貌描述',caption),
    field('使用权限',access),action('upload','添加到相册'));
  wrap.append(form);
  if(state.message)wrap.append(el('p','lp-album-feedback',state.message));
  const list=el('div','lp-album-grid'),photos=items();
  for(const photo of photos){
   if(!safePhoto(photo))continue;
   const card=el('article','lp-album-card'),image=el('img');image.src=photo.image;image.alt=photo.description||photo.title||'相册照片';image.loading='lazy';
   const info=el('div','lp-album-info');
   info.append(el('strong','',photo.title||'未命名照片'),el('small','',nameFor(photo)+' · '+({private:'仅资料',chat:'可发私聊',public:'可公开'}[photo.access]||'仅资料')));
   if(photo.description)info.append(el('p','',photo.description));
   const controls=el('div','lp-album-actions');controls.append(action('delete','删除',photo.id));
   if(photo.access==='chat'||photo.access==='public')controls.prepend(action('chat','发送到聊天',photo.id));
   if(photo.access==='public'&&photo.owner==='user')
    controls.append(action('moment','发朋友圈',photo.id),action('weibo','发群星',photo.id));
   card.append(image,info,controls);list.append(card);
  }
  if(!photos.length)list.append(el('p','lp-album-empty','还没有照片。上传后，可以为每张照片标注人物与用途。'));
  wrap.append(list);
 }
 function handleChange(event){
  if(!event.target?.matches?.('[data-album-field="files"]'))return false;
  const root=host(),area=root?.querySelector('[data-album-preview]');
  const files=[...(event.target.files||[])];if(!area)return false;
  area.replaceChildren();area.hidden=!files.length;
  if(!files.length)return true;
  area.append(el('strong','',files.length+' 张已选择照片'));
  const grid=el('div','lp-album-preview-grid');
  for(const file of files.slice(0,40)){
   const img=document.createElement('img');img.alt=file.name;img.title=file.name;
   const url=URL.createObjectURL(file);img.src=url;img.onload=()=>URL.revokeObjectURL(url);
   grid.append(img);
  }
  area.append(grid);
  return true;
  wrap.scrollTop=previousTop;
 }
 async function encode(file){
  if(!['image/jpeg','image/png','image/webp'].includes(file?.type)||file.size>12*1024*1024)
   throw Error('仅支持12MB以内的 JPG、PNG、WebP 照片');
  const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('图片读取失败'));r.readAsDataURL(file);});
  const picture=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('无法解析照片'));img.src=data;});
  const canvas=document.createElement('canvas'),scale=Math.min(1,900/Math.max(picture.width,picture.height));
  canvas.width=Math.max(1,Math.floor(picture.width*scale));canvas.height=Math.max(1,Math.floor(picture.height*scale));
  const painter=canvas.getContext('2d');if(!painter)throw Error('当前环境不支持压缩照片');
  painter.drawImage(picture,0,0,canvas.width,canvas.height);
  for(const quality of [.78,.66,.52,.4]){
   const result=canvas.toDataURL('image/jpeg',quality);
   if(result.length<=420000)return result;
  }
  throw Error('压缩后仍超过相册单张照片限制');
 }
 async function upload(){
  if(state.busy)return;
  const wrap=host(),files=[...(wrap?.querySelector('[data-album-field="files"]')?.files||[])];
  if(!files.length)return say('请先选择照片',true);
  const owner=wrap.querySelector('[data-album-field="owner"]')?.value;
  const person=people().find(x=>x.id===owner);if(!person)return say('请选择当前故事中的人物',true);
  const title=wrap.querySelector('[data-album-field="title"]')?.value.trim()||'';
  const description=wrap.querySelector('[data-album-field="description"]')?.value.trim()||'';
  const access=wrap.querySelector('[data-album-field="access"]')?.value||'private';
  const original=items();if(original.length+files.length>40)return say('当前角色卡的相册最多40张照片',true);
  const signature=api.albumScope();
  state.busy=true;
  try{
   const added=[];
   for(const file of files){
    const image=await encode(file);
    if(signature!==api.albumScope())throw Error('已切换角色卡，照片未保存');
    added.push({id:'ph-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9),
      owner,ownerName:person.name,title:title||file.name.replace(/\.[^.]+$/,''),description,access,image});
   }
   await api.saveSharedPhotos([...original,...added]);
   say('已添加 '+added.length+' 张照片');
  }catch(e){say(String(e.message||e),true);}finally{state.busy=false;}
 }
 async function handleClick(event){
  const b=event.target.closest('[data-album-action]');if(!b||state.busy)return false;
  const kind=b.dataset.albumAction;
  if(kind==='upload'){await upload();return true;}
  const photo=items().find(p=>p.id===b.dataset.albumId);if(!photo)return false;
  try{
   if(kind==='delete'){
    if(!window.confirm('删除这张相册照片？已发送的聊天消息与已发布的动态不会删除。'))return true;
    await api.saveSharedPhotos(items().filter(x=>x.id!==photo.id));say('照片已删除');return true;
   }
   if(kind==='chat')await api.albumSendToChat(photo);
   else if(kind==='moment')await api.albumPostMoment(photo);
   else if(kind==='weibo')await api.albumPostWeibo(photo);
   else return false;
   say('已完成照片操作');return true;
  }catch(e){say('照片操作失败：'+String(e.message||e),true);return true;}
 }
 return {open:render,render,handleClick,handleChange};
}
