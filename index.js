/**
 * GujiGuji v0.1.0: an isolated SillyTavern phone chat prototype.
 * No direct host-module imports; uses only the documented context surface.
 */

const ROOT_ID = 'st-little-phone-root';
const DATA_KEY = 'st_little_phone_v1';
const CONTEXT_MESSAGE_LIMIT = 24;
const CHARACTER_TEXT_LIMIT = 9000;

let root = null;
let nodes = null;
let mounted = false;
let busy = false;
let chatChangedHandler = null;
let listeningSource = null;
let listeningEvent = null;
let readyBound = false;
let statusText = '';

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
    return { version: 1, storyTime: localDateTime(), messages: [] };
}

function readData(ctx) {
    const value = ctx?.chatMetadata?.[DATA_KEY];
    if (!value || value.version !== 1 || !Array.isArray(value.messages)) return newData();
    return value;
}

async function writeData(ctx, data) {
    if (!ctx?.chatMetadata || typeof ctx.saveMetadata !== 'function') {
        throw new Error('当前酒馆未提供可用的聊天存档接口。');
    }
    ctx.chatMetadata[DATA_KEY] = data;
    await ctx.saveMetadata();
}

function captureSession(ctx) {
    return { metadata: ctx.chatMetadata, characterId: ctx.characterId, groupId: ctx.groupId };
}

function sameSession(snapshot) {
    const ctx = context();
    return Boolean(mounted && ctx && ctx.chatMetadata === snapshot.metadata
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

    return [
        `你正在扮演角色「${getCharacterName(char)}」，与 user 通过一部虚构的手机进行私聊。`,
        '只回复这一角色实际发出的手机消息。不要写旁白、动作描写、镜头说明、心理活动、双方对话或 user 的行为。',
        '不要替 user 发言，也不要强行推进关系。角色只知道设定和这段手机聊天中已提供的事实。',
        '手机聊天时间由玩家设置，与正文时间可能不同。不得假定角色已经经历了这个日期之后的事件。',
        `当前手机故事时间：${data.storyTime.replace('T', ' ')}`,
        profile,
    ].filter(Boolean).join('\n\n');
}

function buildPrompt(data) {
    // Official generateRaw accepts Chat Completion messages and converts them
    // for the selected generation mode. Preserve user/assistant roles.
    return data.messages.slice(-CONTEXT_MESSAGE_LIMIT)
        .filter(message => typeof message.text === 'string')
        .map(message => ({
            role: message.from === 'character' ? 'assistant' : 'user',
            content: message.text,
        }));
}

function setStatus(message) {
    statusText = message || '';
    if (nodes?.status) nodes.status.textContent = statusText;
}

function updateBusy() {
    if (!nodes) return;
    const ready = Boolean(selectedCharacter(context()));
    nodes.send.disabled = busy || !ready;
    nodes.input.disabled = busy || !ready;
    nodes.time.disabled = busy || !ready;
    nodes.send.textContent = busy ? '等待中' : '发送';
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
        item.className = `lp-message ${message.from === 'character' ? 'lp-theirs' : 'lp-mine'}`;
        const bubble = document.createElement('div');
        bubble.className = 'lp-bubble';
        bubble.textContent = message.text;
        const stamp = document.createElement('div');
        stamp.className = 'lp-message-time';
        stamp.textContent = String(message.storyTime || '').replace('T', ' ');
        item.append(bubble, stamp);
        fragment.append(item);
    }
    nodes.messages.append(fragment);
    nodes.messages.scrollTop = nodes.messages.scrollHeight;
}

function render() {
    if (!mounted || !nodes) return;
    const ctx = context();
    const char = selectedCharacter(ctx);
    const data = char ? readData(ctx) : null;

    nodes.name.textContent = char ? getCharacterName(char) : '请先选择角色';
    nodes.subtitle.textContent = char ? '独立手机聊天 · 不写入正文' : '暂不支持群聊或未选择角色的状态';
    nodes.time.value = data?.storyTime || localDateTime();
    if (data) renderMessages(data);
    else {
        nodes.messages.replaceChildren();
        const message = document.createElement('div');
        message.className = 'lp-empty';
        message.textContent = '打开一张单人角色卡的聊天存档后再使用小手机。';
        nodes.messages.append(message);
    }
    updateBusy();
    setStatus(statusText);
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
        console.error('[GujiGuji] Time save failed', error);
        setStatus('时间保存失败，请检查酒馆日志。');
    }
}

async function send() {
    if (!mounted || busy) return;
    const ctx = context();
    const char = selectedCharacter(ctx);
    const content = nodes.input.value.trim();
    if (!char || !content) return;
    if (typeof ctx.generateRaw !== 'function') {
        setStatus('当前酒馆未提供独立生成接口。');
        return;
    }

    const session = captureSession(ctx);
    const data = structuredClone(readData(ctx));
    data.messages.push(makeMessage('user', content, data.storyTime));

    busy = true;
    updateBusy();
    try {
        await writeData(ctx, data);
        if (!sameSession(session)) return;
        nodes.input.value = '';
        renderMessages(data);
        setStatus('正在等待角色回复…');

        const result = await ctx.generateRaw({
            systemPrompt: createSystemPrompt(char, data),
            prompt: buildPrompt(data),
        });
        if (!sameSession(session)) return;
        const reply = typeof result === 'string' ? result.trim() : '';
        if (!reply) throw new Error('模型返回了空消息或不支持的回复类型。');
        data.messages.push(makeMessage('character', reply, data.storyTime));
        await writeData(ctx, data);
        if (sameSession(session)) {
            renderMessages(data);
            setStatus('已收到回复。');
        }
    } catch (error) {
        console.error('[GujiGuji] Message failed', error);
        if (sameSession(session)) setStatus('发送或生成失败；请检查 API 和酒馆日志，已保存的消息不会自动重发。');
    } finally {
        busy = false;
        if (mounted) updateBusy();
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
        <div class="lp-status" data-lp="status" role="status" aria-live="polite"></div>
        <div class="lp-messages" data-lp="messages" role="log" aria-label="手机聊天记录"></div>
        <div class="lp-composer">
          <textarea data-lp="input" rows="1" placeholder="发消息…" aria-label="手机消息内容"></textarea>
          <button type="button" data-lp="send">发送</button>
        </div>
      </section>
      <button type="button" class="lp-launcher" data-lp="launcher" aria-label="打开咕叽咕机" title="咕叽咕机">☏</button>`;
    return container;
}

function mount() {
    if (mounted || !document.body) return;
    root = makeUI();
    document.body.append(root);
    nodes = Object.fromEntries(['name', 'subtitle', 'close', 'time', 'status', 'messages', 'input', 'send', 'launcher']
        .map(key => [key, root.querySelector(`[data-lp="${key}"]`)]));

    nodes.launcher.addEventListener('click', () => {
        root.classList.toggle('lp-open');
        nodes.launcher.setAttribute('aria-label', root.classList.contains('lp-open') ? '隐藏咕叽咕机' : '打开咕叽咕机');
        render();
    });
    nodes.close.addEventListener('click', () => root.classList.remove('lp-open'));
    nodes.time.addEventListener('change', saveStoryTime);
    nodes.send.addEventListener('click', send);
    nodes.input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            send();
        }
    });

    mounted = true;
    const ctx = context();
    if (ctx?.eventSource && ctx?.event_types?.CHAT_CHANGED) {
        listeningSource = ctx.eventSource;
        listeningEvent = ctx.event_types.CHAT_CHANGED;
        chatChangedHandler = () => {
            statusText = '';
            render();
        };
        listeningSource.on(listeningEvent, chatChangedHandler);
    }
    render();
}

function unmount() {
    mounted = false;
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
