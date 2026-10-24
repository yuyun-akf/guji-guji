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
vm.runInContext(`${source}\nglobalThis.helpers = {newData, readData, friendshipState, rememberFriendship, buildPrompt, createSystemPrompt, redactDiagnostic};`, sandbox);
const { newData, readData, friendshipState, rememberFriendship, buildPrompt, createSystemPrompt, redactDiagnostic } = sandbox.helpers;

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
