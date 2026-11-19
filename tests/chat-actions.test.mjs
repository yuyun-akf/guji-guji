import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8').replace(/^export /gm,'');
const image='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

class Element {
    constructor(tagName){
        this.tagName=tagName;this.children=[];this.dataset={};this.scrollTop=0;this.value='';
        this.classList={add(){}};
    }
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=nodes;}
    setAttribute(){}
    addEventListener(){}
    nodes(name){
        return [...(this.className?.split(' ').includes(name)?[this]:[]),
            ...this.children.flatMap(child=>child.nodes?.(name)||[])];
    }
}
const document={createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})};

function runtime(){
    const ctx={characterId:0,chatId:'test',name1:'访客',characters:[{name:'组员甲',data:{}}],
        chatMetadata:{},extensionSettings:{gujiguji:{stickers:[{id:'s-cat',label:'开心的猫',image}]}},
        saveMetadata:async()=>{},saveSettingsDebounced(){}};
    let reply='',request;
    ctx.generateRaw=async options=>{request=options;return reply;};
    const box=vm.createContext({document,window:{SillyTavern:{getContext:()=>ctx}},console,
        structuredClone,Event,setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){}});
    vm.runInContext(code('index.js')+`
        mounted=true;activeScreen='chat';
        nodes={input:{value:'',dispatchEvent(){}},emojiPanel:{},morePanel:{},messageActions:{},diagnosticState:{},status:{dataset:{}}};
        render=()=>{};renderMessages=()=>{};updateBusy=()=>{};
        globalThis.api={newData,readData,captureSession,runReply,updatePhoneCall,sendUserMessage,
            handleMessageOperation,renderVoiceMessage,renderPhoneCall,buildPrompt,
            exportChatPayload,parseChatImport,canRecallMessage,recallPhoneMessage,
            messageQuoteText,parseMessageStickers,canGenerateChatReply,renderLegacyPhoneSticker,
            selectMessage:id=>{selectedMessageId=id;}};
    `,box);
    const api=box.api;
    ctx.chatMetadata.st_little_phone_v1={...api.newData(),friendship:{state:'friends'}};
    return {ctx,api,getRequest:()=>request,generate:async answer=>{
        reply=answer;
        await api.runReply(ctx,ctx.characters[0],structuredClone(api.readData(ctx)),api.captureSession(ctx));
        return api.readData(ctx).messages.at(-1);
    }};
}

test('private generation quotes real messages, displays voice transcripts, and saves mixed stickers',async()=>{
    const {ctx,api,generate,getRequest}=runtime();
    ctx.chatMetadata.st_little_phone_v1.messages.push({id:'u-1',from:'user',text:'要去书店吗？'});
    await generate('[[reply:u-1]][[voice]] 好，下午见。[PHONE_NEXT]到时候见[表情包：开心的猫]');
    const saved=api.readData(ctx);
    assert.match(JSON.stringify(getRequest()),/u-1/);
    assert.equal(saved.messages[1].replyTo,'u-1');
    assert.equal(saved.messages[1].voice,true);
    const voice=api.renderVoiceMessage(saved.messages[1].text);
    assert.equal(voice.tagName,'details');
    assert.match(voice.children[0].textContent,/^语音消息 \d+″$/);
    assert.equal(voice.children[1].textContent,'好，下午见。');
    assert.equal(saved.messages[2].text,'到时候见');
    assert.equal(saved.messages[2].stickerImages[0],image);
    assert.equal(typeof api.buildPrompt(saved)[2].content,'string');

    const old={text:'回头见[表情包：开心的猫]'};
    assert.equal(api.renderLegacyPhoneSticker(old,[{id:'s-cat',label:'开心的猫',image}]).stickerImages[0],image);
    assert.equal(old.stickerImages,undefined);

    api.selectMessage('u-1');
    await api.handleMessageOperation('recall');
    const data=api.readData(ctx);
    assert.equal(data.messages[0].text,'');
    assert.ok(data.messages[0].recalledAt);
    assert.match(api.buildPrompt(data)[1].content,/原消息已撤回/);
    assert.doesNotMatch(JSON.stringify(api.buildPrompt(data)),/要去书店吗/);
    const restored=api.parseChatImport(JSON.stringify(api.exportChatPayload(ctx,data)));
    assert.ok(restored[0].recalledAt);
    assert.equal(restored[1].voice,true);
    assert.equal(restored[2].stickerImages[0],image);
});

test('phone calls record ringing, connected conversation, hang-up and refusal',async()=>{
    const {ctx,api,generate}=runtime();
    await api.updatePhoneCall('dial');
    const outgoing=api.readData(ctx).messages.at(-1);
    assert.equal(outgoing.callState,'ringing');
    assert.equal(outgoing.from,'user');
    assert.equal((await generate('[[accept-call]]')).callState,'connected');
    assert.ok(api.canGenerateChatReply(api.readData(ctx)));
    await api.sendUserMessage('我到了。');
    assert.equal(api.readData(ctx).messages.at(-1).callSpeech,true);
    assert.equal((await generate('[[voice]] 我在入口等你。')).callSpeech,true);
    await api.updatePhoneCall('end',outgoing.id);
    const ended=api.readData(ctx).messages.find(message=>message.id===outgoing.id);
    assert.equal(ended.callState,'ended');
    assert.match(api.renderPhoneCall(ended).children[0].textContent,/通话已结束 · \d+:\d+/);

    const incoming=await generate('[[call]]');
    assert.equal(incoming.callState,'ringing');
    assert.equal(incoming.from,'character');
    assert.equal(api.renderPhoneCall(incoming).children[1].children[0].dataset.callAction,'accept');
    await api.updatePhoneCall('decline',incoming.id);
    const restored=api.parseChatImport(JSON.stringify(api.exportChatPayload(ctx,api.readData(ctx))));
    assert.equal(restored.at(-1).callState,'declined');
    assert.ok(restored.find(message=>message.id===outgoing.id).endedAt);
});

test('group roles quote any earlier valid member and can only recall their own messages',async()=>{
    const {api,ctx}=runtime(),target=new Element('section');
    let story={groupChats:[{id:'g',name:'周末计划',members:['primary','npc:b'],messages:[]}]};
    let messages=[
        {speaker:'npc:b',text:'我先到书店。'},
        {speaker:'unknown',text:'无效发言'},
        {speaker:'primary',text:'帮我留个座。',type:'voice',replyTo:0},
        {speaker:'primary',text:'到了叫我',replyTo:2},
        {speaker:'primary',type:'recall',messageId:0},
    ];
    const create=new Function('document','structuredClone',code('groups.js')+'\nreturn createGroupsModule;')(document,structuredClone);
    const controller=create({context:()=>ctx,getNodes:()=>({groupsContent:target}),readRootData:()=>story,
        writeData:async(_,data)=>{story=data;},isPhoneFriend:()=>true,
        galleryPeople:()=>[{id:'primary',name:'组员甲'},{id:'npc:b',name:'组员乙'}],
        contactCharacter:()=>({data:{}}),phoneGenerate:async()=>JSON.stringify({messages}),
        ...api,notifyInteraction:(text,kind)=>{if(kind==='error')assert.fail(text);}});
    controller.open({groupId:'g'});
    const generate=()=>controller.handleClick({target:{closest:()=>({dataset:{groupAction:'generate'}})}});
    await generate();
    const [first,second,third]=story.groupChats[0].messages;
    assert.equal(second.replyTo,first.id);
    assert.equal(third.replyTo,second.id);
    assert.equal(first.recalledAt,undefined);
    assert.equal(target.nodes('lp-inline-quote')[0].textContent,'组员乙：我先到书店。');
    assert.equal(target.nodes('lp-voice-message')[0].children[1].textContent,'帮我留个座。');

    messages=[{speaker:'npc:b',type:'recall',messageId:first.id}];
    await generate();
    const saved=story.groupChats[0].messages;
    assert.ok(saved[0].recalledAt);
    assert.equal(saved[0].text,'');
    assert.equal(saved[1].replyQuote,undefined);
    assert.equal(target.nodes('lp-inline-quote')[0].textContent,'原消息已撤回');
    assert.equal(target.nodes('lp-recall-notice')[0].textContent,'组员乙撤回了一条消息');
});
