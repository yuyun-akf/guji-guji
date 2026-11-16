import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../shopping.js',import.meta.url),'utf8');
const factory=new Function('document',
 script.replace('export function createShoppingModule','function createShoppingModule')+
 '\nreturn createShoppingModule;');

function element(tag){
 return {tag,className:'',textContent:'',dataset:{},children:[],scrollTop:20,
  append(...children){this.children.push(...children);},
  replaceChildren(...children){this.children=children;},
  setAttribute(k,v){(this.attributes??={})[k]=v;}
 };
}
function harness(){
 const tabs=['browse','cart','me'].map(tab=>({
  dataset:{shoppingTab:tab},active:false,attributes:{},
  classList:{toggle(_class,on){this.parent.active=on;}},
  setAttribute(k,v){this.attributes[k]=v;}
 }));
 for(const tab of tabs)tab.classList.parent=tab;
 const content=element('div');
 const scope={};
 const ctx={chatMetadata:scope};
 const nodes={shoppingContent:content,shoppingTabs:{querySelectorAll:()=>tabs}};
 const app=factory({createElement:element})({context:()=>ctx,getNodes:()=>nodes});
 return {app,tabs,content,ctx};
}
test('shopping tabs can switch and remain independent of takeout',()=>{
 const {app,tabs,content,ctx}=harness();
 app.open();
 assert.equal(app.state.tab,'browse');
 assert.deepEqual(tabs.map(x=>x.active),[true,false,false]);
 app.selectTab('cart');
 assert.equal(app.state.tab,'cart');
 assert.deepEqual(tabs.map(x=>x.active),[false,true,false]);
 assert.equal(tabs[1].attributes['aria-current'],'page');
 app.handleClick({target:{closest:()=>({dataset:{shoppingAction:'browse'}})}});
 assert.equal(app.state.tab,'browse');
 app.selectTab('me');
 assert.deepEqual(tabs.map(x=>x.active),[false,false,true]);
 assert.equal(app.back(),false);
 assert.equal(content.children[0].children[0].children[0].textContent,'我的购物');
 ctx.chatMetadata={};
 app.open();
 assert.equal(app.state.tab,'browse');
 app.selectTab('invalid');
 assert.equal(app.state.tab,'browse');
});
test('shopping icon and three-section markup are wired into the phone',()=>{
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 assert.ok(index.includes("screen:'shopping',name:'购物',ready:true"));
 assert.ok(index.includes("import('./shopping.js?v=0.36.2')"));
 assert.ok(index.includes("'shoppingContent','shoppingTabs'"));
 assert.ok(index.includes("if(activeScreen==='shopping'&&shoppingController?.back())return"));
 for(const tab of ['browse','cart','me'])assert.ok(index.includes('data-shopping-tab="'+tab+'"'));
 const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');
 assert.ok(css.includes('.lp-shopping-tabs button.active'));
});
