import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const style=readFileSync(new URL('../style.css',import.meta.url),'utf8');
const manifest=JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url),'utf8'));
const begin=index.indexOf('/* Shared interaction system for every GujiGuji app.');
const end=index.indexOf('let phoneInteraction=null;',begin);
assert.ok(begin>=0&&end>begin,'inline universal interaction controller exists');
const source=index.slice(begin,end);
const classList=(...names)=>{
 const values=new Set(names);
 return {add(...names){names.forEach(n=>values.add(n));},remove(...names){names.forEach(n=>values.delete(n));},contains(name){return values.has(name);}};
};
function harness(selectedMode='standard',reducedMotion=false){
 const listeners=new Map();
 const feedback={hidden:true,textContent:'',dataset:{}};
 const select={value:'off'};
 const panel={classList:classList(),append(child){this.portal=child;},animate(){},
  getBoundingClientRect(){return {left:0,top:0,width:360,height:680};}};
 const screen={style:{opacity:''},animate(){}};
 const icon={classList:classList(),cloneNode(){
  return {classList:classList(),append(){}};
 },getBoundingClientRect(){return {left:32,top:112,width:52,height:52};}};
 const tile={querySelector(){return icon;}};
 const root={dataset:{},classList:classList('lp-open'),contains(){return true;},
  addEventListener(name,listener){listeners.set(name,listener);},
  querySelector(query){
   if(query==='.lp-panel')return panel;
   if(query.startsWith('[data-lp-screen='))return screen;
   if(query.includes('button[data-lp-open='))return tile;
   return null;
  }};
 const nodes={interactionFeedback:feedback,interactionMotion:select};
 const document={createElement(){
  return {classList:classList(),style:{setProperty(){}},setAttribute(){},append(){},addEventListener(){},remove(){this.removed=true;},
   animate(frames,options){
    const animation={frames,options,cancel(){}};
    this.animation=animation;
    return animation;
   }};
 }};
 const window={matchMedia(){return {matches:reducedMotion};}};
 const factory=new Function('window','document',source+'return createInteractionController;')(window,document);
 const instance=factory({getRoot:()=>root,getNodes:()=>nodes,getMode:()=>selectedMode});
 return {instance,root,nodes,listeners,panel,screen,tile};
}
test('all ten open apps use the shared event and page transition system',()=>{
 const start=index.indexOf('const APP_CATALOG=['),end=index.indexOf('const APP_ICONS=',start);
 assert.ok(start>=0&&end>start);
 assert.equal((index.slice(start,end).match(/ready:true/g)||[]).length,10);
 assert.match(index,/phoneInteraction\.bind\(root\)/);
 assert.match(index,/phoneInteraction\?\.navigate\(\{previous,screen,origin:source\}\)/);
 assert.match(index,/sourceTile:activeScreen==='home'\?button:null/);
 assert.match(index,/data-lp="interactionMotion"/);
 assert.match(index,/data-lp="interactionFeedback"/);
 assert.match(style,/\.lp-app-portal/);
 assert.match(style,/\.lp-press-bounce/);
 assert.equal(manifest.version,'0.34.0');
});
test('pointer and keyboard controls shade while held and flash after click',()=>{
 const h=harness();h.instance.bind(h.root);
 assert.equal(h.root.dataset.motion,'standard');
 const button={disabled:false,classList:classList(),offsetWidth:50,textContent:'保存设置',dataset:{},
  matches:selector=>selector.includes('button'),getBoundingClientRect:()=>({left:0,top:0,width:80,height:36}),
  append(dot){this.lastRipple=dot;},getAttribute:()=>null};
 const event={button:0,target:{closest:()=>button}};
 h.listeners.get('pointerdown')(event);
 assert.equal(button.classList.contains('lp-press-down'),true);
 assert.equal(button.classList.contains('lp-primary-press'),true);
 h.listeners.get('pointerup')(event);
 assert.equal(button.classList.contains('lp-press-down'),false);
 h.listeners.get('click')(event);
 assert.equal(button.classList.contains('lp-click-feedback'),true);
 h.listeners.get('keydown')({...event,key:'Enter'});
 assert.equal(button.classList.contains('lp-press-down'),true);
 h.listeners.get('keyup')(event);
 assert.equal(button.classList.contains('lp-press-down'),false);
 h.instance.shutdown();
});
test('disabled controls and reduced motion have no press animation but still report outcomes',()=>{
 const h=harness('standard',true);h.instance.bind(h.root);
 assert.equal(h.instance.mode(),'off');
 const disabled={disabled:true,classList:classList(),getAttribute:()=>null};
 h.listeners.get('pointerdown')({button:0,target:{closest:()=>disabled}});
 assert.equal(disabled.classList.contains('lp-press-down'),false);
 h.instance.toast('保存失败','error');
 assert.equal(h.nodes.interactionFeedback.hidden,false);
 assert.equal(h.nodes.interactionFeedback.dataset.kind,'error');
 h.instance.pause();
 assert.equal(h.nodes.interactionFeedback.hidden,true);
});
test('opening expands from icon to phone dimensions and returning collapses',()=>{
 const h=harness();h.instance.bind(h.root);
 const origin=h.instance.capture(h.tile);
 assert.equal(origin.rect.width,52);
 h.instance.navigate({previous:'home',screen:'weibo',origin});
 let animation=h.panel.portal.animation;
 assert.equal(animation.frames[0].width,'52px');
 assert.equal(animation.frames[1].width,'360px');
 assert.equal(h.screen.style.opacity,'0');
 animation.onfinish();
 assert.equal(h.screen.style.opacity,'');
 h.instance.navigate({previous:'weibo',screen:'home'});
 animation=h.panel.portal.animation;
 assert.equal(animation.frames[0].width,'360px');
 assert.equal(animation.frames.at(-1).width,'52px');
 animation.onfinish();
 h.instance.shutdown();
});
test('global off mode still permits saving feedback text',()=>{
 const h=harness('off');h.instance.bind(h.root);
 assert.equal(h.instance.mode(),'off');
 h.instance.toast('主题已保存','success');
 assert.equal(h.nodes.interactionFeedback.textContent,'主题已保存');
 assert.equal(h.nodes.interactionFeedback.dataset.kind,'success');
 h.instance.shutdown();
});
test('status notifications are driven by actual results rather than physical taps',()=>{
 assert.match(index,/phoneInteraction\?\.fromStatus\(statusText,kind\)/);
 assert.match(index,/notifyInteraction\(stage\+'失败：'\+detail,'error'\)/);
 assert.match(index,/phoneInteraction\?\.pause\(\)/);
 assert.match(source,/MutationObserver/);
 const takeout=readFileSync(new URL('../takeout.js',import.meta.url),'utf8');
 const group=readFileSync(new URL('../weibo.js',import.meta.url),'utf8');
 assert.match(takeout,/api\.notifyInteraction\?\./);
 assert.match(group,/api\.notifyInteraction\?\./);
});


test('loading status and redundant in-place success messages do not create toasts',()=>{
 const h=harness();
 h.instance.bind(h.root);
 h.instance.fromStatus('正在生成角色回复，请稍候…');
 assert.equal(h.nodes.interactionFeedback.hidden,true);
 h.instance.fromStatus('已收到回复。');
 assert.equal(h.nodes.interactionFeedback.hidden,true);
 h.instance.fromStatus('悬浮按钮已关闭');
 assert.equal(h.nodes.interactionFeedback.hidden,true);
 h.instance.fromStatus('锁屏设置已保存');
 assert.equal(h.nodes.interactionFeedback.textContent,'锁屏设置已保存');
 assert.equal(h.nodes.interactionFeedback.dataset.kind,'success');
 h.instance.shutdown();
});
test('CSS pressed-state shading and centered feedback replace unreliable particles',()=>{
 assert.ok(style.includes('lp-click-feedback:not(:disabled)'));
 assert.ok(style.includes('filter:brightness(.84)!important'));
 assert.ok(style.includes('top:50%!important'));
 assert.ok(style.includes('.lp-me-notification-setting{'));
 assert.ok(index.includes('lp-click-feedback'));
 assert.ok(!source.includes('function burst('));
});
