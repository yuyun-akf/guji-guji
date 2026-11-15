import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');
const weibo=readFileSync(new URL('../weibo.js',import.meta.url),'utf8');
const takeout=readFileSync(new URL('../takeout.js',import.meta.url),'utf8');
function isolated(label,end,expose,bindings=''){
 const s=index.slice(index.indexOf(label),index.indexOf(end,index.indexOf(label)));
 assert.ok(s.length>10,label+' should exist');
 return new Function('args',bindings+'\n'+s+'\nreturn '+expose+';');
}
test('default style cannot inherit custom CSS, icons or font from previous themes',()=>{
 const a={value:{palette:'swiss',font:'uploaded',customCss:'#st-little-phone-root .lp-bubble{color:purple}',icons:{chat:'x'},savedThemes:[]}};
 const root={
  white:'#ffffff',ice:'#e0e8f2',blush:'#f1d6d6',rose:'#e39f9f',slate:'#8b9bc1',navy:'#35568a'
 };
 const helper=isolated('function savedThemeProfile(','function paletteValue(', '{view:themeView,validate:validThemeCss}',
  'const themeData=()=>args.data.value;const SWISS_THEME=args.colors;')({data:a,colors:root});
 const def=helper.view();
 assert.equal(def.palette,'swiss');assert.equal(def.font,'system');assert.equal(def.customCss,'');
 assert.deepEqual(Object.keys(def.icons),[]);
 const t={id:'test',name:'琉璃繁缕',font:'rounded',colors:{navy:'#123456'},customCss:'#st-little-phone-root .lp-bubble{color:red}'};
 a.value={...a.value,palette:'saved:test',savedThemes:[t]};
 assert.equal(helper.view().font,'rounded');assert.equal(helper.view().colors.navy,'#123456');
 assert.equal(helper.view().customCss,t.customCss);
});
test('imported CSS stays inside the phone, without external resources',()=>{
 const helper=isolated('function savedThemeProfile(','function paletteValue(', '{validate:validThemeCss}',
  'const themeData=()=>args.data.value;const SWISS_THEME=args.colors;')({data:{value:{}},colors:{}});
 assert.match(helper.validate('#st-little-phone-root .lp-bubble{border-radius:18px;}'),/border-radius/);
 for(const v of ['body{display:none}', '@import url(https://example.org/a.css)',
  '#st-little-phone-root .lp-chat{color:red} html{color:red}', '.lp-bubble{color:red}']){
  assert.throws(()=>helper.validate(v));
 }
});
test('only stable slide and fade effects are offered, retiring old cube and stack',()=>{
 assert.match(index,/const DESKTOP_EFFECTS=new Set\(\['slide','fade'\]\)/);
 assert.doesNotMatch(index,/<option value="cube">/);
 assert.doesNotMatch(index,/<option value="stack">/);
 assert.match(css,/visibility \.36s!important/);
 const expr=isolated('const DESKTOP_EFFECTS=','function renderDesktop(){','({effect:desktopEffect,visual:desktopVisual})',
  "const themeData=()=>args.theme;const root=args.root;const nodes=args.nodes;");
 const pages=Array.from({length:2},()=>({classList:{toggle(){}},style:{},setAttribute(){}}));
 const app=expr({theme:{desktopEffect:'cube'},root:{dataset:{}},nodes:{
  homePages:{children:pages,dataset:{}},homeDots:{querySelectorAll:()=>[{classList:{toggle(){}}},{classList:{toggle(){}}}]}
 }});
 assert.equal(app.effect(),'slide');
 app.visual(1);
 assert.equal(pages[0].style.visibility,'hidden');
 assert.equal(pages[1].style.visibility,'visible');
 assert.match(pages[0].style.transform,/-100%/);
});
test('phone header is the only back path for nested Qunxing and takeout views',()=>{
 assert.match(index,/activeScreen==='weibo'&&weiboController\?\.back\(\)/);
 assert.match(index,/activeScreen==='takeout'&&takeoutController\?\.back\(\)/);
 assert.match(weibo,/n\.weiboDetailBack\.hidden=true/);
 assert.doesNotMatch(weibo,/control\('‹ 返回','backMe'\)/);
 assert.match(takeout,/function back\(\)/);
 const s=weibo.slice(weibo.indexOf('function back(){'),weibo.indexOf('function handleClick(event){',weibo.indexOf('function back(){')));
 const getBack=new Function('state','render',s+';return back;');
 for(const key of ['detail','topic','subview']){
  const state={detail:'',topic:null,subview:''};state[key]=key==='topic'?{title:'test'}:'test';
  let painted=0;const back=getBack(state,()=>painted++);
  assert.equal(back(),true);assert.equal(painted,1);
 }
 const state={detail:'',topic:null,subview:''};
 assert.equal(getBack(state,()=>{})(),false,'no detail means header may return to phone home');
});
test('theme controls are wired and external recovery remains independent',()=>{
 const ids=['themeSaveNamed','themeRename','themeDelete','themeExport','themeImport','themeFontFile',
 'themeIconFile','themeFloatingIconFile','themeCssFile','themeDesktopIconSize','themeDesktopGap',
 'themeBubbleRadius','themeCopySelectors'];
 for(const id of ids){
  assert.ok(index.includes('data-lp="'+id+'"'),id+' markup present');
  assert.ok(index.includes('nodes.'+id+'.addEventListener'),id+' handler registered');
 }
 assert.match(index,/function restoreDefaultThemeFromHost/);
 assert.match(index,/function resetPhonePasswordFromHost/);
 assert.match(index,/请先选择自定义主题再删除/);
 assert.match(index,/琉璃繁缕（内置）/);
 for(const name of ['鸢尾流光','海棠春信','金盏朝露']){
  assert.ok(index.includes("name:'"+name+"'"),name);
 }
 assert.doesNotMatch(index,/瑞士纸韵|瑞士花影|瑞士珊瑚|瑞士麦穗/);
 assert.match(index,/nodes\.themeDelete\.disabled=isBuiltInPalette\(theme\.palette\)/);
 assert.match(css,/\.lp-theme-library-tools/);
});
test('wallet diamonds stay inside icon canvas and settings gear uses concentric circles',()=>{
 assert.match(index,/wallet:'<path d="M12 2\.5 15 5\.5/);
 assert.match(index,/settings:'<circle cx="12" cy="12" r="7\.3"/);
 assert.match(index,/settings:'<circle cx="12" cy="12" r="7\.3"\/><circle cx="12" cy="12" r="3\.15"/);
 assert.match(index,/adoptHostWandColor/);
});
