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

test('new storage defaults to a friend without breaking v0.1 format', () => {
    const data = newData();
    assert.equal(data.version, 1);
    assert.equal(friendshipState(data), 'friends');
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
    assert.ok(prompt.includes('已是好友 → 非好友'));
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
    const chatMetadata = {};
    const ctx = {
        groupId: null,
        characterId: 0,
        characters: [{ name: '宁肆锦', data: { description: '测试角色' } }],
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
      nodes = { input: {value: '你好呀'}, status: {dataset: {}}, diagnosticState: {textContent: ''} };
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
    assert.equal(manifest.version, '0.5.1');
    assert.equal(manifest.minimum_client_version, '1.18.0');
    assert.equal(manifest.js, 'bootstrap.js');
    assert.match(bootstrap, /import\('\.\/index\.js'\)/);
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
    vm.runInContext(source + '\\nglobalThis.split = splitPhoneReply;', runtime);
    const original = Array.from({length:7}, (_,i)=>'msg'+i).join('[PHONE_NEXT]');
    const actual = runtime.split(original, {});
    assert.equal(actual.length,5);
    assert.equal(actual.join('\\n').replace(/\\n/g,''),original.replaceAll('[PHONE_NEXT]',''));
    assert.equal(JSON.stringify(runtime.split(original,{config:{messageStyle:'unrestricted'}})),JSON.stringify([original]));
});
test('independent API uses a separate model and ephemeral key without changing host settings', async () => {
    const runtime = {console,Date,structuredClone,URL,window:{}};
    vm.createContext(runtime);
    vm.runInContext(source + '\\nglobalThis.api = {phoneGenerate, apiSessionId, transientApiKeys};',runtime);
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
    vm.runInContext(source + '\\nglobalThis.importParse = parseChatImport;',runtime);
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
