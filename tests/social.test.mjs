import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../index.js',import.meta.url),'utf8').replaceAll('export function ','function ');
const image='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
function runtime(ctx={}) {
    const box={console,Date,structuredClone,setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},
        window:{SillyTavern:{getContext:()=>ctx}}, document:{querySelector:()=>null}};
    vm.createContext(box);
    vm.runInContext(source+`\nglobalThis.api={currentPersona,personaNames,stickerLibrary,saveSticker,saveStickerLibrary,stickerPrompt,parseStickerReply,buildPrompt,parseChatImport,exportChatPayload,scanNpcSources,newData,postMoment,sendUserMessage,beginFilePicker,finishFilePicker,filePickerReturning,makeUI};`,box);
    return box;
}

test('sticker library starts empty, persists across characters and never modifies chat data',()=>{
    let saves=0;
    const ctx={characterId:0,extensionSettings:{other:{keep:true},gujiguji:{theme:{font:'serif'}}},chatMetadata:{keep:'chat'},saveSettingsDebounced(){saves++;}};
    const box=runtime(ctx),api=box.api;
    assert.equal(api.stickerLibrary().length,0);
    assert.equal(api.stickerPrompt([]),'');
    const item=api.saveSticker(image,'开心');
    assert.equal(saves,1);
    ctx.characterId=1;ctx.chatMetadata={keep:'other chat'};
    assert.equal(api.stickerLibrary()[0].id,item.id);
    assert.equal(runtime(ctx).api.stickerLibrary()[0].image,image,'survives module reload');
    assert.equal(api.saveSticker(image,'重复').id,item.id);
    assert.equal(saves,1,'duplicate image does not write again');
    assert.equal(ctx.extensionSettings.gujiguji.theme.font,'serif');
    assert.equal(ctx.extensionSettings.other.keep,true);
    assert.deepEqual(ctx.chatMetadata,{keep:'other chat'});
    api.saveStickerLibrary([]);
    assert.equal(api.stickerLibrary().length,0);
});

test('sticker validation rejects remote/SVG/oversized images and rolls back settings on failure',()=>{
    const ctx={extensionSettings:{gujiguji:{theme:'intact'}},saveSettingsDebounced(){throw new Error('save failed');}};
    const api=runtime(ctx).api;
    for(const bad of ['https://example.com/a.png','data:image/svg+xml;base64,QUJD','data:image/png;base64,'+'A'.repeat(500000)]) {
        assert.throws(()=>api.saveSticker(bad,'测试'),/图片/);
    }
    assert.throws(()=>api.saveSticker(image,''),/名称/);
    assert.throws(()=>api.saveSticker(image,'开心'),/save failed/);
    assert.deepEqual(ctx.extensionSettings.gujiguji,{theme:'intact'});
});

test('upload, rename and delete operate on user images while keeping sent copies',async()=>{
    let saves=0;
    const ctx={extensionSettings:{},saveSettingsDebounced(){saves++;},chatMetadata:{messages:[{image}]}};
    const box=runtime(ctx);
    box.FileReader=class {readAsDataURL(){this.result=image;this.onload();}};
    box.window.prompt=()=> '开心贴贴';box.window.confirm=()=>true;
    vm.runInContext('nodes={stickerStatus:{}};renderStickerLibrary=()=>{};globalThis.upload=uploadStickers;globalThis.use=useSticker;',box);
    await box.upload([{name:'贴贴.gif',type:'image/gif',size:100}]);
    const item=box.api.stickerLibrary()[0];
    assert.equal(item.label,'贴贴');assert.equal(item.image,image);
    await box.use(item.id,'rename');
    assert.equal(box.api.stickerLibrary()[0].label,'开心贴贴');
    await box.use(item.id,'delete');
    assert.equal(box.api.stickerLibrary().length,0);assert.equal(saves,3);
    assert.equal(ctx.chatMetadata.messages[0].image,image);
});

test('character selects only catalog stickers; history and JSON preserve image without needing vision',()=>{
    const api=runtime().api;
    const catalog=[{id:'s-happy',label:'开心',image}];
    const prompt=api.stickerPrompt(catalog);
    assert.ok(prompt.includes('s-happy'));assert.ok(!prompt.includes(image));
    const messages=api.parseStickerReply('收到啦[[sticker:s-happy]][PHONE_NEXT]一起玩吧[[sticker:invented]]',{},catalog);
    assert.deepEqual(Array.from(messages,m=>m.text),['收到啦','[表情包：开心]','一起玩吧']);
    assert.equal(messages[1].image,image);
    const data={messages:messages.map(m=>({...m,from:'character'}))};
    assert.equal(typeof api.buildPrompt(data)[1].content,'string');
    const backup=api.exportChatPayload({},data);
    const imported=api.parseChatImport(JSON.stringify(backup));
    assert.equal(imported[1].image,image);assert.equal(imported[1].sticker,true);assert.equal(imported[1].stickerName,'开心');
});

test('player and character exchange stickers through normal host generation',async()=>{
    let options;
    const ctx={characterId:0,chatId:'A',characters:[{name:'朋友'}],chatMetadata:{},
        extensionSettings:{gujiguji:{stickers:[{id:'s-happy',label:'开心',image}]}},
        saveMetadata:async()=>{},generateRaw:async args=>{options=args;return '好呀[[sticker:s-happy]]';}};
    const box=runtime(ctx);
    ctx.chatMetadata.st_little_phone_v1={...box.api.newData(),friendship:{state:'friends'}};
    vm.runInContext(`mounted=true;render=()=>{};renderMessages=()=>{};updateBusy=()=>{};
        nodes={input:{value:'草稿'},quotedPreview:{},morePanel:{},emojiPanel:{},status:{dataset:{}},diagnosticState:{}};`,box);
    await box.api.sendUserMessage('[表情包：开心]',image,box.api.stickerLibrary()[0]);
    const messages=ctx.chatMetadata.st_little_phone_v1.messages;
    assert.equal(messages.length,3);assert.equal(messages[0].sticker,true);assert.equal(messages[2].image,image);
    assert.ok(options.systemPrompt.includes('s-happy'));assert.equal(typeof options.prompt[0].content,'string');
});

test('scan reads only current char/persona and explicitly selected book; excludes self and writing rules',async()=>{
    const requested=[];
    const ctx={name1:'林小雨',characterId:0,characters:[{name:'宁肆锦',data:{extensions:{world:'角色书'}}}],
        powerUserSettings:{persona_description:'姓名：林小雨\n别名：小雨\n宝儿是user的朋友，认识很多年。',persona_description_lorebook:'人设书'},
        chatMetadata:{st_little_phone_v1:{version:1,messages:[],config:{worldEntries:[{book:'文风书'}]}}},
        getWorldInfoNames(){throw new Error('must not enumerate');},
        loadWorldInfo:async name=>{requested.push(name);return {entries:{
            a:{comment:'林小雨',content:'姓名：林小雨\n性格：活泼'},
            b:{comment:'小雨',content:'姓名：小雨\n职业：学生'},
            c:{comment:'清新文风',content:'姓名：清新文风\n性格：自然'},
            d:{comment:'清新自然',content:'写作风格：清新自然，重视外貌与性格描写。'},
            e:{comment:'陈老师',content:'姓名：陈老师\n职业：老师',disable:true},
            f:{comment:'王同学',content:'姓名：王同学\n职业：学生',enabled:false},
            g:{comment:'宝儿',content:'宝儿是user的朋友，认识很多年。'}
        }};}};
    const api=runtime(ctx).api,before=JSON.stringify(ctx.chatMetadata);
    const result=await api.scanNpcSources(ctx);
    assert.deepEqual(requested,['角色书','人设书']);
    assert.deepEqual(Array.from(result.candidates,c=>c.name),['宝儿']);
    assert.equal(JSON.stringify(ctx.chatMetadata),before);
    requested.length=0;
    await api.scanNpcSources(ctx,'额外人物书');
    assert.deepEqual(requested,['角色书','人设书','额外人物书']);
});

test('current persona changes follow host settings, without using another mask',()=>{
    const ctx={name1:'林小雨',powerUserSettings:{persona_description:'现在的人设',personas:{a:'林小雨',b:'别人'},persona_descriptions:{a:{description:'现在的人设'},b:{description:'别人的设定'}}}};
    const api=runtime(ctx).api;
    assert.equal(api.currentPersona(ctx).avatar,'/User Avatars/a');
    assert.equal(api.currentPersona(ctx).description,'现在的人设');
    ctx.name1='新名字';ctx.powerUserSettings.persona_description='新设定';
    assert.equal(api.currentPersona(ctx).name,'新名字');assert.equal(api.currentPersona(ctx).description,'新设定');
    assert.equal(api.currentPersona(ctx).avatar,'/img/user-default.png');
});

test('posting from Me uses shared per-story moments and keeps old primary/NPC messages',async()=>{
    const ctx={name1:'林小雨',characterId:0,chatId:'A',characters:[{name:'朋友'}],chatMetadata:{},saveMetadata:async()=>{}};
    const box=runtime(ctx);
    ctx.chatMetadata.st_little_phone_v1={...box.api.newData(),messages:[{text:'旧主聊天'}],contacts:[{id:'npc:a',name:'宝儿'}],conversations:{'npc:a':{messages:[{text:'旧NPC聊天'}],friendship:{state:'friends'}}}};
    vm.runInContext(`mounted=true;activeContactId='npc:a';nodes={momentsText:{value:'今天真开心'}};globalThis.rendered=[];renderMoments=ctx=>rendered.push(ctx.chatMetadata.st_little_phone_v1.moments.at(-1).text);`,box);
    await box.api.postMoment();
    const data=ctx.chatMetadata.st_little_phone_v1;
    assert.equal(data.moments[0].author,'林小雨');assert.equal(box.rendered[0],'今天真开心');
    assert.equal(data.messages[0].text,'旧主聊天');assert.equal(data.conversations['npc:a'].messages[0].text,'旧NPC聊天');
    assert.equal(data.conversations['npc:a'].moments,undefined);
});

test('cancelled file picker preserves chat, draft and scroll with a short return guard',()=>{
    const box=runtime();
    vm.runInContext(`mounted=true;activeScreen='chat';nodes={input:{value:'未发送草稿'},messages:{scrollTop:123}};
        globalThis.panel={open:false,showModal(){this.open=true;}};
        root={querySelector:()=>panel};globalThis.state=()=>({screen:activeScreen,draft:nodes.input.value,scroll:nodes.messages.scrollTop});`,box);
    box.api.beginFilePicker();
    assert.equal(box.api.filePickerReturning(),true);
    box.api.finishFilePicker();
    assert.equal(box.panel.open,true);
    assert.deepEqual({...box.state()},{screen:'chat',draft:'未发送草稿',scroll:123});
    assert.equal(box.api.filePickerReturning(),true);
    vm.runInContext('pickerGuardUntil=Date.now()-1;',box);
    assert.equal(box.api.filePickerReturning(),false);
});

test('Me owns composer and sticker upload, Discover owns feed, contacts has no explanatory group',()=>{
    const box=runtime();box.document.createElement=()=>({innerHTML:''});
    const html=box.api.makeUI().innerHTML;
    const section=name=>html.split('data-lp-screen="'+name+'"')[1].split('</section>')[0];
    const me=section('me'),discover=section('discover'),contacts=section('contacts');
    assert.ok(me.includes('data-lp="momentsPost"'));assert.ok(me.includes('data-lp="stickerUpload"'));assert.ok(me.includes('data-lp="myPersona"'));
    assert.ok(!me.includes('data-lp-open="settings"'));assert.ok(!me.includes('data-lp-open="theme"'));
    assert.ok(discover.includes('data-lp="momentsFeed"'));assert.ok(!discover.includes('data-lp="momentsText"'));
    assert.ok(!contacts.includes('storyPeopleList'));assert.ok(!html.includes('不代表已经拥有联系方式'));assert.ok(!html.includes('data-emoji='));assert.ok(!html.includes('npcScanAllWorlds'));
});
