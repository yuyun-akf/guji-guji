/* Shopping app scaffold. Product inventory and checkout are intentionally not implemented yet. */
export function createShoppingModule(api){
 const state={scope:null,tab:'browse'};
 const scrollByTab=new Map();let shownTab='';
 const validTabs=new Set(['browse','cart','me']);
 const create=(tag,cls='',text)=>{
  const element=document.createElement(tag);
  if(cls)element.className=cls;
  if(text!==undefined)element.textContent=text;
  return element;
 };
 function render(){
  const nodes=api.getNodes();
  if(!nodes?.shoppingContent||!nodes?.shoppingTabs)return;
  nodes.shoppingTabs.querySelectorAll('[data-shopping-tab]').forEach(button=>{
   const active=button.dataset.shoppingTab===state.tab;
   button.classList.toggle('active',active);
   button.setAttribute('aria-current',active?'page':'false');
  });
  const body=create('div','lp-shopping-body');
  const headings={
   browse:['浏览','发现喜欢的商品'],
   cart:['购物车','查看已选商品'],
   me:['我的购物','订单与账号']
  };
  const header=create('div','lp-shopping-heading');
  header.append(create('strong','',headings[state.tab][0]),
   create('small','',headings[state.tab][1]));
  body.append(header);
  const card=create('section','lp-shopping-card');
  if(state.tab==='browse'){
   card.append(create('strong','','商品浏览区'),
    create('p','lp-shopping-empty','商品展示与搜索功能将在后续加入。'));
  }else if(state.tab==='cart'){
   card.append(create('p','lp-shopping-empty','购物车还是空的'));
   const explore=create('button','lp-shopping-button','去逛逛');
   explore.type='button';explore.dataset.shoppingAction='browse';
   card.append(explore);
  }else{
   card.append(create('strong','','我的购物'),
    create('p','lp-shopping-empty','订单、收货地址与账号资料将在后续加入。'));
  }
  body.append(card);
  const scroller=nodes.shoppingContent;
  if(shownTab&&shownTab!==state.tab)scrollByTab.set(shownTab,scroller.scrollTop);
  const top=shownTab===state.tab?scroller.scrollTop:(scrollByTab.get(state.tab)||0);
  scroller.replaceChildren(body);scroller.scrollTop=top;shownTab=state.tab;
 }
 function selectTab(tab){
  if(!validTabs.has(tab))return;
  state.tab=tab;
  render();
 }
 function open(){
  const scope=api.context()?.chatMetadata??null;
  if(state.scope!==scope){state.scope=scope;state.tab='browse';scrollByTab.clear();shownTab='';}
  render();
 }
 function handleClick(event){
  const b=event.target.closest('[data-shopping-action]');
  if(!b)return false;
  if(b.dataset.shoppingAction==='browse'){selectTab('browse');return true;}
  return false;
 }
 function back(){return false;}
 return {state,open,render,selectTab,handleClick,back};
}
