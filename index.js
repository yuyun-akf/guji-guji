/**
 * GujiGuji v0.2.0: an isolated SillyTavern phone chat prototype.
 * No direct host-module imports; uses only the documented context surface.
 */

const ROOT_ID = 'st-little-phone-root';
const DATA_KEY = 'st_little_phone_v1';
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
let readyBound = false;
let statusText = '';
let statusKind = 'info';
let busyKind = '';
let diagnosticOpen = false;
let lifecycleToken = 0;
const diagnostics = [];

function context() {
    try {
        return window.SillyTavern?.getContext?.() ?? null;
    } catch {
        return null;
    }
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
    ctx.chatMetadata[DATA_KEY] = data;
    await ctx.saveMetadata();
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
}

function redactDiagnostic(text) {
    return String(text || '未知错误')
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [已隐藏]')
        .replace(/\bsk-[A-Za-z0-9_-]{8,}/gi, '[已隐藏的密钥]')
        .replace(/([?&](?:api[_-]?key|token|secret|password|authorization)=)[^&\s]+/gi, '$1[已隐藏]')
        .replace(/\b(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*\S+/gi, '[已隐藏的凭证]')
        .slice(0, 600);
}

function recordError(stage, error) {
    const code = error?.status ?? error?.statusCode ?? error?.code ?? error?.cause?.status ?? '';
    const detail = redactDiagnostic(error?.message || error);
    const entry = { at: new Date().toLocaleTimeString(), stage, code: redactDiagnostic(code), detail };
    diagnostics.unshift(entry);
    diagnostics.length = Math.min(diagnostics.length, DIAGNOSTIC_LIMIT);
    console.error('[GujiGuji]', stage, entry.detail);
    renderDiagnostics();
    return `操作失败：${detail}${code ? `（${redactDiagnostic(code)}）` : ''}`;
}

function renderDiagnostics() {
    if (!nodes?.diagnostics) return;
    nodes.diagnostics.replaceChildren();
    if (!diagnostics.length) {
        const empty = document.createElement('p');
        empty.textContent = '暂无插件捕获的错误。这里不会读取手机或酒馆的全部后台日志。';
        nodes.diagnostics.append(empty);
        return;
    }
    for (const entry of diagnostics) {
        const item = document.createElement('p');
        item.textContent = `[${entry.at}] ${entry.stage}${entry.code ? ` · ${entry.code}` : ''}\n${entry.detail}`;
        nodes.diagnostics.append(item);
    }
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
    nodes.send.textContent = busy ? '生成中…' : '发送';
    nodes.activity.hidden = !busy;
    const elapsed = busy ? `（已等待 ${Math.floor((Date.now() - busyStartedAt) / 1000)} 秒）` : '';
    nodes.activity.textContent = `${busyKind === 'friend' ? '正在等待角色处理好友申请…' : '对方正在输入…'}${elapsed}`;
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
    nodes.subtitle.textContent = char ? '独立手机聊天 · 不写入正文' : '暂不支持群聊或未选择角色的状态';
    nodes.time.value = data?.storyTime || localDateTime();
    renderFriendship(data);
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
    const time = nodes.time.value;
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(time)) {
        setStatus('请选择有效的故事日期和时间。');
        return;
    }
    const data = structuredClone(readData(ctx));
    data.storyTime = time;
    try {
        await writeData(ctx, data);
        setStatus('手机时间已保存。它不会自动改动正文时间。');
    } catch (error) {
        setStatus(recordError('保存故事时间', error), 'error');
    }
}

async function runReply(ctx, char, data, session) {
    const job = startBusy('reply');
    if (sameSession(session)) renderMessages(data);
    setStatus('正在生成角色回复，请稍候…');
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
    try {
        await writeData(ctx, data);
        if (!sameSession(session)) return;
        nodes.input.value = '';
        await runReply(ctx, char, data, session);
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

function makeUI() {
    const container = document.createElement('div');
    container.id = ROOT_ID;
    container.innerHTML = `
      <section class="lp-panel" role="dialog" aria-label="咕叽咕机" aria-modal="false">
        <header class="lp-header">
          <div><div class="lp-title" data-lp="name">咕叽咕机</div>
               <div class="lp-subtitle" data-lp="subtitle">独立手机聊天</div></div>
          <button type="button" class="lp-close" data-lp="close" aria-label="关闭咕叽咕机">×</button>
        </header>
        <div class="lp-timebar">
          <label for="lp-story-time">故事时间</label>
          <input id="lp-story-time" type="datetime-local" data-lp="time" aria-label="小手机故事时间" />
        </div>
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
          <button type="button" class="lp-diagnostic-toggle" data-lp="diagnosticToggle" aria-expanded="false">诊断</button>
        </div>
        <div class="lp-activity" data-lp="activity" role="status" aria-live="polite" hidden></div>
        <div class="lp-diagnostics" data-lp="diagnosticBox" hidden>
          <div class="lp-diagnostic-head"><strong>本次运行的插件错误</strong><button type="button" data-lp="copyDiagnostics">复制诊断</button></div>
          <div data-lp="diagnostics"></div>
        </div>
        <div class="lp-messages" data-lp="messages" role="log" aria-label="手机聊天记录"></div>
        <div class="lp-composer">
          <textarea data-lp="input" rows="1" placeholder="发消息…" aria-label="手机消息内容"></textarea>
          <button type="button" class="lp-retry" data-lp="retry" hidden>重试回复</button>
          <button type="button" data-lp="send">发送</button>
        </div>
      </section>
      <button type="button" class="lp-launcher" data-lp="launcher" aria-label="打开咕叽咕机" title="咕叽咕机">☏</button>`;
    return container;
}

function mount() {
    if (mounted || !document.body) return;
    lifecycleToken += 1;
    root = makeUI();
    document.body.append(root);
    nodes = Object.fromEntries(['name', 'subtitle', 'close', 'time', 'friendLabel', 'friendActions',
        'friendSetup', 'friendSave', 'status', 'activity', 'diagnosticToggle', 'diagnosticBox',
        'diagnostics', 'copyDiagnostics', 'messages', 'input', 'retry', 'send', 'launcher']
        .map(key => [key, root.querySelector(`[data-lp="${key}"]`)]));

    nodes.launcher.addEventListener('click', () => {
        root.classList.toggle('lp-open');
        nodes.launcher.setAttribute('aria-label', root.classList.contains('lp-open') ? '隐藏咕叽咕机' : '打开咕叽咕机');
        render();
    });
    nodes.close.addEventListener('click', () => root.classList.remove('lp-open'));
    nodes.time.addEventListener('change', saveStoryTime);
    nodes.send.addEventListener('click', send);
    nodes.retry.addEventListener('click', retryLastReply);
    nodes.friendSave.addEventListener('click', saveManualFriendship);
    nodes.friendActions.addEventListener('click', event => {
        const button = event.target.closest('button[data-friend-action]');
        if (button) handleFriendAction(button.dataset.friendAction);
    });
    nodes.diagnosticToggle.addEventListener('click', () => {
        diagnosticOpen = !diagnosticOpen;
        nodes.diagnosticBox.hidden = !diagnosticOpen;
        nodes.diagnosticToggle.setAttribute('aria-expanded', String(diagnosticOpen));
        renderDiagnostics();
    });
    nodes.copyDiagnostics.addEventListener('click', copyDiagnostics);
    nodes.input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            send();
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
    root?.remove();
    root = null;
    nodes = null;
    statusText = '';
    statusKind = 'info';
    diagnosticOpen = false;
}

function bindReady() {
    if (readyBound) return;
    const ctx = context();
    if (!ctx?.eventSource || !ctx?.event_types?.APP_READY) {
        // Load order can differ across SillyDroid and browser-hosted Tavern.
        setTimeout(bindReady, 500);
        return;
    }
    readyBound = true;
    ctx.eventSource.on(ctx.event_types.APP_READY, mount);
}

export function onEnable() { mount(); }
export function onDisable() { unmount(); }

bindReady();
