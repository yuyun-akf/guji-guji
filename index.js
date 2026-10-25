/**
 * GujiGuji v0.4.0: a modular phone shell with isolated per-chat context.
 * No direct host-module imports; uses only the documented context surface.
 */

const ROOT_ID = 'st-little-phone-root';
const DATA_KEY = 'st_little_phone_v1';
const PRIMARY_CONTACT_ID = 'primary';
let activeContactId = PRIMARY_CONTACT_ID;
let selectedMessageId = null;
let quotedMessageId = null;
let npcCandidates = [];
let npcScanSession = null;
let npcScanning = false;
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
let wandObserver = null;
let wandEntry = null;
let extensionEnabled = true;
let statusText = '';
let statusKind = 'info';
let busyKind = '';
let activeScreen = 'home';
let lifecycleToken = 0;
const diagnostics = [];
let configWriteQueue = Promise.resolve();
let viewportListener = null;
let pickerState = null;
let pickerReturnTimer = null;
let pickerGuardUntil = 0;
let pickerFocusListener = null;
let stickerUploading = false;
const transientApiKeys = new Map();
const APP_ICONS = {chat:'💬',diagnostics:'🛠️',settings:'⚙️',calendar:'📅',theme:'🎨',album:'🖼️',shopping:'🛍️',takeout:'🥡'};
const SCREENS = new Set(['home', 'chat', 'chatList', 'contacts', 'requests', 'profile', 'addNpc', 'discoverNpc', 'discover', 'me', 'chatOptions', 'settings', 'diagnostics', 'calendar', 'theme', 'presetPicker', 'worldPicker']);

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
        ...prompts.map(m=>({role:m.role==='assistant'?'assistant':'user',content:Array.isArray(m.content)?m.content:String(m.content || '')}))];
    const result = await ctx.ChatCompletionService.sendRequest({
        chat_completion_source:'custom',custom_url:url,
        custom_include_headers:JSON.stringify({Authorization:'Bearer ' + key}),
        model:cfg.model.trim(),messages,stream:false,max_tokens:cfg.maxTokens,temperature:0.85
    });
    return typeof result === 'string' ? result : result?.content || '';
}
async function savePhoneApi() {
    const ctx = context();
    if (!selectedCharacter(ctx) || !nodes) return false;
    const mode = nodes.apiMode.value;
    const url = nodes.apiUrl.value.trim();
    const model = nodes.apiModel.value.trim();
    const key = nodes.apiKey.value.trim();
    if (mode === 'custom') {
        try { normalizeApiUrl(url); } catch(e) { setStatus(e.message,'error'); return false; }
        if (!model) { setStatus('请填写模型名称','error'); return false; }
        if (!key && !transientApiKeys.has(apiSessionId(ctx))) { setStatus('请填写 API 密钥','error'); return false; }
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
        return true;
    } catch(e) { setStatus(recordError('保存 API 配置',e),'error'); return false; }
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
function loadPhoneMessageStyle() {
    if (!nodes?.messageStyle) return;
    nodes.messageStyle.value = readData(context())?.config?.messageStyle === 'unrestricted' ? 'unrestricted' : 'natural';
}
async function savePhoneMessageStyle() {
    const ctx = context();
    if (!selectedCharacter(ctx)) return;
    const data = structuredClone(readData(ctx));
    data.config ||= {};
    data.config.messageStyle = nodes.messageStyle.value === 'unrestricted' ? 'unrestricted' : 'natural';
    try { await writeData(ctx,data); setStatus('聊天风格已保存'); }
    catch (e) { setStatus(recordError('保存聊天风格',e),'error'); }
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
    const row = document.createElement('div');
    row.className = 'lp-picker-row';
    const label = document.createElement('label');
    label.className = 'lp-config-row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.configKind = kind;
    input.dataset.configId = entry.id;
    input.checked = checked;
    const title = document.createElement('span');
    title.className = 'lp-picker-title';
    title.textContent = entry.name;
    label.append(input,title);
    row.append(label);
    if (entry.content) {
        const excerpt = document.createElement('div');
        excerpt.className = 'lp-picker-excerpt';
        excerpt.textContent = entry.content.slice(0,160);
        row.append(excerpt);
        if (entry.content.length > 160) {
            const detail = document.createElement('details');
            const summary = document.createElement('summary');
            summary.textContent = '展开条目全文';
            const full = document.createElement('div');
            full.className = 'lp-picker-full';
            full.textContent = entry.content;
            detail.append(summary,full);
            row.append(detail);
        }
    }
    row.dataset.searchText = (entry.name + ' ' + (entry.content || '')).toLocaleLowerCase();
    return row;
}
function filterPicker(kind) {
    const search = kind === 'preset' ? nodes.presetSearch : nodes.worldSearch;
    const container = kind === 'preset' ? nodes.presetEntries : nodes.worldEntries;
    if (!search || !container) return;
    const term = search.value.trim().toLocaleLowerCase();
    for (const row of container.querySelectorAll('.lp-picker-row')) {
        row.hidden = !!term && !row.dataset.searchText.includes(term);
    }
}
function availablePresetEntries(name, ctx) {
    const manager = ctx?.getPresetManager?.('openai');
    const preset = manager?.getCompletionPresetByName?.(name);
    return (preset?.prompts || []).filter(p => typeof p.content === 'string' && p.content.trim())
        .map(p => ({id:String(p.identifier || p.name),name:p.name || p.identifier || '未命名条目',content:p.content}));
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
    nodes.presetPickerTitle.textContent = '预设：' + (name || '未选择');
    for (const entry of entries) nodes.presetEntries.append(createCheckRow(entry,'preset',selected.some(x=>x.preset===name && x.id===entry.id)));
    filterPicker('preset');
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
        nodes.worldPickerTitle.textContent = '世界书：' + name;
        for (const [key,value] of entries) {
            const id = String(value.uid ?? key);
            nodes.worldEntries.append(createCheckRow({id,name:value.comment || value.key?.join('、') || id,content:value.content},'world',selected.some(x=>x.book===name && x.id===id)));
        }
        filterPicker('world');
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
    return {version:1,storyTime:localDateTime(),messages:[],friendship:{state:'stranger'},contacts:[],conversations:{}};
}
function readRootData(ctx) {
    const value=ctx?.chatMetadata?.[DATA_KEY];
    const base=(!value||value.version!==1||!Array.isArray(value.messages))?newData():value;
    return {
        ...base,
        friendship:FRIEND_STATES.has(base.friendship?.state)?base.friendship:(value?{state:'friends'}:{state:'stranger'}),
        contacts:Array.isArray(base.contacts)?base.contacts.filter(c=>c&&typeof c.id==='string'&&c.id.startsWith('npc:')):[],
        conversations:base.conversations&&typeof base.conversations==='object'&&!Array.isArray(base.conversations)?base.conversations:{}
    };
}
function validContactId(root,id) {
    return id===PRIMARY_CONTACT_ID || root.contacts.some(c=>c.id===id);
}
function readData(ctx,contactId=activeContactId) {
    const root=readRootData(ctx);
    if (contactId===PRIMARY_CONTACT_ID || !validContactId(root,contactId)) return {...root,__contactId:PRIMARY_CONTACT_ID};
    const conversation=root.conversations[contactId] || {};
    return {
        ...root,__contactId:contactId,
        messages:Array.isArray(conversation.messages)?conversation.messages:[],
        friendship:FRIEND_STATES.has(conversation.friendship?.state)?conversation.friendship:{state:'stranger'},
        friendEvents:Array.isArray(conversation.friendEvents)?conversation.friendEvents:[],
        chatDeleted:conversation.chatDeleted===true,
        contactAccess:conversation.contactAccess||'',
        avatars:{...root.avatars,...conversation.avatars}
    };
}
function getContactInfo(ctx,id=activeContactId) {
    if (id===PRIMARY_CONTACT_ID) return {id,name:getCharacterName(selectedCharacter(ctx)),remark:readRootData(ctx).primaryRemark||'',kind:'character'};
    const contact=readRootData(ctx).contacts.find(c=>c.id===id);
    return contact || {id:PRIMARY_CONTACT_ID,name:getCharacterName(selectedCharacter(ctx)),remark:'',kind:'character'};
}
function contactCharacter(ctx,id=activeContactId) {
    const primary=selectedCharacter(ctx);
    if (id===PRIMARY_CONTACT_ID) return primary;
    const contact=readRootData(ctx).contacts.find(c=>c.id===id);
    if (!contact) return primary;
    return {name:contact.name,data:{
        name:contact.name,
        description:contact.description || '',
        personality:contact.personality || '',
        scenario:contact.relationship ? '人物关系：'+contact.relationship : ''
    }};
}
function contactDisplayName(ctx,id=activeContactId) {
    const info=getContactInfo(ctx,id);
    return info.remark || info.name;
}
function friendshipState(data) {
    return FRIEND_STATES.has(data?.friendship?.state) ? data.friendship.state : 'stranger';
}

async function writeData(ctx,data) {
    if (!ctx?.chatMetadata||typeof ctx.saveMetadata!=='function')
        throw new Error('当前酒馆未提供可用的聊天存档接口。');
    const previous=ctx.chatMetadata[DATA_KEY];
    const root=readRootData(ctx);
    const id=data.__contactId || PRIMARY_CONTACT_ID;
    if (!validContactId(root,id) && id!==PRIMARY_CONTACT_ID)
        throw new Error('当前联系人不存在，无法保存聊天');
    const payload={...data};
    delete payload.__contactId;
    if (id!==PRIMARY_CONTACT_ID) {
        const thread=root.conversations[id] || {};
        payload.conversations={
            ...root.conversations,...payload.conversations,
            [id]:{
                ...thread,
                messages:data.messages,
                friendship:data.friendship,
                friendEvents:data.friendEvents || [],
                chatDeleted:data.chatDeleted===true,
                contactAccess:data.contactAccess||thread.contactAccess||'',
                avatars:{...(thread.avatars||{}),character:data.avatars?.character||''}
            }
        };
        payload.messages=root.messages;
        payload.friendship=root.friendship;
        payload.friendEvents=root.friendEvents;
        payload.chatDeleted=root.chatDeleted;
        payload.avatars={...(root.avatars||{})};
        if (data.avatars?.user) payload.avatars.user=data.avatars.user;
        else delete payload.avatars.user;
    }
    ctx.chatMetadata[DATA_KEY]=payload;
    try {await ctx.saveMetadata();}
    catch(error){
        if(ctx.chatMetadata[DATA_KEY]===payload){
            if(previous===undefined)delete ctx.chatMetadata[DATA_KEY];
            else ctx.chatMetadata[DATA_KEY]=previous;
        }
        throw error;
    }
}

function captureSession(ctx) {
    return { metadata: ctx.chatMetadata, characterId: ctx.characterId, groupId: ctx.groupId, contactId: activeContactId, lifecycleToken };
}

function sameSession(snapshot) {
    const ctx = context();
    return Boolean(mounted && ctx && lifecycleToken === snapshot.lifecycleToken && ctx.chatMetadata === snapshot.metadata
        && ctx.characterId === snapshot.characterId && ctx.groupId === snapshot.groupId && activeContactId === snapshot.contactId);
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

function messageStylePrompt(data) {
    const option = data?.config?.messageStyle;
    if (option === 'unrestricted') return '';
    return [
        '【手机消息呈现】请当作真实即时通讯而不是小说章节：直接发角色会在手机上打出的消息。',
        '优先自然、口语化、具体的表达；通常一次回复是一到几条相对短的聊天消息，除非角色有充分理由详细解释。',
        '口癖、语气、标点、颜文字、空格及发消息的频率由角色性格和眼下的情境决定；不要统一省略标点，也不要统一每句加句号。',
        '可以只发一个词、表情或问号，也可以在需要时发较长的消息，不要为了凑消息数无意义分条。',
        '如果一次想连续发送多条不同的消息，请在消息之间单独放置 [PHONE_NEXT]，不加编号，不解释这个标记。最多连续发五条。',
        '避免演讲体、长篇旁白、舞台指示、心理描写、替对方发言及机械总结。'
    ].join('\n');
}
function splitPhoneReply(text, data) {
    const source = String(text || '').trim();
    if (!source) return [];
    if (data?.config?.messageStyle === 'unrestricted') return [source];
    const cap = parts => parts.length > 5 ? [...parts.slice(0,4), parts.slice(4).join('\n')] : parts;
    const direct = source.split(/\s*\[PHONE_NEXT\]\s*|\n\s*\n+/).map(x=>x.trim()).filter(Boolean);
    if (direct.length > 1 || source.includes('[PHONE_NEXT]')) return cap(direct);
    const lines = source.split(/\n+/).map(x=>x.trim()).filter(Boolean);
    if (lines.length > 1 && lines.every(x=>x.length < 130)) return cap(lines);
    // Fallback splitting only for unusually long monologues, at sentence boundaries.
    if (source.length < 165) return [source];
    const pieces = source.match(/[^。！？!?；;]+[。！？!?；;]?/g)?.map(x=>x.trim()).filter(Boolean) || [source];
    if (pieces.length < 2) return [source];
    const result = [];
    let buffer = '';
    for (const piece of pieces) {
        if (buffer.length >= 65 && buffer.length + piece.length > 112 && result.length < 4) {
            result.push(buffer.trim());
            buffer = piece;
        } else buffer += piece;
    }
    if (buffer) result.push(buffer.trim());
    return result.filter(Boolean).slice(0,5);
}
function buildPrompt(data) {
    // Official generateRaw accepts Chat Completion messages and converts them
    // for the selected generation mode. Preserve user/assistant roles.
    return data.messages.slice(-CONTEXT_MESSAGE_LIMIT)
        .filter(message => typeof message.text === 'string' && ['user', 'character'].includes(message.from))
        .map(message => ({
            role: message.from === 'character' ? 'assistant' : 'user',
            content: !message.sticker && message.image && typeof message.image==='string' && /^data:image\/(?:jpeg|png|webp);base64,/.test(message.image)
              ? [{type:'text',text:(message.text||'')+'（请根据图片中实际可见内容回复，不要虚构看不到的细节）'},
                 {type:'image_url',image_url:{url:message.image,detail:'auto'}}]
              : ((message.replyQuote?'[引用：'+message.replyQuote+']\n':'')+message.text),
        }));
}

function setStatus(message, kind = 'info') {
    statusText = message || '';
    statusKind = kind;
    if (nodes?.status) {
        nodes.status.textContent = statusText;
        nodes.status.dataset.kind = kind;
    }
    if (nodes?.chatError) {
        nodes.chatError.hidden = kind !== 'error' || !statusText;
        nodes.chatError.textContent = kind === 'error' ? statusText : '';
    }
    if (nodes?.npcStatus) { nodes.npcStatus.textContent=statusText; nodes.npcStatus.dataset.kind=kind; }
    if (nodes?.profileStatus) { nodes.profileStatus.textContent=statusText; nodes.profileStatus.dataset.kind=kind; }
    if (nodes?.settingsStatus) {
        nodes.settingsStatus.textContent = statusText;
        nodes.settingsStatus.dataset.kind = kind;
    }
    if (nodes && !busy) nodes.diagnosticState.textContent = statusText || '空闲';
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
    // Log status is shown only in the separate diagnostics app.
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

function setScreen(screen) {
    if (!SCREENS.has(screen) || !nodes) return;
    const previous = activeScreen;
    activeScreen = screen;
    root.dataset.screen = screen;
    for (const section of root.querySelectorAll('[data-lp-screen]')) {
        section.hidden = section.dataset.lpScreen !== screen;
    }
    nodes.back.hidden = screen === 'home';
    const titles = { home:'咕叽咕机',chat:'',chatList:'咕叽聊',contacts:'通讯录',discover:'发现',me:'我',requests:'新的朋友',profile:'联系人资料',addNpc:'添加 NPC',discoverNpc:'发现故事人物',chatOptions:'聊天设置',settings:'设置',diagnostics:'运行日志',calendar:'日历',theme:'主题',presetPicker:'选择预设条目',worldPicker:'选择世界书条目' };
    nodes.title.textContent = screen === 'chat' ? contactDisplayName(context()) : titles[screen];
    nodes.chatMenu.hidden = screen !== 'chat';
    if (screen === 'diagnostics') renderDiagnostics();
    if (screen === 'me') { renderPersona(context()); renderStickerLibrary(); }
    if (screen === 'discover') renderMoments(context());
    if (screen === 'addNpc') renderChatLists(context(),contactCharacter(context()),readData(context()));
    if (['chatList','contacts','discover','me'].includes(screen)) {
        root.querySelectorAll('.lp-tabbar button[data-lp-open]').forEach(button=>button.classList.toggle('lp-tab-active',button.dataset.lpOpen===screen));
    }
    if (screen === 'settings' && screen !== previous) { loadPhoneApiUI(); loadPhoneMessageStyle(); void populateConfigLists(); }
    if (screen === 'theme') applyTheme();
    if (screen === 'discoverNpc' && screen !== previous) {populateNpcWorldSelect();renderNpcCandidates();}
    if (screen === 'presetPicker') {nodes.presetSearch.value=''; showPresetEntries();}
    if (screen === 'worldPicker') {nodes.worldSearch.value=''; void showWorldEntries();}
    if (screen === 'chat') nodes.messages.scrollTop = nodes.messages.scrollHeight;
    if (nodes?.status) nodes.status.textContent = statusKind==='error' ? statusText : '';
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
    nodes.send.textContent = '发送';
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

function allowedAvatarSrc(src) {
    if (typeof src !== 'string' || !src.trim()) return '';
    const url = src.trim();
    if (/^data:image\/(png|jpeg|webp|gif);base64,/i.test(url)) return url;
    if (/^(https?:\/\/|\/|User Avatars\/)/i.test(url) && !/[<>]/.test(url)) return url;
    return '';
}
function avatarSources(ctx, data) {
    const char = contactCharacter(ctx,data?.__contactId||activeContactId);
    const custom = data?.avatars || {};
    let character = allowedAvatarSrc(custom.character);
    if (!character && char?.avatar && char.avatar !== 'none') {
        try { character = allowedAvatarSrc(ctx?.getThumbnailUrl?.('avatar',char.avatar)); } catch { /* default */ }
    }
    let user = allowedAvatarSrc(custom.user);
    if (!user) {
        const last = Array.isArray(ctx?.chat) ? [...ctx.chat].reverse().find(m => m?.is_user && m.force_avatar) : null;
        user = allowedAvatarSrc(last?.force_avatar);
    }
    if (!user) {
        try {
            const picked = document.querySelector('#user_avatar_block .selected img, #user_avatar_block .avatar-container.selected img, .mes[is_user="true"] .avatar img');
            user = allowedAvatarSrc(picked?.getAttribute('src'));
        } catch { /* default */ }
    }
    return {character:character || '/img/ai4.png',user:user || '/img/user-default.png'};
}
function makeAvatarElement(src, label) {
    const img = document.createElement('img');
    img.className = 'lp-person-avatar';
    img.alt = label || '头像';
    img.src = src;
    img.loading = 'lazy';
    img.addEventListener('error', () => {
        if (!img.dataset.fallback) { img.dataset.fallback='1'; img.src=label?.includes('我的') ? '/img/user-default.png' : '/img/ai4.png'; }
    });
    return img;
}
function makeListContact(char, data, label, action, displayName) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'lp-conversation-row';
    const avatars = avatarSources(context(), data);
    const image = makeAvatarElement(avatars.character, getCharacterName(char));
    const text = document.createElement('div');
    text.className = 'lp-conversation-text';
    const name = document.createElement('strong');
    name.textContent = displayName || getCharacterName(char);
    const small = document.createElement('small');
    small.textContent = label;
    text.append(name,small);
    const chevron = document.createElement('span');
    chevron.textContent = '›';
    chevron.className = 'lp-chevron';
    row.append(image,text,chevron);
    row.addEventListener('click',action);
    return row;
}
function switchContact(id,screen='profile') {
    if (busy) return setStatus('请等待当前消息处理完成','error');
    const ctx=context();
    const root=readRootData(ctx);
    if (!validContactId(root,id)) return setStatus('联系人不存在','error');
    activeContactId=id;
    statusText='';
    statusKind='info';
    if (nodes?.input) nodes.input.value='';
    render();
    setScreen(screen);
}
function contactSummary(ctx,id) {
    const data=readData(ctx,id);
    const last=[...data.messages].reverse().find(m=>m.from!=='system');
    return {data,last,state:friendshipState(data)};
}

function messageText(message) {
    return typeof message?.mes==='string' ? message.mes : typeof message?.text==='string' ? message.text : '';
}
function storyExchangeEvidence(ctx,id=activeContactId) {
    const person=getContactInfo(ctx,id);
    const main=getCharacterName(selectedCharacter(ctx));
    const messages=Array.isArray(ctx?.chat)?ctx.chat:[];
    const positive=/(?:交换(?:了|过)?(?:微信|联系(?:方式|号码)?|手机号|电话号|号码)|互加(?:了|过)?(?:微信|好友|联系方式)|加(?:了|上|过)?(?:微信|好友)|扫码(?:加|通过)|通过了好友申请|添加了.*?好友|把(?:微信|联系方式|号码)给(?:了)?(?:我|你|他|她)|留下了(?:微信|联系方式|电话))/;
    const negation=/(?:没有|没|未|不曾|尚未|还没|不能|不会|拒绝|想要|打算|准备|如果|假如|能否|要不要|可以|希望|问(?:他|她)?(?:要|拿)).{0,16}(?:加微信|交换|联系方式|号码|加好友)/;
    const identity=id===PRIMARY_CONTACT_ID ? '' : String(person.name||'');
    for (const msg of messages.slice(-500)) {
        const body=messageText(msg);
        if(!body||body.length>12000)continue;
        const clauses=body.split(/[。！？!?\n]/).filter(Boolean);
        for(const clause of clauses){
            if(!positive.test(clause)||negation.test(clause))continue;
            if(identity&&!clause.includes(identity)&&!clause.includes(person.remark||'\u0000'))continue;
            return clause.slice(0,180);
        }
    }
    return '';
}
function contactAccess(ctx,id=activeContactId) {
    const info=getContactInfo(ctx,id);
    const data=readData(ctx,id);
    const state=friendshipState(data);
    if(['friends','incoming','outgoing'].includes(state)) return {allowed:true,source:'已建立联系'};
    if(id!==PRIMARY_CONTACT_ID && info.source==='manual') return {allowed:true,source:'玩家手动添加'};
    if(info.contactAccess==='manual'||data.contactAccess==='manual')return {allowed:true,source:'手动确认拥有联系方式'};
    const scene=storyExchangeEvidence(ctx,id);
    return scene?{allowed:true,source:'正文中已交换联系方式',evidence:scene}:{allowed:false,source:'尚无交换联系方式的剧情证据'};
}
async function markContactExchanged() {
    if(busy)return;
    if(!window.confirm('确认剧情中已经认识并交换了联系方式？这不是自动加好友，只是允许发送申请。'))return;
    const ctx=context(),data=structuredClone(readData(ctx));
    data.contactAccess='manual';
    try {
        if(activeContactId!==PRIMARY_CONTACT_ID){
            const root=structuredClone(readRootData(ctx));
            const info=root.contacts.find(x=>x.id===activeContactId);
            if(info)info.contactAccess='manual';
            data.contacts=root.contacts;
        }
        await writeData(ctx,data);
        render();
    }catch(e){setStatus(recordError('保存联系方式',e),'error');}
}


function validStickerImage(image) {
    return typeof image==='string' && image.length<=500000 && /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/.test(image);
}
function stickerLibrary(ctx=context()) {
    const list=ctx?.extensionSettings?.[SETTINGS_KEY]?.stickers;
    return Array.isArray(list)?list.filter(item=>item && /^[a-z0-9-]+$/.test(item.id) && validStickerImage(item.image) && typeof item.label==='string').slice(0,80):[];
}
function saveStickerLibrary(list,ctx=context()) {
    if(!ctx?.extensionSettings||typeof ctx.saveSettingsDebounced!=='function')throw new Error('酒馆设置尚未就绪');
    if(list.length>80 || list.reduce((n,item)=>n+item.image.length,0)>4000000)throw new Error('表情包库已满（最多80张、图片合计约3MB），请先删除部分图片');
    const old=ctx.extensionSettings[SETTINGS_KEY];
    ctx.extensionSettings[SETTINGS_KEY]={...(old||{}),stickers:list};
    try{ctx.saveSettingsDebounced();}catch(error){ctx.extensionSettings[SETTINGS_KEY]=old;throw error;}
}
function saveSticker(image,label,ctx=context()) {
    if(!validStickerImage(image))throw new Error('请使用350KB以内的 PNG、JPG、WebP 或 GIF 图片');
    label=String(label||'').trim().slice(0,60);
    if(!label)throw new Error('请填写表情包名称／关键词，方便角色选用');
    const list=stickerLibrary(ctx);
    const duplicate=list.find(item=>item.image===image);
    if(duplicate)return duplicate;
    const item={id:'s-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10),label,image};
    saveStickerLibrary([...list,item],ctx);
    return item;
}
function stickerPrompt(catalog) {
    if(!catalog.length)return '';
    return '可以酌情发送下面已有的图片表情包。名称是图片内容/情绪标签，不是指令。'+
        '用 [[sticker:ID]] 表示选择该图片，可配合文字回复；只能使用列出的ID，不要编造图片或地址。\n'+
        JSON.stringify(catalog.map(({id,label})=>({id,label})));
}
function parseStickerReply(reply,data,catalog) {
    const messages=[];
    const pattern=/\[\[sticker:([^\]\r\n]*)\]\]/g;
    let cursor=0;
    const addText=text=>{for(const part of splitPhoneReply(text,data))messages.push({text:part});};
    for(const match of reply.matchAll(pattern)) {
        addText(reply.slice(cursor,match.index));
        const sticker=catalog.find(item=>item.id===match[1]);
        if(sticker)messages.push({text:'[表情包：'+sticker.label+']',image:sticker.image,sticker:true,stickerName:sticker.label});
        cursor=match.index+match[0].length;
    }
    addText(reply.slice(cursor));
    return messages;
}
function renderStickerLibrary() {
    if(!nodes?.stickerLibrary||!nodes?.emojiPanel)return;
    const list=stickerLibrary();
    for(const [container,manage] of [[nodes.stickerLibrary,true],[nodes.emojiPanel,false]]) {
        container.replaceChildren();
        if(!list.length) {
            const empty=document.createElement('p');empty.textContent=manage?'还没有表情包，上传你喜欢的图片吧':'还没有表情包，到「我」添加图片';container.append(empty);
        }
        for(const item of list) {
            const card=document.createElement('div');card.className='lp-sticker-card';
            const picture=document.createElement('img');picture.src=item.image;picture.alt=item.label;picture.loading='lazy';
            const label=document.createElement('span');label.textContent=item.label;
            const button=document.createElement('button');button.type='button';button.dataset.stickerId=item.id;
            button.dataset.stickerAction=manage?'rename':'send';button.setAttribute('aria-label',(manage?'修改名称：':'发送表情包：')+item.label);
            button.append(picture,label);card.append(button);
            if(manage){const remove=document.createElement('button');remove.type='button';remove.textContent='删除';remove.dataset.stickerId=item.id;remove.dataset.stickerAction='delete';card.append(remove);}
            container.append(card);
        }
    }
}
async function useSticker(id,action) {
    const ctx=context(),list=stickerLibrary(ctx),item=list.find(sticker=>sticker.id===id);
    if(!item)return;
    if(action==='send')return sendUserMessage('[表情包：'+item.label+']',item.image,item);
    try{
        if(action==='delete') {
            if(!window.confirm('删除这个表情包？已发送的图片仍保留在聊天记录中。'))return;
            saveStickerLibrary(list.filter(sticker=>sticker.id!==id),ctx);
        } else if(action==='rename') {
            const label=window.prompt('表情包名称／关键词',item.label);
            if(label===null)return;
            if(!label.trim())throw new Error('名称不能为空');
            saveStickerLibrary(list.map(sticker=>sticker.id===id?{...sticker,label:label.trim().slice(0,60)}:sticker),ctx);
        }
        renderStickerLibrary();nodes.stickerStatus.textContent='已保存';
    }catch(error){nodes.stickerStatus.textContent=error.message;}
}
async function uploadStickers(files) {
    if(stickerUploading)return;
    stickerUploading=true;
    const ctx=context();
    let count=0;
    try{
        for(const file of files){
            if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)||file.size>350*1024)throw new Error('请选择350KB以内的 PNG、JPG、WebP 或 GIF 图片');
            const image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('图片读取失败'));reader.readAsDataURL(file);});
            const label=file.name.replace(/\.[^.]+$/,'').trim()||'表情包';
            saveSticker(image,label,ctx);count++;
        }
        if(nodes)nodes.stickerStatus.textContent='已添加 '+count+' 张，可点击图片修改名称／关键词';
    }catch(error){if(nodes)nodes.stickerStatus.textContent='已添加 '+count+' 张；'+error.message;}
    finally{stickerUploading=false;if(nodes)renderStickerLibrary();}
}

// Native Android pickers can dispatch dialog cancel/Escape while returning.
// Keep the current panel and draft alive until that return sequence finishes.
function beginFilePicker() {
    pickerState={screen:activeScreen,scroll:nodes?.messages?.scrollTop||0};
    pickerGuardUntil=0;
}
function filePickerReturning() { return Boolean(pickerState)||Date.now()<pickerGuardUntil; }
function finishFilePicker() {
    if(!pickerState)return;
    const saved=pickerState;pickerState=null;pickerGuardUntil=Date.now()+700;
    if(!mounted||!extensionEnabled)return;
    const panel=root.querySelector('.lp-panel');
    if(panel && !panel.open && typeof panel.showModal==='function')panel.showModal();
    if(activeScreen!==saved.screen)setScreen(saved.screen);
    if(nodes?.messages)nodes.messages.scrollTop=saved.scroll;
}
function currentPersona(ctx) {
    const settings = ctx?.powerUserSettings || {};
    let avatar = '';
    try { avatar = allowedAvatarSrc(document.querySelector('#user_avatar_block .avatar-container.selected img, #user_avatar_block .selected img')?.getAttribute('src')); } catch { /* host not mounted */ }
    if(!avatar) {
        const matches=Object.entries(settings.personas||{}).filter(([id,name])=>name===ctx?.name1 && String(settings.persona_descriptions?.[id]?.description||'')===String(settings.persona_description||''));
        if(matches.length===1)avatar='/User Avatars/'+encodeURIComponent(matches[0][0]);
    }
    return { name: String(ctx?.name1 || 'user'), description: String(settings.persona_description || ''),
        lorebook: String(settings.persona_description_lorebook || '').trim(), avatar: avatar || '/img/user-default.png' };
}
function personaNames(ctx) {
    const persona = currentPersona(ctx);
    const names = new Set([persona.name, 'user', '玩家', '用户', '{{user}}']);
    for (const match of persona.description.matchAll(/(?:^|\n)\s*(?:姓名|名字|昵称|别名|化名)[：:]\s*([^\n。；]+)/g)) {
        for (const name of match[1].split(/[、，,／/|]/)) if (name.trim()) names.add(name.trim());
    }
    return names;
}
function renderPersona(ctx) {
    const persona = currentPersona(ctx);
    nodes.myIdentity.textContent = persona.name;
    nodes.myPersona.textContent = persona.description || '尚未填写人设';
    nodes.myAvatar.src = persona.avatar;
}
function renderMoments(ctx) {
    if (!nodes?.momentsFeed) return;
    nodes.momentsFeed.replaceChildren();
    const posts=readRootData(ctx).moments||[];
    renderPersona(ctx);
    for(const post of [...posts].reverse()){
        const item=document.createElement('div');item.className='lp-moment';
        const author=document.createElement('strong');author.textContent=post.author||ctx?.name1||'user';
        const body=document.createElement('p');body.textContent=post.text;
        const date=document.createElement('small');date.textContent=String(post.createdAt||'').replace('T',' ').slice(0,16);
        item.append(author,body,date);nodes.momentsFeed.append(item);
    }
    if(!posts.length) nodes.momentsFeed.textContent='还没有动态';
}
async function postMoment() {
    if(busy)return;
    const ctx=context();
    if(!selectedCharacter(ctx))return setStatus('请先打开剧情存档','error');
    const session=captureSession(ctx);
    const value=nodes.momentsText.value.trim();
    if(!value)return;
    const data=structuredClone(readRootData(ctx));
    data.moments=Array.isArray(data.moments)?data.moments:[];
    data.moments.push({id:'moment-'+Date.now(),author:ctx?.name1||'user',text:value.slice(0,1000),createdAt:new Date().toISOString()});
    data.moments=data.moments.slice(-100);
    try {
        await writeData(ctx,{...data,__contactId:PRIMARY_CONTACT_ID});
        if(!sameSession(session))return;
        nodes.momentsText.value='';
        renderMoments(ctx);
    }catch(e){setStatus(recordError('发布动态',e),'error');}
}

function renderChatLists(ctx,char,data) {
    for (const key of ['recentChats','contactsList','requestsList','storyPeopleList']) nodes[key]?.replaceChildren();
    if (!char||!data) return;
    const root=readRootData(ctx);
    const ids=[PRIMARY_CONTACT_ID,...root.contacts.map(c=>c.id)];
    let requests=0, conversations=0;
    for (const id of ids) {
        const person=contactCharacter(ctx,id);
        const view=readData(ctx,id);
        const info=getContactInfo(ctx,id);
        const label=info.remark || info.name;
        const {last,state}=contactSummary(ctx,id);
        const summary=last?.text?.slice(0,64) || (state==='friends'?'点击开始聊天':FRIEND_LABELS[state]);
        if (!view.chatDeleted && (state==='friends' || (view.messages.length>0 && ['friends','outgoing','incoming'].includes(state)))) {
            nodes.recentChats.append(makeListContact(person,view,summary,()=>switchContact(id,'chat'),label));
            conversations++;
        }
        if(state==='friends')nodes.contactsList.append(makeListContact(person,view,FRIEND_LABELS[state],()=>switchContact(id,'profile'),label));
        else nodes.storyPeopleList.append(makeListContact(person,view,'',()=>switchContact(id,'profile'),label));
        if (state==='incoming' || state==='outgoing') {
            nodes.requestsList.append(makeListContact(person,view,state==='incoming'?'请求添加你为好友':state==='outgoing'?'好友申请处理中':'可发送好友申请',()=>switchContact(id,'profile'),label));
            if(state!=='stranger') requests++;
        }
    }
    nodes.requestBadge.textContent=requests ? requests+' 条' : '';
    if (!nodes.requestsList.children.length) {
        const empty=document.createElement('p');
        empty.className='lp-list-empty';
        empty.textContent='暂无好友申请';
        nodes.requestsList.append(empty);
    }
    if (!nodes.contactsList.children.length)nodes.contactsList.textContent='暂无好友';
    if (!conversations) {
        const empty=document.createElement('p');
        empty.className='lp-list-empty';
        empty.textContent='还没有聊天，去通讯录找朋友吧';
        nodes.recentChats.append(empty);
    }
}

const NPC_RELATIONS = '父亲|母亲|爸爸|妈妈|养父|养母|哥哥|姐姐|弟弟|妹妹|兄长|兄弟|妻子|丈夫|老师|导师|教授|同学|室友|朋友|闺蜜|同事|上司|下属|邻居|管家|助理|经纪人|秘书|儿子|女儿|表哥|表姐|舅舅|姑姑|叔叔|阿姨|恋人|未婚夫|未婚妻';
const NPC_COMMON_WORDS = new Set(['人物','角色','背景','故事','正文','世界','设定','学校','老师','学生','朋友','同学','室友','父亲','母亲','爸爸','妈妈','其他','玩家','用户','主角','姓名','年龄','性格','描述','关系','身份','简介','经历','小说','人物设定','个人资料','角色介绍','个人信息','主要人物','背景资料','角色设定','男主','女主','女主角','男主角','职业','特长','喜好','偏好','爱好','兴趣','职业经历','人物身份','教育背景','家庭','父母','性别','身高','体重','外貌','长相','服装','着装','声音','身份信息','家庭关系','成长经历','背景故事','联系方式','备注','与同学','与朋友','与室友','范畴内','范畴外','同学们','朋友们','老师们','老师们','同伴','称呼','职位']);
function cleanNpcName(name) {
    const value=String(name||'').replace(/[“”"'「」『』【】<>()（）]/g,'').trim().replace(/^(?:名叫|名为|叫)/,'');
    if (!/^[\u3400-\u9fff·]{2,8}$/.test(value)||NPC_COMMON_WORDS.has(value)) return '';
    if (/^(?:这位|那位|一个|两个|他的|她的|我的|你的|他们|她们|自己|没有|任何|所有|其它|与|和|跟|对|在|于|将|已|有|被|是|由|把|范畴|范围|目前|现在)/.test(value)) return '';
    return value;
}
function extractNpcCandidatesFromText(sourceText,source,mainName) {
    const text=String(sourceText||'').slice(0,40000);
    const found=[];
    const lines=text.split(/\r?\n|(?<=[。！？；])(?=[^\s])/).map(v=>v.trim()).filter(Boolean);
    const rel=NPC_RELATIONS;
    for(let i=0;i<lines.length&&i<850;i++){
        const line=lines[i].slice(0,1200);
        const trimmed=line.replace(/^[-*\d.、\s#]+/,'');
        const hits=[];
        let m;
        // A labeled character entry, e.g. 姓名：苏晚意 / 角色：宁致远
        const labeled=trimmed.match(/^(?:姓名|人物|角色名|角色姓名|NPC|名字|名称)[：:\s]+([\u3400-\u9fff·]{2,8})(?=\s|[,，;；。]|$)/i);
        if(labeled)hits.push({name:labeled[1],relation:''});
        const heading=trimmed.match(/^(?:#+\s*)?(?:人物|角色|NPC)[：:\s]+([\u3400-\u9fff·]{2,8})(?=\s|[,，;；。]|$)/i);
        if(heading)hits.push({name:heading[1],relation:''});
        // Relation label e.g. 父亲：宁致远
        const relLabel=new RegExp('(?:^|[，,。；;\\s])('+rel+')[：:\\s]+([\\u3400-\\u9fff·]{2,8})(?=\\s|[，,。；;]|$)','g');
        while((m=relLabel.exec(trimmed))!==null)hits.push({name:m[2],relation:m[1]});
        //  宁肆锦的母亲苏晚意 / 他的老师陈某某
        const relationWithName=new RegExp('(?:[\\u3400-\\u9fff·]{2,6}|他|她|我|你)的('+rel+')([\\u3400-\\u9fff·]{2,4})(?=[，,。；;\\s（(]|是|为|在|会|曾|现|于|就|还|并|担任)','g');
        while((m=relationWithName.exec(trimmed))!==null)hits.push({name:m[2],relation:m[1]});
        const namedAs=new RegExp('(?:[\\u3400-\\u9fff·]{2,6}|他|她|我|你)的('+rel+')叫([\\u3400-\\u9fff·]{2,4})(?=[，,。；;\\s]|是|为|在|$)','g');
        while((m=namedAs.exec(trimmed))!==null)hits.push({name:m[2],relation:m[1]});
        const userRelation=new RegExp('(?:user|玩家|\\{\\{user\\}\\})的('+rel+')([\\u3400-\\u9fff·]{2,4})(?=[，,。；;\\s]|是|为|在|会|曾|现|于|$)','gi');

        const namedUserFriend=new RegExp('(?:^|[，,。；;\\s（(])([\\u3400-\\u9fff·]{2,5})\\s*(?:是|为|即|（|\\()\\s*(?:user|玩家|我|\\{\\{user\\}\\})的('+rel+')(?=[，,。；;）)\\s]|$)','gi');
        while((m=namedUserFriend.exec(trimmed))!==null)hits.push({name:m[1],relation:m[2]});
        const friendKey=trimmed.match(/^(?:好友|朋友|闺蜜|室友|同学|老师|昵称|外号)[：:\s]+([\u3400-\u9fff·]{2,5})(?=[，,。；;\s]|$)/);
        if(friendKey)hits.push({name:friendKey[1],relation:trimmed.split(/[：:]/)[0].slice(0,8)});

        while((m=userRelation.exec(trimmed))!==null)hits.push({name:m[2],relation:m[1]});
        // 苏晚意（宁肆锦的母亲） / 宁致远：知名导演，宁肆锦父亲
        const namedRelation=new RegExp('^([\\u3400-\\u9fff·]{2,5})[：:（(][^。\\n]{0,85}?(?:'+rel+')(?=[，,。；;）)\\s]|$)');
        m=trimmed.match(namedRelation);
        if(m)hits.push({name:m[1],relation:trimmed.match(new RegExp(rel))?.[0]||''});
        // Explicit named worldbook title, e.g. 苏晚意 - 人物档案
        if(i===0 || trimmed.startsWith('#')){
            m=trimmed.match(/^#*\s*([\u3400-\u9fff·]{2,5})\s*[-—｜|:：]\s*(?:人物|角色|NPC|档案|父亲|母亲|同学|老师|关系)/);
            if(m)hits.push({name:m[1],relation:''});
        }
        for(const hit of hits){
            const name=cleanNpcName(hit.name);
            if(!name||name===mainName)continue;
            const context=[lines[Math.max(0,i-1)]||'',line,lines[i+1]||''].join('\n').slice(0,900);
            const meaningful=context.replace(/\s/g,'').length>=8;
            if(!meaningful)continue;
            const r=hit.relation ? (new RegExp('(?:user|玩家|\\{\\{user\\}\\})的?'+hit.relation).test(context) ? 'user 的'+hit.relation
                : context.includes(mainName+'的'+hit.relation) ? mainName+'的'+hit.relation
                : '当前角色的'+hit.relation+'（请核对）') : '';
            found.push({name,relation:r,description:context,source,confidence:hit.relation?'关系线索':'人物条目'});
        }
    }
    return found;
}
function mergeNpcCandidates(candidates,root,primaryName) {
    const existing=new Set([primaryName,...root.contacts.map(x=>x.name)].map(x=>String(x).trim().toLocaleLowerCase()));
    const unique=new Map();
    for(const c of candidates){
        const name=cleanNpcName(c.name);
        if(!name||existing.has(name.toLocaleLowerCase()))continue;
        const key=name.toLocaleLowerCase();
        if(!unique.has(key))unique.set(key,{...c,name,description:String(c.description||'').slice(0,3500),relation:String(c.relation||'').slice(0,180)});
        else {
            const previous=unique.get(key);
            if(c.relation&&!previous.relation)previous.relation=c.relation;
            if(previous.description.length<700 && !previous.description.includes(c.description))previous.description=(previous.description+'\n'+c.description).slice(0,3500);
            if(previous.source!==c.source)previous.source+='、'+c.source;
        }
    }
    return [...unique.values()].slice(0,45);
}
function embeddedCharacterLore(char) {
    const info=char?.data||char||{};
    const entries=info.character_book?.entries||char?.character_book?.entries||[];
    return Array.isArray(entries)?entries:[];
}
async function scanNpcSources(ctx,extraWorld='') {
    const char=selectedCharacter(ctx);
    if(!char)throw new Error('请先打开角色卡的单人聊天');
    const info=char.data||char;
    const sources=[];
    const selfNames=personaNames(ctx);
    const persona=currentPersona(ctx);
    if(persona.description)sources.push({name:'当前 user 人设',text:persona.description});
    const fields=['description','personality','scenario','mes_example','first_mes'];
    const cardText=fields.map(k=>typeof info[k]==='string'?info[k]:'').filter(Boolean).join('\n');
    if(cardText)sources.push({name:'当前角色卡',text:cardText.slice(0,40000)});
    for(const entry of embeddedCharacterLore(char).slice(0,160)){
        if(entry.enabled===false||entry.disable===true)continue;
        const title=String(entry.name||entry.comment||'');
        const content=String(entry.content||'');
        if(content)sources.push({name:'角色卡内嵌世界书 · '+title,text:title+'\n'+content,title,profileEntry:true});
    }
    const names=new Set();
    if(typeof info.extensions?.world==='string'&&info.extensions.world.trim())names.add(info.extensions.world.trim());
    if(persona.lorebook)names.add(persona.lorebook);
    if(extraWorld)names.add(extraWorld);

    let loaded=0,failures=[];
    for(const name of [...names]){
        if(typeof ctx.loadWorldInfo!=='function'){failures.push('世界书接口不可用');break;}
        try {
            const book=await ctx.loadWorldInfo(name);
            if(!book?.entries){failures.push(name+'：没有返回条目');continue;}
            loaded++;
            const entries=Array.isArray(book.entries)?book.entries:Object.values(book.entries);
            for(const entry of entries.slice(0,280)){
                if(entry?.disable===true||entry?.enabled===false)continue;
                const title=String(entry?.comment||entry?.name||'');
                const content=String(entry?.content||'');
                if(content)sources.push({name:'世界书「'+name+'」 · '+title,text:title+'\n'+content,title,profileEntry:true});
            }
        }catch(e){failures.push(name+'：'+String(e?.message||e).slice(0,90));}
    }
    const candidates=[];
    for(const source of sources){
        if(source.profileEntry && (/文风|写作|叙事|排版|格式|提示词|系统指令|输出规则|示例/.test(source.title) || /文风要求|写作风格|写作要求|叙事规则|输出格式|扮演规则/.test(source.text.slice(0,300))))continue;
        const parsed=extractNpcCandidatesFromText(source.text,source.name,getCharacterName(char));
        const titleName=source.profileEntry ? cleanNpcName(source.title) : '';
        const titleLooksLikeBio=titleName && !selfNames.has(titleName) && titleName!==getCharacterName(char) && source.text.slice(source.title.length).includes(titleName) &&
            /(?:姓名|年龄|职业|身份|性格|外貌|长相|个人经历|人物背景|画家|导演|教授|助理|室友|同学|朋友|老师)/.test(source.text.slice(0,900));
        if(titleLooksLikeBio){
            if(!parsed.some(x=>x.name===titleName))parsed.unshift({
                name:titleName,relation:'',description:source.text.slice(0,3500),
                source:source.name,confidence:'人物档案标题'
            });
            else for(const candidate of parsed){
                if(candidate.name===titleName)candidate.description=source.text.slice(0,3500);
            }
        }
        candidates.push(...parsed);
    }
    return {candidates:mergeNpcCandidates(candidates.filter(c=>!selfNames.has(c.name)),readRootData(ctx),getCharacterName(char)),scanned:sources.length,worlds:loaded,failures};
}
function sameNpcScanSession(snapshot) {
    const ctx=context();
    return ctx?.chatMetadata===snapshot.metadata &&
           ctx?.characterId===snapshot.characterId &&
           ctx?.chatId===snapshot.chatId &&
           lifecycleToken===snapshot.lifecycleToken;
}
function makeNpcScanSnapshot(ctx) {
    return {metadata:ctx.chatMetadata,characterId:ctx.characterId,chatId:ctx.chatId,lifecycleToken};
}
function renderNpcCandidates() {
    if(!nodes?.npcCandidates)return;
    nodes.npcCandidates.replaceChildren();
    if(!npcCandidates.length) {
        nodes.npcCandidates.textContent='没有找到可确认的人物；可以改为手动创建，或额外指定一部世界书。';
        return;
    }
    for(const [index,c] of npcCandidates.entries()){
        const row=document.createElement('div');
        row.className='lp-npc-candidate';
        const header=document.createElement('label');
        const input=document.createElement('input');input.type='checkbox';input.dataset.npcCandidate=String(index);
        const title=document.createElement('strong');title.textContent=c.name;
        header.append(input,title);row.append(header);
        const meta=document.createElement('small');meta.textContent=c.confidence+' · '+c.source;row.append(meta);
        for(const [field,value,placeholder,max] of [['name',c.name,'姓名',60],['relation',c.relation,'人物关系（可修改）',180]]){
            const edit=document.createElement('input');
            edit.type='text';edit.maxLength=max;edit.dataset.npcField=field;edit.dataset.npcIndex=String(index);
            edit.value=value;edit.placeholder=placeholder;row.append(edit);
        }
        const summary=document.createElement('details');
        const st=document.createElement('summary');st.textContent='查看并编辑人物资料';
        const note=document.createElement('textarea');note.dataset.npcField='description';note.dataset.npcIndex=String(index);
        note.maxLength=3500;note.rows=5;note.value=c.description;
        summary.append(st,note);row.append(summary);
        nodes.npcCandidates.append(row);
    }
}
async function scanNpcUI() {
    if(npcScanning||busy)return;
    const ctx=context();
    if(!selectedCharacter(ctx))return setStatus('请先进入一条角色聊天存档','error');
    npcScanning=true;
    const snapshot=makeNpcScanSnapshot(ctx);
    npcScanSession=snapshot;
    nodes.npcScanButton.disabled=true;
    nodes.npcScanState.textContent='正在读取角色卡和世界书…';
    try {
        const result=await scanNpcSources(ctx,nodes.npcWorldSelect.value);
        if(!sameNpcScanSession(snapshot))return;
        npcCandidates=result.candidates;
        renderNpcCandidates();
        nodes.npcScanState.textContent='扫描 '+result.scanned+' 段资料、'+result.worlds+' 本世界书，找到 '+npcCandidates.length+' 位候选人物。'+(result.failures.length?' 未读取：'+result.failures.join('；'):'');
        recordActivity('NPC 扫描','候选 '+npcCandidates.length+'，未自动添加任何好友','success');
    }catch(e){
        if(sameNpcScanSession(snapshot)){
            nodes.npcScanState.textContent='扫描失败：'+String(e.message||e);
            recordError('扫描 NPC',e);
        }
    }finally{npcScanning=false;if(nodes?.npcScanButton)nodes.npcScanButton.disabled=false;}
}
async function saveSelectedNpcCandidates() {
    if(busy||npcScanning||!npcScanSession||!sameNpcScanSession(npcScanSession))return setStatus('请重新扫描当前存档','error');
    const selected=[...nodes.npcCandidates.querySelectorAll('input[data-npc-candidate]:checked')];
    if(!selected.length)return setStatus('请先勾选要加入的人物','error');
    const ctx=context();const root=structuredClone(readRootData(ctx));
    const existing=new Set([getCharacterName(selectedCharacter(ctx)),...root.contacts.map(c=>c.name)].map(v=>v.toLocaleLowerCase()));
    const additions=[];
    for(const checkbox of selected){
        const row=checkbox.closest('.lp-npc-candidate');
        const get=key=>row?.querySelector('[data-npc-field="'+key+'"]')?.value?.trim()||'';
        const name=cleanNpcName(get('name'));
        const relation=get('relation').slice(0,180);
        const description=get('description').slice(0,3500);
        if(!name||!description)return setStatus('候选人物必须有合法姓名与人物设定','error');
        if(personaNames(ctx).has(name))return setStatus('不能添加当前人设本人','error');
        if(existing.has(name.toLocaleLowerCase()))continue;
        existing.add(name.toLocaleLowerCase());
        if(root.contacts.length+additions.length>=60)break;
        const index=Number(checkbox.dataset.npcCandidate);
        const candidate=npcCandidates[index];if(!candidate)continue;
        const id='npc:'+Date.now().toString(36)+Math.random().toString(36).slice(2,9);
        additions.push({id,kind:'npc',name,remark:'',relationship:relation,description,source:candidate.source,createdAt:new Date().toISOString()});
    }
    if(!additions.length)return setStatus('这些人物已存在，或联系人数量已达上限','error');
    if(!window.confirm('将选中的 '+additions.length+' 位人物加入当前存档通讯录？默认不是好友。'))return;
    for(const person of additions){
        root.contacts.push(person);
        root.conversations[person.id]={messages:[],friendship:{state:'stranger'},friendEvents:[],chatDeleted:false};
    }
    try {
        await writeData(ctx,{...root,__contactId:PRIMARY_CONTACT_ID});
        npcCandidates=[];npcScanSession=null;
        renderNpcCandidates();
        render();setScreen('addNpc');
        setStatus('已添加 '+additions.length+' 位 NPC 联系人');
    } catch(e){setStatus(recordError('保存扫描人物',e),'error');}
}
function populateNpcWorldSelect() {
    if(!nodes?.npcWorldSelect)return;
    const ctx=context();
    const names=ctx?.getWorldInfoNames?.()||[];
    const selected=nodes.npcWorldSelect.value;
    nodes.npcWorldSelect.replaceChildren();
    const empty=document.createElement('option');empty.value='';empty.textContent='当前角色与当前人设关联资料';nodes.npcWorldSelect.append(empty);
    for(const name of names){
        const op=document.createElement('option');
        op.value=String(name);op.textContent=String(name);
        nodes.npcWorldSelect.append(op);
    }
    if(names.includes(selected))nodes.npcWorldSelect.value=selected;
}

async function addNpcContact() {
    if (busy) return;
    const ctx=context();
    if (!selectedCharacter(ctx)) return setStatus('请先打开单人角色聊天存档','error');
    const name=nodes.npcName.value.trim().slice(0,60);
    const relationship=nodes.npcRelation.value.trim().slice(0,180);
    const description=nodes.npcDescription.value.trim().slice(0,3500);
    if (!name) return setStatus('请填写 NPC 名称','error');
    if (personaNames(ctx).has(name)) return setStatus('不能添加当前人设本人','error');
    if (!description) return setStatus('请填写 NPC 设定，避免模型凭空编造人物','error');
    const root=structuredClone(readRootData(ctx));
    if (root.contacts.length>=60) return setStatus('当前存档最多添加 60 位 NPC','error');
    const id='npc:'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
    root.contacts.push({id,kind:'npc',name,remark:'',relationship,description,source:'manual',createdAt:new Date().toISOString()});
    root.conversations[id]={messages:[],friendship:{state:'stranger'},friendEvents:[],chatDeleted:false};
    try {
        await writeData(ctx,{...root,__contactId:PRIMARY_CONTACT_ID});
        nodes.npcName.value='';nodes.npcRelation.value='';nodes.npcDescription.value='';
        switchContact(id,'profile');
    } catch(e) {setStatus(recordError('保存 NPC 联系人',e),'error');}
}
async function saveContactRemark() {
    if (busy) return;
    const ctx=context();
    const remark=nodes.contactRemark.value.trim().slice(0,60);
    if (activeContactId===PRIMARY_CONTACT_ID) {
        const data=structuredClone(readRootData(ctx));
        data.primaryRemark=remark;
        try {await writeData(ctx,{...data,__contactId:PRIMARY_CONTACT_ID});render();}
        catch(e){setStatus(recordError('保存备注',e),'error');}
        return;
    }
    const data=structuredClone(readRootData(ctx));
    const target=data.contacts.find(c=>c.id===activeContactId);
    if (!target) return;
    target.remark=remark;
    try {await writeData(ctx,{...data,__contactId:PRIMARY_CONTACT_ID});render();}
    catch(e){setStatus(recordError('保存备注',e),'error');}
}
async function removeNpcContact() {
    if(busy||activeContactId===PRIMARY_CONTACT_ID) return;
    if(!window.confirm('删除此 NPC 联系人及其私聊记录？此操作无法撤销，建议先导出聊天记录。')) return;
    const ctx=context();
    const data=structuredClone(readRootData(ctx));
    const id=activeContactId;
    data.contacts=data.contacts.filter(c=>c.id!==id);
    delete data.conversations[id];
    try {
        await writeData(ctx,{...data,__contactId:PRIMARY_CONTACT_ID});
        activeContactId=PRIMARY_CONTACT_ID;
        render();
        setScreen('contacts');
    } catch(e){setStatus(recordError('删除 NPC 联系人',e),'error');}
}

async function updateAvatar(side, file) {
    if (!file) return;
    if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type) || file.size>350*1024) {
        setStatus('请使用不超过350KB的 PNG/JPG/WebP/GIF 图片','error');return;
    }
    const ctx=context();
    if (!selectedCharacter(ctx)||busy) return;
    const session=captureSession(ctx);
    const reader=new FileReader();
    reader.onerror=()=>setStatus('头像读取失败','error');
    reader.onload=async()=>{
        if (!sameSession(session)) return;
        if (typeof reader.result!=='string'||!allowedAvatarSrc(reader.result)) return setStatus('头像格式不支持','error');
        const data=structuredClone(readData(ctx));
        data.avatars ||= {};
        data.avatars[side]=reader.result;
        try { await writeData(ctx,data); if (mounted) render(); }
        catch(e) {setStatus(recordError('保存头像',e),'error');}
    };
    reader.readAsDataURL(file);
}
async function resetAvatar(side) {
    const ctx=context();
    if (!selectedCharacter(ctx)||busy) return;
    const data=structuredClone(readData(ctx));
    if (data.avatars) delete data.avatars[side];
    try { await writeData(ctx,data);render(); }
    catch(e) {setStatus(recordError('重置头像',e),'error');}
}
function exportChatPayload(ctx,data) {
    return {format:'gujiguji-chat',version:1,character:getCharacterName(selectedCharacter(ctx)),exportedAt:new Date().toISOString(),
        messages:data.messages.map(({id,from,text,storyTime,createdAt,image,sticker,stickerName,replyTo,replyQuote})=>({
            id,from,text,storyTime,createdAt,...(image?{image}:{}),...(sticker?{sticker:true,stickerName}:{}),
            ...(replyTo?{replyTo}:{}),...(replyQuote?{replyQuote}:{})
        }))};
}
function parseChatImport(raw) {
    const obj=JSON.parse(raw);
    if (!obj || obj.format!=='gujiguji-chat'||obj.version!==1||!Array.isArray(obj.messages)||obj.messages.length>10000)
        throw new Error('不是受支持的咕叽咕机聊天记录');
    return obj.messages.map((m,i)=>{
        if (!m || !['user','character','system'].includes(m.from) || typeof m.text!=='string'||m.text.length>50000)
            throw new Error('第'+(i+1)+'条消息格式不合法');
        const image=typeof m.image==='string' && /^data:image\/(?:jpeg|png|webp|gif);base64,/.test(m.image) && m.image.length<950000?m.image:'';
        return {id: typeof m.id==='string'&&m.id.length<100?m.id:'import-'+i+'-'+Date.now(),
            from:m.from,text:m.text,storyTime:typeof m.storyTime==='string'?m.storyTime.slice(0,30):'',
            createdAt:typeof m.createdAt==='string'?m.createdAt.slice(0,40):new Date().toISOString(),
            ...(image?{image}:{}),...(image&&m.sticker===true?{sticker:true,stickerName:String(m.stickerName||'').slice(0,60)}:{}),
            ...(typeof m.replyQuote==='string'?{replyQuote:m.replyQuote.slice(0,180)}:{}),
            ...(typeof m.replyTo==='string'?{replyTo:m.replyTo.slice(0,100)}:{})
        };
    });
}
function getChatExport() {
    const ctx=context();
    return JSON.stringify(exportChatPayload(ctx,readData(ctx)),null,2);
}
async function copyChatExport() {
    try {
        await navigator.clipboard.writeText(getChatExport());
        setStatus('已复制聊天记录 JSON');
    } catch(e){setStatus(recordError('复制聊天记录',e),'error');}
}
function downloadChatExport() {
    try {
        const payload=getChatExport();
        const blob=new Blob([payload],{type:'application/json;charset=utf-8'});
        const url=URL.createObjectURL(blob);
        const anchor=document.createElement('a');
        anchor.href=url;anchor.download='gujiguji-chat-'+new Date().toISOString().slice(0,10)+'.json';
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(()=>URL.revokeObjectURL(url),60000);
        setStatus('已请求下载聊天记录');
    } catch(e) {setStatus(recordError('导出聊天记录',e),'error');}
}
async function importChatFile(file) {
    if (!file) return;
    if (busy) return setStatus('生成期间无法导入','error');
    if (file.size>5*1024*1024) return setStatus('聊天记录文件不能超过5MB','error');
    try {
        const messages=parseChatImport(await file.text());
        if (!window.confirm('导入 '+messages.length+' 条记录并替换当前手机聊天消息？其他配置不会被覆盖。')) return;
        const ctx=context();
        const session=captureSession(ctx);
        const data=structuredClone(readData(ctx));
        data.messages=messages;
        data.chatDeleted=false;
        await writeData(ctx,data);
        if (sameSession(session)) {setStatus('已导入 '+messages.length+' 条记录');render();setScreen('chat');}
    } catch(e) {setStatus(recordError('导入聊天记录',e),'error');}
}
async function clearOrDeleteChat(deleteConversation=false) {
    if (busy) return;
    const ctx=context();
    if (!selectedCharacter(ctx)) return;
    const message=deleteConversation?'删除当前会话？消息会被清空，联系人关系和设置保留。':'清空当前聊天的全部消息？此操作不可撤销，建议先导出备份。';
    if (!window.confirm(message)) return;
    const data=structuredClone(readData(ctx));
    data.messages=[];
    data.chatDeleted=deleteConversation;
    try {
        await writeData(ctx,data);
        render();
        setScreen(deleteConversation?'chatList':'chat');
    } catch(e) {setStatus(recordError('删除聊天记录',e),'error');}
}

function openMessageActions(id) {
    if(busy)return;
    selectedMessageId=id;
    nodes.messageActions.hidden=false;
}
function closeMessageActions() {
    selectedMessageId=null;
    nodes.messageActions.hidden=true;
}
async function handleMessageOperation(action) {
    const ctx=context();
    const current=readData(ctx);
    const msg=current.messages.find(x=>x.id===selectedMessageId);
    if(!msg)return closeMessageActions();
    if(action==='saveSticker'){
        if(!msg.image)return setStatus('这条消息没有图片','error');
        const label=window.prompt('表情包名称／关键词',msg.stickerName||'');
        if(label===null)return;
        try{saveSticker(msg.image,label);renderStickerLibrary();setStatus('已收藏表情包');}catch(e){setStatus(e.message,'error');}
    } else if(action==='quote'){
        quotedMessageId=msg.id;
        nodes.quotedPreview.textContent='引用：'+msg.text.slice(0,100);
        nodes.quotedPreview.hidden=false;
        nodes.input.focus();
    } else if(action==='edit'){
        if(msg.from!=='user')return setStatus('只能编辑自己发送的消息','error');
        const replacement=window.prompt('编辑这条消息',msg.text);
        if(replacement===null)return;
        const data=structuredClone(current);
        const target=data.messages.find(x=>x.id===msg.id);
        if(target){target.text=replacement.slice(0,5000);target.editedAt=new Date().toISOString();}
        try{await writeData(ctx,data);render();}catch(e){setStatus(recordError('编辑消息',e),'error');}
    } else if(action==='forward'){
        const root=readRootData(ctx);
        const targets=[PRIMARY_CONTACT_ID,...root.contacts.map(x=>x.id)].filter(id=>id!==activeContactId&&friendshipState(readData(ctx,id))==='friends');
        if(!targets.length)return setStatus('暂无其他已添加的好友可以转发','error');
        const description=targets.map((id,i)=>(i+1)+'. '+contactDisplayName(ctx,id)).join('\n');
        const choice=window.prompt('转发到哪位好友？输入序号：\n'+description);
        if(choice===null)return;
        const chosen=targets[Number(choice)-1];
        if(!chosen)return setStatus('选择的联系人无效','error');
        const data=structuredClone(readData(ctx,chosen));
        data.messages.push({...makeMessage('user','[转发] '+msg.text,data.storyTime),forwardFrom:contactDisplayName(ctx)});
        try{await writeData(ctx,data);setStatus('已转发到 '+contactDisplayName(ctx,chosen));}
        catch(e){setStatus(recordError('转发消息',e),'error');}
    } else if(action==='delete'){
        closeMessageActions();await deleteIndividualMessage(msg.id);return;
    } else if(action==='copy'){
        try{await navigator.clipboard.writeText(msg.text);setStatus('已复制消息');}
        catch(e){setStatus(recordError('复制消息',e),'error');}
    }
    closeMessageActions();
}
async function sendImageFile(file) {
    if(!file||busy)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type))return setStatus('目前支持 PNG、JPG、WebP 图片','error');
    if(file.size>650*1024)return setStatus('图片暂限 650KB，请先缩小图片再发送','error');
    const ctx=context();
    if(readApiOptions(readData(ctx)).mode!=='custom')return setStatus('图片识别需要在设置中使用支持视觉输入的独立 OpenAI 兼容 API','error');
    const reader=new FileReader();
    const session=captureSession(ctx);
    reader.onerror=()=>setStatus('图片读取失败','error');
    reader.onload=()=>{if(sameSession(session)&&typeof reader.result==='string')void sendUserMessage('[图片]',reader.result);};
    reader.readAsDataURL(file);
}
function toggleChatTools(type) {
    if(!nodes)return;
    nodes.emojiPanel.hidden=type!=='emoji' || !nodes.emojiPanel.hidden;
    nodes.morePanel.hidden=type!=='more' || !nodes.morePanel.hidden;
}
function startChatTool(action) {
    if(action==='photo'){nodes.chatImageInput.click();return;}
    if(action==='location'){
        const location=window.prompt('输入故事中的地点');
        if(location?.trim()){nodes.input.value='[分享位置] '+location.trim().slice(0,160);nodes.input.focus();}
    } else if(action==='transfer'){
        const amount=window.prompt('剧情内转账金额（虚拟金额，不涉及真实支付）');
        if(amount!==null && /^\d+(?:\.\d{1,2})?$/.test(amount)&&Number(amount)>0){
            nodes.input.value='[剧情转账] 向'+contactDisplayName(context())+'转账 '+amount+' 元（虚拟情节）';nodes.input.focus();
        }
    } else if(action==='call'){
        nodes.input.value='[剧情语音通话邀请] 方便接电话吗？';nodes.input.focus();
    } else if(action==='emoji'){
        renderStickerLibrary();
        toggleChatTools('emoji');
    } else if(action==='more')toggleChatTools('more');
}

async function deleteIndividualMessage(id) {
    if (busy) return;
    const ctx=context();
    if (!selectedCharacter(ctx)) return;
    if (!window.confirm('删除这条消息？')) return;
    const data=structuredClone(readData(ctx));
    const before=data.messages.length;
    data.messages=data.messages.filter(x=>x.id!==id);
    if (data.messages.length===before) return;
    try { await writeData(ctx,data);render(); }catch(e){setStatus(recordError('删除消息',e),'error');}
}

function renderMessages(data) {
    nodes.messages.replaceChildren();
    nodes.messageActions.hidden=true;
    if (!data.messages.length) {
        const empty = document.createElement('p');
        empty.className='lp-empty';
        empty.textContent='暂无消息';
        nodes.messages.append(empty);
    }
    const fragment=document.createDocumentFragment();
    const avatars=avatarSources(context(),data);
    for (const message of data.messages) {
        if (typeof message?.text!=='string') continue;
        const row=document.createElement('div');
        row.className='lp-message '+(message.from==='system'?'lp-system':message.from==='character'?'lp-theirs':'lp-mine');
        const body=document.createElement('div');
        body.className='lp-message-body';
        const bubble=document.createElement('div');
        bubble.className='lp-bubble';
        bubble.textContent=message.text;
        if(message.replyQuote){const quote=document.createElement('div');quote.className='lp-inline-quote';quote.textContent=message.replyQuote;bubble.prepend(quote);}
        if(message.image){const picture=document.createElement('img');picture.className='lp-chat-image';picture.src=message.image;picture.alt='聊天图片';bubble.append(picture);}
        const stamp=document.createElement('small');
        stamp.className='lp-message-time';
        stamp.textContent=String(message.storyTime || '').replace('T',' ');
        body.append(bubble,stamp);
        if (message.from!=='system') {
            row.append(makeAvatarElement(message.from==='character'?avatars.character:avatars.user,message.from==='character'?'角色头像':'我的头像'),body);
        } else row.append(body);
        const remove=document.createElement('button');
        remove.type='button';
        remove.className='lp-message-remove';
        remove.textContent='⋯';
        remove.setAttribute('aria-label','消息操作');
        remove.addEventListener('click',()=>openMessageActions(message.id));
        row.append(remove);
        bubble.addEventListener('contextmenu',event=>{event.preventDefault();openMessageActions(message.id);});
        fragment.append(row);
    }
    if (busy && busyKind==='reply') {
        const typing=document.createElement('div');
        typing.className='lp-message lp-theirs lp-typing-row';
        typing.append(makeAvatarElement(avatars.character,'角色头像'));
        const bubble=document.createElement('div');
        bubble.className='lp-typing';
        bubble.textContent='● ● ●';
        bubble.setAttribute('aria-label','对方正在输入');
        typing.append(bubble);
        fragment.append(typing);
    }
    nodes.messages.append(fragment);
    nodes.messages.scrollTop=nodes.messages.scrollHeight;
}

function renderFriendship(data) {
    if (!nodes?.friendActions) return;
    nodes.friendActions.replaceChildren();
    const state = data ? friendshipState(data) : null;
    const access=contactAccess(context());
    nodes.friendLabel.textContent = state ? FRIEND_LABELS[state] + (state==='stranger'?' · '+access.source:'') : '暂无联系人';
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
        button.disabled = busy || (action==='add'&&!access.allowed);
        nodes.friendActions.append(button);
    }
}

function render() {
    if (!mounted || !nodes) return;
    const ctx = context();
    const primary = selectedCharacter(ctx);
    if (!validContactId(readRootData(ctx),activeContactId)) activeContactId=PRIMARY_CONTACT_ID;
    const char = primary ? contactCharacter(ctx) : null;
    const data = primary ? readData(ctx) : null;

    nodes.profileName.textContent = char ? contactDisplayName(ctx) : '请先选择角色';
    nodes.contactRemark.value = getContactInfo(ctx).remark || '';
    nodes.profileDescription.textContent = activeContactId===PRIMARY_CONTACT_ID
        ? '当前酒馆角色卡'
        : [getContactInfo(ctx).relationship,getContactInfo(ctx).description].filter(Boolean).join(' · ').slice(0,500);
    nodes.deleteNpc.hidden = activeContactId===PRIMARY_CONTACT_ID;
    nodes.contactEvidence.textContent=contactAccess(ctx).evidence||contactAccess(ctx).source;
    nodes.profileAvatar.src = avatarSources(ctx,data).character;
    renderChatLists(ctx,char,data);
    renderMoments(ctx);
    nodes.subtitle.textContent = char ? '故事中的小手机 · 独立聊天' : '请先选择单人角色存档';
    nodes.homeCharacter.textContent = primary ? `与 ${getCharacterName(primary)} 的故事` : '等待进入角色存档';
    nodes.homeTime.textContent = (data?.storyTime || localDateTime()).replace('T', ' ');
    nodes.homeMessageCount.textContent = `${readRootData(ctx).contacts.length+1} 位联系人`;
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
        const catalog=stickerLibrary(ctx);
        const systemPrompt = [await composePhonePrompt(ctx, char, data), messageStylePrompt(data), stickerPrompt(catalog)].filter(Boolean).join('\n\n');
        recordActivity('生成配置', '使用当前酒馆连接' + (ctx?.mainApi ? ' · ' + ctx.mainApi : '') + '；手机历史 ' + buildPrompt(data).length + ' 条；单独预设条目 ' + (data?.config?.presetEntries?.length || 0) + ' 条；世界书条目 ' + (data?.config?.worldEntries?.length || 0) + ' 条。');
        const result = await generateWithTimeout(ctx, {
            systemPrompt,
            prompt: buildPrompt(data),
        }, data);
        if (!sameSession(session)) return;
        const reply = typeof result === 'string' ? result.trim() : '';
        if (!reply) throw new Error('模型返回了空消息或不支持的回复类型。');
        const phoneMessages = parseStickerReply(reply,data,catalog);
        if (!phoneMessages.length) throw new Error('角色消息为空');
        for (const message of phoneMessages) data.messages.push({...makeMessage('character',message.text,data.storyTime),...message});
        await writeData(ctx, data);
        recordActivity('生成成功', '已保存 ' + phoneMessages.length + ' 条角色消息', 'success');
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
    const char = contactCharacter(ctx);
    if (!selectedCharacter(ctx)) return;
    const data = structuredClone(readData(ctx));
    if (friendshipState(data) !== 'friends' || data.messages.at(-1)?.from !== 'user') return;
    if (typeof ctx.generateRaw !== 'function' && !ctx.ChatCompletionService?.sendRequest) {
        setStatus(recordError('重试生成', new Error('当前酒馆未提供生成接口。')), 'error');
        return;
    }
    await runReply(ctx, char, data, captureSession(ctx));
}

async function sendUserMessage(text,image='',sticker=null) {
    if (!mounted || busy) return;
    const ctx=context();
    const char=contactCharacter(ctx);
    const content=String(text||'').trim();
    if(!char||!content||friendshipState(readData(ctx))!=='friends')return;
    if(image && !sticker && readApiOptions(readData(ctx)).mode!=='custom')return setStatus('图片发送需使用支持视觉输入的独立 API','error');
    if(typeof ctx.generateRaw!=='function' && !ctx.ChatCompletionService?.sendRequest)return setStatus('当前酒馆未提供生成接口','error');
    const session=captureSession(ctx);
    const data=structuredClone(readData(ctx));
    const quoted=data.messages.find(x=>x.id===quotedMessageId);
    const message=makeMessage('user',content,data.storyTime);
    if(quoted){message.replyTo=quoted.id;message.replyQuote=quoted.text.slice(0,180);}
    if(image)message.image=image;
    if(sticker){message.sticker=true;message.stickerName=sticker.label;}
    data.messages.push(message);data.chatDeleted=false;
    const job=startBusy('reply');
    recordActivity('发送消息','正在保存玩家消息');
    try {
        await writeData(ctx,data);
        if(!sameSession(session))return;
        nodes.input.value='';
        quotedMessageId=null;nodes.quotedPreview.hidden=true;
        nodes.morePanel.hidden=true;nodes.emojiPanel.hidden=true;
        await runReply(ctx,char,data,session,job);
    }catch(e){if(sameSession(session))setStatus(recordError('发送消息',e),'error');}
    finally{finishBusy(job);if(mounted)render();}
}
async function send() { return sendUserMessage(nodes.input.value); }

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
    const char = contactCharacter(ctx);
    const data = structuredClone(readData(ctx));
    if (!selectedCharacter(ctx) || friendshipState(data) !== 'outgoing') return;
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
        if(!contactAccess(ctx).allowed)return setStatus('正文尚无交换联系方式的证据，可在人物资料中手动确认','error');
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

function syncPhoneViewport() {
    if (!root?.classList.contains('lp-open')) return;
    const panel = root.querySelector('.lp-panel');
    if (!panel) return;
    const viewport=window.visualViewport;
    const height=viewport?.height || window.innerHeight || 700;
    const offset=viewport?.offsetTop || 0;
    const targetHeight=Math.max(230,Math.min(670,height-18));
    panel.style.height=targetHeight+'px';
    panel.style.maxHeight=targetHeight+'px';
    panel.style.top=Math.max(4,offset+(height-targetHeight)/2)+'px';
    panel.style.left='50%';
    panel.style.transform='translateX(-50%)';
    if (activeScreen==='chat') {
        const messages=nodes?.messages;
        if (messages) messages.scrollTop=messages.scrollHeight;
    }
}

function openPhone() {
    if (!extensionEnabled) return;
    try {
        if (!mounted || !root) bindReady();
        if (!mounted || !root || !nodes) throw new Error('手机界面尚未初始化');
        // A native modal occupies the browser's top layer, outside the host's
        // stacking contexts. The previous html-root fixed overlay could end up
        // outside Android WebView's hit-testing viewport.
        if (root.parentElement !== document.body) document.body.append(root);
        const panel = root.querySelector('.lp-panel');
        if (!panel) throw new Error('找不到手机主屏容器');
        root.classList.add('lp-open');
        if (typeof panel.showModal === 'function' && !panel.open) panel.showModal();
        syncPhoneViewport();
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
    if (previous?.isConnected && previous === wandEntry && previous.parentElement === menu) return true;
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
          <button type="button" class="lp-header-menu" data-lp="chatMenu" aria-label="聊天设置" hidden>···</button>
          <button type="button" class="lp-close" data-lp="close" aria-label="关闭咕叽咕机">×</button>
        </header>
        <section class="lp-screen lp-home" data-lp-screen="home" aria-label="手机桌面">
          <div class="lp-home-hero">
            <div class="lp-home-greeting">咕叽咕机 · GujiGuji · v0.7.1</div>
            <div class="lp-home-time" data-lp="homeTime">故事时间</div>
            <div class="lp-home-character" data-lp="homeCharacter">等待进入角色存档</div>
          </div>
          <div class="lp-home-summary" data-lp="homeMessageCount">0 条聊天记录</div>
          <div class="lp-app-grid" aria-label="小手机应用">
            <button type="button" class="lp-app-tile" data-lp-open="chatList"><span class="lp-app-icon lp-app-chat" data-lp-icon="chat">💬</span><span>咕叽聊</span><small>可使用</small></button>
            <button type="button" class="lp-app-tile" data-lp-open="diagnostics"><span class="lp-app-icon lp-app-log" data-lp-icon="diagnostics">🛠️</span><span>运行日志</span><small data-lp="homeLogCount">0 条记录</small></button>
            <button type="button" class="lp-app-tile" data-lp-open="settings"><span class="lp-app-icon lp-app-settings" data-lp-icon="settings">⚙️</span><span>设置</span></button>
            <button type="button" class="lp-app-tile" data-lp-open="calendar"><span class="lp-app-icon" data-lp-icon="calendar">📅</span><span>日历</span></button>
            <button type="button" class="lp-app-tile" data-lp-open="theme"><span class="lp-app-icon" data-lp-icon="theme">🎨</span><span>主题</span></button>
            <div class="lp-app-tile lp-app-soon" aria-label="相册，待开发"><span class="lp-app-icon" data-lp-icon="album">🖼️</span><span>相册</span><small>待开发</small></div>
            <div class="lp-app-tile lp-app-soon" aria-label="购物，待开发"><span class="lp-app-icon" data-lp-icon="shopping">🛍️</span><span>购物</span><small>待开发</small></div>
            <div class="lp-app-tile lp-app-soon" aria-label="外卖，待开发"><span class="lp-app-icon" data-lp-icon="takeout">🥡</span><span>外卖</span><small>待开发</small></div>
          </div>
        </section>
        <section class="lp-screen lp-chatlist" data-lp-screen="chatList" aria-label="消息列表" hidden>
          <div class="lp-list-body">
            <div class="lp-list-heading">消息</div>
            <div data-lp="recentChats"></div>
          </div>
          <nav class="lp-tabbar" aria-label="咕叽聊导航">
            <button data-lp-open="chatList" type="button">消息</button>
            <button data-lp-open="contacts" type="button">通讯录</button>
            <button data-lp-open="discover" type="button">发现</button>
            <button data-lp-open="me" type="button">我</button>
          </nav>
        </section>
        <section class="lp-screen lp-chatlist" data-lp-screen="contacts" aria-label="通讯录" hidden>
          <div class="lp-list-body">
            <button type="button" class="lp-list-action" data-lp-open="requests"><span>✉</span><span>新的朋友</span><span data-lp="requestBadge"></span></button>
            <button type="button" class="lp-list-action" data-lp-open="addNpc"><span>＋</span><span>添加好友／故事人物</span></button>
            <div class="lp-list-heading">好友</div>
            <div data-lp="contactsList"></div>

          </div>
          <nav class="lp-tabbar" aria-label="咕叽聊导航">
            <button data-lp-open="chatList" type="button">消息</button>
            <button data-lp-open="contacts" type="button">通讯录</button>
            <button data-lp-open="discover" type="button">发现</button>
            <button data-lp-open="me" type="button">我</button>
          </nav>
        </section>
        <section class="lp-screen lp-chatlist" data-lp-screen="discover" aria-label="发现" hidden>
          <div class="lp-list-body lp-discover">
            <button type="button" class="lp-list-action lp-discovery-action" data-lp-open="me"><span>＋</span><span>发布朋友圈</span></button>
            <div class="lp-moments-panel">

              <div data-lp="momentsFeed" class="lp-moments-feed"></div>
            </div>
          </div>
                    <nav class="lp-tabbar" aria-label="咕叽聊导航">
            <button data-lp-open="chatList" type="button">消息</button>
            <button data-lp-open="contacts" type="button">通讯录</button>
            <button data-lp-open="discover" type="button">发现</button>
            <button data-lp-open="me" type="button">我</button>
          </nav>
        </section>
        <section class="lp-screen lp-chatlist" data-lp-screen="me" aria-label="我" hidden>
          <div class="lp-list-body lp-me-page">
            <div class="lp-me-title">我的小手机</div>
            <img data-lp="myAvatar" class="lp-person-avatar" alt="我的头像" />
            <div data-lp="myIdentity" class="lp-me-identity"></div>
            <details><summary>当前人设</summary><div data-lp="myPersona" class="lp-persona-description"></div></details>
            <h2>发布朋友圈</h2>
              <label class="lp-field">发表动态<textarea data-lp="momentsText" rows="3" maxlength="1000" placeholder="这一刻想说什么？"></textarea></label>
              <button data-lp="momentsPost" type="button">发表动态</button>
            <h2>我的表情包</h2>
            <label>添加图片<input type="file" data-lp="stickerUpload" accept="image/png,image/jpeg,image/webp,image/gif" multiple /></label>
            <div data-lp="stickerStatus" role="status"></div>
            <div data-lp="stickerLibrary" class="lp-sticker-library"></div>
          </div>
                    <nav class="lp-tabbar" aria-label="咕叽聊导航">
            <button data-lp-open="chatList" type="button">消息</button>
            <button data-lp-open="contacts" type="button">通讯录</button>
            <button data-lp-open="discover" type="button">发现</button>
            <button data-lp-open="me" type="button">我</button>
          </nav>
        </section>
        <section class="lp-screen lp-chatlist" data-lp-screen="requests" aria-label="新的朋友" hidden>
          <div class="lp-list-body">
            <div class="lp-list-heading">好友申请</div>
            <div data-lp="requestsList"></div>
          </div>
        </section>
        <section class="lp-screen lp-chatlist" data-lp-screen="discoverNpc" aria-label="从设定中发现人物" hidden>
          <div class="lp-list-body lp-npc-discovery">
            <h2>从当前设定中发现人物</h2>
            <p>本地扫描，不会调用 API。仅从明确的人物资料与关系描述中提取候选；勾选并确认后才加入通讯录。</p>

            <label>额外选择一本世界书（可选）
              <select data-lp="npcWorldSelect"></select>
            </label>
            <button type="button" data-lp="npcScanButton">扫描人物设定</button>
            <div class="lp-npc-scan-state" data-lp="npcScanState" role="status" aria-live="polite"></div>
            <div class="lp-npc-candidates" data-lp="npcCandidates"></div>
            <button type="button" data-lp="npcSaveCandidates">添加勾选的 NPC</button>
          </div>
        </section>
        <section class="lp-screen lp-chatlist" data-lp-screen="addNpc" aria-label="添加 NPC" hidden>
          <div class="lp-list-body lp-npc-editor">
            <h2>添加故事中的人物</h2>
            <button type="button" class="lp-npc-discover-button" data-lp="viewPrimaryContact">查看当前 char 的资料与联系方式</button>
            <div data-lp="storyPeopleList"></div>
            <button type="button" class="lp-npc-discover-button" data-lp-open="discoverNpc">从角色设定／世界书扫描人物</button>
            <p class="lp-npc-note">也可以在下方手动创建人物；两种方式都会进入当前存档的联系人系统。</p>
            <label>姓名<input data-lp="npcName" type="text" maxlength="60" placeholder="NPC 姓名" /></label>
            <label>人物关系（请说明与谁的关系）<input data-lp="npcRelation" type="text" maxlength="180" placeholder="如：宁肆锦的母亲、user的同学" /></label>
            <label>人物设定<textarea data-lp="npcDescription" maxlength="3500" rows="6" placeholder="填写或粘贴角色卡、世界书里的 NPC 设定"></textarea></label>
            <button type="button" data-lp="addNpcSave">创建联系人</button>
            <div class="lp-inline-status" data-lp="npcStatus" role="status" aria-live="polite"></div>
            <p class="lp-npc-note">可手动填写，也可从上方扫描入口发现人物。扫描结果须核对并确认；不会自动成为好友。</p>
          </div>
        </section>
        <section class="lp-screen lp-profile" data-lp-screen="profile" aria-label="联系人资料" hidden>
          <div class="lp-profile-hero">
            <img data-lp="profileAvatar" alt="角色头像" class="lp-profile-avatar" />
            <div><strong data-lp="profileName"></strong><div data-lp="friendLabel" class="lp-profile-state"></div><div data-lp="profileDescription" class="lp-profile-state"></div></div>
          </div>
          <div class="lp-profile-remark">
            <label>联系人备注<input type="text" maxlength="60" data-lp="contactRemark" placeholder="备注名（可选）" /></label>
            <button type="button" data-lp="saveContactRemark">保存备注</button>
          </div>
          <div class="lp-profile-actions" data-lp="friendActions"></div>
          <div class="lp-contact-evidence" data-lp="contactEvidence"></div>
          <button type="button" class="lp-contact-exchange" data-lp="contactExchange">剧情中已交换联系方式（手动确认）</button>
          <button type="button" class="lp-profile-chat" data-lp-open="chat">进入聊天</button>
          <details class="lp-profile-setup">
            <summary>按照已有剧情设定关系</summary>
            <select data-lp="friendSetup" aria-label="设定当前好友状态">
              <option value="friends">已是好友</option>
              <option value="stranger">未加好友</option>
              <option value="outgoing">我已发送申请</option>
              <option value="incoming">对方向我申请</option>
              <option value="blocked">已拉黑</option>
            </select>
            <button type="button" data-lp="friendSave">保存关系设定</button>
          </details>
          <button type="button" class="lp-delete-npc" data-lp="deleteNpc" hidden>删除此 NPC 联系人</button>
          <div class="lp-inline-status" data-lp="profileStatus" role="status" aria-live="polite"></div>
          <div class="lp-profile-upload">
            <label>角色头像（默认读取酒馆角色）<input type="file" accept="image/*" data-lp="avatarCharFile" /></label>
            <button type="button" data-lp="resetCharAvatar">恢复角色原头像</button>
            <label>我的头像（默认读取酒馆人设）<input type="file" accept="image/*" data-lp="avatarUserFile" /></label>
            <button type="button" data-lp="resetUserAvatar">恢复我的原头像</button>
          </div>
        </section>
        <section class="lp-screen lp-chat" data-lp-screen="chat" aria-label="聊天" hidden>
          <div class="lp-chat-error" data-lp="chatError" hidden></div>
          <div class="lp-messages" data-lp="messages" role="log" aria-label="手机聊天记录"></div>
          <div class="lp-message-actions" data-lp="messageActions" hidden>
            <button type="button" data-message-action="quote">引用</button>
            <button type="button" data-message-action="forward">转发</button>
            <button type="button" data-message-action="edit">编辑</button>
            <button type="button" data-message-action="copy">复制</button>
            <button type="button" data-message-action="saveSticker">收藏为表情包</button>
            <button type="button" data-message-action="delete">删除</button>
            <button type="button" data-message-action="cancel">关闭</button>
          </div>
          <div class="lp-quoted-preview" data-lp="quotedPreview" hidden></div>
          <div class="lp-emoji-panel" data-lp="emojiPanel" hidden>
          </div>
          <div class="lp-more-panel" data-lp="morePanel" hidden>
            <button type="button" data-chat-tool="photo">相册</button>
            <button type="button" data-chat-tool="call">电话</button>
            <button type="button" data-chat-tool="transfer">转账</button>
            <button type="button" data-chat-tool="location">定位</button>
          </div>
          <input type="file" accept="image/png,image/jpeg,image/webp" data-lp="chatImageInput" hidden />
          <div class="lp-composer">
            <button type="button" class="lp-tool-btn" data-chat-tool="emoji" aria-label="表情包">☺</button>
            <textarea data-lp="input" rows="1" placeholder="发送消息" aria-label="手机消息内容"></textarea>
            <button type="button" class="lp-tool-btn" data-chat-tool="more" aria-label="更多功能">＋</button>
            <button type="button" data-lp="send" aria-label="发送并生成">发送</button>
            <button type="button" class="lp-retry" data-lp="retry" hidden>重试回复</button>
          </div>
        </section>
        <section class="lp-screen lp-chatlist" data-lp-screen="chatOptions" aria-label="聊天记录管理" hidden>
          <div class="lp-list-body lp-options-body">
            <button type="button" data-lp="goProfile">查看联系人资料</button>
            <button type="button" data-lp="exportChat">导出聊天记录 JSON</button>
            <button type="button" data-lp="copyChat">复制聊天记录 JSON</button>
            <label class="lp-option-file">导入聊天记录 JSON<input type="file" accept="application/json,.json" data-lp="importChat" /></label>
            <button type="button" data-lp="clearChat">清空聊天记录</button>
            <button type="button" data-lp="deleteChat" class="lp-danger-action">删除会话</button>
            <button type="button" data-lp-open="diagnostics">运行日志</button>
            <div class="lp-settings-status" data-lp="status" role="status" aria-live="polite"></div>
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
          <h2>聊天方式</h2>
          <select data-lp="messageStyle" aria-label="消息显示方式"><option value="natural">自然即时聊天 · 可连续分条</option><option value="unrestricted">自由文本 · 不自动拆分</option></select>
          <button type="button" class="lp-settings-link" data-lp="saveMessageStyle">保存聊天方式</button>
          <h2>预设条目</h2>
          <select data-lp="presetSource" aria-label="选择预设"></select>
          <button type="button" class="lp-settings-link" data-lp="openPresetPicker">打开条目列表 · 搜索与勾选</button>
          <h2>世界书条目</h2>
          <select data-lp="worldSource" aria-label="选择世界书"></select>
          <button type="button" class="lp-settings-link" data-lp="openWorldPicker">打开条目列表 · 搜索与勾选</button>
          <h2>打开方式</h2>
          <label class="lp-entry-option"><input type="checkbox" data-lp="floatingLauncher" /> 显示悬浮按钮</label>
          <div class="lp-settings-status" data-lp="settingsStatus" role="status" aria-live="polite"></div>
        </section>
        <section class="lp-screen lp-picker" data-lp-screen="presetPicker" hidden>
          <div class="lp-picker-head" data-lp="presetPickerTitle">预设</div>
          <input class="lp-picker-search" type="search" data-lp="presetSearch" placeholder="搜索条目名称或内容" aria-label="搜索预设条目" />
          <div class="lp-picker-rows" data-lp="presetEntries"></div>
        </section>
        <section class="lp-screen lp-picker" data-lp-screen="worldPicker" hidden>
          <div class="lp-picker-head" data-lp="worldPickerTitle">世界书</div>
          <input class="lp-picker-search" type="search" data-lp="worldSearch" placeholder="搜索条目名称或内容" aria-label="搜索世界书条目" />
          <div class="lp-picker-rows" data-lp="worldEntries"></div>
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
    floating.hidden = !floatLauncherEnabled();
    document.body.append(floating);
    nodes = Object.fromEntries(['title', 'subtitle', 'back', 'close', 'time',
        'homeTime', 'homeCharacter', 'homeMessageCount', 'homeLogCount',
        'momentsPost', 'momentsText', 'momentsFeed', 'myIdentity', 'myAvatar', 'myPersona', 'stickerUpload', 'stickerStatus', 'stickerLibrary',
        'friendLabel', 'friendActions','profileAvatar','profileName','profileDescription','contactEvidence','contactExchange','contactRemark','saveContactRemark','deleteNpc','npcName','npcRelation','npcDescription','addNpcSave','npcStatus','profileStatus','npcWorldSelect','npcScanButton','npcScanState','npcCandidates','npcSaveCandidates','storyPeopleList','viewPrimaryContact','recentChats','contactsList','requestsList','requestBadge','chatError','chatMenu',
        'goProfile','exportChat','copyChat','importChat','clearChat','deleteChat','avatarCharFile','avatarUserFile','resetCharAvatar','resetUserAvatar',
        'friendSetup', 'friendSave', 'floatingLauncher', 'status', 'settingsStatus',
        'presetSource','presetEntries','worldSource','worldEntries','presetSearch','worldSearch','presetPickerTitle','worldPickerTitle','openPresetPicker','openWorldPicker','apiInfo','apiMode','apiUrl','apiModel','apiKey','apiKeyState','customApiFields','saveApi','messageStyle','saveMessageStyle','themeFont','themeWallpaper','themeResetWallpaper','themeIcons',
        'diagnostics', 'diagnosticState', 'copyDiagnostics', 'clearDiagnostics',
        'messages','messageActions','quotedPreview','emojiPanel','morePanel','chatImageInput','input', 'retry', 'send', 'launcher']
        .map(key => [key, key === 'launcher' ? floating : root.querySelector(`[data-lp="${key}"]`)]));

    nodes.launcher.addEventListener('click', () => {
        const opening = !root.classList.contains('lp-open');
        if (opening) openPhone();
        else closePhone();
    });
    nodes.close.addEventListener('click', closePhone);
    root.querySelector('.lp-panel')?.addEventListener('cancel', event => {
        event.preventDefault();
        if(filePickerReturning()){finishFilePicker();return;}
        closePhone();
    });
    for(const input of root.querySelectorAll('input[type="file"]')) {
        input.addEventListener('click',beginFilePicker);
        input.addEventListener('cancel',event=>{event.stopPropagation();finishFilePicker();});
        input.addEventListener('change',finishFilePicker);
    }
    pickerFocusListener=()=>{
        if(!pickerState)return;
        if(pickerReturnTimer)clearTimeout(pickerReturnTimer);
        pickerReturnTimer=setTimeout(()=>{pickerReturnTimer=null;finishFilePicker();},300);
    };
    window.addEventListener('focus',pickerFocusListener);
    nodes.chatMenu.addEventListener('click',()=>setScreen('chatOptions'));
    nodes.momentsPost.addEventListener('click',()=>void postMoment());

    nodes.back.addEventListener('click', () => setScreen({
        chat: 'chatList', contacts: 'chatList', discover:'chatList', me:'chatList', profile: 'contacts', requests:'contacts', addNpc:'contacts', discoverNpc:'addNpc', chatOptions:'chat', presetPicker:'settings', worldPicker:'settings'
    }[activeScreen] || 'home'));
    root.addEventListener('click', event => {
        const button = event.target.closest('button[data-lp-open]');
        if (button && root.contains(button)) setScreen(button.dataset.lpOpen);
    });
    nodes.time.addEventListener('change', saveStoryTime);
    nodes.presetSource.addEventListener('change', showPresetEntries);
    nodes.worldSource.addEventListener('change', () => void showWorldEntries());
    nodes.presetSearch.addEventListener('input',()=>filterPicker('preset'));
    nodes.worldSearch.addEventListener('input',()=>filterPicker('world'));
    nodes.openPresetPicker.addEventListener('click',()=>setScreen('presetPicker'));
    nodes.openWorldPicker.addEventListener('click',()=>setScreen('worldPicker'));

    nodes.apiMode.addEventListener('change', () => { nodes.customApiFields.hidden = nodes.apiMode.value !== 'custom'; });
    nodes.saveApi.addEventListener('click', () => void savePhoneApi());
    nodes.saveMessageStyle.addEventListener('click', () => void savePhoneMessageStyle());
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
    nodes.send.addEventListener('click',send);
    nodes.stickerUpload.addEventListener('change',event=>{const files=[...event.target.files];event.target.value='';void uploadStickers(files);});
    nodes.chatImageInput.addEventListener('change',event=>{void sendImageFile(event.target.files?.[0]);event.target.value='';});
    root.addEventListener('click',event=>{
        const tool=event.target.closest('button[data-chat-tool]');
        if(tool&&root.contains(tool)){startChatTool(tool.dataset.chatTool);return;}
        const sticker=event.target.closest('button[data-sticker-id]');
        if(sticker&&root.contains(sticker)){void useSticker(sticker.dataset.stickerId,sticker.dataset.stickerAction);return;}
        const action=event.target.closest('button[data-message-action]');
        if(action&&root.contains(action)){if(action.dataset.messageAction==='cancel')closeMessageActions();else void handleMessageOperation(action.dataset.messageAction);}
    });
    nodes.retry.addEventListener('click', retryLastReply);
    nodes.friendSave.addEventListener('click', saveManualFriendship);
    nodes.addNpcSave.addEventListener('click',()=>void addNpcContact());
    nodes.viewPrimaryContact.addEventListener('click',()=>switchContact(PRIMARY_CONTACT_ID,'profile'));
    nodes.npcScanButton.addEventListener('click',()=>void scanNpcUI());
    nodes.npcSaveCandidates.addEventListener('click',()=>void saveSelectedNpcCandidates());
    nodes.saveContactRemark.addEventListener('click',()=>void saveContactRemark());
    nodes.deleteNpc.addEventListener('click',()=>void removeNpcContact());
    nodes.contactExchange.addEventListener('click',()=>void markContactExchanged());
    nodes.friendActions.addEventListener('click', event => {
        const button = event.target.closest('button[data-friend-action]');
        if (button) handleFriendAction(button.dataset.friendAction);
    });
    nodes.copyDiagnostics.addEventListener('click', copyDiagnostics);
    nodes.goProfile.addEventListener('click',()=>setScreen('profile'));
    nodes.exportChat.addEventListener('click',downloadChatExport);
    nodes.copyChat.addEventListener('click',()=>void copyChatExport());
    nodes.importChat.addEventListener('change',event=>{void importChatFile(event.target.files?.[0]);event.target.value='';});
    nodes.clearChat.addEventListener('click',()=>void clearOrDeleteChat(false));
    nodes.deleteChat.addEventListener('click',()=>void clearOrDeleteChat(true));
    nodes.avatarCharFile.addEventListener('change',event=>{void updateAvatar('character',event.target.files?.[0]);event.target.value='';});
    nodes.avatarUserFile.addEventListener('change',event=>{void updateAvatar('user',event.target.files?.[0]);event.target.value='';});
    nodes.resetCharAvatar.addEventListener('click',()=>void resetAvatar('character'));
    nodes.resetUserAvatar.addEventListener('click',()=>void resetAvatar('user'));
    nodes.clearDiagnostics.addEventListener('click', () => {
        diagnostics.length = 0;
        renderDiagnostics();
        setStatus('已清空本次运行日志。');
    });
    nodes.input.addEventListener('focus', () => setTimeout(syncPhoneViewport, 120));
    nodes.input.addEventListener('blur', () => setTimeout(syncPhoneViewport, 120));
    viewportListener = () => syncPhoneViewport();
    window.visualViewport?.addEventListener('resize', viewportListener);
    window.visualViewport?.addEventListener('scroll', viewportListener);
    window.addEventListener('resize', viewportListener);
    nodes.input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            send();
        }
    });
    root.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            if(filePickerReturning()){event.stopPropagation();finishFilePicker();return;}
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
            activeContactId=PRIMARY_CONTACT_ID;
            npcCandidates=[];npcScanSession=null;
            statusText = '';
            statusKind = 'info';
            render();
        };
        listeningSource.on(listeningEvent, chatChangedHandler);
    }
    render();
}

function unmount() {
    if(pickerFocusListener)window.removeEventListener('focus',pickerFocusListener);
    pickerFocusListener=null;
    if(pickerReturnTimer)clearTimeout(pickerReturnTimer);
    pickerReturnTimer=null;pickerState=null;pickerGuardUntil=0;
    closePhone();
    if (viewportListener) {
        window.visualViewport?.removeEventListener('resize', viewportListener);
        window.visualViewport?.removeEventListener('scroll', viewportListener);
        window.removeEventListener('resize', viewportListener);
        viewportListener = null;
    }
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
    activeContactId = PRIMARY_CONTACT_ID;
    npcCandidates=[];npcScanSession=null;
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
    // Both 1.18 and 1.19 insert #extensionsMenu asynchronously. Observe
    // insertion/replacement without a 15-second deadline or polling forever.
    if (!wandObserver && typeof MutationObserver === 'function') {
        wandObserver = new MutationObserver(() => {
            if (extensionEnabled) installWandEntry();
        });
        wandObserver.observe(document.body, { childList: true, subtree: true });
    }
    installWandEntry();
    if (!mounted) {
        try {
            mount();
        } catch (error) {
            // Remove partial UI/listeners so a later activation can retry.
            unmount();
            installWandEntry();
            throw error;
        }
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
    wandObserver?.disconnect();
    wandObserver = null;
    unmount();
}

// bootstrap owns activation, including imports that finish after disable.

