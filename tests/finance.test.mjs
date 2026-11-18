import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import vm from 'node:vm';

const source=readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),'../index.js'),'utf8')
    .replaceAll('export function ','function ');
function harness(ctx=null,document=null){
    const events=[];
    const scope={console,Date,Intl,structuredClone,Math,events,document,
        window:{SillyTavern:{getContext:()=>ctx}},
        setTimeout,clearTimeout,setInterval:()=>1,clearInterval:()=>{}};
    vm.createContext(scope);
    vm.runInContext(source+`
        recordActivity=(...args)=>events.push(args);
        globalThis.financeTest={
            walletCents,walletMoney,walletState,walletAdjustBalance,walletCreateTransfer,
            walletSettleTransfer,walletExpireTransfers,walletChargeOrder,walletRefundOrder,
            walletInvalidateMainlinePayment,detectMainlinePayment,mainlineAmountCents,
            syncMainlinePayments,mainlineStructuredEvents,classifyStoryFriendEvent,
            applyPaymentModelTags,applyCharacterPaymentSendTag,buildPrompt,
            readRootData,writeData,appendPhoneMessage,newData,makeUI,
            confirmPaymentReceipt,markContactExchanged,
            mountConfirmationPanel(panel){
                root={querySelector:()=>panel,classList:{contains:()=>true}};
                mounted=true;render=()=>{};
            }
        };
    `,scope);
    return {...scope.financeTest,events};
}
function story(){
    return {version:1,storyTime:'2026-11-15T19:00',messages:[],friendship:{state:'friends'},contacts:[],conversations:{}};
}
function walletMock(){
    const data=story(),api=harness();
    api.walletAdjustBalance(data,100000,'初始余额');
    return {data,api};
}
test('money input keeps cents and rejects improper, zero, negative or excessive amounts',()=>{
    const {walletCents}=harness();
    assert.equal(walletCents('200'),20000);
    assert.equal(walletCents('20.05'),2005);
    assert.equal(walletCents('0.01'),1);
    assert.equal(walletCents('0',true),0);
    assert.equal(walletCents('1000000000'),100000000000); // no arbitrary per-transfer cap
    for(const bad of ['-1','0','1.234','1e4','999999999999999999','abc'])
        assert.throws(()=>walletCents(bad));
});
test('outgoing transfers reserve money once; cancellation refunds exactly once',()=>{
    const {data,api}=walletMock();
    const tx=api.walletCreateTransfer(data,{id:'pay:a',amountCents:20000,kind:'transfer',from:'user'});
    assert.equal(api.walletState(data).balanceCents,80000);
    assert.equal(api.walletCreateTransfer(data,{id:'pay:a',amountCents:20000}).id,tx.id);
    assert.equal(api.walletState(data).balanceCents,80000);
    api.walletSettleTransfer(data,tx.id,'cancelled');
    assert.equal(api.walletState(data).balanceCents,100000);
    api.walletSettleTransfer(data,tx.id,'cancelled');
    assert.equal(api.walletState(data).balanceCents,100000);
    assert.equal(api.walletState(data).ledger.filter(x=>x.relatedId===tx.id).length,2);
});
test('phone confirmation cancels safely and settles one pending payment only after confirmation',async()=>{
    class Element extends EventTarget {
        children=[];
        attrs={};
        open=false;
        append(...children){this.children.push(...children);for(const child of children)child.parent=this;}
        setAttribute(name,value){this.attrs[name]=value;}
        showModal(){this.open=true;}
        close(){this.open=false;}
        remove(){this.parent.children=this.parent.children.filter(child=>child!==this);}
        click(){this.dispatchEvent(new Event('click'));}
    }
    const data=story(),panel=new Element();
    const ctx={name1:'测试面具',characterId:0,characters:[{name:'测试角色'}],chatId:'story',
        chatMetadata:{st_little_phone_v1:data},saveMetadata:async()=>{}};
    const api=harness(ctx,{createElement:()=>new Element(),visibilityState:'visible'});
    api.mountConfirmationPanel(panel);
    api.walletCreateTransfer(data,{id:'pay:packet',kind:'redpacket',from:'contact',amountCents:6666});
    api.walletCreateTransfer(data,{id:'pay:transfer',kind:'transfer',from:'contact',amountCents:5200});
    const getPayment=id=>api.walletState(api.readRootData(ctx)).transfers.find(item=>item.id===id);
    const redpacket=api.confirmPaymentReceipt('pay:packet');
    const [dialog]=panel.children;
    assert.equal(dialog.open,true);
    assert.equal(dialog.children[0].textContent,'领取红包');
    assert.doesNotMatch(dialog.children[1].textContent,/66\.66/);
    await api.confirmPaymentReceipt('pay:transfer');
    assert.equal(panel.children.length,1);
    dialog.dispatchEvent(new Event('cancel',{cancelable:true}));
    await redpacket;
    assert.equal(getPayment('pay:packet').status,'pending');
    assert.equal(panel.children.length,0);

    const transfer=api.confirmPaymentReceipt('pay:transfer');
    const [title,detail,buttons]=panel.children[0].children;
    assert.equal(title.textContent,'确认收款');
    assert.match(detail.textContent,/¥52\.00/);
    buttons.children[1].click();
    await transfer;
    assert.equal(getPayment('pay:transfer').status,'accepted');
    assert.equal(api.walletState(api.readRootData(ctx)).balanceCents,5200);
    assert.equal(api.readRootData(ctx).messages.filter(message=>message.paymentReceiptId==='pay:transfer').length,1);

    const stale=api.confirmPaymentReceipt('pay:packet');
    const previous=ctx.chatMetadata;
    ctx.chatMetadata=structuredClone(previous);
    panel.children[0].children[2].children[1].click();
    await stale;
    assert.equal(getPayment('pay:packet').status,'pending');
    assert.equal(api.walletState(previous.st_little_phone_v1).balanceCents,5200);

    ctx.chatMetadata.st_little_phone_v1.friendship={state:'stranger'};
    ctx.name1='另一个面具';
    const exchange=api.markContactExchanged();
    const contactDialog=panel.children[0];
    assert.equal(contactDialog.children[0].textContent,'确认交换联系方式');
    assert.equal(contactDialog.children[1].textContent,'另一个面具 与 测试角色 已交换联系方式。');
    contactDialog.children[2].children[1].click();
    await exchange;
    assert.equal(api.readRootData(ctx).contactAccess,'manual');
    assert.equal(api.readRootData(ctx).friendship.state,'stranger');
});
test('balances enforce spending limits; all shopping and takeout use one account',()=>{
    const {data,api}=walletMock();
    api.walletChargeOrder(data,{orderId:'food:1',amountCents:3500,shop:'食堂',category:'takeout'});
    assert.equal(api.walletState(data).balanceCents,96500);
    api.walletChargeOrder(data,{orderId:'food:1',amountCents:3500,shop:'食堂',category:'takeout'});
    assert.equal(api.walletState(data).balanceCents,96500);
    assert.throws(()=>api.walletChargeOrder(data,{orderId:'bad',amountCents:-500,category:'shopping'}));
    assert.throws(()=>api.walletCreateTransfer(data,{amountCents:1000000,kind:'redpacket',from:'user'}),/红包/);
    assert.throws(()=>api.walletCreateTransfer(data,{amountCents:150000,kind:'transfer',from:'user'}),/余额不足/);
    api.walletRefundOrder(data,{orderId:'food:1',amountCents:3500,category:'takeout'});
    assert.equal(api.walletState(data).balanceCents,100000);
    api.walletRefundOrder(data,{orderId:'food:1',amountCents:3500,category:'takeout'});
    assert.equal(api.walletState(data).balanceCents,100000);
});
test('account snapshot preserves counterparty and transfer metadata',()=>{
    const api=harness(),data=story();
    data.contacts=[{id:'npc-friend',name:'联系人乙',remark:'同学乙'}];
    api.walletAdjustBalance(data,500000,'初始余额');
    const tx=api.walletCreateTransfer(data,{id:'pay:snapshot',kind:'transfer',from:'user',contactId:'npc-friend',amountCents:30000,note:'吃饭钱'});
    assert.equal(tx.counterpartyName,'同学乙');
    const entry=api.walletState(data).ledger.find(x=>x.relatedId===tx.id);
    assert.equal(entry.counterpartyName,'同学乙');
    assert.equal(entry.note,'吃饭钱');
    assert.throws(()=>api.walletCreateTransfer(data,{kind:'redpacket',from:'contact',amountCents:20001}),/红包/);
});
test('incoming red packets require user consent; reject and repeated accept never credit twice',()=>{
    const api=harness(),data=story();
    const first=api.walletCreateTransfer(data,{id:'in:1',kind:'redpacket',from:'contact',amountCents:6666});
    assert.equal(api.walletState(data).balanceCents,0);
    api.walletSettleTransfer(data,first.id,'accepted');
    assert.equal(api.walletState(data).balanceCents,6666);
    api.walletSettleTransfer(data,first.id,'accepted');
    assert.equal(api.walletState(data).balanceCents,6666);
    const second=api.walletCreateTransfer(data,{id:'in:2',kind:'transfer',from:'contact',amountCents:10000});
    api.walletSettleTransfer(data,second.id,'declined');
    assert.equal(api.walletState(data).balanceCents,6666);
    assert.throws(()=>api.walletSettleTransfer(data,second.id,'accepted'),/已经处理/);
});
test('24 story hours expire unclaimed user transfers and refund exactly once',()=>{
    const {data,api}=walletMock();
    const tx=api.walletCreateTransfer(data,{id:'expire:1',kind:'redpacket',from:'user',amountCents:1200,storyTime:data.storyTime});
    assert.equal(api.walletState(data).balanceCents,98800);
    data.storyTime='2026-11-16T18:59';
    assert.equal(api.walletExpireTransfers(data),0);
    data.storyTime='2026-11-16T19:00';
    assert.equal(api.walletExpireTransfers(data),1);
    assert.equal(tx.status,'expired');
    assert.equal(api.walletState(data).balanceCents,100000);
    assert.equal(api.walletExpireTransfers(data),0);
});
test('mainline detection only accepts completed character payment statements',()=>{
    const {detectMainlinePayment,mainlineAmountCents}=harness();
    assert.equal(mainlineAmountCents('两百'),20000);
    assert.equal(mainlineAmountCents('三千二百'),320000);
    const paid=detectMainlinePayment({mes:'我已经给你转了两百块，记得收。',is_user:false},7);
    assert.equal(paid.kind,'transfer');
    assert.equal(paid.amountCents,20000);
    const gift=detectMainlinePayment({mes:'我给你发了66.66元红包。',is_user:false},8);
    assert.equal(gift?.amountCents,6666);
    for(const body of ['我想给你转两百块','等会给你转账200','如果我给你转账200呢','我还没给你转账200','可能给你转账200','你刚说我给你转账200']){
        assert.equal(detectMainlinePayment({mes:body,is_user:false},7),null,body);
    }
    assert.equal(detectMainlinePayment({mes:'我给你转了200元',is_user:true},7),null);
});
test('edited mainline transfer is invalidated and accepted money is reversed',async()=>{
    const ctx={characterId:0,groupId:null,chatId:'room1',name1:'面具甲',
        characters:[{name:'顾明舟',avatar:'char.png'}],
        chat:[{mes:'我给你转了200元',is_user:false}],
        chatMetadata:{st_little_phone_v1:story()},
        saveMetadata:async()=>{},
        setExtensionPrompt:()=>{}};
    const api=harness(ctx);
    const first=await api.syncMainlinePayments(ctx);
    assert.equal(first.created,1);
    assert.equal(api.readRootData(ctx).messages.filter(x=>x.paymentId).length,1);
    assert.equal(api.walletState(api.readRootData(ctx)).balanceCents,0);
    await api.syncMainlinePayments(ctx);
    assert.equal(api.readRootData(ctx).messages.filter(x=>x.paymentId).length,1);
    const root=structuredClone(api.readRootData(ctx));
    const id=root.wallet.transfers[0].id;
    api.walletSettleTransfer(root,id,'accepted');
    await api.writeData(ctx,root);
    assert.equal(api.walletState(api.readRootData(ctx)).balanceCents,20000);
    assert.match(api.mainlineStructuredEvents(api.readRootData(ctx)),/已收款/);
    ctx.chat[0].mes='我准备给你转200元';
    const changed=await api.syncMainlinePayments(ctx);
    assert.equal(changed.invalidated,1);
    assert.equal(api.walletState(api.readRootData(ctx)).balanceCents,0);
    assert.equal(api.readRootData(ctx).wallet.transfers[0].status,'invalidated');
});
test('edited mainline source with already spent credits becomes a visible conflict',async()=>{
    const ctx={characterId:0,groupId:null,chatId:'room2',characters:[{name:'顾明舟',avatar:'char.png'}],
        chat:[{mes:'我给你转了200元',is_user:false}],chatMetadata:{st_little_phone_v1:story()},
        saveMetadata:async()=>{}};
    const api=harness(ctx);
    await api.syncMainlinePayments(ctx);
    let root=structuredClone(api.readRootData(ctx));
    api.walletSettleTransfer(root,root.wallet.transfers[0].id,'accepted');
    api.walletChargeOrder(root,{orderId:'shopping:1',amountCents:20000,shop:'买东西'});
    await api.writeData(ctx,root);
    ctx.chat[0].mes='我想给你转200元';
    await api.syncMainlinePayments(ctx);
    root=api.readRootData(ctx);
    assert.equal(root.wallet.transfers[0].status,'conflict');
    assert.equal(root.wallet.balanceCents,0);
    assert.ok(root.wallet.events.some(x=>x.type==='payment.conflict'));
});
test('character wallet directives never require an additional API and never decide for user',()=>{
    const {api,data}=walletMock();
    const sent=api.applyCharacterPaymentSendTag(data,'我发你个红包 [[PAYMENT_SEND:redpacket:66.66]]','primary');
    assert.equal(sent.text,'我发你个红包');
    assert.equal(sent.created?.amountCents,6666);
    assert.equal(api.walletState(data).balanceCents,100000);
    const toChar=api.walletCreateTransfer(data,{id:'user:1',kind:'transfer',from:'user',amountCents:20000});
    const reply=api.applyPaymentModelTags(data,'收下了 [[PAYMENT_ACCEPT:user:1]]','primary');
    assert.equal(reply,'收下了');
    assert.equal(toChar.status,'accepted');
    assert.equal(api.walletState(data).balanceCents,80000);
    assert.equal(api.applyPaymentModelTags(data,'已收下 [[PAYMENT_ACCEPT:user:1]]','primary'),'已收下');
});
test('friend requests distinguish role speech from the player action',()=>{
    const {classifyStoryFriendEvent}=harness();
    assert.equal(classifyStoryFriendEvent('我刚向你发了好友申请','顾明舟',true,'character')?.state,'incoming');
    assert.equal(classifyStoryFriendEvent('我同意了你的好友申请','顾明舟',true,'user')?.state,'friends');
    assert.equal(classifyStoryFriendEvent('我准备向你发好友申请','顾明舟',true,'character'),null);
});
test('interface exposes account, receipt and sync settings with no out-of-story disclaimer',()=>{
    // Static template contract; UI rendering requires the browser and is
    // covered separately by device testing.
    assert.match(source,/data-lp="walletBalance"/);
    assert.match(source,/data-lp="paymentSend"/);
    assert.match(source,/data-lp="eventBridge"/);
    assert.match(source,/data-chat-tool="redpacket"/);
    assert.doesNotMatch(source,/故事里的虚拟支付应用/);
});

test('returning to an earlier story swipe revives a new pending transfer with a new ledger ID',async()=>{
    const ctx={characterId:0,groupId:null,chatId:'swipe-story',
        characters:[{name:'顾明舟',avatar:'role-avatar.png'}],
        chat:[{is_user:false,mes:'我给你转了200元',swipe_id:0}],
        chatMetadata:{st_little_phone_v1:story()},saveMetadata:async()=>{}};
    const api=harness(ctx);
    await api.syncMainlinePayments(ctx);
    const original=api.readRootData(ctx).wallet.transfers[0].id;
    ctx.chat[0]={is_user:false,mes:'我准备给你转200元',swipe_id:1};
    await api.syncMainlinePayments(ctx);
    assert.equal(api.readRootData(ctx).wallet.transfers[0].status,'invalidated');
    ctx.chat[0]={is_user:false,mes:'我给你转了200元',swipe_id:0};
    const resumed=await api.syncMainlinePayments(ctx);
    const transfers=api.readRootData(ctx).wallet.transfers;
    assert.equal(resumed.created,1);
    assert.equal(transfers.length,2);
    assert.equal(transfers[1].status,'pending');
    assert.notEqual(original,transfers[1].id);
    assert.equal(api.walletState(api.readRootData(ctx)).balanceCents,0);
});
test('wallet changes and future order adapters publish stable deduplicated story events',()=>{
    const api=harness(),data=story();
    api.walletAdjustBalance(data,100000);
    api.walletChargeOrder(data,{orderId:'order-42',category:'takeout',amountCents:3200,shop:'晚饭'});
    const count=data.storyEvents.length;
    api.walletChargeOrder(data,{orderId:'order-42',category:'takeout',amountCents:3200,shop:'晚饭'});
    assert.equal(data.storyEvents.length,count);
    assert.equal(data.storyEvents.filter(event=>event.type==='takeout.paid').length,1);
    assert.match(api.mainlineStructuredEvents(data),/已付款/);
    assert.doesNotMatch(api.mainlineStructuredEvents(data),/余额调整/);
});
