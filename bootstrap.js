/**
 * GujiGuji diagnostic entry point.
 * This file deliberately avoids SillyTavern APIs until the main module loads.
 */
const DIAG_ID = 'gujiguji-bootstrap-diagnostic';
const ROOT_ID = 'st-little-phone-root';
const VERSION = '0.7.0';

let mainPromise = null;
let mainModule = null;
let enabled = true;
let checkTimer = null;
let detailNode = null;
let diagnosticNode = null;
let activationPromise = null;
let lifecycle = 0;

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
    const wand = document.getElementById('gujiguji-wand-entry');
    const launcher = document.getElementById('gujiguji-floating-launcher');
    if (mounted && wand?.querySelector('.gujiguji-wand-button')) {
        report('B4', '已加入魔法棒菜单：咕叽咕机。悬浮按钮默认关闭。');
        // Successful startup should not leave a floating diagnostic on screen.
        const token = lifecycle;
        setTimeout(() => { if (enabled && token === lifecycle) diagnosticNode?.remove(); }, 1600);
    } else if (launcher) {
        const rect = launcher.getBoundingClientRect();
        const style = getComputedStyle(launcher);
        const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        report(visible ? 'B4' : 'B3', visible
            ? '悬浮按钮已创建，但魔法棒入口尚未注册。请截图。'
            : '正在等待酒馆魔法棒菜单；若一直未出现，请截图此诊断框。');
    } else {
        report('B3', '主模块已加载，但没有发现手机界面（可能是初始化失败）');
    }
    if (enabled && !(mounted && wand?.querySelector('.gujiguji-wand-button'))) {
        checkTimer = setTimeout(checkInterface, 5000);
    }
}

async function loadMain() {
    if (!enabled) return null;
    if (activationPromise) return activationPromise;
    const token = lifecycle;
    if (!mainPromise) {
        report('B1', '入口脚本已运行，开始加载主模块');
        mainPromise = import('./index.js?v=0.7.0').then(module => {
            mainModule = module;
            return module;
        }).catch(error => {
            mainPromise = null;
            throw error;
        });
    }
    const attempt = mainPromise.then(module => {
            if (!enabled || token !== lifecycle) return null;
            report('B2', '主模块已加载，正在检查界面');
            module.onActivate?.();
            if (checkTimer) clearTimeout(checkTimer);
            checkTimer = setTimeout(checkInterface, 5000);
            return module;
        })
        .catch(error => {
            if (enabled && token === lifecycle) {
                report('B-ERR', `主模块载入或启动失败：${error?.message || error}`);
                console.error('[GujiGuji boot] Main module failed to load or start');
            }
            return null;
        }).finally(() => {
            if (activationPromise === attempt) activationPromise = null;
        });
    activationPromise = attempt;
    return attempt;
}

// Self-start and lifecycle hook both use the same idempotent loader.
if (document.body) void loadMain();
else document.addEventListener('DOMContentLoaded', () => { if (enabled) void loadMain(); }, { once: true });

export function onActivate() { enabled = true; return loadMain(); }
export function onEnable() {
    enabled = true;
    return loadMain();
}
export function onDisable() {
    enabled = false;
    lifecycle += 1;
    activationPromise = null;
    if (checkTimer) clearTimeout(checkTimer);
    checkTimer = null;
    diagnosticNode?.remove();
    if (mainModule) mainModule.onDisable?.();
}

