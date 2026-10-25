// Real Chromium DOM with a mocked host context, not a full SillyTavern install.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');

test('browser startup, delayed menu, lifecycle, old data and v0.7 UI', async () => {
    const browser = await chromium.launch({ headless: true,
        ...(process.env.GUJI_BROWSER_PATH ? { executablePath: process.env.GUJI_BROWSER_PATH } : {}) });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('http://guji.test/**', route => {
            const file = new URL(route.request().url()).pathname.slice(1);
            if (['bootstrap.js', 'index.js', 'style.css'].includes(file)) {
                return route.fulfill({ contentType: file.endsWith('.css') ? 'text/css' : 'text/javascript', body: fs.readFileSync(path.join(root, file)) });
            }
            return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body></body></html>' });
        });
        await page.goto('http://guji.test/');
        await page.evaluate(() => {
            window.saves = 0;
            window.ctx = { characterId: 0, chatId: 'old-story', name1: '测试玩家', name2: '角色',
                characters: [{ name: '角色', avatar: 'test.png', data: {} }], chat: [],
                chatMetadata: { st_little_phone_v1: { version: 1, messages: [{ id: 'old', from: 'user', text: '保留旧聊天' }], customField: 123 } },
                extensionSettings: {}, powerUserSettings: {persona_description:'当前玩家的人设'},
                saveSettingsDebounced() {},
                generateRaw: async () => '收到[[sticker:'+window.ctx.extensionSettings.gujiguji.stickers[0].id+']]',
                event_types: { CHAT_CHANGED: 'chat_changed' },
                eventSource: { on() {}, removeListener() {} },
                saveMetadata: async () => { window.saves++; } };
            window.SillyTavern = { getContext: () => window.ctx };
            window.before = JSON.stringify(ctx.chatMetadata);
        });
        await page.evaluate(async () => { window.boot = await import('/bootstrap.js'); await boot.onActivate(); });
        assert.deepEqual(errors, [], 'full mount must not throw');
        assert.equal(await page.locator('#st-little-phone-root').count(), 1);
        assert.equal(await page.locator('#gujiguji-floating-launcher').isVisible(), false);
        assert.equal(await page.evaluate(() => JSON.stringify(ctx.chatMetadata) === before && saves === 0), true);
        // Advance beyond the old 15-second deadline, then insert host menu.
        await page.clock.install();
        await page.clock.fastForward(20000);
        await page.evaluate(() => { const menu = document.createElement('div'); menu.id = 'extensionsMenu'; document.body.append(menu); });
        await page.waitForSelector('.gujiguji-wand-button');
        await page.locator('.gujiguji-wand-button').click();
        assert.equal(await page.locator('dialog').evaluate(node => node.open), true);
        await page.locator('[data-lp-open="chatList"]').first().click();
        for (const screen of ['chatList','contacts','discover','me']) {
            assert.ok(await page.locator(`[data-lp-open="${screen}"]`).count());
        }
        await page.locator('[data-lp-screen="chatList"] [data-lp-open="me"]').click();
        assert.equal(await page.locator('[data-lp="myIdentity"]').innerText(),'测试玩家');
        assert.equal(await page.locator('[data-lp="stickerLibrary"] img').count(),0);
        await page.locator('[data-lp="momentsText"]').fill('朋友圈回归检查');
        await page.locator('[data-lp="momentsPost"]').click();
        await page.waitForFunction(() => ctx.chatMetadata.st_little_phone_v1.moments?.length === 1);
        await page.locator('[data-lp-screen="me"] [data-lp-open="discover"]').click();
        assert.equal(await page.locator('[data-lp="momentsFeed"]').innerText().then(t => t.includes('朋友圈回归检查')), true);
        await page.locator('[data-lp-screen="discover"] nav [data-lp-open="me"]').click();
        await page.locator('[data-lp="stickerUpload"]').setInputFiles({name:'开心.gif',mimeType:'image/gif',buffer:Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64')});
        await page.waitForFunction(()=>ctx.extensionSettings.gujiguji?.stickers?.length===1);
        await page.locator('[data-lp-screen="me"] [data-lp-open="chatList"]').click();
        await page.locator('[data-lp="recentChats"] .lp-conversation-row').first().click();
        await page.locator('[data-lp="input"]').fill('未发送草稿');
        await page.evaluate(()=>{
            const input=document.querySelector('[data-lp="chatImageInput"]');
            // Synthetic click exercises picker tracking without opening OS UI.
            input.addEventListener('click',e=>e.preventDefault(),{once:true});
            input.click();input.dispatchEvent(new Event('cancel',{bubbles:true}));
            document.querySelector('.lp-panel').dispatchEvent(new Event('cancel',{cancelable:true}));
        });
        assert.equal(await page.locator('dialog').evaluate(node=>node.open),true);
        assert.equal(await page.locator('[data-lp="input"]').inputValue(),'未发送草稿');
        assert.equal(await page.locator('#st-little-phone-root').getAttribute('data-screen'),'chat');
        await page.locator('[data-chat-tool="emoji"]').click();
        await page.locator('[data-lp="emojiPanel"] [data-sticker-action="send"]').click();
        await page.waitForFunction(()=>ctx.chatMetadata.st_little_phone_v1.messages.filter(m=>m.sticker).length===2);
        assert.equal(await page.evaluate(() => ctx.chatMetadata.st_little_phone_v1.messages[0].text), '保留旧聊天');
        await page.evaluate(() => boot.onDisable());
        assert.equal(await page.locator('#st-little-phone-root, #gujiguji-wand-entry, #gujiguji-floating-launcher').count(), 0);
        await page.evaluate(async () => { await boot.onEnable(); await boot.onActivate(); });
        assert.equal(await page.locator('#st-little-phone-root').count(), 1);
        assert.equal(await page.locator('#gujiguji-wand-entry').count(), 1);
        await page.evaluate(() => { document.getElementById('extensionsMenu').replaceWith(Object.assign(document.createElement('div'), { id: 'extensionsMenu' })); });
        await page.waitForSelector('.gujiguji-wand-button');
        assert.equal(await page.locator('#gujiguji-wand-entry').count(), 1);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
