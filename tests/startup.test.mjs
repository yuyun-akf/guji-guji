import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const main = readFileSync(new URL('../index.js', import.meta.url), 'utf8').replaceAll('export function ', 'function ');
const boot = readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8')
    .replaceAll('export function ', 'function ')
    .replace("import('./index.js?v=0.8.0')", 'mockImport()');

function dom() {
    const observers = new Set();
    class Node {
        constructor(tag) {
            this.tagName = tag; this.children = []; this.listeners = {}; this.dataset = {}; this.style = {};
            this.classList = { contains: () => false, add() {}, remove() {}, toggle() {} };
        }
        get isConnected() { return this === body || Boolean(this.parentElement?.isConnected); }
        set innerHTML(html) {
            this.children = [];
            for (const match of html.matchAll(/<([a-z]+)\b[^>]*>/g)) {
                const node = new Node(match[1]);
                const key = match[0].match(/data-lp="([^"]+)"/);
                if (key) node.dataset.lp = key[1];
                node.type = match[0].match(/type="([^"]+)"/)?.[1];
                const cls = match[0].match(/class="([^"]+)"/);
                if (cls) node.className = cls[1];
                this.append(node);
            }
        }
        append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
        remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(n => n !== this); this.parentElement = null; }
        setAttribute(key, value) { this[key] = value; }
        addEventListener(event, fn) { this.listeners[event] = fn; }
        removeEventListener(event) { delete this.listeners[event]; }
        querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
        querySelectorAll(selector) {
            const key = selector.match(/^\[data-lp="([^"]+)"\]$/)?.[1];
            const match = node => key ? node.dataset.lp === key : selector === 'input[type="file"]' ? node.tagName==='input' && node.type==='file' : selector.startsWith('.') && node.className?.split(' ').includes(selector.slice(1));
            return this.children.flatMap(node => [...(match(node) ? [node] : []), ...node.querySelectorAll(selector)]);
        }
    }
    const body = new Node('body');
    const find = (node, id) => node.id === id ? node : node.children.map(child => find(child,id)).find(Boolean);
    return {
        document: { body, createElement: tag => new Node(tag), getElementById: id => find(body,id) },
        MutationObserver: class { constructor(fn) { this.fn = fn; } observe() { observers.add(this); } disconnect() { observers.delete(this); } },
        mutate() { for (const observer of observers) observer.fn(); },
        observers,
    };
}

test('full mount binds actual template controls including moments; disable preserves metadata', () => {
    const host = dom();
    const metadata = { st_little_phone_v1: { messages: [{text:'old'}], customField: 42 } };
    const before = JSON.stringify(metadata);
    const ctx = { chatMetadata: metadata };
    const runtime = { ...host, console, Date, structuredClone,
        window: { SillyTavern: { getContext: () => ctx }, addEventListener() {}, removeEventListener() {} },
        setTimeout() { return 1; }, clearTimeout() {}, clearInterval() {} };
    vm.createContext(runtime);
    // Keep the real mount and all event wiring; rendering is covered separately.
    vm.runInContext(main + '\nrender = () => {}; renderDiagnostics = () => {}; globalThis.api = { onActivate, onDisable, controls: () => nodes };', runtime);
    runtime.api.onActivate();
    for (const [, key] of main.matchAll(/nodes\??\.([A-Za-z]\w*)/g)) {
        assert.ok(runtime.api.controls()[key], `missing template control: ${key}`);
    }
    const root = host.document.getElementById('st-little-phone-root');
    assert.equal(typeof root.querySelector('[data-lp="momentsPost"]').listeners.click, 'function');
    // Exercise the actual mounted handlers, not just picker state helpers.
    const input = root.querySelector('[data-lp="chatImageInput"]');
    let prevented = 0;
    vm.runInContext("globalThis.closed=0;closePhone=()=>{closed++;};activeScreen='chat';nodes.input.value='草稿';nodes.messages.scrollTop=42;",runtime);
    input.listeners.click();
    root.querySelector('.lp-panel').listeners.cancel({preventDefault(){prevented++;}});
    root.listeners.keydown({key:'Escape',preventDefault(){prevented++;},stopPropagation(){}});
    assert.equal(runtime.closed,0);
    assert.equal(prevented,2);
    assert.equal(runtime.api.controls().input.value,'草稿');
    assert.equal(runtime.api.controls().messages.scrollTop,42);
    assert.equal(host.document.getElementById('gujiguji-floating-launcher').hidden, true);
    assert.equal(host.observers.size, 1);
    const menu = host.document.createElement('div'); menu.id = 'extensionsMenu'; host.document.body.append(menu);
    host.mutate();
    runtime.api.onActivate();
    assert.equal(menu.children.length, 1);
    menu.remove();
    const replacement = host.document.createElement('div'); replacement.id = 'extensionsMenu'; host.document.body.append(replacement);
    host.mutate();
    assert.equal(replacement.children.length, 1);
    runtime.api.onDisable();
    host.mutate();
    assert.equal(replacement.children.length, 0);
    assert.equal(host.observers.size, 0);
    assert.equal(host.document.getElementById('st-little-phone-root'), undefined);
    assert.equal(JSON.stringify(metadata), before);
    runtime.api.onActivate();
    assert.equal(replacement.children.length, 1);
    assert.equal(host.observers.size, 1);
});

test('mount failure keeps wand entry and permits a clean retry', () => {
    const host = dom();
    const menu = host.document.createElement('div'); menu.id = 'extensionsMenu'; host.document.body.append(menu);
    const runtime = { ...host, console, Date, structuredClone, window: {}, clearTimeout() {}, clearInterval() {} };
    vm.createContext(runtime);
    vm.runInContext(main + `
        mount = () => { root = document.createElement('div'); root.id = ROOT_ID; document.body.append(root); throw new Error('broken control'); };
        globalThis.api = { onActivate, onDisable };
    `, runtime);
    assert.throws(() => runtime.api.onActivate(), /broken control/);
    assert.equal(host.document.getElementById('st-little-phone-root'), undefined);
    assert.equal(menu.children.length, 1);
    vm.runInContext('mount = () => { mounted = true; };', runtime);
    runtime.api.onActivate();
    assert.equal(menu.children.length, 1);
});

function bootRuntime(mockImport) {
    const host = dom();
    // Avoid the automatic load; exercise the real exported lifecycle functions.
    host.document.body = null;
    host.document.addEventListener = () => {};
    const runtime = { ...host, mockImport, console: {info() {}, error() {}}, setTimeout() { return 1; }, clearTimeout() {} };
    vm.createContext(runtime);
    vm.runInContext(boot + '\nglobalThis.api = {onActivate, onEnable, onDisable};', runtime);
    return runtime;
}

test('bootstrap coalesces load, disables during import, and reenables cached module', async () => {
    let resolveImport, imports = 0, activations = 0, disables = 0;
    const runtime = bootRuntime(() => { imports++; return new Promise(resolve => { resolveImport = resolve; }); });
    const first = runtime.api.onActivate();
    const second = runtime.api.onEnable();
    runtime.api.onDisable();
    resolveImport({ onActivate() { activations++; }, onDisable() { disables++; } });
    await Promise.all([first,second]);
    assert.equal(activations, 0);
    await runtime.api.onEnable();
    assert.equal(activations, 1);
    assert.equal(imports, 1);
    runtime.api.onDisable();
    assert.equal(disables, 1);
});

test('bootstrap retries failed import and failed activation instead of caching null', async () => {
    let calls = 0, starts = 0;
    const runtime = bootRuntime(() => {
        if (++calls === 1) return Promise.reject(new Error('network'));
        return Promise.resolve({ onActivate() { if (++starts === 1) throw new Error('UI'); } });
    });
    assert.equal(await runtime.api.onActivate(), null);
    assert.equal(await runtime.api.onEnable(), null);
    assert.ok(await runtime.api.onEnable());
    assert.equal(calls, 2);
    assert.equal(starts, 2);
});
