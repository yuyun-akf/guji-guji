import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const main = readFileSync(new URL('../index.js', import.meta.url), 'utf8').replaceAll('export function ', 'function ');
const boot = readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8')
    .replaceAll('export function ', 'function ')
    .replace("import('./index.js?v=0.8.12')", 'mockImport()');

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
        document: { body, createElement: tag => new Node(tag), createTextNode: value => {const text = new Node('#text');text.textContent=value;return text;}, getElementById: id => find(body,id) },
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
        setTimeout() { return 1; }, clearTimeout() {}, setInterval() {return 1;}, clearInterval() {} };
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

test('extension settings drawer is unique, opens phone, and toggles the real floating launcher', () => {
    const host=dom(),settings=host.document.createElement('div');
    settings.id='extensions_settings';host.document.body.append(settings);
    const stale=host.document.createElement('details');stale.id='gujiguji-extension-settings';settings.append(stale);
    const ctx={extensionSettings:{gujiguji:{}},chatMetadata:{},saveSettingsDebounced(){this.saved=(this.saved||0)+1;}};
    const runtime={...host,console,Date,structuredClone,
        window:{SillyTavern:{getContext:()=>ctx},addEventListener(){},removeEventListener(){}},
        setTimeout(){return 1;},clearTimeout(){},setInterval(){return 1;},clearInterval(){}};
    vm.createContext(runtime);
    vm.runInContext(main+'\nrender=()=>{};renderDiagnostics=()=>{};globalThis.api={onActivate,onDisable,updateLauncherVisibility,controls:()=>nodes};',runtime);
    runtime.api.onActivate();
    assert.equal(settings.children.length,1);
    const panel=host.document.getElementById('gujiguji-extension-settings');
    assert.notEqual(panel,stale,'replace a stale unthemed drawer after hot reload');
    assert.equal(panel.tagName,'div');
    assert.match(panel.querySelector('.inline-drawer-header').className,/inline-drawer-toggle/);
    assert.ok(panel.querySelector('.inline-drawer-icon'),'native SillyTavern theme chevron must be used');
    assert.ok(panel.querySelector('.inline-drawer-content'),'native extension body must inherit theme');
    assert.equal(typeof panel.querySelector('.menu_button').listeners.click,'function');
    const checkbox=host.document.getElementById('gujiguji-host-floating');
    assert.equal(checkbox.checked,false);
    const launcher=host.document.getElementById('gujiguji-floating-launcher');
    const importantWrites=[];
    launcher.matches=selector=>selector===':popover-open'&&launcher.popoverOpen===true;
    launcher.showPopover=()=>{launcher.popoverOpen=true;};
    launcher.hidePopover=()=>{launcher.popoverOpen=false;};
    launcher.style.setProperty=(name,value,priority)=>{importantWrites.push([name,value,priority]);
        launcher.style[({ 'z-index':'zIndex', 'pointer-events':'pointerEvents' })[name]||name]=value;};
    checkbox.checked=true;checkbox.listeners.change();
    assert.equal(ctx.extensionSettings.gujiguji.floatingLauncher,true);
    assert.equal(ctx.saved,1);
    assert.equal(launcher.hidden,false);
    assert.equal(launcher.style.display,'grid');
    assert.ok(importantWrites.some(([name,value,priority])=>name==='display'&&value==='grid'&&priority==='important'));
    assert.equal(launcher.style.position,'fixed');
    assert.equal(launcher.style.top,'auto');
    assert.equal(launcher.style.transform,'none');
    assert.equal(launcher.popover,'manual');
    assert.equal(launcher.popoverOpen,true,'put the control into the viewport top layer');
    assert.ok(launcher.querySelector('.lp-launcher-art'),'launcher should use the custom phone artwork');
    assert.match(host.document.getElementById('gujiguji-host-floating-status').textContent,/已开启/);
    launcher.remove();runtime.api.updateLauncherVisibility();
    assert.equal(host.document.getElementById('gujiguji-floating-launcher'),launcher,'reattach launcher if host/theme removes it');
    host.mutate();assert.equal(settings.children.length,1);
    checkbox.checked=false;checkbox.listeners.change();
    assert.equal(launcher.hidden,true);
    assert.equal(launcher.popoverOpen,false,'closing the switch removes the top-layer control');
    assert.equal(launcher.style.display,'none');
    runtime.api.onDisable();assert.equal(settings.children.length,0);
    const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');
    assert.match(css,/#gujiguji-floating-launcher\s*\{[\s\S]*?position:\s*fixed/);
    assert.match(css,/#gujiguji-floating-launcher\[hidden\]/);
});

test('launcher drag stores one normalized position on release, suppresses drag click, and clamps after resize', () => {
    const host=dom(),ctx={extensionSettings:{gujiguji:{floatingLauncher:true}},saved:0,
        saveSettingsDebounced(){this.saved++;}};
    const runtime={...host,console,Date,structuredClone,setTimeout(){return 1;},clearTimeout(){},
        window:{SillyTavern:{getContext:()=>ctx},innerWidth:360,innerHeight:720}};
    vm.createContext(runtime);
    vm.runInContext(main+'\nglobalThis.drag={enableLauncherDragging,positionLauncher};',runtime);
    const button=host.document.createElement('button');
    button.style.setProperty=(name,value)=>{button.style[name]=value;};
    button.getBoundingClientRect=()=>({left:Number.parseFloat(button.style.left)||292,
        top:Number.parseFloat(button.style.top)||582,width:54,height:54});
    const consumeClick=runtime.drag.enableLauncherDragging(button);
    const input=(pointerId,clientX,clientY)=>({pointerId,clientX,clientY,pointerType:'touch',isPrimary:true,
        preventDefault(){},button:0});
    button.listeners.pointerdown(input(1,312,600));
    button.listeners.pointermove(input(1,316,602));
    button.listeners.pointerup(input(1,316,602));
    assert.equal(ctx.saved,0,'tiny movement is still a tap');
    assert.equal(consumeClick(),false);
    button.listeners.pointerdown(input(2,312,600));
    button.listeners.pointermove(input(2,82,0));
    button.listeners.pointerup(input(2,82,0));
    assert.equal(ctx.saved,1,'save only once when dropped');
    assert.equal(consumeClick({detail:1}),true,'drag should not also click open the phone');
    assert.equal(consumeClick({detail:1}),false,'the next ordinary click must work');
    assert.ok(ctx.extensionSettings.gujiguji.floatingLauncherPosition.x<0.5);
    assert.equal(ctx.extensionSettings.gujiguji.floatingLauncherPosition.y,0,'clamp against the top edge');
    runtime.window.innerWidth=260;runtime.window.innerHeight=420;
    runtime.drag.positionLauncher(button);
    assert.ok(Number.parseFloat(button.style.left)>=8&&Number.parseFloat(button.style.left)<=198);
    assert.equal(button.style.top,'8px','normalized top position remains on screen after resize');
    const saved=ctx.saved,originalLeft=button.style.left;
    button.listeners.pointerdown(input(3,40,30));
    button.listeners.pointermove(input(3,240,390));
    button.listeners.pointercancel(input(3,240,390));
    assert.equal(ctx.saved,saved,'cancelled drag must not overwrite the previous position');
    assert.equal(button.style.left,originalLeft,'cancelled drag must restore the saved position');
});

test('launcher diagnostics distinguish missing, hidden, offscreen, and covered controls', () => {
    const host=dom(),ctx={extensionSettings:{gujiguji:{floatingLauncher:true}}};
    const runtime={...host,console,Date,structuredClone,
        window:{SillyTavern:{getContext:()=>ctx},innerWidth:360,innerHeight:720,
            getComputedStyle:button=>({display:button.style.display||'grid',visibility:'visible'})}};
    vm.createContext(runtime);
    vm.runInContext(main+'\nmounted=true;nodes={launcher:null};globalThis.probe=inspectLauncher;globalThis.logs=diagnostics;',runtime);
    assert.equal(runtime.probe('测试').state,'按钮未挂载');
    const button=host.document.createElement('button');button.id='gujiguji-floating-launcher';
    host.document.body.append(button);
    vm.runInContext('nodes.launcher=document.getElementById("gujiguji-floating-launcher")',runtime);
    button.hidden=true;button.style.display='none';
    assert.equal(runtime.probe('测试').state,'样式隐藏');
    button.hidden=false;button.style.display='grid';
    button.getBoundingClientRect=()=>({left:500,top:900,right:550,bottom:950,width:50,height:50});
    assert.equal(runtime.probe('测试').state,'尺寸为零或位置在屏幕外');
    button.getBoundingClientRect=()=>({left:280,top:570,right:330,bottom:620,width:50,height:50});
    const overlay=host.document.createElement('div');overlay.id='cover';
    host.document.elementFromPoint=()=>overlay;button.contains=target=>target===button;
    assert.equal(runtime.probe('测试').state,'按钮位置被其他元素占用');
    host.document.elementFromPoint=()=>button;
    assert.equal(runtime.probe('测试').state,'几何位置正常');
    assert.equal(runtime.logs[0].stage,'悬浮按钮诊断');
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
