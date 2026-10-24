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
vm.runInContext(`${source}\nglobalThis.helpers = {newData, readData, writeData, friendshipState, rememberFriendship, buildPrompt, createSystemPrompt, redactDiagnostic, makeUI};`, sandbox);
const { newData, readData, writeData, friendshipState, rememberFriendship, buildPrompt, createSystemPrompt, redactDiagnostic, makeUI } = sandbox.helpers;

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
    assert.match(html, /data-lp="send">发送并生成/);
    assert.match(html, /data-lp="floatingLauncher"/);
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
        append(...children) { this.children.push(...children); }
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

test('diagnostic bootstrap is the manifest entry and exposes lifecycle hooks', () => {
    const manifest = JSON.parse(readFileSync(resolve(testRoot, '../manifest.json'), 'utf8'));
    const bootstrap = readFileSync(resolve(testRoot, '../bootstrap.js'), 'utf8');
    assert.equal(manifest.version, '0.3.3');
    assert.equal(manifest.js, 'bootstrap.js');
    assert.match(bootstrap, /import\('\.\/index\.js'\)/);
    assert.match(bootstrap, /export function onActivate\(/);
    assert.match(bootstrap, /export function onEnable\(/);
    assert.match(bootstrap, /export function onDisable\(/);
    assert.match(bootstrap, /B-ERR/);
});
