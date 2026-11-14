import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8').replaceAll('export function ','function ');
function harness(){
 const info={characters:[{name:'宁肆锦'}],characterId:0,chatId:'story',chatMetadata:{},extensionSettings:{}};
 const scope={Date,Math,Intl,structuredClone,console,window:{SillyTavern:{getContext:()=>info}},setTimeout,clearTimeout,setInterval:()=>1,clearInterval:()=>{}};
 vm.createContext(scope);
 vm.runInContext(source+'\nglobalThis.uiTest={walletCents,walletMoney,walletCreateTransfer,walletLedgerDisplay,walletState,chatTimeLabel,isChatTimeBreak};',scope);
 return scope.uiTest;
}
test('time dividers show only at ten minutes or day changes, formatted by story date',()=>{
 const h=harness();
 assert.equal(h.chatTimeLabel('2025-12-17T19:50','2025-12-17T22:00'),'19:50');
 assert.equal(h.chatTimeLabel('2025-12-16T19:50','2025-12-17T22:00'),'昨天 19:50');
 assert.match(h.chatTimeLabel('2025-12-15T19:50','2025-12-17T22:00'),/^星期一 /);
 assert.equal(h.chatTimeLabel('2025-12-01T19:50','2025-12-17T22:00'),'2025年12月01日 19:50');
 assert.equal(h.isChatTimeBreak('2025-12-17T19:50','2025-12-17T19:59'),false);
 assert.equal(h.isChatTimeBreak('2025-12-17T19:50','2025-12-17T20:00'),true);
 assert.equal(h.isChatTimeBreak('2025-12-17T23:58','2025-12-18T00:01'),true);
});
test('wallet remembers counterparty and note and caps only redpacket to 200 yuan',()=>{
 const h=harness(),data={storyTime:'2025-12-17T19:50',messages:[],contacts:[{id:'npc',name:'黎奖',remark:'梨子'}],
  wallet:{balanceCents:12000000,ledger:[],transfers:[],events:[]}};
 const payment=h.walletCreateTransfer(data,{kind:'transfer',from:'user',contactId:'npc',note:'天天开心',amountCents:30000});
 assert.equal(payment.counterpartyName,'梨子');
 const bill=data.wallet.ledger.find(e=>e.relatedId===payment.id);
 assert.equal(h.walletLedgerDisplay(null,bill,data.wallet).label,'转账给梨子');
 assert.equal(h.walletLedgerDisplay(null,bill,data.wallet).note,'天天开心');
 assert.equal(h.walletCents('500000'),50000000);
 assert.equal(h.walletMoney(30001),'300.01');
 assert.throws(()=>h.walletCreateTransfer(data,{kind:'redpacket',from:'user',contactId:'npc',amountCents:20001}),/红包/);
 const ok=h.walletCreateTransfer(data,{kind:'redpacket',from:'user',contactId:'npc',amountCents:20000});
 assert.equal(ok.amountCents,20000);
});
test('desktop UI and location/transaction panels stay wired',()=>{
 const markup=source.split('container.innerHTML = '+String.fromCharCode(96))[1].split(String.fromCharCode(96)+';\n    return container;')[0];
 for(const key of ['themeDesktopEffect','homePages','messageActions','morePanel','emojiPanel','walletBills','walletPending']){
  assert.ok(markup.includes('data-lp="'+key+'"'),key+' missing');
 }
 assert.equal((markup.match(/data-lp="desktopSortList"/g)||[]).length,1);
 assert.ok(!markup.includes('data-lp="bridgeEvents"'));
 assert.ok(!markup.includes('class="lp-home-dock"'));
 assert.ok(source.includes('function locationCard('));
 assert.ok(source.includes("nodes.close.hidden=true"));
 const composer=markup.lastIndexOf('class="lp-composer"'),tools=markup.lastIndexOf('class="lp-more-panel"');
 assert.ok(tools>composer,'attachments belong after composer');
});
