/**
 * GujiGuji v0.3.3: a modular phone shell with an isolated chat app.
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
let extensionEnabled = true;
let statusText = '';
let statusKind = 'info';
let busyKind = '';
let activeScreen = 'home';
let lifecycleToken = 0;
const diagnostics = [];
const SCREENS = new Set(['home', 'chat', 'settings', 'diagnostics']);

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
        code: redactDiagnostic(code), detail: redactDiagnostic(detail), kind,
    };
    diagnostics.unshift(entry);
    diagnostics.length = Math.min(diagnostics.length, DIAGNOSTIC_LIMIT);
    renderDiagnostics();
    return entry;
}

function recordError(stage, error) {
    const code = error?.status ?? error?.statusCode ?? error?.code ?? error?.cause?.status ?? '';
    const detail = redactDiagnostic(error?.message || error);
    const entry = recordActivity(stage, detail, 'error', code);
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

function setScreen(screen) {
    if (!SCREENS.has(screen) || !nodes) return;
    activeScreen = screen;
    for (const section of root.querySelectorAll('[data-lp-screen]')) {
        section.hidden = section.dataset.lpScreen !== screen;
    }
    nodes.back.hidden = screen === 'home';
    const titles = { home: '咕叽咕机', chat: '咕叽聊', settings: '手机设置', diagnostics: '运行日志' };
    nodes.title.textContent = titles[screen];
    if (screen === 'diagnostics') renderDiagnostics();
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

async function generateWithTimeout(ctx, options) {
    let timer = null;
    try {
        return await Promise.race([
            ctx.generateRaw(options),
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
    renderFriendship(data);
    updateLauncherVisibility();
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
        const result = await generateWithTimeout(ctx, {
            systemPrompt: createSystemPrompt(char, data),
            prompt: buildPrompt(data),
        });
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
    if (typeof ctx.generateRaw !== 'function') {
        setStatus(recordError('重试生成', new Error('当前酒馆未提供独立生成接口。')), 'error');
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
    if (typeof ctx.generateRaw !== 'function') {
        setStatus(recordError('生成前检查', new Error('当前酒馆未提供独立生成接口。')), 'error');
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
    if (typeof ctx.generateRaw !== 'function') {
        setStatus(recordError('处理好友申请', new Error('酒馆未提供独立生成接口，申请将保持待处理。')), 'error');
        return;
    }
    const session = captureSession(ctx);
    const job = startBusy('friend');
    renderFriendship(data);
    setStatus('好友申请已发出，正在等待角色决定…');
    recordActivity('好友申请', '已请求模型判断角色是否接受好友申请。');
    try {
        const profilePrompt = createSystemPrompt(char, data);
        const result = await generateWithTimeout(ctx, {
            systemPrompt: `${profilePrompt}\n\n现在只判断角色是否愿意通过 user 的好友申请。请根据设定、已经发生的相处以及角色自己的意愿决定，不保证同意。只能输出一个英文单词：ACCEPT 或 REJECT。`,
            prompt: [
                ...buildPrompt(data).slice(-8),
                { role: 'user', content: '【好友申请事件】user 请求添加你为手机好友。只输出 ACCEPT 或 REJECT。' },
            ],
        });
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
    if (!mounted || !root) return;
    root.classList.add('lp-open');
    nodes.launcher.setAttribute('aria-label', '隐藏咕叽咕机');
    setScreen('home');
    render();
}

function closePhone() {
    if (!mounted || !root) return;
    root.classList.remove('lp-open');
    nodes.launcher.setAttribute('aria-label', '打开咕叽咕机');
}

function installWandEntry() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return false;
    if (document.getElementById(WAND_ENTRY_ID)) return true;

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
    recordActivity('启动入口', '魔法棒菜单已注册「咕叽咕机」。', 'success');
    return true;
}

function makeUI() {
    const container = document.createElement('div');
    container.id = ROOT_ID;
    container.innerHTML = `
      <section class="lp-panel" role="dialog" aria-label="咕叽咕机" aria-modal="false">
        <header class="lp-header">
          <button type="button" class="lp-back" data-lp="back" aria-label="返回手机桌面" hidden>‹</button>
          <div class="lp-heading"><div class="lp-title" data-lp="title">咕叽咕机</div>
               <div class="lp-subtitle" data-lp="subtitle">故事中的小手机</div></div>
          <button type="button" class="lp-close" data-lp="close" aria-label="关闭咕叽咕机">×</button>
        </header>
        <section class="lp-screen lp-home" data-lp-screen="home" aria-label="手机桌面">
          <div class="lp-home-hero">
            <div class="lp-home-greeting">咕叽咕机 · GujiGuji · v0.3.3</div>
            <div class="lp-home-time" data-lp="homeTime">故事时间</div>
            <div class="lp-home-character" data-lp="homeCharacter">等待进入角色存档</div>
          </div>
          <div class="lp-home-summary" data-lp="homeMessageCount">0 条聊天记录</div>
          <div class="lp-app-grid" aria-label="小手机应用">
            <button type="button" class="lp-app-tile" data-lp-open="chat"><span class="lp-app-icon lp-app-chat">💬</span><span>咕叽聊</span><small>可使用</small></button>
            <button type="button" class="lp-app-tile" data-lp-open="diagnostics"><span class="lp-app-icon lp-app-log">🛠️</span><span>运行日志</span><small data-lp="homeLogCount">0 条记录</small></button>
            <button type="button" class="lp-app-tile" data-lp-open="settings"><span class="lp-app-icon lp-app-settings">⚙️</span><span>设置</span><small>故事时间</small></button>
            <div class="lp-app-tile lp-app-soon" aria-label="相册，待开发"><span class="lp-app-icon">🖼️</span><span>相册</span><small>待开发</small></div>
            <div class="lp-app-tile lp-app-soon" aria-label="购物，待开发"><span class="lp-app-icon">🛍️</span><span>购物</span><small>待开发</small></div>
            <div class="lp-app-tile lp-app-soon" aria-label="外卖，待开发"><span class="lp-app-icon">🥡</span><span>外卖</span><small>待开发</small></div>
          </div>
          <p class="lp-home-note">现在先把聊天打磨好；相册、购物和外卖会按模块逐个开发。</p>
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
        <section class="lp-screen lp-settings" data-lp-screen="settings" aria-label="小手机设置" hidden>
          <h2>打开方式</h2>
          <p>默认从酒馆的魔法棒菜单选择「咕叽咕机」打开。也可以额外开启悬浮按钮。</p>
          <label class="lp-entry-option"><input type="checkbox" data-lp="floatingLauncher" /> 在聊天页面显示悬浮按钮</label>
          <h2>故事时间</h2>
          <p>这里设置的是小手机的剧情时间；它可以早于正文开始，不会自动修改正文时间。</p>
          <div class="lp-timebar">
            <label for="lp-story-time">手机当前时间</label>
            <input id="lp-story-time" type="datetime-local" data-lp="time" aria-label="小手机故事时间" />
          </div>
          <div class="lp-settings-status" data-lp="settingsStatus" role="status" aria-live="polite"></div>
          <h2>小手机功能</h2>
          <p>聊天记录按当前角色和存档保存。后续可以继续加入相册、购物、外卖等独立 App。</p>
          <button type="button" class="lp-settings-link" data-lp-open="diagnostics">查看运行日志与 API 错误 →</button>
        </section>
        <section class="lp-screen lp-diagnostics" data-lp-screen="diagnostics" aria-label="运行日志与报错" hidden>
          <div class="lp-diagnostic-state" data-lp="diagnosticState" role="status" aria-live="polite">空闲</div>
          <p class="lp-diagnostic-note">这里记录咕叽咕机发起的生成和保存操作、返回结果及捕获的报错。无法直接读取 SillyDroid 或酒馆服务端的全部后台日志。</p>
          <div class="lp-diagnostic-head"><strong>本次打开页面后的记录</strong><button type="button" data-lp="copyDiagnostics">复制日志</button></div>
          <div class="lp-diagnostic-list" data-lp="diagnostics"></div>
          <button type="button" class="lp-clear-logs" data-lp="clearDiagnostics">清空本次运行日志</button>
        </section>
      </section>
      <button type="button" class="lp-launcher" data-lp="launcher" aria-label="打开咕叽咕机" title="咕叽咕机">☏</button>`;
    return container;
}

function mount() {
    if (mounted || !document.body) return;
    lifecycleToken += 1;
    root = makeUI();
    document.body.append(root);
    nodes = Object.fromEntries(['title', 'name', 'subtitle', 'back', 'close', 'time',
        'homeTime', 'homeCharacter', 'homeMessageCount', 'homeLogCount',
        'friendLabel', 'friendActions',
        'friendSetup', 'friendSave', 'floatingLauncher', 'status', 'settingsStatus', 'activity', 'diagnosticToggle',
        'diagnostics', 'diagnosticState', 'copyDiagnostics', 'clearDiagnostics',
        'messages', 'input', 'retry', 'send', 'launcher']
        .map(key => [key, root.querySelector(`[data-lp="${key}"]`)]));

    nodes.launcher.addEventListener('click', () => {
        const opening = !root.classList.contains('lp-open');
        if (opening) openPhone();
        else closePhone();
    });
    nodes.close.addEventListener('click', closePhone);
    nodes.back.addEventListener('click', () => setScreen('home'));
    root.addEventListener('click', event => {
        const button = event.target.closest('button[data-lp-open]');
        if (button && root.contains(button)) setScreen(button.dataset.lpOpen);
    });
    nodes.time.addEventListener('change', saveStoryTime);
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
