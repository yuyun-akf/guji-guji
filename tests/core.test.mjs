import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

// Evaluate pure helpers without launching a live SillyTavern environment.
const testRoot = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(resolve(testRoot, '../index.js'), 'utf8');
const source = raw.replaceAll('export function ', 'function ').replace(/\bbindReady\(\);\s*$/, '');
const sandbox = { console, Date, structuredClone, window: {} };
vm.createContext(sandbox);
vm.runInContext(`${source}\nglobalThis.helpers = {newData, readData, writeData, friendshipState, rememberFriendship, buildPrompt, createSystemPrompt, redactDiagnostic, makeUI, composePhonePrompt, availablePresetEntries, worldEntryTriggered, readExternalMemory, mainlineHistory, syncMainlinePrompt,selectedWorldBookNames,nextMessageStoryTime,appendPhoneMessage,storyHourLabel,resolvePhonePlaceholders,totalUnread};`, sandbox);
const { newData, readData, writeData, friendshipState, rememberFriendship, buildPrompt, createSystemPrompt, redactDiagnostic, makeUI, composePhonePrompt, availablePresetEntries, worldEntryTriggered, readExternalMemory, mainlineHistory, syncMainlinePrompt,selectedWorldBookNames,nextMessageStoryTime,appendPhoneMessage,storyHourLabel,resolvePhonePlaceholders,totalUnread } = sandbox.helpers;

test('new story starts without contact details or a friendship', () => {
    const data = newData();
    assert.equal(data.version, 1);
    assert.equal(friendshipState(data), 'stranger');
    assert.equal(data.messages.length, 0);
});

test('old chats retain their messages and gain a safe default friend state', () => {
    const old = { version: 1, storyTime: '2021-09-01T20:00', messages: [{ from: 'user', text: '旧消息' }], customField: 123 };
    const migrated = readData({ chatMetadata: { st_little_phone_v1: old } });
    assert.equal(friendshipState(migrated), 'friends');
    assert.equal(migrated.messages[0].text, '旧消息');
    assert.equal(migrated.customField, 123);
    assert.equal(old.friendship, undefined);
});

test('deleting and blocking friends do not destroy historical messages', () => {
    const data = newData();
    data.messages.push({ from: 'user', text: '还记得吗', storyTime: data.storyTime });
    rememberFriendship(data, 'stranger', '删除好友');
    assert.equal(friendshipState(data), 'stranger');
    assert.equal(data.messages[0].text, '还记得吗');
    rememberFriendship(data, 'blocked', '加入黑名单');
    rememberFriendship(data, 'stranger', '解除拉黑');
    rememberFriendship(data, 'outgoing', '重新申请');
    rememberFriendship(data, 'friends', '通过申请');
    assert.equal(friendshipState(data), 'friends');
    assert.equal(data.friendEvents.length, 5);
    assert.equal(data.messages[0].text, '还记得吗');
});

test('relationship system notices never become fake user messages in the prompt', () => {
    const data = newData();
    data.messages = [
        { from: 'user', text: '你好' },
        { from: 'system', text: '你已删除好友' },
        { from: 'character', text: '你好。' },
    ];
    const prompt = buildPrompt(data);
    assert.equal(prompt.length, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(prompt.map(x => x.role))), ['user', 'assistant']);
});

test('character receives the current relationship and past relationship transitions', () => {
    const data = newData();
    rememberFriendship(data, 'stranger', '删除好友');
    rememberFriendship(data, 'outgoing', '重新申请');
    const prompt = createSystemPrompt({ name: '测试角色', description: '普通朋友' }, data);
    assert.ok(prompt.includes('当前好友关系：已发送好友申请'));
    assert.ok(prompt.includes('非好友 → 已发送好友申请'));
});

test('diagnostic text hides obvious credentials', () => {
    const rawError = 'Bearer abcdefghijklmnop /v1?api_key=secret123 sk-abcdefghijklmnop';
    const cleaned = redactDiagnostic(rawError);
    assert.equal(cleaned.includes('secret123'), false);
    assert.equal(cleaned.includes('abcdefghijklmnop'), false);
    assert.equal(cleaned.includes('已隐藏'), true);
});

test('phone opens into a launcher with one send-and-generate action', () => {
    sandbox.document = { createElement: () => ({ innerHTML: '', id: '' }) };
    const html = makeUI().innerHTML;
    assert.match(html, /data-lp-screen="home"/);
    assert.match(html, /data-lp-screen="chat"/);
    assert.match(html, /data-lp-screen="diagnostics"/);
    assert.match(html, /data-lp="homeLogCount"/);
    assert.match(html, /data-lp="diagnosticState"/);
    assert.match(html, /data-lp="send"[^>]*>发送/);
    assert.match(html, /data-lp="floatingLauncher"/);
    assert.match(html, /<dialog class="lp-panel"/);
    assert.equal((html.match(/data-lp="send"/g) || []).length, 1);
    assert.equal((html.match(/data-lp="generate"/g) || []).length, 0);
    assert.match(html, /相册/);
    assert.match(html, /待开发/);
});

test('pressing send saves one player message and automatically generates one reply', async () => {
    let generationCount = 0;
    let saveCount = 0;
    const chatMetadata = { st_little_phone_v1: { ...newData(), friendship: { state: 'friends' } } };
    const ctx = {
        groupId: null,
        characterId: 0,
        characters: [{ name: '角色甲', data: { description: '测试角色' } }],
        chatMetadata,
        async saveMetadata() { saveCount += 1; },
        async generateRaw() { generationCount += 1; return '收到了。'; },
    };
    const runtime = {
        console, Date, structuredClone,
        setInterval: () => 1,
        clearInterval: () => {},
        setTimeout,
        clearTimeout,
        window: { SillyTavern: { getContext: () => ctx } },
    };
    vm.createContext(runtime);
    vm.runInContext(`${source}
      render = () => {};
      renderMessages = () => {};
      updateBusy = () => {};
      mounted = true;
      nodes = { input: {value: '你好呀'}, quotedPreview: {}, morePanel: {}, emojiPanel: {}, status: {dataset: {}}, diagnosticState: {textContent: ''} };
      globalThis.sendOnce = send;
      globalThis.readText = () => nodes.input.value;
      globalThis.logs = diagnostics;
    `, runtime);
    // A rapid second click must not duplicate the player message or the API call.
    await Promise.all([runtime.sendOnce(), runtime.sendOnce()]);
    const data = ctx.chatMetadata.st_little_phone_v1;
    assert.equal(generationCount, 1);
    assert.equal(saveCount, 2);
    assert.deepEqual(data.messages.map(message => message.from), ['user', 'character']);
    assert.equal(data.messages[0].text, '你好呀');
    assert.equal(data.messages[1].text, '收到了。');
    assert.equal(runtime.readText(), '');
    assert.equal(runtime.logs.some(entry => entry.stage === '生成成功'), true);
});

test('failed persistence rolls back the in-memory phone value for safe retry', async () => {
    const oldData = { version: 1, storyTime: '2021-09-01T20:00', messages: [] };
    const chatMetadata = { st_little_phone_v1: oldData };
    const ctx = {
        chatMetadata,
        async saveMetadata() { throw new Error('保存失败'); },
    };
    const changed = structuredClone(oldData);
    changed.messages.push({ from: 'user', text: '测试' });
    await assert.rejects(writeData(ctx, changed), /保存失败/);
    assert.equal(ctx.chatMetadata.st_little_phone_v1, oldData);
});

test('activation mounts even if APP_READY fired before the extension was loaded', () => {
    let mounts = 0;
    const readyContext = { eventSource: { on() {} }, event_types: { APP_READY: 'app_ready' } };
    const runtime = {
        console, Date, structuredClone,
        document: { body: {} },
        window: { SillyTavern: { getContext: () => readyContext } },
        setTimeout: () => { throw new Error('Unexpected readiness wait'); },
        clearTimeout() {},
        mountCount: () => { mounts += 1; },
    };
    vm.createContext(runtime);
    vm.runInContext(`${source}
      mount = () => { if (!mounted) { mounted = true; globalThis.mountCount(); } };
      installWandEntry = () => true;
      globalThis.activate = onActivate;
    `, runtime);
    // The host never emits APP_READY again; direct page activation must suffice.
    runtime.activate();
    runtime.activate();
    assert.equal(mounts, 1);
});

test('phone shell mounts immediately even when the host context is not ready', () => {
    let mounts = 0;
    const scheduled = [];
    const runtime = {
        console, Date, structuredClone,
        document: { body: {} },
        window: { SillyTavern: { getContext: () => null } },
        setTimeout: fn => { scheduled.push(fn); return scheduled.length; },
        clearTimeout() {},
        mountCount: () => { mounts += 1; },
    };
    vm.createContext(runtime);
    vm.runInContext(`${source}
      mount = () => { if (!mounted) { mounted = true; globalThis.mountCount(); } };
      installWandEntry = () => true;
      globalThis.activate = onActivate;
    `, runtime);
    runtime.activate();
    assert.equal(mounts, 1);
    assert.equal(scheduled.length, 0);
});

test('wand entry registers exactly once and opens the shared phone UI', () => {
    let opens = 0;
    class NodeStub {
        constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; }
        append(...children) {
            for (const child of children) {
                child.parentElement = this;
                child.isConnected = true;
                this.children.push(child);
            }
        }
        remove() {
            if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
            this.isConnected = false;
        }
        setAttribute(key, value) { this[key] = value; }
        addEventListener(name, fn) { this.listeners[name] = fn; }
    }
    const menu = new NodeStub('div');
    menu.id = 'extensionsMenu';
    const find = (node, id) => node.id === id ? node : node.children.map(child => find(child, id)).find(Boolean);
    const runtime = {
        console, Date, structuredClone,
        document: {
            getElementById: id => find(menu, id),
            createElement: tag => new NodeStub(tag),
        },
        window: {},
        markOpen: () => { opens += 1; },
    };
    vm.createContext(runtime);
    vm.runInContext(`${source}
      openPhone = () => globalThis.markOpen();
      globalThis.registerWand = installWandEntry;
    `, runtime);
    assert.equal(runtime.registerWand(), true);
    assert.equal(runtime.registerWand(), true);
    assert.equal(menu.children.length, 1);
    const button = menu.children[0].children[0];
    assert.equal(button['aria-label'], '打开咕叽咕机');
    assert.equal(button.children[1].textContent, '咕叽咕机');
    button.listeners.click();
    assert.equal(opens, 1);
});

test('floating launcher is off by default and its switch preserves other host settings', () => {
    let saves = 0;
    const ctx = {
        extensionSettings: { someOtherPlugin: { intact: true } },
        saveSettingsDebounced() { saves += 1; },
    };
    const runtime = {
        console, Date, structuredClone,
        window: { SillyTavern: { getContext: () => ctx } },
    };
    vm.createContext(runtime);
    vm.runInContext(`${source}
      nodes = { launcher: {}, floatingLauncher: {}, status: {dataset: {}},
                settingsStatus: {dataset: {}}, diagnosticState: {} };
      globalThis.enabled = floatLauncherEnabled;
      globalThis.change = setFloatLauncherEnabled;
      globalThis.launcher = nodes.launcher;
    `, runtime);
    assert.equal(runtime.enabled(), false);
    runtime.change(true);
    assert.equal(runtime.enabled(), true);
    assert.equal(runtime.launcher.hidden, false);
    runtime.change(false);
    assert.equal(runtime.enabled(), false);
    assert.equal(runtime.launcher.hidden, true);
    assert.equal(saves, 2);
    assert.equal(ctx.extensionSettings.someOtherPlugin.intact, true);
});

test('wand opens a native top-layer modal despite Android WebView returning no hit-test element', () => {
    const timers = [];
    const alerts = [];
    let shown = 0;
    const panel = {
        isConnected: true,
        open: false,
        style: {},
        showModal() { shown += 1; this.open = true; },
        getBoundingClientRect: () => ({ left: 20, top: 20, right: 340, bottom: 540, width: 320, height: 520 }),
    };
    const classes = new Set();
    const mockRoot = {
        isConnected: false,
        parentElement: null,
        classList: { add: name => classes.add(name), contains: name => classes.has(name) },
        querySelector: selector => selector === '.lp-panel' ? panel : null,
    };
    const body = { append(node) { node.parentElement = this; node.isConnected = true; } };
    const runtime = {
        console, Date, structuredClone,
        document: { body, documentElement: { clientWidth: 360, clientHeight: 720 }, elementFromPoint: () => null },
        window: { alert: message => alerts.push(message), innerWidth: 360, innerHeight: 720 },
        setTimeout: fn => { timers.push(fn); },
        mockRoot,
    };
    vm.createContext(runtime);
    vm.runInContext(`${source}
      mounted = true;
      root = globalThis.mockRoot;
      nodes = { launcher: { setAttribute() {} } };
      setScreen = () => {};
      render = () => {};
      globalThis.openActualPhone = openPhone;
    `, runtime);
    runtime.openActualPhone();
    assert.equal(mockRoot.parentElement, body);
    assert.equal(classes.has('lp-open'), true);
    assert.equal(shown, 1);
    assert.equal(panel.open, true);
    assert.equal(timers.length, 1);
    timers.shift()();
    assert.deepEqual(alerts, []);
});

test('closing the phone releases the modal top layer', () => {
    let closed = 0;
    const classes = new Set(['lp-open']);
    const panel = { open: true, close() { closed += 1; this.open = false; } };
    const runtime = { console, Date, structuredClone, classSet: classes, panel };
    vm.createContext(runtime);
    vm.runInContext(`${source}
      mounted = true;
      root = {
        classList: { remove: key => globalThis.classSet.delete(key) },
        querySelector: () => globalThis.testPanel,
      };
      nodes = { launcher: { setAttribute() {} } };
      globalThis.testPanel = globalThis.panel;
      globalThis.closeActualPhone = closePhone;
    `, runtime);
    runtime.closeActualPhone();
    assert.equal(closed, 1);
    assert.equal(classes.has('lp-open'), false);
});

test('modal entirely outside the viewport produces a visible diagnostic error', () => {
    const alerts = [];
    const timers = [];
    const panel = {
        isConnected: true,
        open: false,
        style: {},
        showModal() { this.open = true; },
        getBoundingClientRect: () => ({ left: 800, top: 700, right: 1120, bottom: 1200, width: 320, height: 500 }),
    };
    const runtime = {
        console, Date, structuredClone,
        document: { body: { append() {} }, documentElement: { clientWidth: 360, clientHeight: 720 } },
        window: { alert: message => alerts.push(message), innerWidth: 360, innerHeight: 720 },
        setTimeout: fn => { timers.push(fn); },
        panelForTest: panel,
    };
    vm.createContext(runtime);
    vm.runInContext(`${source}
      mounted = true;
      root = {
        parentElement: document.body,
        classList: { add() {}, contains: () => true },
        querySelector: () => globalThis.testPanel,
      };
      globalThis.testPanel = globalThis.panelForTest;
      nodes = { launcher: { setAttribute() {} } };
      setScreen = () => {};
      render = () => {};
      globalThis.tryOpen = openPhone;
    `, runtime);
    runtime.tryOpen();
    timers.shift()();
    assert.match(alerts[0], /手机主屏未进入可见区域/);
});

test('diagnostic bootstrap is the manifest entry and exposes lifecycle hooks', () => {
    const manifest = JSON.parse(readFileSync(resolve(testRoot, '../manifest.json'), 'utf8'));
    const bootstrap = readFileSync(resolve(testRoot, '../bootstrap.js'), 'utf8');
    assert.equal(manifest.version, '0.8.4');
    assert.equal(manifest.minimum_client_version, '1.18.0');
    assert.equal(manifest.js, 'bootstrap.js');
    assert.match(bootstrap, /import\('\.\/index\.js\?v=0\.8\.4'\)/);
    assert.match(bootstrap, /export function onActivate\(/);
    assert.match(bootstrap, /export function onEnable\(/);
    assert.match(bootstrap, /export function onDisable\(/);
    assert.match(bootstrap, /B-ERR/);
});

test('theme and calendar are separate apps with per-session time setting', () => {
    const html = makeUI().innerHTML;
    for (const screen of ['home','chat','calendar','theme','settings','diagnostics']) {
        assert.match(html, new RegExp('data-lp-screen="' + screen + '"'));
    }
    assert.match(html, /data-lp="themeWallpaper"/);
    assert.match(html, /data-lp="themeIcons"/);
    assert.match(html, /data-lp="apiInfo"/);
    assert.match(html, /data-lp="worldEntries"/);
    assert.equal((html.match(/data-lp="time"/g) || []).length, 1);
});
test('phone preset entry selection only reads requested prompt content', async () => {
    const data = newData();
    data.config = {presetEntries:[{preset:'A',id:'intro'}],worldEntries:[]};
    const ctx = {getPresetManager:()=>({getCompletionPresetByName:()=>({prompts:[
        {identifier:'intro',content:'ONLY_THIS'},
        {identifier:'other',content:'NOT_THIS'}
    ]})})};
    const prompt = await composePhonePrompt(ctx,{name:'C'},data);
    assert.ok(prompt.includes('ONLY_THIS'));
    assert.equal(prompt.includes('NOT_THIS'),false);
});
test('phone worldbook selection reads individual entries without changing source data', async () => {
    const book = {entries:{1:{uid:1,content:'ONE',constant:true},2:{uid:2,content:'TWO',constant:true}}};
    const data = newData();
    data.config = {worldEntries:[{book:'Book',id:'2'}]};
    const ctx = {loadWorldInfo:async()=>book};
    const text = await composePhonePrompt(ctx,{name:'C'},data);
    assert.ok(text.includes('TWO'));
    assert.equal(text.includes('ONE'),false);
    assert.equal(book.entries[1].content,'ONE');
});
test('multi-worldbook selection injects only triggered entries and respects constant/disabled/secondary keys', async () => {
    const bookA={entries:{
        1:{uid:1,key:['雨'],content:'雨天设定'},
        2:{uid:2,key:['海盗'],content:'海盗设定'},
        3:{uid:3,constant:true,content:'常驻设定'}
    }};
    const bookB={entries:{
        4:{uid:4,key:['雨'],keysecondary:['清晨'],selective:true,selectiveLogic:0,content:'清晨下雨'},
        5:{uid:5,constant:true,disable:true,content:'禁止插入'}
    }};
    const data=newData();data.messages=[{from:'user',text:'雨天好冷'}];
    data.config={worldEntries:[{book:'A',id:'1'},{book:'A',id:'2'},{book:'A',id:'3'},
        {book:'B',id:'4'},{book:'B',id:'5'}]};
    const ctx={loadWorldInfo:async name=>name==='A'?bookA:bookB};
    const result=await composePhonePrompt(ctx,{name:'C'},data);
    assert.ok(result.includes('雨天设定') && result.includes('常驻设定'));
    for(const ignored of ['海盗设定','清晨下雨','禁止插入'])assert.ok(!result.includes(ignored));
    assert.equal(bookA.entries[1].content,'雨天设定');
    assert.ok(worldEntryTriggered({key:['/(?:雨|雪)/i'],content:'x'},'下雪啦'));
});
test('multi-book UI requires selecting books first, keeps old entry choices, and disables unselected books',async()=>{
    const data=newData();
    data.messages=[{from:'user',text:'雨'}];
    data.config={worldEntries:[{book:'天气书',id:'1'},{book:'人物书',id:'2'}]};
    assert.equal(selectedWorldBookNames(data).length,2,'legacy world entries remain active');
    data.config.worldBooks=['天气书'];
    const ctx={loadWorldInfo:async()=>({entries:{1:{uid:1,key:['雨'],content:'雨天设定'},2:{uid:2,constant:true,content:'未选书的秘密'}}})};
    const content=await composePhonePrompt(ctx,{name:'角色'},data);
    assert.ok(content.includes('雨天设定'));
    assert.ok(!content.includes('未选书的秘密'));
    assert.equal(data.config.worldEntries.length,2,'switching the book should not erase saved entry ticks');
    const html=makeUI().innerHTML;
    assert.ok(html.includes('data-lp="worldBookList"'));
    assert.ok(html.includes('data-lp="worldSelectionSummary"'));
    assert.ok(!html.includes('data-lp="worldSource"'),'no misleading single-book dropdown');
});
test('worldbook checkboxes render multiple choices and persist selections together',async()=>{
    const previousDocument=sandbox.document,previousWindow=sandbox.window;
    const element=tag=>({tag,children:[],dataset:{},textContent:'',checked:false,
        append(...children){this.children.push(...children);},replaceChildren(){this.children=[];}});
    const ctx={characterId:0,characters:[{name:'角色甲'}],chatMetadata:{st_little_phone_v1:{...newData(),config:{worldBooks:['天气书'],worldEntries:[{book:'天气书',id:'a'}]}}},
        getWorldInfoNames:()=>['天气书','人物书'],saveMetadata:async()=>{}};
    const fixture={worldBookList:element('div'),openWorldPicker:element('button'),worldSelectionSummary:element('div'),diagnosticState:element('div')};
    try {
        sandbox.document={createElement:element};
        sandbox.window={SillyTavern:{getContext:()=>ctx}};
        sandbox.fixtureNodes=fixture;
        vm.runInContext('nodes=fixtureNodes',sandbox);
        vm.runInContext('renderWorldBookSelector',sandbox)(ctx);
        assert.equal(fixture.worldBookList.children.length,2);
        assert.equal(fixture.worldBookList.children[0].children[0].checked,true);
        assert.equal(fixture.worldBookList.children[1].children[0].checked,false);
        const second=fixture.worldBookList.children[1].children[0];second.checked=true;
        vm.runInContext('onWorldBookChange',sandbox)(second);
        await vm.runInContext('configWriteQueue',sandbox);
        assert.equal(JSON.stringify(ctx.chatMetadata.st_little_phone_v1.config.worldBooks),JSON.stringify(['天气书','人物书']));
        assert.equal(ctx.chatMetadata.st_little_phone_v1.config.worldEntries[0].id,'a');
        assert.match(fixture.openWorldPicker.textContent,/2 本/);
    }finally{sandbox.document=previousDocument;sandbox.window=previousWindow;vm.runInContext('nodes=null',sandbox);}
});
test('story clock advances for replies, respects manual calendar jumps and evening-vs-late-night',()=>{
    const data={...newData(),storyTime:'2026-01-18T17:41',messages:[]};
    appendPhoneMessage(data,'user','你好');
    appendPhoneMessage(data,'character','晚上好');
    assert.equal(data.messages[0].storyTime,'2026-01-18T17:41');
    assert.equal(data.messages[1].storyTime,'2026-01-18T17:42');
    assert.equal(storyHourLabel(data.storyTime),'傍晚');
    data.storyTime='2026-01-18T22:30';
    assert.equal(nextMessageStoryTime(data),'2026-01-18T22:30');
    appendPhoneMessage(data,'user','吃夜宵了');
    assert.equal(data.messages[2].storyTime,'2026-01-18T22:30');
    assert.equal(storyHourLabel(data.storyTime),'深夜');
});
test('placeholders resolve active user mask and selected contact without replacing stored card text',async()=>{
    const ctx={name1:'梨子',powerUserSettings:{persona_description:'和{{char}}是网友'}};
    const char={name:'宁肆锦',data:{description:'{{char}}认识{{user}}，但{{user}}不知道他是演员'}};
    const data=newData();
    const prompt=await composePhonePrompt(ctx,char,data);
    assert.ok(prompt.includes('宁肆锦认识梨子'));
    assert.ok(prompt.includes('梨子不知道他是演员'));
    assert.ok(!prompt.includes('{{user}}')&&!prompt.includes('{{char}}'));
    assert.ok(prompt.includes('真实身份')&&prompt.includes('不得主动自曝'));
    assert.ok(prompt.includes('（'+storyHourLabel(data.storyTime)+'）'));
    assert.equal(char.data.description,'{{char}}认识{{user}}，但{{user}}不知道他是演员');
    const history=buildPrompt({messages:[{from:'user',text:'{{char}} 在吗？'}]},ctx,char);
    assert.equal(history[0].content,'宁肆锦 在吗？');
    assert.equal(resolvePhonePlaceholders('{{user}}和{{char}}',ctx,char),'梨子和宁肆锦');
});
test('message indicators count per contact; quote cancellation and activity feedback have controls',()=>{
    const data={contacts:[{id:'npc:a'},{id:'npc:b'}],unreadCounts:{primary:2,'npc:a':3,'npc:b':0}};
    assert.equal(totalUnread(data),5);
    const html=makeUI().innerHTML;
    for(const key of ['homeUnreadCount','notification','inlineNotification','quotedText','cancelQuote','autonomyFeedback'])
        assert.ok(html.includes('data-lp="'+key+'"'));
    assert.ok(html.includes('取消引用'));
});
test('NPC autonomous unread counts persist independently of existing phone messages',async()=>{
    const old={...newData(),messages:[{id:'primary',from:'user',text:'老消息'}],
        contacts:[{id:'npc:a',name:'人物甲'}],
        conversations:{'npc:a':{messages:[{id:'oldnpc',from:'character',text:'NPC旧消息'}],friendship:{state:'friends'}}},
        unreadCounts:{primary:1,'npc:a':0}};
    const ctx={chatMetadata:{st_little_phone_v1:old},saveMetadata:async()=>{}};
    const changed=structuredClone(readData(ctx,'npc:a'));
    changed.messages.push({id:'new',from:'character',text:'新主动消息'});
    changed.unreadCounts['npc:a']=2;
    await writeData(ctx,changed);
    const now=ctx.chatMetadata.st_little_phone_v1;
    assert.equal(now.unreadCounts['npc:a'],2);
    assert.equal(now.unreadCounts.primary,1);
    assert.equal(now.messages[0].text,'老消息');
    assert.equal(now.conversations['npc:a'].messages[0].text,'NPC旧消息');
});
test('avatar change uses the same photo encoder as Me and no 350KB hard gate',()=>{
    const fn=raw.match(/async function updateAvatar\([\s\S]*?(?=async function resetAvatar)/)?.[0]||'';
    assert.ok(fn.includes('await encodeAvatarPhoto(file)'));
    assert.ok(!fn.includes('350*1024'));
});
test('current persona joins the phone character prompt and does not become an NPC action', async () => {
    const ctx={name1:'阿梨',powerUserSettings:{persona_description:'喜欢紫色的成年人'}};
    const prompt=await composePhonePrompt(ctx,{name:'角色甲',data:{personality:'嘴硬但关心人',mes_example:'别傻了。'}},newData());
    assert.ok(prompt.includes('阿梨') && prompt.includes('喜欢紫色的成年人'));
    assert.ok(prompt.includes('嘴硬但关心人') && prompt.includes('别傻了。'));
    assert.ok(prompt.includes('不能凭人设臆断 user'));
});
test('Gaga memory is read-only; in-past timeline blocks all external memory', () => {
    const ctx={chatMetadata:{st_little_phone_v1:newData()},
        extensionPrompts:{'gaga-dog-summary:000100:memory':{value:'已经发生的正文记忆'},
            'gaga-dog-summary:000200:director':{value:'禁止混入的导演规则'}}};
    const data=newData();
    const found=readExternalMemory(ctx,data);
    assert.equal(found.source,'嘎嘎小狗 · 当前正文记忆');
    assert.ok(found.text.includes('已经发生的正文记忆'));
    assert.ok(!found.text.includes('导演规则'));
    ctx.chatMetadata.st_little_phone_v1.socialConfig={phoneInPast:true};
    assert.equal(readExternalMemory(ctx,data).text,'');
    assert.equal(ctx.extensionPrompts['gaga-dog-summary:000100:memory'].value,'已经发生的正文记忆');
});
test('BaiBai public API reads only ordinary history and public details, without internal affinity estimates', () => {
    sandbox.window.STBaiBaiBook={apiVersion:1,
        getSnapshot:()=>({chat:{characterName:'角色甲'},coverage:{complete:true},
            state:{location:'屋顶'},npcs:[{name:'乙',affinityInner:2}],
            lifeDetails:[{subject:'user',text:'喜欢热牛奶'}]}),
        getInjectedHistory:()=>({text:'角色甲昨天捡到一枚钥匙'})};
    const ctx={characters:[{name:'角色甲'}],characterId:0,chatMetadata:{st_little_phone_v1:newData()}};
    const data=newData();data.config={memorySource:'baibai'};
    try {
        const found=readExternalMemory(ctx,data);
        assert.ok(found.text.includes('昨天捡到一枚钥匙'));
        assert.ok(found.text.includes('喜欢热牛奶'));
        assert.ok(!found.text.includes('affinityInner'));
        assert.equal(found.source,'柏宝书 · 只读公开接口');
    } finally {delete sandbox.window.STBaiBaiBook;}
});
test('phone history enters mainline only when opted in and can be cleared without editing original chat', () => {
    const saved={...newData(),messages:[{from:'user',text:'晚上好',storyTime:'2026-01-01T20:00'}]};
    const prompts=[];
    const ctx={chatMetadata:{st_little_phone_v1:saved},characterId:0,characters:[{name:'C'}],
        setExtensionPrompt:(...args)=>prompts.push(args),extension_prompt_types:{IN_CHAT:1}};
    assert.equal(syncMainlinePrompt(ctx),true);
    assert.equal(prompts.at(-1)[1],'');
    saved.config={phoneToMainline:true};
    syncMainlinePrompt(ctx);
    assert.match(prompts.at(-1)[1],/晚上好/);
    assert.equal(ctx.chatMetadata.st_little_phone_v1.messages[0].text,'晚上好');
    saved.config.phoneToMainline=false;
    syncMainlinePrompt(ctx);
    assert.equal(prompts.at(-1)[1],'');
    assert.ok(mainlineHistory(saved).includes('晚上好'));
    const other={...newData(),config:{phoneToMainline:true},messages:[{from:'user',text:'另一份独立聊天'}]};
    ctx.chatMetadata={st_little_phone_v1:other};
    syncMainlinePrompt(ctx);
    assert.ok(prompts.at(-1)[1].includes('另一份独立聊天'));
    assert.ok(!prompts.at(-1)[1].includes('晚上好'));
});
test('unavailable selected entry is a visible failure not silently ignored', async () => {
    const data = newData();
    data.config = {worldEntries:[{book:'missing',id:'9'}]};
    await assert.rejects(composePhonePrompt({loadWorldInfo:async()=>({entries:{}})}, {name:'C'},data), /不可用/);
});

test('mobile settings use dedicated full-screen searchable item pickers', () => {
    const html = makeUI().innerHTML;
    assert.match(html, /data-lp-screen="presetPicker"/);
    assert.match(html, /data-lp-screen="worldPicker"/);
    assert.match(html, /data-lp="presetSearch"/);
    assert.match(html, /data-lp="worldSearch"/);
    assert.match(html, /data-lp="apiMode"/);
    assert.match(html, /data-lp="apiUrl"/);
    assert.match(html, /data-lp="apiModel"/);
    assert.match(html, /data-lp="apiKey"/);
    assert.doesNotMatch(html, /data-lp="testApi"/);
    assert.match(html, /data-lp="saveApi"/);
});
test('split phone messages preserve content even above five bubbles', () => {
    const runtime = { console, Date, structuredClone, window:{} };
    vm.createContext(runtime);
    vm.runInContext(source + '\nglobalThis.split = splitPhoneReply;', runtime);
    const original = Array.from({length:7}, (_,i)=>'msg'+i).join('[PHONE_NEXT]');
    const actual = runtime.split(original, {});
    assert.equal(actual.length,5);
    assert.equal(actual.join('\n').replace(/\n/g,''),original.replaceAll('[PHONE_NEXT]',''));
    assert.equal(JSON.stringify(runtime.split(original,{config:{messageStyle:'unrestricted'}})),JSON.stringify([original]));
});
test('independent API uses a separate model and ephemeral key without changing host settings', async () => {
    const runtime = {console,Date,structuredClone,URL,window:{}};
    vm.createContext(runtime);
    vm.runInContext(source + '\nglobalThis.api = {phoneGenerate, apiSessionId, transientApiKeys};',runtime);
    let outbound;
    const settings = {theme:'unchanged'};
    const ctx = {
        characterId:0,chatId:'storyA',extensionSettings:settings,
        generateRaw:async()=> 'host answer',
        ChatCompletionService:{sendRequest:async request => {outbound = request;return {content:'independent answer'};}}
    };
    runtime.api.transientApiKeys.set(runtime.api.apiSessionId(ctx),'TEST_SECRET');
    const data={config:{api:{mode:'custom',url:'https://api.example/v1',model:'another-model'}}};
    const answer=await runtime.api.phoneGenerate(ctx,{systemPrompt:'s',prompt:'u'},data);
    assert.equal(answer,'independent answer');
    assert.equal(outbound.model,'another-model');
    assert.equal(outbound.chat_completion_source,'custom');
    assert.equal(JSON.parse(outbound.custom_include_headers).Authorization,'Bearer TEST_SECRET');
    assert.deepEqual(settings,{theme:'unchanged'});
});

test('messenger has messages, contacts, requests, profile, settings and import/export actions', () => {
    const html = makeUI().innerHTML;
    for (const page of ['chatList','contacts','requests','profile','chat','chatOptions']) {
        assert.match(html,new RegExp('data-lp-screen="' + page + '"'));
    }
    for (const control of ['exportChat','copyChat','importChat','deleteChat','clearChat','avatarCharFile','avatarUserFile']) {
        assert.ok(html.includes('data-lp="' + control + '"'));
    }
    assert.doesNotMatch(html,/data-lp="activity"/);
    assert.doesNotMatch(html,/data-lp="diagnosticToggle"/);
    assert.match(html,/data-lp="chatMenu"/);
});
test('chat import validates schema, sender roles and length limits', () => {
    const runtime = {console,Date,structuredClone,window:{},document:{}};
    vm.createContext(runtime);
    vm.runInContext(source + '\nglobalThis.importParse = parseChatImport;',runtime);
    const json=JSON.stringify({format:'gujiguji-chat',version:1,messages:[{from:'user',text:'你好'},{from:'character',text:'在'}]});
    const list=runtime.importParse(json);
    assert.equal(list.length,2);
    assert.equal(list[1].text,'在');
    assert.throws(()=>runtime.importParse(JSON.stringify({format:'gujiguji-chat',version:1,messages:[{from:'admin',text:'x'}]})),/格式不合法/);
});
test('contact data keeps the original v1 chat messages unchanged', () => {
    const old={version:1,storyTime:'2020-01-01T00:00',messages:[{id:'m1',from:'character',text:'以前的消息'}],friendship:{state:'friends'}};
    const next=readData({chatMetadata:{st_little_phone_v1:old}});
    assert.equal(next.messages[0].text,'以前的消息');
    assert.equal(next.messages[0].id,'m1');
    assert.equal(next.friendship.state,'friends');
});

test('old primary chat and NPC conversations persist independently in same story', async () => {
    const runtime={console,Date,structuredClone,window:{}};
    vm.createContext(runtime);
    vm.runInContext(source + `
        globalThis.storage={readRootData,readData,writeData,contactCharacter,
            select:(id)=>{activeContactId=id;}};
    `,runtime);
    const ctx={characterId:0,characters:[{name:'主角'}],
        chatMetadata:{st_little_phone_v1:{version:1,storyTime:'2026-01-01T12:00',
            messages:[{from:'user',text:'旧主角消息'}],friendship:{state:'friends'}}},
        async saveMetadata(){}};
    const root=runtime.storage.readRootData(ctx);
    root.contacts=[{id:'npc:a',name:'A',description:'老师A'},{id:'npc:b',name:'B',description:'同学B'}];
    root.conversations={'npc:a':{messages:[],friendship:{state:'stranger'}},
                        'npc:b':{messages:[],friendship:{state:'stranger'}}};
    await runtime.storage.writeData(ctx,{...root,__contactId:'primary'});
    runtime.storage.select('npc:a');
    const a=structuredClone(runtime.storage.readData(ctx));
    assert.equal(a.friendship.state,'stranger');
    a.messages.push({from:'user',text:'给A的消息'});
    a.friendship={state:'friends'};
    await runtime.storage.writeData(ctx,a);
    runtime.storage.select('npc:b');
    const b=structuredClone(runtime.storage.readData(ctx));
    b.messages.push({from:'user',text:'给B的消息'});
    await runtime.storage.writeData(ctx,b);
    runtime.storage.select('primary');
    assert.equal(runtime.storage.readData(ctx).messages[0].text,'旧主角消息');
    assert.equal(ctx.chatMetadata.st_little_phone_v1.conversations['npc:a'].messages[0].text,'给A的消息');
    assert.equal(ctx.chatMetadata.st_little_phone_v1.conversations['npc:b'].messages[0].text,'给B的消息');
    assert.equal(ctx.chatMetadata.st_little_phone_v1.conversations['npc:a'].friendship.state,'friends');
});
test('NPC generations use only the selected contact persona', () => {
    const runtime={console,Date,structuredClone,window:{}};
    vm.createContext(runtime);
    vm.runInContext(source + `
        globalThis.storage={contactCharacter,readData,createSystemPrompt,select:(id)=>{activeContactId=id;}};
    `,runtime);
    const ctx={characterId:0,characters:[{name:'角色甲',description:'演员'}],chatMetadata:{
        st_little_phone_v1:{version:1,storyTime:'2026-01-01T12:00',messages:[],friendship:{state:'friends'},
        contacts:[{id:'npc:mom',name:'人物乙',description:'画家'}],
        conversations:{'npc:mom':{messages:[],friendship:{state:'friends'}}}}}};
    runtime.storage.select('npc:mom');
    const prompt=runtime.storage.createSystemPrompt(runtime.storage.contactCharacter(ctx),runtime.storage.readData(ctx));
    assert.ok(prompt.includes('角色「人物乙」'));
    assert.ok(prompt.includes('画家'));
    assert.equal(prompt.includes('角色「角色甲」'),false);
});
test('NPC data is scoped to current roleplay chat metadata, not an imported character directory', () => {
    const runtime={console,Date,structuredClone,window:{}};
    vm.createContext(runtime);
    vm.runInContext(source + `globalThis.readRoot=readRootData;`,runtime);
    const a={chatMetadata:{st_little_phone_v1:{version:1,messages:[],contacts:[{id:'npc:a',name:'A'}]}}};
    const b={chatMetadata:{st_little_phone_v1:{version:1,messages:[]}}};
    assert.equal(runtime.readRoot(a).contacts.length,1);
    assert.equal(runtime.readRoot(b).contacts.length,0);
});
test('NPC creation and remarks have dedicated mobile UI', () => {
    const html=makeUI().innerHTML;
    for(const name of ['addNpc','npcName','npcRelation','npcDescription','addNpcSave',
      'contactRemark','saveContactRemark','deleteNpc']) {
      assert.ok(html.includes('data-lp="' + name + '"') || html.includes('data-lp-screen="' + name + '"'));
    }
});

test('NPC extraction finds explicit names and preserves who the relationship belongs to', () => {
    const runtime = {console,Date,structuredClone,window:{}};
    vm.createContext(runtime);
    vm.runInContext(source+'\nglobalThis.extract=extractNpcCandidatesFromText;',runtime);
    const text = '角色甲的母亲人物乙，画家。\n父亲：人物丙\nuser的老师李春华，是大学教授。';
    const results=runtime.extract(text,'当前角色卡','角色甲');
    const get=name=>results.find(x=>x.name===name);
    assert.equal(get('人物乙')?.relation,'角色甲的母亲');
    assert.ok(get('人物丙')?.relation.includes('父亲'));
    assert.equal(get('李春华')?.relation,'user 的老师');
    assert.equal(results.some(x=>x.name==='角色甲'),false);
});
test('NPC scanner does not mistake an occupation phrase for a name', () => {
    const runtime={console,Date,structuredClone,window:{}};
    vm.createContext(runtime);
    vm.runInContext(source+'\nglobalThis.extract=extractNpcCandidatesFromText;',runtime);
    const results=runtime.extract('人物丙：著名导演，角色甲的父亲。','人物档案','角色甲');
    assert.ok(results.some(x=>x.name==='人物丙'));
    assert.equal(results.some(x=>x.name==='著名导演'),false);
});
test('NPC scanner reads only the current character and its configured lorebooks, without API use', async () => {
    const runtime={console,Date,structuredClone,window:{}};
    vm.createContext(runtime);
    vm.runInContext(source+'\nglobalThis.scan=scanNpcSources;',runtime);
    let worldCalls=0;
    const ctx={characterId:0,chatId:'story-A',
        characters:[
            {name:'角色甲',data:{description:'角色甲的母亲人物乙，画家。',extensions:{world:'宁家设定'}}},
            {name:'其他角色',data:{description:'姓名：不相干的人物'}}
        ],
        chatMetadata:{st_little_phone_v1:{version:1,storyTime:'2026-10-25T09:00',messages:[],friendship:{state:'friends'}}},
        loadWorldInfo:async name=>{worldCalls++;assert.equal(name,'宁家设定');return {entries:{
            1:{comment:'人物丙',content:'人物丙\n身份：电影导演，角色甲的父亲。'}
        }};}
    };
    const results=await runtime.scan(ctx);
    const names=results.candidates.map(x=>x.name);
    assert.ok(names.includes('人物乙'));
    assert.ok(names.includes('人物丙'));
    assert.equal(names.includes('不相干的人物'),false);
    assert.equal(worldCalls,1);
    assert.equal(results.candidates.find(x=>x.name==='人物丙')?.description.includes('电影导演'),true);
    assert.equal(ctx.chatMetadata.st_little_phone_v1.contacts,undefined);
});
test('NPC scanner excludes people already saved and has review-only UI', () => {
    const runtime={console,Date,structuredClone,window:{}};
    vm.createContext(runtime);
    vm.runInContext(source+'\nglobalThis.filter=mergeNpcCandidates;',runtime);
    const found=runtime.filter([
        {name:'人物乙',description:'画家',source:'一'},
        {name:'人物乙',description:'学院画家',source:'二'},
        {name:'角色甲',description:'当前 char',source:'三'},
        {name:'人物丙',description:'父亲',source:'四'}
    ],{contacts:[{id:'npc:s',name:'人物乙'}]},'角色甲');
    assert.equal(found.length,1);
    assert.equal(found[0].name,'人物丙');
    const html=makeUI().innerHTML;
    assert.ok(html.includes('data-lp-screen="discoverNpc"'));
    assert.ok(html.includes('data-lp="npcScanButton"'));
    assert.ok(html.includes('data-lp="npcSaveCandidates"'));
    assert.ok(html.includes('data-lp="npcWorldSelect"'));
});

test('contact application is gated by exchange proof or manual creation', () => {
    const runtime={console,Date,structuredClone,window:{}};
    vm.createContext(runtime);
    vm.runInContext(source+'\nglobalThis.gate={readData,contactAccess,storyExchangeEvidence};',runtime);
    const ctx={characters:[{name:'角色甲'}],characterId:0,chat:[],chatMetadata:{}};
    assert.equal(runtime.gate.contactAccess(ctx,'primary').allowed,false);
    ctx.chat=[{mes:'我们交换了联系方式。'}];
    assert.equal(runtime.gate.contactAccess(ctx,'primary').allowed,true);
    ctx.chat=[{mes:'我们还没交换联系方式。'}];
    assert.equal(runtime.gate.contactAccess(ctx,'primary').allowed,false);
});
test('legacy chat without friendship object remains a friend', () => {
    const ctx={chatMetadata:{st_little_phone_v1:{version:1,messages:[{from:'user',text:'hi'}]}}};
    assert.equal(friendshipState(readData(ctx)),'friends');
});
test('user lorebook friends are discovered from the current persona binding', async () => {
    const runtime={console,Date,structuredClone,window:{}};
    vm.createContext(runtime);
    vm.runInContext(source+'\nglobalThis.scan=scanNpcSources;',runtime);
    const ctx={characters:[{name:'角色甲',data:{description:'角色甲在上课。'}}],characterId:0,chatMetadata:{},
        powerUserSettings:{persona_description_lorebook:'user-设定'},
        getWorldInfoNames:()=>{throw new Error('must not enumerate all books');},loadWorldInfo:async()=>({entries:{1:{comment:'朋友丁',content:'朋友丁是user的朋友，认识很多年。'}}})};
    const scan=await runtime.scan(ctx);
    assert.ok(scan.candidates.some(x=>x.name==='朋友丁'));
    assert.equal(scan.worlds,1);
});
test('incomplete phrases do not become NPC names', () => {
    const runtime={console,Date,structuredClone,window:{}};
    vm.createContext(runtime);
    vm.runInContext(source+'\nglobalThis.extract=extractNpcCandidatesFromText;',runtime);
    assert.equal(runtime.extract('与同学在范畴内讨论问题。','世界书','角色甲').length,0);
});
test('new four tab layout and functional input tools exist', () => {
    const html=makeUI().innerHTML;
    for(const name of ['chatList','contacts','discover','me'])assert.ok(html.includes('data-lp-screen="'+name+'"'));
    for(const name of ['messageActions','chatImageInput','momentsText','momentsPost','quotedPreview'])assert.ok(html.includes('data-lp="'+name+'"'));
    assert.ok(html.includes('data-chat-tool="transfer"'));
    assert.ok(html.includes('data-chat-tool="location"'));
});
test('chat backup round trip retains multimedia image payload', () => {
    const runtime={console,Date,structuredClone,window:{}};
    vm.createContext(runtime);
    vm.runInContext(source+'\nglobalThis.chatFns={exportChatPayload,parseChatImport,buildPrompt};',runtime);
    const ctx={characters:[{name:'C'}],characterId:0};
    const image='data:image/jpeg;base64,QUJD';
    const data={messages:[{id:'1',from:'user',text:'[图片]',image}]};
    const payload=runtime.chatFns.exportChatPayload(ctx,data);
    assert.equal(runtime.chatFns.parseChatImport(JSON.stringify(payload))[0].image,image);
    assert.equal(runtime.chatFns.buildPrompt(data)[0].content[1].type,'image_url');
});


test('published NPC form uses generic user/char placeholders without private character defaults', () => {
    const html = makeUI().innerHTML;
    assert.ok(html.includes('placeholder="如：{{char}}的母亲、{{user}}的同学"'));
    assert.ok(html.includes('placeholder="NPC 姓名"'));
    assert.ok(!html.includes('角色甲的母亲'), 'test fixture names must not leak into the public UI');
});
