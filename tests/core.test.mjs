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
vm.runInContext(`${source}\nglobalThis.helpers = {newData, readData, writeData, friendshipState, rememberFriendship, buildPrompt, createSystemPrompt, redactDiagnostic, makeUI, composePhonePrompt, availablePresetEntries};`, sandbox);
const { newData, readData, writeData, friendshipState, rememberFriendship, buildPrompt, createSystemPrompt, redactDiagnostic, makeUI, composePhonePrompt, availablePresetEntries } = sandbox.helpers;

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
    assert.equal(manifest.version, '0.8.1');
    assert.equal(manifest.minimum_client_version, '1.18.0');
    assert.equal(manifest.js, 'bootstrap.js');
    assert.match(bootstrap, /import\('\.\/index\.js\?v=0\.7\.1'\)/);
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
    const book = {entries:{1:{uid:1,content:'ONE'},2:{uid:2,content:'TWO'}}};
    const data = newData();
    data.config = {worldEntries:[{book:'Book',id:'2'}]};
    const ctx = {loadWorldInfo:async()=>book};
    const text = await composePhonePrompt(ctx,{name:'C'},data);
    assert.ok(text.includes('TWO'));
    assert.equal(text.includes('ONE'),false);
    assert.equal(book.entries[1].content,'ONE');
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
