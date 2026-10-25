import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { deflateRawSync } from 'node:zlib';

const source=readFileSync(new URL('../index.js',import.meta.url),'utf8').replaceAll('export function ','function ');
const image='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
function runtime(ctx={}) {
    const box={console,Date,structuredClone,setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},
        Blob,Response,DecompressionStream,TextDecoder,Uint8Array,DataView,
        window:{SillyTavern:{getContext:()=>ctx}}, document:{querySelector:()=>null,createElement:()=>({innerHTML:'',id:''}),visibilityState:'visible'}};
    vm.createContext(box);
    vm.runInContext(source+`\nglobalThis.api={currentPersona,personaNames,stickerLibrary,saveSticker,saveStickerLibrary,stickerPrompt,parseStickerReply,visibleStickerText,importStickerAssets,parseStickerCatalogCsv,zipStickerEntries,uploadStickerPack,buildPrompt,parseChatImport,exportChatPayload,scanNpcSources,newData,postMoment,sendUserMessage,beginFilePicker,finishFilePicker,filePickerReturning,makeUI};`,box);
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
    assert.equal(api.visibleStickerText({from:'user',text:'[表情包：非常长的内容说明和配文]',sticker:true,image},null,null),'');
    assert.equal(api.visibleStickerText({from:'character',text:'[表情包：角色用的备注]',sticker:true,image},null,null),'');
    assert.equal(api.visibleStickerText({from:'character',text:'普通聊天'},null,null),'普通聊天');
});

test('user pressing a sticker sends the image as user, not as the character',async()=>{
    let calls=0;
    const ctx={characterId:0,chatId:'A',characters:[{name:'角色甲'}],chatMetadata:{},
        extensionSettings:{gujiguji:{stickers:[{id:'s-cat',label:'猫咪跑来，配文我来啦',image}]}},
        saveMetadata:async()=>{},generateRaw:async()=>{calls++;return '哈哈，收到了';}};
    const box=runtime(ctx);
    ctx.chatMetadata.st_little_phone_v1={...box.api.newData(),friendship:{state:'friends'}};
    vm.runInContext(`mounted=true;render=()=>{};renderMessages=()=>{};updateBusy=()=>{};
        nodes={input:{value:''},quotedPreview:{},morePanel:{},emojiPanel:{},status:{dataset:{}},diagnosticState:{}};
        globalThis.chooseSticker=useSticker;`,box);
    await box.chooseSticker('s-cat','send');
    const messages=ctx.chatMetadata.st_little_phone_v1.messages;
    assert.equal(messages.length,2);
    assert.equal(messages[0].from,'user');
    assert.equal(messages[0].image,image);
    assert.equal(messages[0].sticker,true);
    assert.equal(messages[1].from,'character');
    assert.equal(messages[1].image,undefined);
    assert.equal(calls,1);
});

test('bulk importing 100 stickers saves once and skips overflow safely',async()=>{
    let saves=0;
    const ctx={extensionSettings:{},saveSettingsDebounced(){saves++;}};
    const box=runtime(ctx);
    box.FileReader=class {readAsDataURL(file){this.result=file.image;this.onload();}};
    const assets=Array.from({length:108},(_,i)=>({file:{type:'image/png',size:300,name:'cat'+i+'.png',
        image:'data:image/png;base64,'+'A'.repeat(400)+String(i).padStart(4,'0').replace(/\d/g,d=>'ABCDEFGHIJ'[Number(d)])},label:'猫猫'+i,usage:'撒娇'}));
    const result=await box.api.importStickerAssets(assets,ctx);
    assert.equal(result.added,100);assert.equal(result.skipped,8);
    assert.equal(saves,1,'settings must not be serialized 100 times');
    assert.equal(box.api.stickerLibrary(ctx).length,100);
    assert.equal(box.api.stickerLibrary(ctx)[0].usage,'撒娇');
});

test('CSV catalog imports description and use-tags even with quoted commas',()=>{
    const csv='index,编号,内容,用途,原文件名,相对路径\n1,e001,"猫咪, 跑过来","撒娇、邀请",猫.jpg,images/猫.jpg\n';
    const catalog=runtime().api.parseStickerCatalogCsv(csv);
    assert.equal(catalog.get('images/猫.jpg').label,'猫咪, 跑过来');
    assert.equal(catalog.get('猫.jpg').usage,'撒娇、邀请');
});

function makeZipFixture(files) {
    const local=[],central=[];let offset=0;
    for(const [name,plain] of files){
        const filename=Buffer.from(name,'utf8'),bytes=Buffer.isBuffer(plain)?plain:Buffer.from(plain,'utf8');
        const compressed=deflateRawSync(bytes),header=Buffer.alloc(30),entry=Buffer.alloc(46);
        header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(8,8);
        header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(filename.length,26);
        entry.writeUInt32LE(0x02014b50,0);entry.writeUInt16LE(8,10);
        entry.writeUInt32LE(compressed.length,20);entry.writeUInt32LE(bytes.length,24);
        entry.writeUInt16LE(filename.length,28);entry.writeUInt32LE(offset,42);
        local.push(header,filename,compressed);central.push(entry,filename);
        offset+=header.length+filename.length+compressed.length;
    }
    const directory=Buffer.concat(central),end=Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);
    end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
    return Buffer.concat([...local,directory,end]);
}

test('ZIP with compressed CSV catalog auto-imports matching labels and uses one save',async()=>{
    let saves=0;
    const ctx={extensionSettings:{},saveSettingsDebounced(){saves++;}};
    const box=runtime(ctx);
    box.FileReader=class {readAsDataURL(file){
        file.arrayBuffer().then(data=>{this.result='data:'+file.type+';base64,'+Buffer.from(data).toString('base64');this.onload();});
    }};
    const csv='index,编号,内容,用途,原文件名,相对路径\n1,e001,跑来小猫,打招呼、撒娇,猫.gif,images/猫.gif\n';
    const packed=makeZipFixture([['表情包目录.csv',csv],['images/猫.gif',Buffer.from(image.split(',')[1],'base64')]]);
    const file={name:'表情包库.zip',size:packed.length,arrayBuffer:async()=>packed.buffer.slice(packed.byteOffset,packed.byteOffset+packed.byteLength)};
    await box.api.uploadStickerPack([file]);
    assert.equal(saves,1);
    const imported=box.api.stickerLibrary(ctx);
    assert.equal(imported.length,1);
    assert.equal(imported[0].label,'跑来小猫');
    assert.equal(imported[0].usage,'打招呼、撒娇');
    assert.equal(imported[0].image,image);
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
    const ctx={name1:'玩家甲',characterId:0,characters:[{name:'角色甲',data:{extensions:{world:'角色书'}}}],
        powerUserSettings:{persona_description:'姓名：玩家甲\n别名：小雨\n朋友丁是user的朋友，认识很多年。',persona_description_lorebook:'人设书'},
        chatMetadata:{st_little_phone_v1:{version:1,messages:[],config:{worldEntries:[{book:'文风书'}]}}},
        getWorldInfoNames(){throw new Error('must not enumerate');},
        loadWorldInfo:async name=>{requested.push(name);return {entries:{
            a:{comment:'玩家甲',content:'姓名：玩家甲\n性格：活泼'},
            b:{comment:'小雨',content:'姓名：小雨\n职业：学生'},
            c:{comment:'清新文风',content:'姓名：清新文风\n性格：自然'},
            d:{comment:'清新自然',content:'写作风格：清新自然，重视外貌与性格描写。'},
            e:{comment:'陈老师',content:'姓名：陈老师\n职业：老师',disable:true},
            f:{comment:'王同学',content:'姓名：王同学\n职业：学生',enabled:false},
            g:{comment:'朋友丁',content:'朋友丁是user的朋友，认识很多年。'}
        }};}};
    const api=runtime(ctx).api,before=JSON.stringify(ctx.chatMetadata);
    const result=await api.scanNpcSources(ctx);
    assert.deepEqual(requested,['角色书','人设书']);
    assert.deepEqual(Array.from(result.candidates,c=>c.name),['朋友丁']);
    assert.equal(JSON.stringify(ctx.chatMetadata),before);
    requested.length=0;
    await api.scanNpcSources(ctx,'额外人物书');
    assert.deepEqual(requested,['角色书','人设书','额外人物书']);
});

test('current persona changes follow host settings, without using another mask',()=>{
    const ctx={name1:'玩家甲',powerUserSettings:{persona_description:'现在的人设',personas:{a:'玩家甲',b:'别人'},persona_descriptions:{a:{description:'现在的人设'},b:{description:'别人的设定'}}}};
    const api=runtime(ctx).api;
    assert.equal(api.currentPersona(ctx).avatar,'/User Avatars/a');
    assert.equal(api.currentPersona(ctx).description,'现在的人设');
    ctx.name1='新名字';ctx.powerUserSettings.persona_description='新设定';
    assert.equal(api.currentPersona(ctx).name,'新名字');assert.equal(api.currentPersona(ctx).description,'新设定');
    assert.equal(api.currentPersona(ctx).avatar,'/img/user-default.png');
});

test('posting from Me uses shared per-story moments and keeps old primary/NPC messages',async()=>{
    const ctx={name1:'玩家甲',characterId:0,chatId:'A',characters:[{name:'朋友'}],chatMetadata:{},saveMetadata:async()=>{}};
    const box=runtime(ctx);
    ctx.chatMetadata.st_little_phone_v1={...box.api.newData(),messages:[{text:'旧主聊天'}],contacts:[{id:'npc:a',name:'朋友丁'}],conversations:{'npc:a':{messages:[{text:'旧NPC聊天'}],friendship:{state:'friends'}}}};
    vm.runInContext(`mounted=true;activeContactId='npc:a';nodes={momentsText:{value:'今天真开心'}};globalThis.rendered=[];renderMoments=ctx=>rendered.push(ctx.chatMetadata.st_little_phone_v1.moments.at(-1).text);`,box);
    await box.api.postMoment();
    const data=ctx.chatMetadata.st_little_phone_v1;
    assert.equal(data.moments[0].author,'玩家甲');assert.equal(box.rendered[0],'今天真开心');
    assert.equal(data.messages[0].text,'旧主聊天');assert.equal(data.conversations['npc:a'].messages[0].text,'旧NPC聊天');
    assert.equal(data.conversations['npc:a'].moments,undefined);
});

function socialStory() {
    const data={version:1,storyTime:'2026-01-18T17:41',messages:[{text:'主角旧消息'}],friendship:{state:'friends'},
        contacts:[{id:'npc:b',name:'室友B'},{id:'npc:c',name:'网友C'}],
        conversations:{'npc:b':{messages:[{text:'室友旧消息'}],friendship:{state:'friends'}},
            'npc:c':{messages:[{text:'网友旧消息'}],friendship:{state:'friends'}}},
        moments:[{id:'m-user',authorId:'user',author:'玩家甲',text:'我的动态'},
            {id:'m-c',authorId:'npc:c',author:'网友C',text:'C的动态'}]};
    const ctx={name1:'玩家甲',characterId:0,chatId:'A',characters:[{name:'主角A',data:{description:'不透露演员职业'}}],
        chatMetadata:{st_little_phone_v1:data},saveMetadata:async()=>{}};
    return {ctx,data};
}

test('moments require explicit mutual contact links between characters, not just shared user friendship',()=>{
    const {ctx,data}=socialStory(),box=runtime(ctx);
    const api=vm.runInContext('({momentCandidates,charactersHaveContact,visibleMomentComments,contactLinkKey})',box);
    const cPost=data.moments[1],uPost=data.moments[0];
    assert.deepEqual(Array.from(api.momentCandidates(ctx,cPost)),[],'A and roommate B cannot view C merely because both friended the user');
    assert.deepEqual(Array.from(api.momentCandidates(ctx,uPost)),['primary','npc:b','npc:c']);
    data.contactLinks={[api.contactLinkKey('primary','npc:c')]:true};
    assert.equal(api.charactersHaveContact(ctx,'primary','npc:c'),true);
    assert.equal(api.charactersHaveContact(ctx,'npc:b','npc:c'),false);
    assert.deepEqual(Array.from(api.momentCandidates(ctx,cPost)),['primary']);
    cPost.comments=[{id:'x1',actorId:'npc:b',author:'室友B',text:'不知道对方是谁'},
        {id:'x2',actorId:'user',author:'玩家甲',text:'你好'}];
    assert.deepEqual(Array.from(api.visibleMomentComments(ctx,cPost,'primary'),c=>c.id),['x2']);
    data.conversations['npc:c'].friendship={state:'blocked'};
    assert.equal(api.charactersHaveContact(ctx,'primary','npc:c'),false,'link is inactive if either person is no longer a friend');
});

test('manually confirming and removing character contact links persists without touching chats',async()=>{
    const {ctx}=socialStory(),box=runtime(ctx);
    const change=vm.runInContext('changeContactLink',box);
    await change('npc:b',true);
    let root=ctx.chatMetadata.st_little_phone_v1;
    assert.equal(root.contactLinks['npc:b|primary'],true);
    assert.equal(root.contactLinks['npc:c|primary'],undefined);
    assert.equal(root.messages[0].text,'主角旧消息');
    await change('npc:b',false);
    root=ctx.chatMetadata.st_little_phone_v1;
    assert.equal(root.contactLinks['npc:b|primary'],undefined);
});

test('user likes, unlikes, comments, replies and reposts without affecting old private chats',async()=>{
    const {ctx}=socialStory(),box=runtime(ctx);
    box.window.prompt=()=> '转发给朋友们看看';
    const ops=vm.runInContext('({toggleMomentLike,addMomentComment,repostMoment,clearMomentsUnread})',box);
    await ops.toggleMomentLike('m-c');
    assert.equal(ctx.chatMetadata.st_little_phone_v1.moments[1].likes[0].actorId,'user');
    await ops.toggleMomentLike('m-c');
    assert.equal(ctx.chatMetadata.st_little_phone_v1.moments[1].likes.length,0);
    await Promise.all([ops.toggleMomentLike('m-c'),ops.toggleMomentLike('m-c')]);
    assert.equal(ctx.chatMetadata.st_little_phone_v1.moments[1].likes.length,0,'rapid like/unlike operations must serialize');
    await ops.addMomentComment('m-c','你好呀');
    const first=ctx.chatMetadata.st_little_phone_v1.moments[1].comments[0];
    await ops.addMomentComment('m-c','补充回复',first.id);
    assert.equal(ctx.chatMetadata.st_little_phone_v1.moments[1].comments[1].replyTo,first.id);
    await ops.repostMoment('m-c');
    const state=ctx.chatMetadata.st_little_phone_v1;
    assert.equal(state.moments.length,3);
    assert.equal(state.moments[2].repostOf.id,'m-c');
    assert.equal(state.moments[2].authorId,'user');
    assert.equal(state.messages[0].text,'主角旧消息');
    assert.equal(state.conversations['npc:b'].messages[0].text,'室友旧消息');
    state.unreadMoments=4;
    await ops.clearMomentsUnread(ctx);
    assert.equal(ctx.chatMetadata.st_little_phone_v1.unreadMoments,0);
});

test('batch parser accepts controlled JSON and rejects unstructured responses',()=>{
    const parse=vm.runInContext('parseMomentBatch',runtime());
    const result=parse('```json\n{"actions":[{"actorId":"primary","kind":"like"},{"actorId":"npc:c","kind":"comment","text":"你好"}]}\n```');
    assert.equal(result.actions.length,2);
    assert.equal(result.actions[1].text,'你好');
    assert.equal(parse('替别人点了个赞'),null);
    assert.equal(parse('{"actions":"not an array"}'),null);
});

test('a single request batches eligible character reactions and blocks actors without a relationship',async()=>{
    const {ctx,data}=socialStory();let calls=0;
    ctx.generateRaw=async()=>{calls++;return JSON.stringify({actions:[
        {actorId:'primary',kind:'comment',text:'这是什么好东西？'},
        {actorId:'npc:b',kind:'comment',text:'打个招呼'},
        {actorId:'npc:c',kind:'like'}]});};
    const box=runtime(ctx);
    vm.runInContext(`mounted=true;root={classList:{contains:()=>false}};nodes={momentFeedback:{textContent:''}};
        render=()=>{};startBusy=()=>{busy=true;return 1};finishBusy=()=>{busy=false};`,box);
    const run=vm.runInContext('runMomentBatch',box);
    await run('m-c',false);
    assert.equal(calls,0,'two characters lacking contact cannot receive a model call about the other');
    data.contactLinks={'npc:c|primary':true};
    await run('m-c',false);
    assert.equal(calls,1);
    const saved=ctx.chatMetadata.st_little_phone_v1;
    assert.ok(saved.moments[1].comments,vm.runInContext('nodes.momentFeedback.textContent',box)||'no response comment');
    assert.equal(saved.moments[1].comments[0].actorId,'primary');
    assert.equal(saved.moments[1].comments.some(c=>c.actorId==='npc:b'),false,'unlinked B cannot interact on C post');
    assert.equal(saved.unreadMoments,1);
    assert.equal(saved.momentInteractionSeen.includes('m-c'),true);
    assert.equal(saved.messages[0].text,'主角旧消息');
    await run('m-user',false);
    assert.equal(calls,2,'all reactions on one additional post share one request');
    const own=ctx.chatMetadata.st_little_phone_v1.moments[0];
    assert.equal(own.comments.length,2);
    assert.equal(own.likes[0].actorId,'npc:c');
});

test('characters may reply to each other only with explicit mutual contact',()=>{
    const {ctx,data}=socialStory(),box=runtime(ctx);
    const apply=vm.runInContext('applyMomentBatch',box);
    const post=data.moments[0];
    const actions=[{actorId:'npc:c',kind:'comment',text:'你好'},
        {actorId:'npc:b',kind:'reply',replyToActor:'npc:c',text:'你好呀'}];
    assert.equal(apply(ctx,data,post,['npc:c','npc:b'],actions),1);
    assert.equal(post.comments.length,1,'B cannot reply to C just because both know the user');
    post.comments=[];data.contactLinks={'npc:b|npc:c':true};
    assert.equal(apply(ctx,data,post,['npc:c','npc:b'],actions),2);
    assert.equal(post.comments[1].replyTo,post.comments[0].id);
});

test('one user comment queues one optional grouped reply request, likes remain free',async()=>{
    const {ctx,data}=socialStory();let calls=0;
    data.socialConfig={momentInteractions:true};data.momentInteractionSeen=['m-user','m-c'];
    ctx.generateRaw=async()=>{calls++;return JSON.stringify({actions:[{actorId:'primary',kind:'reply',replyTo:ctx.chatMetadata.st_little_phone_v1.moments[1].comments[0].id,text:'看到了'}]});};
    data.contactLinks={'npc:c|primary':true};
    const box=runtime(ctx);
    vm.runInContext(`mounted=true;root={classList:{contains:()=>false}};nodes={momentFeedback:{textContent:''}};
        render=()=>{};renderMoments=()=>{};renderChatLists=()=>{};
        scheduleMomentReply=()=>{};startBusy=()=>{busy=true;return 1};finishBusy=()=>{busy=false};`,box);
    const add=vm.runInContext('addMomentComment',box),like=vm.runInContext('toggleMomentLike',box),tick=vm.runInContext('tickMomentInteractions',box);
    await like('m-c');assert.equal(calls,0);
    await add('m-c','我也想知道');assert.equal(calls,0,'writing a comment does not call an API before the grouped reply job');
    await add('m-c','补充一句');
    assert.equal(ctx.chatMetadata.st_little_phone_v1.pendingMomentReplies?.length,2);
    await tick();assert.equal(calls,1);
    const saved=ctx.chatMetadata.st_little_phone_v1;
    assert.equal(saved.pendingMomentReplies.length,0);
    assert.equal(saved.moments[1].comments[2].actorId,'primary');
    assert.equal(saved.moments[1].comments[2].replyTo,saved.moments[1].comments[0].id);
    await tick();assert.equal(calls,1,'processed comments must not be charged twice');
});

test('autonomous post and reactions share one generation request',async()=>{
    const {ctx,data}=socialStory();let calls=0;
    data.socialConfig={moments:{mode:'fixed',days:7},momentInteractions:true};
    data.contactLinks={'npc:b|primary':true,'npc:c|primary':true};
    ctx.generateRaw=async()=>{calls++;return JSON.stringify({post:'角色甲分享一张落日照',actions:[
        {actorId:'npc:b',kind:'comment',text:'这个角度真不错'},
        {actorId:'npc:c',kind:'like'}]});};
    const box=runtime(ctx);
    vm.runInContext(`mounted=true;root={classList:{contains:()=>false}};
        render=()=>{};loadAutonomyUI=()=>{};showMomentAlert=()=>{};
        startBusy=()=>{busy=true;return 1};finishBusy=()=>{busy=false};`,box);
    await vm.runInContext('tickAutonomousActivity',box)('moments');
    const saved=ctx.chatMetadata.st_little_phone_v1;
    assert.equal(calls,1,'post generation and all eligible reactions must use the same API call');
    const created=saved.moments.at(-1);
    assert.equal(created.text,'角色甲分享一张落日照');
    assert.equal(created.comments.length,1);
    assert.equal(created.likes.length,1);
    assert.ok(saved.momentInteractionSeen.includes(created.id),'the scheduled interaction ticker must not charge again');
});

test('new moment notifications and mutual-link settings appear in the rendered template',()=>{
    const box=runtime();box.document.createElement=()=>({innerHTML:''});
    const html=box.api.makeUI().innerHTML;
    assert.ok(!html.includes('data-lp="homeMessageCount"'));
    for(const name of ['momentFeedback','momentInteractions','contactLinks'])
        assert.ok(html.includes('data-lp="'+name+'"'));
    assert.ok(!html.includes('data-lp="homeMomentCount"'));
    const home=html.split('data-lp-screen="home"')[1].split('</section>')[0];
    assert.ok(home.includes('data-lp-open="wallet"'));
    assert.ok(!home.includes('data-lp-open="discover"'),'no duplicate Discover/Moments app on desktop');
    assert.ok(html.includes('data-lp-screen="wallet"'));
    assert.ok(html.includes('data-lp-open="discover"'),'Moments remains inside chat Discover tab');
    assert.ok(html.includes('吱付宝'));
    assert.ok(html.includes('data-lp="notification"'));
    const cfg=vm.runInContext('socialConfig({})',box);
    assert.equal(cfg.momentInteractions,false,'automatic paid interaction must default off');
});

test('autonomous character moments create unread Discover notifications without changing private messages',async()=>{
    const {ctx}=socialStory();
    ctx.generateRaw=async()=> '今天阳光真好';
    const box=runtime(ctx);
    const tick=vm.runInContext('tickAutonomousActivity',box);
    const before=ctx.chatMetadata.st_little_phone_v1.moments.length;
    await tick('moments');
    const now=ctx.chatMetadata.st_little_phone_v1;
    assert.equal(now.moments.length,before+1);
    assert.equal(now.moments.at(-1).authorId,'primary');
    assert.equal(now.unreadMoments,1);
    assert.equal(now.messages[0].text,'主角旧消息');
    assert.equal(now.conversations['npc:c'].messages[0].text,'网友旧消息');
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

test('Discover owns moment composer, Me owns sticker upload and persona, contacts has no explanatory group',()=>{
    const box=runtime();box.document.createElement=()=>({innerHTML:''});
    const html=box.api.makeUI().innerHTML;
    const section=name=>html.split('data-lp-screen="'+name+'"')[1].split('</section>')[0];
    const me=section('me'),discover=section('discover'),contacts=section('contacts');
    assert.ok(!me.includes('data-lp="momentsPost"'));assert.ok(me.includes('data-lp="stickerUpload"'));assert.ok(me.includes('data-lp="myPersona"'));
    assert.ok(me.includes('data-lp-open="settings"'));assert.ok(me.includes('data-lp-open="theme"'));
    assert.ok(discover.includes('data-lp="momentsFeed"'));assert.ok(discover.includes('data-lp="momentsText"'));
    assert.ok(!contacts.includes('storyPeopleList'));assert.ok(!html.includes('不代表已经拥有联系方式'));assert.ok(!html.includes('data-emoji='));assert.ok(!html.includes('npcScanAllWorlds'));
});

test('social activity intervals default off, fixed exactly, random within requested days',()=>{
    const box=runtime(),api=vm.runInContext('({socialConfig,nextActivityTime,knownOldFriend,classifyStoryFriendEvent})',box);
    const cfg=api.socialConfig({});
    assert.equal(cfg.messages.mode,'off');
    assert.equal(cfg.moments.mode,'off');
    assert.equal(api.nextActivityTime(cfg.messages,1000),0);
    assert.equal(api.nextActivityTime({mode:'fixed',days:3},1000),1000+3*86400000);
    const minimum=api.nextActivityTime({mode:'random',days:3},1000,()=>0);
    const maximum=api.nextActivityTime({mode:'random',days:3},1000,()=>0.999999);
    assert.ok(minimum>=1000+15*60000);
    assert.ok(maximum<=1000+3*86400000);
    assert.ok(api.knownOldFriend('室友戊与user从大一至大三一直是室友'));
    assert.ok(!api.knownOldFriend('今天刚认识的同学'));
});
test('mainline friend applications match their named sender, not unrelated NPCs',()=>{
    const box=runtime();
    const classify=vm.runInContext('classifyStoryFriendEvent',box);
    const content='室友戊向你发送了好友申请。';
    assert.equal(classify(content,'角色甲',true),null);
    assert.equal(classify(content,'室友戊',false)?.state,'incoming');
    assert.equal(classify('角色甲向你发送了好友申请。','角色甲',true)?.state,'incoming');
    assert.equal(classify('角色甲和你互相加了微信。','角色甲',true)?.state,'friends');
    assert.equal(classify('角色甲还没申请添加你为好友。','角色甲',true),null);
});
test('existing story chats and NPC messages remain intact after story relation sync',async()=>{
    const ctx={
        characterId:0,chatId:'saveA',
        characters:[{name:'角色甲',data:{description:'现在是大三'}}],
        chat:[{mes:'室友戊向你发送了好友申请。'}],
        chatMetadata:{st_little_phone_v1:{version:1,messages:[{id:'main',from:'user',text:'旧私聊'}],
           friendship:{state:'stranger'},storyTime:'2026-01-18T17:41',
           contacts:[{id:'npc:room',name:'室友戊',relationship:'从大一到大三都是室友',description:'user的室友多年'}],
           conversations:{'npc:room':{messages:[{id:'npcold',from:'user',text:'NPC旧私聊'}],friendship:{state:'stranger'}}}}},
        async saveMetadata(){}
    };
    const box=runtime(ctx);
    box.api.syncStoryRelationships=vm.runInContext('syncStoryRelationships',box);
    await box.api.syncStoryRelationships(ctx);
    const current=ctx.chatMetadata.st_little_phone_v1;
    assert.equal(current.friendship.state,'stranger');
    assert.equal(current.conversations['npc:room'].friendship.state,'friends');
    assert.equal(current.messages[0].text,'旧私聊');
    assert.equal(current.conversations['npc:room'].messages[0].text,'NPC旧私聊');
});
test('moment composer and autonomous UI are present without external background services',()=>{
    const html=runtime().api.makeUI().innerHTML;
    for(const id of ['momentImageUpload','momentsPreview','myAvatarUpload','autoMessagesMode',
      'autoMessagesDays','autoMomentsMode','autoMomentsDays','relationAutoSync',
      'phoneInPast','autonomyStatus','saveAutonomy','rescanRelations']){
       assert.ok(html.includes('data-lp="'+id+'"'),id);
    }
});

test('model-driven incoming friend request is opt-in and never approves itself',async()=>{
  let calls=0;
  const ctx={
    characterId:0,chatId:'current',characters:[{name:'角色甲',data:{description:'性格傲娇'}}],
    chat:[{mes:'角色甲和user交换了微信。'}],
    chatMetadata:{st_little_phone_v1:{version:1,storyTime:'2026-10-25T18:00',
      messages:[],friendship:{state:'stranger'},contacts:[],conversations:{},
      socialConfig:{relationSync:true,phoneInPast:false,characterRequests:true,
       messages:{mode:'off',days:3},moments:{mode:'off',days:3}}}},
    async saveMetadata(){},
    async generateRaw(){calls++;return 'APPLY';}
  };
  const box=runtime(ctx);
  box.document.visibilityState='visible';
  const decision=vm.runInContext('maybeAutoFriendRequest',box);
  await decision(ctx);
  assert.equal(ctx.chatMetadata.st_little_phone_v1.friendship.state,'incoming');
  assert.equal(calls,1);
  await decision(ctx);
  assert.equal(calls,1,'no duplicate requests from same event');
});


test('manual autonomous message test is independent of the daily schedule', async()=>{
  const ctx={characterId:0,chatId:'test-autonomy',characters:[{name:'角色甲',data:{description:'当前角色'}}],
    chatMetadata:{st_little_phone_v1:{version:1,messages:[],storyTime:'2026-10-25T12:00',friendship:{state:'friends'},
      socialConfig:{messages:{mode:'fixed',days:1},moments:{mode:'off',days:3}},
      socialSchedule:{messages:{nextDue:Date.now()+86400000,cursor:0}}}},
    async saveMetadata(){},async generateRaw(){return '主动打招呼。';}};
  const box=runtime(ctx);
  box.document.visibilityState='visible';
  const tick=vm.runInContext('tickAutonomousActivity',box);
  const before=ctx.chatMetadata.st_little_phone_v1.socialSchedule.messages.nextDue;
  await tick('messages');
  assert.equal(ctx.chatMetadata.st_little_phone_v1.messages.at(-1)?.text,'主动打招呼。');
  assert.equal(ctx.chatMetadata.st_little_phone_v1.socialSchedule.messages.nextDue,before,
    'test button must not change scheduled run');
});
test('friend request UI shows incoming accept/decline and a red-dot contact navigation',()=>{
  const html=runtime().api.makeUI().innerHTML;
  assert.ok(html.includes('data-lp="requestBadge"'));
  assert.ok(html.includes('class="lp-friend-request-badge"'));
  assert.ok(html.includes('data-lp="myAvatarFallback"'));
  assert.ok(html.includes('data-lp="myAvatarStatus"'));
  assert.ok(html.includes('data-lp="testAutonomy"'));
  const full=source;
  assert.ok(full.includes("['friends','同意']") || full.includes("['friends', '同意']"));
  assert.ok(full.includes("'补录对方的好友申请'"));
  assert.equal(full.includes("changeFriendship('outgoing', '你向对方发送了好友申请"),false);
});
