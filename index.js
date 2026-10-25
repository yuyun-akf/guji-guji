/**
 * GujiGuji v0.4.0: a modular phone shell with isolated per-chat context.
 * No direct host-module imports; uses only the documented context surface.
 */

const ROOT_ID = 'st-little-phone-root';
const DATA_KEY = 'st_little_phone_v1';
const SETTINGS_KEY = 'gujiguji';
const WAND_ENTRY_ID = 'gujiguji-wand-entry';
const CONTEXT_MESSAGE_LIMIT = 24;
const CHARACTER_TEXT_LIMIT = 9000;
const DIAGNOSTIC_LIMIT = 24;
const GENERATION_TIMEOUT_MS = 120000;
const FRIEND_STATES = new Set(['friends', 'stranger', 'outgoing', 'incoming', 'blocked']);
const FRIEND_LABELS = {
    friends: '已是好友', stranger: '非好友', outgoing: '已发送好友申请',
    incoming: '收到好友申请', blocked: '已拉黑',
};

let root = null;
let nodes = null;
let mounted = false;
let busy = false;
let busyStartedAt = 0;
let activityTicker = null;
let busyJobId = 0;
let chatChangedHandler = null;
let listeningSource = null;
let listeningEvent = null;
let bootstrapTimer = null;
let wandAttempts = 0;
let wandEntry = null;
let extensionEnabled = true;
let statusText = '';
let statusKind = 'info';
let busyKind = '';
let activeScreen = 'home';
let lifecycleToken = 0;
const diagnostics = [];
let configWriteQueue = Promise.resolve();
const transientApiKeys = new Map();
const APP_ICONS = {chat:'💬',diagnostics:'🛠️',settings:'⚙️',calendar:'📅',theme:'🎨',album:'🖼️',shopping:'🛍️',takeout:'🥡'};
const SCREENS = new Set(['home', 'chat', 'settings', 'diagnostics', 'calendar', 'theme']);

function context() {
    try {
        const host = window.SillyTavern ?? (typeof SillyTavern !== 'undefined' ? SillyTavern : null);
        return host?.getContext?.() ?? null;
    } catch {
        return null;
    }
}

function floatLauncherEnabled() {
    return context()?.extensionSettings?.[SETTINGS_KEY]?.floatingLauncher === true;
}

function updateLauncherVisibility() {
    if (nodes?.launcher) nodes.launcher.hidden = !floatLauncherEnabled();
    if (nodes?.floatingLauncher) nodes.floatingLauncher.checked = floatLauncherEnabled();
}

function setFloatLauncherEnabled(value) {
    const ctx = context();
    if (!ctx?.extensionSettings || typeof ctx.saveSettingsDebounced !== 'function') {
        setStatus('酒馆设置接口尚未就绪，请稍后再试。', 'error');
        updateLauncherVisibility();
        return;
    }
    if (!ctx.extensionSettings[SETTINGS_KEY] || typeof ctx.extensionSettings[SETTINGS_KEY] !== 'object') {
        ctx.extensionSettings[SETTINGS_KEY] = {};
    }
    ctx.extensionSettings[SETTINGS_KEY].floatingLauncher = Boolean(value);
    ctx.saveSettingsDebounced();
    updateLauncherVisibility();
    setStatus(value ? '已开启悬浮按钮；魔法棒入口仍然可用。' : '已关闭悬浮按钮；请从魔法棒进入咕叽咕机。');
}

function themeData() {
    const theme = context()?.extensionSettings?.[SETTINGS_KEY]?.theme;
    return theme && typeof theme === 'object' ? theme : {};
}
function applyTheme() {
    if (!root) return;
    const theme = themeData();
    root.dataset.font = ['system','serif','rounded'].includes(theme.font) ? theme.font : 'system';
    root.style.setProperty('--lp-wallpaper', theme.wallpaper?.startsWith('data:image/') ? 'url("' + theme.wallpaper + '")' : 'none');
    for (const span of root.querySelectorAll('[data-lp-icon]')) {
        span.textContent = typeof theme.icons?.[span.dataset.lpIcon] === 'string' ? theme.icons[span.dataset.lpIcon] : APP_ICONS[span.dataset.lpIcon];
    }
    if (nodes?.themeFont) nodes.themeFont.value = root.dataset.font;
    if (nodes?.themeIcons) {
        for (const input of nodes.themeIcons.querySelectorAll('[data-theme-icon]')) {
            input.value = theme.icons?.[input.dataset.themeIcon] || APP_ICONS[input.dataset.themeIcon];
        }
    }
}
function changeTheme(partial) {
    const ctx = context();
    if (!ctx?.extensionSettings || !ctx.saveSettingsDebounced) return setStatus('保存主题失败', 'error');
    const settings = ctx.extensionSettings[SETTINGS_KEY] ||= {};
    settings.theme = { ...(settings.theme || {}), ...partial };
    ctx.saveSettingsDebounced();
    applyTheme();
    setStatus('已保存');
}
function loadWallpaper(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return setStatus('请选择图片文件', 'error');
    if (file.size > 750 * 1024) return setStatus('图片不能超过 750KB', 'error');
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') changeTheme({wallpaper:reader.result}); };
    reader.onerror = () => setStatus('读取图片失败', 'error');
    reader.readAsDataURL(file);
}
function apiSessionId(ctx) {
    return String(ctx?.characterId ?? 'none') + '::' + String(ctx?.chatId ?? ctx?.getCurrentChatId?.() ?? 'default');
}
function readApiOptions(data) {
    const cfg = data?.config?.api || {};
    return {mode:cfg.mode === 'custom' ? 'custom' : 'inherit',
        url:typeof cfg.url === 'string' ? cfg.url : '',
        model:typeof cfg.model === 'string' ? cfg.model : '',
        maxTokens:Number.isFinite(Number(cfg.maxTokens)) ? Math.max(32,Math.min(4096,Number(cfg.maxTokens))) : 320};
}
function normalizeApiUrl(value) {
    let url;
    try { url = new URL(String(value || '').trim()); } catch { throw new Error('API 地址无效'); }
    if (!['https:','http:'].includes(url.protocol)) throw new Error('API 地址须以 HTTPS 开头');
    if (url.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('远程 API 请使用 HTTPS');
    if (url.search || url.hash) throw new Error('请填写不含查询参数的 API 地址');
    url.pathname = url.pathname.replace(/\/+$/,'').replace(/\/chat\/completions$/,'') || '/';
    return url.toString().replace(/\/$/,'');
}
async function phoneGenerate(ctx, options, data) {
    const cfg = readApiOptions(data);
    if (cfg.mode !== 'custom') {
        if (typeof ctx?.generateRaw !== 'function') throw new Error('酒馆生成接口不可用');
        return ctx.generateRaw(options);
    }
    if (!ctx?.ChatCompletionService?.sendRequest) throw new Error('酒馆独立 API 接口不可用');
    const key = transientApiKeys.get(apiSessionId(ctx));
    if (!key) throw new Error('独立 API 密钥未设置，请在「设置」中填写');
    const url = normalizeApiUrl(cfg.url);
    if (!cfg.model.trim()) throw new Error('请填写独立 API 模型名称');
    const prompts = Array.isArray(options.prompt) ? options.prompt : [{role:'user',content:String(options.prompt || '')}];
    const messages = [{role:'system',content:String(options.systemPrompt || '')},
        ...prompts.map(m=>({role:m.role==='assistant'?'assistant':'user',content:String(m.content || '')}))];
    const result = await ctx.ChatCompletionService.sendRequest({
        chat_completion_source:'custom',custom_url:url,
        custom_include_headers:{Authorization:'Bearer ' + key},
        model:cfg.model.trim(),messages,stream:false,max_tokens:cfg.maxTokens,temperature:0.85
    });
    return typeof result === 'string' ? result : result?.content || '';
}
async function savePhoneApi() {
    const ctx = context();
    if (!selectedCharacter(ctx) || !nodes) return;
    const mode = nodes.apiMode.value;
    const url = nodes.apiUrl.value.trim();
    const model = nodes.apiModel.value.trim();
    const key = nodes.apiKey.value.trim();
    if (mode === 'custom') {
        try { normalizeApiUrl(url); } catch(e) { return setStatus(e.message,'error'); }
        if (!model) return setStatus('请填写模型名称','error');
        if (!key && !transientApiKeys.has(apiSessionId(ctx))) return setStatus('请填写 API 密钥','error');
    }
    const data = structuredClone(readData(ctx));
    data.config ||= {};
    data.config.api = {mode,url,model,maxTokens:320};
    try {
        await writeData(ctx,data);
        if (key) transientApiKeys.set(apiSessionId(ctx),key);
        nodes.apiKey.value = '';
        setStatus('连接配置已保存');
        loadPhoneApiUI();
    } catch(e) { setStatus(recordError('保存 API 配置',e),'error'); }
}
function loadPhoneApiUI() {
    if (!nodes?.apiMode) return;
    const ctx = context();
    const cfg = readApiOptions(readData(ctx));
    nodes.apiMode.value = cfg.mode;
    nodes.apiUrl.value = cfg.url;
    nodes.apiModel.value = cfg.model;
    nodes.apiKey.value = '';
    nodes.customApiFields.hidden = cfg.mode !== 'custom';
    nodes.apiKeyState.textContent = transientApiKeys.has(apiSessionId(ctx)) ? '密钥已在本次页面中设置' : '未设置密钥';
    updateApiInfo();
}
function updateApiInfo() {
    if (!nodes?.apiInfo) return;
    const ctx = context();
    const settings = ctx?.chatCompletionSettings || {};
    let detected = '';
    try { detected = ctx?.getChatCompletionModel?.(settings) || ''; } catch { /* Keep settings visible if model lookup fails */ }
    const model = detected || settings.custom_model || settings.openai_model || settings.model || '未识别';
    nodes.apiInfo.textContent = '连接：' + (ctx?.mainApi || '未连接') + ' · 模型：' + (typeof model === 'string' ? model : '当前所选模型');
}
function createCheckRow(entry, kind, checked) {
    const label = document.createElement('label');
    label.className = 'lp-config-row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.configKind = kind;
    input.dataset.configId = entry.id;
    input.checked = checked;
    const title = document.createElement('span');
    title.textContent = entry.name;
    label.append(input, title);
    return label;
}
function availablePresetEntries(name, ctx) {
    const manager = ctx?.getPresetManager?.('openai');
    const preset = manager?.getCompletionPresetByName?.(name);
    return (preset?.prompts || []).filter(p => typeof p.content === 'string' && p.content.trim())
        .map(p => ({id:String(p.identifier || p.name),name:p.name || p.identifier || '未命名条目'}));
}
async function populateConfigLists() {
    if (!nodes?.presetSource || !nodes?.worldSource) return;
    const ctx = context();
    updateApiInfo();
    const presets = ctx?.getPresetManager?.('openai')?.getAllPresets?.() || [];
    const worlds = ctx?.getWorldInfoNames?.() || [];
    const oldPreset = nodes.presetSource.value;
    const oldWorld = nodes.worldSource.value;
    nodes.presetSource.replaceChildren();
    nodes.worldSource.replaceChildren();
    for (const [select, values] of [[nodes.presetSource,presets],[nodes.worldSource,worlds]]) {
        for (const name of values) {
            const option = document.createElement('option');
            option.value = name; option.textContent = name; select.append(option);
        }
    }
    if (presets.includes(oldPreset)) nodes.presetSource.value = oldPreset;
    if (worlds.includes(oldWorld)) nodes.worldSource.value = oldWorld;
    showPresetEntries();
    await showWorldEntries();
}
function showPresetEntries() {
    if (!nodes?.presetEntries) return;
    const ctx = context();
    const name = nodes.presetSource.value;
    const selected = readData(ctx)?.config?.presetEntries || [];
    const entries = availablePresetEntries(name, ctx);
    nodes.presetEntries.replaceChildren();
    if (!entries.length) nodes.presetEntries.textContent = '没有可选的文本条目';
    for (const entry of entries) nodes.presetEntries.append(createCheckRow(entry,'preset',selected.some(x=>x.preset===name && x.id===entry.id)));
}
async function showWorldEntries() {
    if (!nodes?.worldEntries) return;
    const ctx = context();
    const name = nodes.worldSource.value;
    nodes.worldEntries.replaceChildren();
    if (!name || !ctx?.loadWorldInfo) { nodes.worldEntries.textContent = '没有可用的世界书'; return; }
    try {
        const book = await ctx.loadWorldInfo(name);
        if (name !== nodes.worldSource.value) return;
        const entries = Object.entries(book?.entries || {}).filter(([,value]) => typeof value?.content === 'string' && value.content.trim());
        const selected = readData(ctx)?.config?.worldEntries || [];
        if (!entries.length) nodes.worldEntries.textContent = '没有可选条目';
        for (const [key,value] of entries) {
            const id = String(value.uid ?? key);
            nodes.worldEntries.append(createCheckRow({id,name:value.comment || value.key?.join('、') || id},'world',selected.some(x=>x.book===name && x.id===id)));
        }
    } catch (error) { nodes.worldEntries.textContent = '读取失败：' + redactDiagnostic(error?.message || error); }
}
function onConfigChange(input) {
    const kind = input.dataset.configKind;
    const id = input.dataset.configId;
    const source = kind === 'preset' ? nodes.presetSource.value : nodes.worldSource.value;
    const field = kind === 'preset' ? 'presetEntries' : 'worldEntries';
    const key = kind === 'preset' ? 'preset' : 'book';
    const checked = input.checked;
    const snapshot = context();
    const metadata = snapshot?.chatMetadata;
    const characterId = snapshot?.characterId;
    configWriteQueue = configWriteQueue.then(async () => {
        const ctx = context();
        if (!selectedCharacter(ctx) || ctx.chatMetadata !== metadata || ctx.characterId !== characterId) return;
        const data = structuredClone(readData(ctx));
        data.config ||= {};
        const selected = Array.isArray(data.config[field]) ? data.config[field] : [];
        data.config[field] = selected.filter(x=>!(x[key] === source && x.id === id));
        if (checked) data.config[field].push({[key]:source,id});
        await writeData(ctx,data);
    }).catch(e => setStatus(recordError('保存条目选择',e),'error'));
}
function localDateTime() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
}

function selectedCharacter(ctx) {
    if (!ctx || ctx.groupId) return null;
    if (ctx.characterId === undefined || ctx.characterId === null) return null;
    const index = Number(ctx.characterId);
    if (!Number.isInteger(index) || index < 0) return null;
    return ctx.characters?.[index] ?? null;
}

function newData() {
    return { version: 1, storyTime: localDateTime(), messages: [], friendship: { state: 'friends' } };
}

function readData(ctx) {
    const value = ctx?.chatMetadata?.[DATA_KEY];
    if (!value || value.version !== 1 || !Array.isArray(value.messages)) return newData();
    // Existing v0.1 chats remain friends. Preserve unknown metadata fields.
    const friendState = value.friendship?.state;
    return {
        ...value,
        friendship: FRIEND_STATES.has(friendState) ? value.friendship : { state: 'friends' },
    };
}

function friendshipState(data) {
    return FRIEND_STATES.has(data?.friendship?.state) ? data.friendship.state : 'friends';
}

async function writeData(ctx, data) {
    if (!ctx?.chatMetadata || typeof ctx.saveMetadata !== 'function') {
        throw new Error('当前酒馆未提供可用的聊天存档接口。');
    }
    const previous = ctx.chatMetadata[DATA_KEY];
    ctx.chatMetadata[DATA_KEY] = data;
    try {
        await ctx.saveMetadata();
    } catch (error) {
        // A rejected persistence call must not leave an unsaved phantom
        // message that would be duplicated by the user's next send/retry.
        if (ctx.chatMetadata[DATA_KEY] === data) {
            if (previous === undefined) delete ctx.chatMetadata[DATA_KEY];
            else ctx.chatMetadata[DATA_KEY] = previous;
        }
        throw error;
    }
}

function captureSession(ctx) {
    return { metadata: ctx.chatMetadata, characterId: ctx.characterId, groupId: ctx.groupId, lifecycleToken };
}

function sameSession(snapshot) {
    const ctx = context();
    return Boolean(mounted && ctx && lifecycleToken === snapshot.lifecycleToken && ctx.chatMetadata === snapshot.metadata
        && ctx.characterId === snapshot.characterId && ctx.groupId === snapshot.groupId);
}

function getCharacterName(char) {
    return String(char?.data?.name || char?.name || '角色');
}

function shortText(value, maxLength = CHARACTER_TEXT_LIMIT) {
    if (typeof value !== 'string') return '';
    return value.slice(0, maxLength).trim();
}

async function composePhonePrompt(ctx, char, data) {
    const parts = [createSystemPrompt(char, data)];
    const selectedPresets = Array.isArray(data?.config?.presetEntries) ? data.config.presetEntries : [];
    if (selectedPresets.length) {
        const manager = ctx?.getPresetManager?.('openai');
        for (const item of selectedPresets) {
            const preset = manager?.getCompletionPresetByName?.(item.preset);
            const entry = preset?.prompts?.find(p => String(p.identifier || p.name) === item.id);
            if (!entry || !entry.content) throw new Error('选中的预设条目不可用：' + item.preset + '/' + item.id);
            parts.push('[手机预设 · ' + (entry.name || item.id) + ']\n' + entry.content);
        }
    }
    const selectedBooks = Array.isArray(data?.config?.worldEntries) ? data.config.worldEntries : [];
    for (const bookName of [...new Set(selectedBooks.map(x => x.book))]) {
        if (typeof ctx?.loadWorldInfo !== 'function') throw new Error('酒馆世界书接口不可用');
        const book = await ctx.loadWorldInfo(bookName);
        const entries = book?.entries || {};
        for (const selected of selectedBooks.filter(x => x.book === bookName)) {
            const entry = entries[selected.id] ?? Object.values(entries).find(e => String(e.uid) === selected.id);
            if (!entry || !entry.content) throw new Error('选中的世界书条目不可用：' + bookName + '/' + selected.id);
            parts.push('[手机世界书 · ' + (entry.comment || selected.id) + ']\n' + entry.content);
        }
    }
    return parts.join('\n\n');
}

function createSystemPrompt(char, data) {
    const info = char.data || char;
    const profile = [
        ['角色描述', info.description],
        ['角色性格', info.personality],
        ['角色场景设定', info.scenario],
    ].map(([label, value]) => `${label}:\n${shortText(value, 3500)}`)
        .filter(line => !line.endsWith(':\n'))
        .join('\n\n')
        .slice(0, CHARACTER_TEXT_LIMIT);
    const relationEvents = (Array.isArray(data.friendEvents) ? data.friendEvents : [])
        .slice(-8)
        .map(event => `${event.storyTime || '未知时间'}：${FRIEND_LABELS[event.from] || '未知'} → ${FRIEND_LABELS[event.to] || '未知'}`)
        .join('；');

    return [
        `你正在扮演角色「${getCharacterName(char)}」，与 user 通过一部虚构的手机进行私聊。`,
        '只回复这一角色实际发出的手机消息。不要写旁白、动作描写、镜头说明、心理活动、双方对话或 user 的行为。',
        '不要替 user 发言，也不要强行推进关系。角色只知道设定和这段手机聊天中已提供的事实。',
        '手机聊天时间由玩家设置，与正文时间可能不同。不得假定角色已经经历了这个日期之后的事件。',
        `当前手机故事时间：${data.storyTime.replace('T', ' ')}`,
        `当前好友关系：${FRIEND_LABELS[friendshipState(data)]}`,
        relationEvents ? `当前存档已发生的好友关系变化：${relationEvents}` : '',
        profile,
    ].filter(Boolean).join('\n\n');
}

function buildPrompt(data) {
    // Official generateRaw accepts Chat Completion messages and converts them
    // for the selected generation mode. Preserve user/assistant roles.
    return data.messages.slice(-CONTEXT_MESSAGE_LIMIT)
        .filter(message => typeof message.text === 'string' && ['user', 'character'].includes(message.from))
        .map(message => ({
            role: message.from === 'character' ? 'assistant' : 'user',
            content: message.text,
        }));
}

function setStatus(message, kind = 'info') {
    statusText = message || '';
    statusKind = kind;
    if (nodes?.status) {
        nodes.status.textContent = statusText;
        nodes.status.dataset.kind = kind;
    }
    if (nodes?.settingsStatus) {
        nodes.settingsStatus.textContent = statusText;
        nodes.settingsStatus.dataset.kind = kind;
    }
    if (nodes && !busy) nodes.diagnosticState.textContent = statusText || '空闲：当前没有正在运行的请求。';
}

function redactDiagnostic(text) {
    return String(text || '未知错误')
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [已隐藏]')
        .replace(/\bsk-[A-Za-z0-9_-]{8,}/gi, '[已隐藏的密钥]')
        .replace(/([?&](?:api[_-]?key|token|secret|password|authorization)=)[^&\s]+/gi, '$1[已隐藏]')
        .replace(/\b(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*\S+/gi, '[已隐藏的凭证]')
        .slice(0, 600);
}

function recordActivity(stage, detail, kind = 'info', code = '') {
    const entry = {
        at: new Date().toLocaleTimeString(), stage,
        code: code ? redactDiagnostic(code) : '', detail: redactDiagnostic(detail), kind,
    };
    diagnostics.unshift(entry);
    diagnostics.length = Math.min(diagnostics.length, DIAGNOSTIC_LIMIT);
    renderDiagnostics();
    return entry;
}

function recordError(stage, error) {
    const message = String(error?.message || error);
    const statusMatch = message.match(/(?:response\s+status|HTTP\s*|status[:\s]+)([45]\d\d)/i);
    const code = error?.status ?? error?.statusCode ?? error?.code ?? error?.cause?.status ?? statusMatch?.[1] ?? '';
    const detail = redactDiagnostic(message);
    const category = error?.name && error.name !== 'Error' ? ' [' + redactDiagnostic(error.name) + ']' : '';
    const stack = error?.stack ? '\n' + redactDiagnostic(String(error.stack).split('\n').slice(1, 3).join('\n')) : '';
    const entry = recordActivity(stage, detail + category + stack, 'error', code);
    console.error('[GujiGuji]', stage, entry.detail);
    return `操作失败：${detail}${code ? `（${redactDiagnostic(code)}）` : ''}`;
}

function renderDiagnostics() {
    if (!nodes?.diagnostics) return;
    nodes.diagnostics.replaceChildren();
    const failures = diagnostics.filter(entry => entry.kind === 'error').length;
    nodes.diagnosticToggle.textContent = failures ? `⚠ 查看日志（${failures} 条错误）` : '查看运行日志';
    nodes.diagnosticToggle.classList.toggle('lp-has-error', failures > 0);
    nodes.homeLogCount.textContent = failures ? `${failures} 条错误` : `${diagnostics.length} 条记录`;
    if (!diagnostics.length) {
        const empty = document.createElement('p');
        empty.textContent = '目前没有运行记录。发送消息后会显示请求开始、结束或错误。';
        nodes.diagnostics.append(empty);
        return;
    }
    for (const entry of diagnostics) {
        const item = document.createElement('p');
        item.className = `lp-log-${entry.kind}`;
        item.textContent = `[${entry.at}] ${entry.stage}${entry.code ? ` · ${entry.code}` : ''}\n${entry.detail}`;
        nodes.diagnostics.append(item);
    }
}

async function testPhoneApi() {
    const ctx = context();
    if (busy) return;
    if (typeof ctx?.generateRaw !== 'function' && !ctx?.ChatCompletionService?.sendRequest) return setStatus('生成接口不可用','error');
    const job = startBusy('reply');
    recordActivity('连接测试', '测试原始生成请求，不写入聊天记录');
    try {
        const answer = await generateWithTimeout(ctx, {systemPrompt:'仅回复 OK',prompt:'请回复 OK'}, readData(ctx));
        if (typeof answer !== 'string' || !answer.trim()) throw new Error('API 返回空内容');
        recordActivity('连接测试成功', '收到模型响应','success');
        setStatus('连接测试成功');
    } catch (error) { setStatus(recordError('连接测试',error),'error'); }
    finally { finishBusy(job); }
}

function setScreen(screen) {
    if (!SCREENS.has(screen) || !nodes) return;
    const previous = activeScreen;
    activeScreen = screen;
    for (const section of root.querySelectorAll('[data-lp-screen]')) {
        section.hidden = section.dataset.lpScreen !== screen;
    }
    nodes.back.hidden = screen === 'home';
    const titles = { home: '咕叽咕机', chat: '咕叽聊', settings: '设置', diagnostics: '运行日志', calendar: '日历', theme: '主题' };
    nodes.title.textContent = titles[screen];
    if (screen === 'diagnostics') renderDiagnostics();
    if (screen === 'settings' && screen !== previous) { loadPhoneApiUI(); void populateConfigLists(); }
    if (screen === 'theme') applyTheme();
    if (screen === 'chat') nodes.messages.scrollTop = nodes.messages.scrollHeight;
}

function updateBusy() {
    if (!nodes) return;
    const ctx = context();
    const ready = Boolean(selectedCharacter(ctx));
    const data = ready ? readData(ctx) : null;
    const isFriend = data && friendshipState(data) === 'friends';
    nodes.send.disabled = busy || !isFriend;
    nodes.input.disabled = busy || !isFriend;
    nodes.time.disabled = busy || !ready;
    nodes.send.textContent = busy ? '等待回复…' : '发送并生成';
    nodes.activity.hidden = !busy;
    const elapsed = busy ? `（已等待 ${Math.floor((Date.now() - busyStartedAt) / 1000)} 秒）` : '';
    nodes.activity.textContent = `${busyKind === 'friend' ? '正在等待角色处理好友申请…' : '对方正在输入…'}${elapsed}`;
    nodes.diagnosticState.textContent = busy
        ? `${busyKind === 'friend' ? '好友申请处理中' : '正在请求模型回复'} · ${Math.floor((Date.now() - busyStartedAt) / 1000)} 秒`
        : statusText || '空闲：当前没有正在运行的请求。';
    const lastMessage = data?.messages?.at(-1);
    const canRetry = Boolean(isFriend && !busy && lastMessage?.from === 'user');
    nodes.retry.hidden = !canRetry;
    nodes.retry.disabled = busy;
}

function startBusy(kind) {
    const jobId = ++busyJobId;
    busy = true;
    busyKind = kind;
    busyStartedAt = Date.now();
    if (activityTicker) clearInterval(activityTicker);
    activityTicker = setInterval(updateBusy, 1000);
    updateBusy();
    return jobId;
}

function finishBusy(jobId) {
    if (jobId !== busyJobId) return;
    busy = false;
    busyKind = '';
    if (activityTicker) clearInterval(activityTicker);
    activityTicker = null;
    updateBusy();
}

async function generateWithTimeout(ctx, options, data) {
    let timer = null;
    try {
        return await Promise.race([
            phoneGenerate(ctx, options, data),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('生成超过 120 秒仍未返回，可能是 API 超时或连接中断。')), GENERATION_TIMEOUT_MS);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function renderMessages(data) {
    nodes.messages.replaceChildren();
    if (!data.messages.length) {
        const empty = document.createElement('div');
        empty.className = 'lp-empty';
        empty.textContent = '这里还没有消息。\n试着发一句话，开启属于你们的手机聊天吧。';
        nodes.messages.append(empty);
        return;
    }

    const fragment = document.createDocumentFragment();
    for (const message of data.messages) {
        if (typeof message?.text !== 'string') continue;
        const item = document.createElement('div');
        item.className = `lp-message ${message.from === 'system' ? 'lp-system' : message.from === 'character' ? 'lp-theirs' : 'lp-mine'}`;
        const bubble = document.createElement('div');
        bubble.className = 'lp-bubble';
        bubble.textContent = message.text;
        const stamp = document.createElement('div');
        stamp.className = 'lp-message-time';
        stamp.textContent = String(message.storyTime || '').replace('T', ' ');
        item.append(bubble, stamp);
        fragment.append(item);
    }
    if (busy && busyKind === 'reply') {
        const typing = document.createElement('div');
        typing.className = 'lp-message lp-theirs lp-typing';
        typing.textContent = '●  ●  ●  对方正在输入…';
        fragment.append(typing);
    }
    nodes.messages.append(fragment);
    nodes.messages.scrollTop = nodes.messages.scrollHeight;
}

function renderFriendship(data) {
    if (!nodes?.friendActions) return;
    nodes.friendActions.replaceChildren();
    const state = data ? friendshipState(data) : null;
    nodes.friendLabel.textContent = state ? FRIEND_LABELS[state] : '暂无联系人';
    nodes.friendLabel.dataset.state = state || '';
    nodes.friendSetup.disabled = !state || busy;
    if (state) nodes.friendSetup.value = state;

    const options = {
        friends: [['remove', '删除好友'], ['block', '拉黑']],
        stranger: [['add', '添加好友'], ['block', '拉黑']],
        outgoing: [['review', '重试申请'], ['cancel', '撤回申请'], ['block', '拉黑']],
        incoming: [['accept', '同意申请'], ['decline', '拒绝'], ['block', '拉黑']],
        blocked: [['unblock', '解除拉黑']],
    };
    for (const [action, label] of options[state] || []) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.friendAction = action;
        button.textContent = label;
        button.disabled = busy;
        nodes.friendActions.append(button);
    }
}

function render() {
    if (!mounted || !nodes) return;
    const ctx = context();
    const char = selectedCharacter(ctx);
    const data = char ? readData(ctx) : null;

    nodes.name.textContent = char ? getCharacterName(char) : '请先选择角色';
    nodes.subtitle.textContent = char ? '故事中的小手机 · 独立聊天' : '请先选择单人角色存档';
    nodes.homeCharacter.textContent = char ? `与 ${getCharacterName(char)} 的故事` : '等待进入角色存档';
    nodes.homeTime.textContent = (data?.storyTime || localDateTime()).replace('T', ' ');
    nodes.homeMessageCount.textContent = `${data?.messages?.filter(message => message.from !== 'system').length || 0} 条聊天记录`;
    nodes.time.value = data?.storyTime || localDateTime();
    updateApiInfo();
    renderFriendship(data);
    updateLauncherVisibility();
    applyTheme();
    if (data) renderMessages(data);
    else {
        nodes.messages.replaceChildren();
        const message = document.createElement('div');
        message.className = 'lp-empty';
        message.textContent = '打开一张单人角色卡的聊天存档后再使用小手机。';
        nodes.messages.append(message);
    }
    updateBusy();
    setStatus(statusText, statusKind);
    setScreen(activeScreen);
}

function makeMessage(from, text, storyTime) {
    return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        from,
        text,
        storyTime,
        createdAt: new Date().toISOString(),
    };
}

async function saveStoryTime() {
    const ctx = context();
    if (!selectedCharacter(ctx) || busy) return;
    const session = captureSession(ctx);
    const time = nodes.time.value;
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(time)) {
        setStatus('请选择有效的故事日期和时间。');
        return;
    }
    const data = structuredClone(readData(ctx));
    data.storyTime = time;
    try {
        await writeData(ctx, data);
        if (sameSession(session)) {
            setStatus('手机时间已保存。它不会自动改动正文时间。');
            render();
        }
    } catch (error) {
        setStatus(recordError('保存故事时间', error), 'error');
    }
}

async function runReply(ctx, char, data, session, existingJob = null) {
    const job = existingJob ?? startBusy('reply');
    if (sameSession(session)) renderMessages(data);
    setStatus('正在生成角色回复，请稍候…');
    recordActivity('开始生成', '已将当前手机对话交给酒馆生成接口，正在等待模型返回。');
    try {
        const systemPrompt = await composePhonePrompt(ctx, char, data);
        recordActivity('生成配置', '使用当前酒馆连接' + (ctx?.mainApi ? ' · ' + ctx.mainApi : '') + '；手机历史 ' + buildPrompt(data).length + ' 条；单独预设条目 ' + (data?.config?.presetEntries?.length || 0) + ' 条；世界书条目 ' + (data?.config?.worldEntries?.length || 0) + ' 条。');
        const result = await generateWithTimeout(ctx, {
            systemPrompt,
            prompt: buildPrompt(data),
        }, data);
        if (!sameSession(session)) return;
        const reply = typeof result === 'string' ? result.trim() : '';
        if (!reply) throw new Error('模型返回了空消息或不支持的回复类型。');
        data.messages.push(makeMessage('character', reply, data.storyTime));
        await writeData(ctx, data);
        recordActivity('生成成功', '已收到角色回复并保存到当前手机聊天存档。', 'success');
        if (sameSession(session)) setStatus('已收到回复。');
    } catch (error) {
        const message = recordError('生成角色回复', error);
        if (sameSession(session)) setStatus(message, 'error');
    } finally {
        finishBusy(job);
        if (mounted) render();
    }
}

async function retryLastReply() {
    if (!mounted || busy) return;
    const ctx = context();
    const char = selectedCharacter(ctx);
    if (!char) return;
    const data = structuredClone(readData(ctx));
    if (friendshipState(data) !== 'friends' || data.messages.at(-1)?.from !== 'user') return;
    if (typeof ctx.generateRaw !== 'function' && !ctx.ChatCompletionService?.sendRequest) {
        setStatus(recordError('重试生成', new Error('当前酒馆未提供生成接口。')), 'error');
        return;
    }
    await runReply(ctx, char, data, captureSession(ctx));
}

async function send() {
    if (!mounted || busy) return;
    const ctx = context();
    const char = selectedCharacter(ctx);
    const content = nodes.input.value.trim();
    if (!char || !content || friendshipState(readData(ctx)) !== 'friends') return;
    if (typeof ctx.generateRaw !== 'function' && !ctx.ChatCompletionService?.sendRequest) {
        setStatus(recordError('生成前检查', new Error('当前酒馆未提供生成接口。')), 'error');
        return;
    }

    const session = captureSession(ctx);
    const data = structuredClone(readData(ctx));
    data.messages.push(makeMessage('user', content, data.storyTime));

    const job = startBusy('reply');
    recordActivity('发送消息', '正在将玩家消息保存到当前手机存档。');
    setStatus('正在发送消息，并将自动生成角色回复…');
    try {
        await writeData(ctx, data);
        if (!sameSession(session)) return;
        nodes.input.value = '';
        await runReply(ctx, char, data, session, job);
    } catch (error) {
        const message = recordError('保存用户消息', error);
        if (sameSession(session)) setStatus(message, 'error');
    } finally {
        finishBusy(job);
        if (mounted) render();
    }
}

function rememberFriendship(data, nextState, notice) {
    const from = friendshipState(data);
    data.friendship = { state: nextState, changedAt: new Date().toISOString() };
    const events = Array.isArray(data.friendEvents) ? data.friendEvents.slice(-39) : [];
    events.push({ from, to: nextState, storyTime: data.storyTime, at: new Date().toISOString() });
    data.friendEvents = events;
    if (notice) data.messages.push(makeMessage('system', notice, data.storyTime));
}

async function changeFriendship(nextState, notice) {
    if (!mounted || busy || !FRIEND_STATES.has(nextState)) return false;
    const ctx = context();
    if (!selectedCharacter(ctx)) return false;
    const session = captureSession(ctx);
    const data = structuredClone(readData(ctx));
    if (friendshipState(data) === nextState) return false;
    rememberFriendship(data, nextState, notice);
    const job = startBusy('friend');
    try {
        await writeData(ctx, data);
        if (!sameSession(session)) return false;
        recordActivity('好友关系', `当前状态已更新为：${FRIEND_LABELS[nextState]}。`, 'success');
        setStatus(`好友关系已更新：${FRIEND_LABELS[nextState]}。`);
        return true;
    } catch (error) {
        const message = recordError('保存好友关系', error);
        if (sameSession(session)) setStatus(message, 'error');
        return false;
    } finally {
        finishBusy(job);
        if (mounted) render();
    }
}

async function reviewOutgoingRequest() {
    if (!mounted || busy) return;
    const ctx = context();
    const char = selectedCharacter(ctx);
    const data = structuredClone(readData(ctx));
    if (!char || friendshipState(data) !== 'outgoing') return;
    if (typeof ctx.generateRaw !== 'function' && !ctx.ChatCompletionService?.sendRequest) {
        setStatus(recordError('处理好友申请', new Error('酒馆未提供生成接口，申请将保持待处理。')), 'error');
        return;
    }
    const session = captureSession(ctx);
    const job = startBusy('friend');
    renderFriendship(data);
    setStatus('好友申请已发出，正在等待角色决定…');
    recordActivity('好友申请', '已请求模型判断角色是否接受好友申请。');
    try {
        const profilePrompt = createSystemPrompt(char, data);
        const selectedPrompt = await composePhonePrompt(ctx, char, data);
        const result = await generateWithTimeout(ctx, {
            systemPrompt: `${selectedPrompt}\n\n现在只判断角色是否愿意通过 user 的好友申请。请根据设定、已经发生的相处以及角色自己的意愿决定，不保证同意。只能输出一个英文单词：ACCEPT 或 REJECT。`,
            prompt: [
                ...buildPrompt(data).slice(-8),
                { role: 'user', content: '【好友申请事件】user 请求添加你为手机好友。只输出 ACCEPT 或 REJECT。' },
            ],
        }, data);
        if (!sameSession(session)) return;
        const response = typeof result === 'string' ? result.trim().replace(/^`+|`+$/g, '').trim() : '';
        const verdict = /^(ACCEPT|REJECT)$/i.test(response) ? response.toUpperCase() : '';
        if (!verdict) throw new Error('模型没有按要求返回 ACCEPT 或 REJECT，好友申请保持待处理。');
        const next = verdict === 'ACCEPT' ? 'friends' : 'stranger';
        rememberFriendship(data, next, verdict === 'ACCEPT' ? '对方同意了你的好友申请。' : '对方拒绝了你的好友申请。');
        await writeData(ctx, data);
        recordActivity('好友申请结果', verdict === 'ACCEPT' ? '角色同意了好友申请。' : '角色拒绝了好友申请。', 'success');
        if (sameSession(session)) setStatus(verdict === 'ACCEPT' ? '对方通过了好友申请。' : '对方暂时没有同意好友申请。');
    } catch (error) {
        const message = recordError('处理好友申请', error);
        if (sameSession(session)) setStatus(message, 'error');
    } finally {
        finishBusy(job);
        if (mounted) render();
    }
}

async function handleFriendAction(action) {
    if (!mounted || busy) return;
    const ctx = context();
    if (!selectedCharacter(ctx)) return;
    const state = friendshipState(readData(ctx));
    if (action === 'remove' && state === 'friends') {
        if (window.confirm('确定删除好友吗？历史聊天会保留，之后可以重新添加。')) {
            await changeFriendship('stranger', '你已删除好友，历史消息仍然保留。');
        }
    } else if (action === 'block' && state !== 'blocked') {
        if (window.confirm('确定拉黑吗？拉黑期间无法互发手机消息，历史聊天仍保留。')) {
            await changeFriendship('blocked', '你已将对方拉黑。');
        }
    } else if (action === 'unblock' && state === 'blocked') {
        await changeFriendship('stranger', '你已解除拉黑，可以重新添加好友。');
    } else if (action === 'add' && state === 'stranger') {
        if (await changeFriendship('outgoing', '你向对方发送了好友申请。')) await reviewOutgoingRequest();
    } else if (action === 'review' && state === 'outgoing') {
        await reviewOutgoingRequest();
    } else if (action === 'cancel' && state === 'outgoing') {
        await changeFriendship('stranger', '你撤回了好友申请。');
    } else if (action === 'accept' && state === 'incoming') {
        await changeFriendship('friends', '你同意了对方的好友申请。');
    } else if (action === 'decline' && state === 'incoming') {
        await changeFriendship('stranger', '你拒绝了对方的好友申请。');
    }
}

async function saveManualFriendship() {
    const next = nodes?.friendSetup?.value;
    if (!FRIEND_STATES.has(next) || busy) return;
    const label = FRIEND_LABELS[next];
    if (!window.confirm(`将当前存档的起始/剧情好友状态手动设为「${label}」？这会影响是否能在手机里发消息。`)) return;
    await changeFriendship(next, `玩家根据剧情将当前好友状态设为「${label}」。`);
}

async function copyDiagnostics() {
    const summary = diagnostics.map(entry => `[${entry.at}] ${entry.stage}${entry.code ? ` (${entry.code})` : ''}\n${entry.detail}`).join('\n\n');
    if (!summary) return setStatus('当前没有可复制的错误记录。');
    try {
        if (!navigator.clipboard?.writeText) throw new Error('当前 WebView 不支持剪贴板写入。');
        await navigator.clipboard.writeText(summary);
        setStatus('已复制诊断记录（不含聊天正文和 API 密钥）。');
    } catch (error) {
        setStatus(recordError('复制诊断', error), 'error');
    }
}

function openPhone() {
    try {
        if (!mounted || !root) mount();
        if (!mounted || !root || !nodes) throw new Error('手机界面尚未初始化');
        // A native modal occupies the browser's top layer, outside the host's
        // stacking contexts. The previous html-root fixed overlay could end up
        // outside Android WebView's hit-testing viewport.
        if (root.parentElement !== document.body) document.body.append(root);
        const panel = root.querySelector('.lp-panel');
        if (!panel) throw new Error('找不到手机主屏容器');
        root.classList.add('lp-open');
        if (typeof panel.showModal === 'function' && !panel.open) panel.showModal();
        nodes.launcher.setAttribute('aria-label', '隐藏咕叽咕机');
        setScreen('home');
        render();
        setTimeout(() => {
            if (!root?.classList.contains('lp-open')) return;
            const bounds = panel.getBoundingClientRect();
            const viewportWidth = window.visualViewport?.width || window.innerWidth || document.documentElement.clientWidth;
            const viewportHeight = window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight;
            const intersectsViewport = bounds.right > 0 && bounds.bottom > 0
                && bounds.left < viewportWidth && bounds.top < viewportHeight;
            // Android WebView can return null from elementFromPoint on a modal
            // layer; showModal + visible bounds are the reliable checks here.
            const modalMissing = typeof panel.showModal === 'function' && !panel.open;
            if (!panel.isConnected || bounds.width < 100 || bounds.height < 100 || !intersectsViewport || modalMissing) {
                const detail = `手机主屏未进入可见区域（面板 ${Math.round(bounds.left)},${Math.round(bounds.top)}，${Math.round(bounds.width)}×${Math.round(bounds.height)}；视口 ${Math.round(viewportWidth)}×${Math.round(viewportHeight)}；弹窗 ${panel.open ? '已打开' : '未打开'}）`;
                recordError('打开手机', new Error(detail));
                window.alert(`咕叽咕机启动错误：${detail}`);
            }
        }, 650);
    } catch (error) {
        const detail = recordError('打开手机', error);
        window.alert(`咕叽咕机启动错误：${detail}`);
    }
}

function closePhone() {
    if (!mounted || !root) return;
    root.classList.remove('lp-open');
    const panel = root.querySelector('.lp-panel');
    if (panel?.open && typeof panel.close === 'function') panel.close();
    nodes.launcher.setAttribute('aria-label', '打开咕叽咕机');
}

function installWandEntry() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return false;
    const previous = document.getElementById(WAND_ENTRY_ID);
    if (previous?.isConnected && previous === wandEntry) return true;
    // A prior module instance can leave a button with a stale click handler.
    previous?.remove();

    const container = document.createElement('div');
    container.id = WAND_ENTRY_ID;
    container.className = 'extension_container';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'list-group-item flex-container flexGap5 gujiguji-wand-button';
    button.setAttribute('aria-label', '打开咕叽咕机');
    const icon = document.createElement('span');
    icon.className = 'fa-solid fa-mobile-screen-button extensionsMenuExtensionButton';
    icon.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span');
    title.textContent = '咕叽咕机';
    button.append(icon, title);
    button.addEventListener('click', openPhone);
    container.append(button);
    menu.append(container);
    wandEntry = container;
    recordActivity('启动入口', '魔法棒菜单已注册「咕叽咕机」。', 'success');
    return true;
}

function makeUI() {
    const container = document.createElement('div');
    container.id = ROOT_ID;
    container.innerHTML = `
      <dialog class="lp-panel" aria-label="咕叽咕机" aria-modal="true">
        <header class="lp-header">
          <button type="button" class="lp-back" data-lp="back" aria-label="返回手机桌面" hidden>‹</button>
          <div class="lp-heading"><div class="lp-title" data-lp="title">咕叽咕机</div>
               <div class="lp-subtitle" data-lp="subtitle">故事中的小手机</div></div>
          <button type="button" class="lp-close" data-lp="close" aria-label="关闭咕叽咕机">×</button>
        </header>
        <section class="lp-screen lp-home" data-lp-screen="home" aria-label="手机桌面">
          <div class="lp-home-hero">
            <div class="lp-home-greeting">咕叽咕机 · GujiGuji · v0.4.0</div>
            <div class="lp-home-time" data-lp="homeTime">故事时间</div>
            <div class="lp-home-character" data-lp="homeCharacter">等待进入角色存档</div>
          </div>
          <div class="lp-home-summary" data-lp="homeMessageCount">0 条聊天记录</div>
          <div class="lp-app-grid" aria-label="小手机应用">
            <button type="button" class="lp-app-tile" data-lp-open="chat"><span class="lp-app-icon lp-app-chat" data-lp-icon="chat">💬</span><span>咕叽聊</span><small>可使用</small></button>
            <button type="button" class="lp-app-tile" data-lp-open="diagnostics"><span class="lp-app-icon lp-app-log" data-lp-icon="diagnostics">🛠️</span><span>运行日志</span><small data-lp="homeLogCount">0 条记录</small></button>
            <button type="button" class="lp-app-tile" data-lp-open="settings"><span class="lp-app-icon lp-app-settings" data-lp-icon="settings">⚙️</span><span>设置</span></button>
            <button type="button" class="lp-app-tile" data-lp-open="calendar"><span class="lp-app-icon" data-lp-icon="calendar">📅</span><span>日历</span></button>
            <button type="button" class="lp-app-tile" data-lp-open="theme"><span class="lp-app-icon" data-lp-icon="theme">🎨</span><span>主题</span></button>
            <div class="lp-app-tile lp-app-soon" aria-label="相册，待开发"><span class="lp-app-icon" data-lp-icon="album">🖼️</span><span>相册</span><small>待开发</small></div>
            <div class="lp-app-tile lp-app-soon" aria-label="购物，待开发"><span class="lp-app-icon" data-lp-icon="shopping">🛍️</span><span>购物</span><small>待开发</small></div>
            <div class="lp-app-tile lp-app-soon" aria-label="外卖，待开发"><span class="lp-app-icon" data-lp-icon="takeout">🥡</span><span>外卖</span><small>待开发</small></div>
          </div>
        </section>
        <section class="lp-screen lp-chat" data-lp-screen="chat" aria-label="咕叽聊" hidden>
          <div class="lp-chat-contact">联系人：<strong data-lp="name">角色</strong></div>
          <div class="lp-friendship">
            <div class="lp-friend-main">
              <span class="lp-friend-label" data-lp="friendLabel">已是好友</span>
              <div class="lp-friend-actions" data-lp="friendActions"></div>
            </div>
            <details class="lp-friend-setup">
              <summary>按已有剧情设定好友状态</summary>
              <div class="lp-friend-editor">
                <select data-lp="friendSetup" aria-label="设定当前存档的好友状态">
                  <option value="friends">已是好友</option>
                  <option value="stranger">未加好友</option>
                  <option value="outgoing">我已发送申请</option>
                  <option value="incoming">对方向我申请</option>
                  <option value="blocked">已拉黑</option>
                </select>
                <button type="button" data-lp="friendSave">应用设定</button>
              </div>
            </details>
          </div>
          <div class="lp-statusrow">
            <div class="lp-status" data-lp="status" role="status" aria-live="polite"></div>
            <button type="button" class="lp-diagnostic-toggle" data-lp="diagnosticToggle">查看运行日志</button>
          </div>
          <div class="lp-activity" data-lp="activity" role="status" aria-live="polite" hidden></div>
          <div class="lp-messages" data-lp="messages" role="log" aria-label="手机聊天记录"></div>
          <div class="lp-composer">
            <textarea data-lp="input" rows="1" placeholder="输入消息…" aria-label="手机消息内容"></textarea>
            <button type="button" class="lp-retry" data-lp="retry" hidden>重新生成上一条回复</button>
            <button type="button" data-lp="send">发送并生成</button>
          </div>
        </section>
        <section class="lp-screen lp-settings" data-lp-screen="settings" aria-label="设置" hidden>
          <h2>API</h2>
          <div class="lp-settings-card" data-lp="apiInfo">当前酒馆连接</div>
          <label class="lp-field">连接方式<select data-lp="apiMode">
            <option value="inherit">跟随酒馆当前连接</option>
            <option value="custom">独立 OpenAI 兼容 API</option>
          </select></label>
          <div class="lp-api-custom" data-lp="customApiFields" hidden>
            <label class="lp-field">API 地址（以 /v1 结尾）<input data-lp="apiUrl" type="url" placeholder="https://example.com/v1" autocomplete="off"/></label>
            <label class="lp-field">模型名称<input data-lp="apiModel" type="text" placeholder="模型 ID" autocomplete="off"/></label>
            <label class="lp-field">API 密钥（仅本次页面）<input data-lp="apiKey" type="password" placeholder="输入新密钥" autocomplete="new-password"/></label>
            <div class="lp-api-key-state" data-lp="apiKeyState"></div>
          </div>
          <button type="button" class="lp-settings-link" data-lp="saveApi">保存 API 配置</button>
          <button type="button" class="lp-settings-link" data-lp="testApi">测试生成连接</button>
          <h2>预设条目</h2>
          <select data-lp="presetSource" aria-label="选择预设"></select>
          <div class="lp-config-list" data-lp="presetEntries"></div>
          <h2>世界书条目</h2>
          <select data-lp="worldSource" aria-label="选择世界书"></select>
          <div class="lp-config-list" data-lp="worldEntries"></div>
          <h2>打开方式</h2>
          <label class="lp-entry-option"><input type="checkbox" data-lp="floatingLauncher" /> 显示悬浮按钮</label>
          <div class="lp-settings-status" data-lp="settingsStatus" role="status" aria-live="polite"></div>
        </section>
        <section class="lp-screen lp-settings" data-lp-screen="calendar" aria-label="日历" hidden>
          <h2>当前故事时间</h2>
          <div class="lp-timebar">
            <label for="lp-story-time">日期与时间</label>
            <input id="lp-story-time" type="datetime-local" data-lp="time" aria-label="小手机故事时间" />
          </div>
          <p>当前角色 · 当前聊天存档</p>
        </section>
        <section class="lp-screen lp-settings" data-lp-screen="theme" aria-label="主题" hidden>
          <h2>手机壁纸</h2>
          <input type="file" accept="image/*" data-lp="themeWallpaper" aria-label="选择壁纸图片" />
          <button type="button" class="lp-settings-link" data-lp="themeResetWallpaper">恢复默认壁纸</button>
          <h2>字体</h2>
          <select data-lp="themeFont" aria-label="选择手机字体">
            <option value="system">系统字体</option>
            <option value="serif">衬线字体</option>
            <option value="rounded">圆润字体</option>
          </select>
          <h2>App 图标</h2>
          <div class="lp-theme-icons" data-lp="themeIcons">
            <label>咕叽聊 <input data-theme-icon="chat" maxlength="12" /></label>
            <label>运行日志 <input data-theme-icon="diagnostics" maxlength="12" /></label>
            <label>设置 <input data-theme-icon="settings" maxlength="12" /></label>
            <label>日历 <input data-theme-icon="calendar" maxlength="12" /></label>
            <label>主题 <input data-theme-icon="theme" maxlength="12" /></label>
            <label>相册 <input data-theme-icon="album" maxlength="12" /></label>
            <label>购物 <input data-theme-icon="shopping" maxlength="12" /></label>
            <label>外卖 <input data-theme-icon="takeout" maxlength="12" /></label>
          </div>
        </section>
        <section class="lp-screen lp-diagnostics" data-lp-screen="diagnostics" aria-label="运行日志与报错" hidden>
          <div class="lp-diagnostic-state" data-lp="diagnosticState" role="status" aria-live="polite">空闲</div>
          <div class="lp-diagnostic-head"><strong>本次打开页面后的记录</strong><button type="button" data-lp="copyDiagnostics">复制日志</button></div>
          <div class="lp-diagnostic-list" data-lp="diagnostics"></div>
          <button type="button" class="lp-clear-logs" data-lp="clearDiagnostics">清空本次运行日志</button>
        </section>
      </dialog>
      `;
    return container;
}

function mount() {
    if (mounted || !document.body) return;
    lifecycleToken += 1;
    root = makeUI();
    document.body.append(root);
    const floating = document.createElement('button');
    floating.type = 'button';
    floating.id = 'gujiguji-floating-launcher';
    floating.className = 'lp-launcher';
    floating.textContent = '☏';
    floating.setAttribute('aria-label','打开咕叽咕机');
    document.body.append(floating);
    nodes = Object.fromEntries(['title', 'name', 'subtitle', 'back', 'close', 'time',
        'homeTime', 'homeCharacter', 'homeMessageCount', 'homeLogCount',
        'friendLabel', 'friendActions',
        'friendSetup', 'friendSave', 'floatingLauncher', 'status', 'settingsStatus', 'activity', 'diagnosticToggle',
        'presetSource','presetEntries','worldSource','worldEntries','apiInfo','testApi','apiMode','apiUrl','apiModel','apiKey','apiKeyState','customApiFields','saveApi','themeFont','themeWallpaper','themeResetWallpaper','themeIcons',
        'diagnostics', 'diagnosticState', 'copyDiagnostics', 'clearDiagnostics',
        'messages', 'input', 'retry', 'send', 'launcher']
        .map(key => [key, key === 'launcher' ? floating : root.querySelector(`[data-lp="${key}"]`)]));

    nodes.launcher.addEventListener('click', () => {
        const opening = !root.classList.contains('lp-open');
        if (opening) openPhone();
        else closePhone();
    });
    nodes.close.addEventListener('click', closePhone);
    root.querySelector('.lp-panel')?.addEventListener('cancel', event => {
        event.preventDefault();
        closePhone();
    });
    nodes.back.addEventListener('click', () => setScreen('home'));
    root.addEventListener('click', event => {
        const button = event.target.closest('button[data-lp-open]');
        if (button && root.contains(button)) setScreen(button.dataset.lpOpen);
    });
    nodes.time.addEventListener('change', saveStoryTime);
    nodes.presetSource.addEventListener('change', showPresetEntries);
    nodes.worldSource.addEventListener('change', () => void showWorldEntries());
    nodes.testApi.addEventListener('click', () => void testPhoneApi());
    nodes.apiMode.addEventListener('change', () => { nodes.customApiFields.hidden = nodes.apiMode.value !== 'custom'; });
    nodes.saveApi.addEventListener('click', () => void savePhoneApi());
    nodes.presetEntries.addEventListener('change', event => { if (event.target?.dataset?.configKind) onConfigChange(event.target); });
    nodes.worldEntries.addEventListener('change', event => { if (event.target?.dataset?.configKind) onConfigChange(event.target); });
    nodes.themeFont.addEventListener('change', () => changeTheme({font:nodes.themeFont.value}));
    nodes.themeWallpaper.addEventListener('change', e => loadWallpaper(e.target.files?.[0]));
    nodes.themeResetWallpaper.addEventListener('click', () => changeTheme({wallpaper:''}));
    nodes.themeIcons.addEventListener('change', e => {
        const iconName = e.target.dataset?.themeIcon;
        if (!iconName) return;
        const str = e.target.value.trim().slice(0,12);
        changeTheme({icons:{...(themeData().icons||{}),[iconName]:str || APP_ICONS[iconName]}});
    });
    nodes.floatingLauncher.addEventListener('change', event => setFloatLauncherEnabled(event.target.checked));
    nodes.send.addEventListener('click', send);
    nodes.retry.addEventListener('click', retryLastReply);
    nodes.friendSave.addEventListener('click', saveManualFriendship);
    nodes.friendActions.addEventListener('click', event => {
        const button = event.target.closest('button[data-friend-action]');
        if (button) handleFriendAction(button.dataset.friendAction);
    });
    nodes.diagnosticToggle.addEventListener('click', () => setScreen('diagnostics'));
    nodes.copyDiagnostics.addEventListener('click', copyDiagnostics);
    nodes.clearDiagnostics.addEventListener('click', () => {
        diagnostics.length = 0;
        renderDiagnostics();
        setStatus('已清空本次运行日志。');
    });
    nodes.input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            send();
        }
    });
    root.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            if (activeScreen !== 'home') setScreen('home');
            else {
                closePhone();
                nodes.launcher.focus();
            }
        }
    });

    mounted = true;
    renderDiagnostics();
    const ctx = context();
    if (ctx?.eventSource && ctx?.event_types?.CHAT_CHANGED) {
        listeningSource = ctx.eventSource;
        listeningEvent = ctx.event_types.CHAT_CHANGED;
        chatChangedHandler = () => {
            statusText = '';
            statusKind = 'info';
            render();
        };
        listeningSource.on(listeningEvent, chatChangedHandler);
    }
    render();
}

function unmount() {
    closePhone();
    mounted = false;
    lifecycleToken += 1;
    busyJobId += 1;
    busy = false;
    busyKind = '';
    if (activityTicker) clearInterval(activityTicker);
    activityTicker = null;
    if (listeningSource && chatChangedHandler) {
        if (typeof listeningSource.removeListener === 'function') {
            listeningSource.removeListener(listeningEvent, chatChangedHandler);
        } else if (typeof listeningSource.off === 'function') {
            listeningSource.off(listeningEvent, chatChangedHandler);
        }
    }
    listeningSource = null;
    listeningEvent = null;
    chatChangedHandler = null;
    document.getElementById(WAND_ENTRY_ID)?.remove();
    wandEntry = null;
    nodes?.launcher?.remove();
    root?.remove();
    root = null;
    nodes = null;
    statusText = '';
    statusKind = 'info';
    activeScreen = 'home';
}

function bindReady() {
    if (!extensionEnabled) return;
    if (!document.body) {
        // The phone shell does not require a SillyTavern context to appear.
        // Wait only for the document body, never for host event API shape.
        if (!bootstrapTimer) {
            bootstrapTimer = setTimeout(() => {
                bootstrapTimer = null;
                bindReady();
            }, 500);
        }
        return;
    }
    if (bootstrapTimer) clearTimeout(bootstrapTimer);
    bootstrapTimer = null;
    if (!mounted) mount();
    if (!installWandEntry()) {
        // On SillyTavern 1.19 the wand menu is normally ready before extensions,
        // but retry briefly for hosts that inject it after our entry module.
        if (wandAttempts++ < 30) {
            bootstrapTimer = setTimeout(() => {
                bootstrapTimer = null;
                bindReady();
            }, 500);
        } else {
            recordError('魔法棒入口', new Error('酒馆没有提供 #extensionsMenu，无法添加咕叽咕机入口。'));
        }
    } else {
        wandAttempts = 0;
    }
}

// activate runs on every successful page-load activation; enable runs when the
// user changes the extension's enabled state. They are not interchangeable.
export function onActivate() { extensionEnabled = true; bindReady(); }
export function onEnable() { extensionEnabled = true; bindReady(); }
export function onDisable() {
    extensionEnabled = false;
    if (bootstrapTimer) clearTimeout(bootstrapTimer);
    bootstrapTimer = null;
    wandAttempts = 0;
    unmount();
}

bindReady();
