/**
 * GujiGuji v0.3.2 diagnostic entry point.
 * This file deliberately avoids SillyTavern APIs until the main module loads.
 */
const DIAG_ID = 'gujiguji-bootstrap-diagnostic';
const ROOT_ID = 'st-little-phone-root';
const VERSION = '0.3.2';

let mainPromise = null;
let mainModule = null;
let enabled = true;
let checkTimer = null;
let detailNode = null;
let diagnosticNode = null;

function redact(message) {
    return String(message ?? '未知错误')
        .replace(/Bearer\s+\S+/gi, 'Bearer [隐藏]')
        .replace(/\bsk-[A-Za-z0-9_-]{8,}/gi, '[隐藏的密钥]')
        .replace(/([?&](?:api[_-]?key|token|secret|password)=)[^&\s]+/gi, '$1[隐藏]')
        .slice(0, 180);
}

function ensureDiagnostic() {
    if (!document.body) return;
    if (diagnosticNode?.isConnected) return;

    const box = document.createElement('section');
    box.id = DIAG_ID;
    box.setAttribute('aria-label', `咕叽咕机 ${VERSION} 启动诊断`);
    box.style.cssText = [
        'position:fixed', 'right:10px', 'bottom:86px', 'z-index:2147483646',
        'max-width:min(300px,92vw)', 'padding:9px 11px', 'border-radius:13px',
        'background:#352748', 'color:#fff', 'box-shadow:0 5px 20px #24172e55',
        'font:12px/1.5 sans-serif', 'pointer-events:auto', 'overflow-wrap:anywhere',
    ].join(';');

    const heading = document.createElement('div');
    heading.textContent = `咕叽咕机 · 启动检查 ${VERSION}`;
    heading.style.cssText = 'font-weight:700;margin-bottom:4px;display:inline-block';
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = '×';
    dismiss.setAttribute('aria-label', '关闭启动诊断');
    dismiss.style.cssText = 'float:right;background:transparent;color:#fff;border:0;font-size:17px;cursor:pointer';
    dismiss.addEventListener('click', () => box.remove());

    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = 'B0 · 检测到启动入口';

    const hint = document.createElement('div');
    hint.textContent = '如果手机未出现，请截图这块诊断文字。';
    hint.style.cssText = 'opacity:.8;margin-top:3px;font-size:11px';

    box.append(heading, dismiss, status, hint);
    document.body.append(box);
    diagnosticNode = box;
    detailNode = status;
}

function report(stage, message) {
    ensureDiagnostic();
    const info = `${stage} · ${redact(message)}`;
    if (detailNode) detailNode.textContent = info;
    console.info('[GujiGuji boot]', info);
}

function checkInterface() {
    checkTimer = null;
    if (!enabled) return;
    const mounted = document.getElementById(ROOT_ID);
    const launcher = mounted?.querySelector('.lp-launcher');
    if (launcher) {
        const rect = launcher.getBoundingClientRect();
        const style = getComputedStyle(launcher);
        const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        report(visible ? 'B4' : 'B3', visible
            ? '手机按钮已创建。请找右下角的紫色 ☏，若仍看不到请截图。'
            : '手机按钮已创建，但布局不可见。请截图此诊断框。');
    } else {
        report('B3', '主模块已加载，但没有发现手机界面（可能是初始化失败）');
    }
}

async function loadMain() {
    if (!enabled) return null;
    if (mainPromise) return mainPromise;

    report('B1', '入口脚本已运行，开始加载主模块');
    mainPromise = import('./index.js')
        .then(module => {
            mainModule = module;
            if (!enabled) return module;
            report('B2', '主模块已加载，正在检查界面');
            module.onActivate?.();
            if (checkTimer) clearTimeout(checkTimer);
            checkTimer = setTimeout(checkInterface, 5000);
            return module;
        })
        .catch(error => {
            report('B-ERR', `主模块载入或启动失败：${error?.message || error}`);
            console.error('[GujiGuji boot] Main module failed to load or start');
            return null;
        });
    return mainPromise;
}

// Self-start and lifecycle hook both use the same idempotent loader.
if (document.body) void loadMain();
else document.addEventListener('DOMContentLoaded', () => { if (enabled) void loadMain(); }, { once: true });

export function onActivate() { if (enabled) void loadMain(); }
export function onEnable() {
    enabled = true;
    void loadMain().then(module => module?.onEnable?.());
}
export function onDisable() {
    enabled = false;
    if (checkTimer) clearTimeout(checkTimer);
    checkTimer = null;
    diagnosticNode?.remove();
    if (mainModule) mainModule.onDisable?.();
    else if (mainPromise) void mainPromise.then(module => module?.onDisable?.());
}
