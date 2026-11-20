// Real Chromium DOM with a mocked host context, not a full SillyTavern install.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');

test('contact setup, tutorial, memory, and legacy world album open from their normal entry points', async () => {
    const browser = await chromium.launch({ headless: true,
        ...(process.env.GUJI_BROWSER_PATH ? { executablePath: process.env.GUJI_BROWSER_PATH } : {}) });
    try {
        const page = await browser.newPage({ viewport: { width: 360, height: 800 }, reducedMotion: 'reduce' });
        page.setDefaultTimeout(7000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('http://guji.test/**', route => {
            const file = new URL(route.request().url()).pathname.slice(1);
            if (['bootstrap.js', 'index.js', 'memory.js', 'album.js', 'style.css'].includes(file)) {
                return route.fulfill({ path: path.join(root, file) });
            }
            if (file) return route.fulfill({ status: 404 });
            return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><div id="extensionsMenu"></div>' });
        });
        await page.goto('http://guji.test/');
        await page.evaluate(async () => {
            const picture = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
            const ctx = { characterId: 0, chatId: 'test-story', name1: '玩家',
                characters: [{ name: '角色甲', data: {} }], chat: [], chatMetadata: {},
                extensionSettings: { gujiguji: {
                    lock: { enabled: false }, desktopOrder: ['chat', 'settings', 'memory', 'album'],
                    albumSafetyWarningDisabled: true,
                    worldAlbumFolders: { modern: ['风景', '家居', '室外'] },
                    worldPhotoAlbums: { modern: [
                        { id: 'park', folder: '风景', title: '旧公园照片', image: picture },
                        { id: 'room', folder: '家居', title: '旧室内照片', image: picture + '#room' },
                    ] },
                    albumCovers: { 'world:modern:风景': 'room' },
                } },
                saveMetadata: async () => {}, saveSettingsDebounced() {} };
            window.SillyTavern = { getContext: () => ctx };
            await (await import('/bootstrap.js')).onActivate();
        });
        const control = key => page.locator('[data-lp="' + key + '"]');
        const screen = key => page.locator('[data-lp-screen="' + key + '"]');
        const openIn = (from, to) => screen(from).locator('[data-lp-open="' + to + '"]');
        await page.locator('.gujiguji-wand-button').click();
        await openIn('home', 'chatList').click();
        await openIn('chatList', 'contacts').click();
        await openIn('contacts', 'addNpc').click();
        assert.equal(await control('title').innerText(), '添加联系人');
        assert.equal(await control('viewPrimaryContact').innerText(), '角色甲');
        page.once('dialog', dialog => dialog.accept());
        await control('addPrimaryFriend').click();
        await screen('requests').getByRole('button', { name: '同意', exact: true }).click();
        await page.waitForFunction(() => SillyTavern.getContext().chatMetadata.st_little_phone_v1.friendship.state === 'friends');
        for (let i = 0; i < 3; i++) await control('back').click();
        await openIn('home', 'settings').click();
        assert.equal(await openIn('settings', 'memory').count(), 0);
        await screen('settings').getByRole('button', { name: /使用教程/ }).click();
        assert.equal(await control('title').innerText(), '使用教程');
        await control('back').click();
        await control('back').click();
        await openIn('home', 'memory').click();
        await screen('memory').getByText('暂无记忆', { exact: true }).waitFor();
        const search = await control('phoneMemorySearch').locator('..').boundingBox();
        const filter = await control('phoneMemoryFilter').boundingBox();
        assert.deepEqual([search.y, search.height], [filter.y, filter.height]);
        await control('phoneMemoryAdd').click();
        await control('phoneMemoryText').fill('下周一起看展。');
        await control('phoneMemoryEditSave').click();
        await control('phoneMemoryList').getByText('下周一起看展。', { exact: true }).first().waitFor();
        await control('back').click();
        await openIn('home', 'album').click();
        await page.locator('[data-album-action="owner"][data-album-id="world"]').click();
        const folder = id => page.locator('[data-album-action="folder"][data-album-id="' + id + '"]');
        assert.equal(await folder('室外').count(), 1);
        assert.equal(await folder('风景').count(), 0);
        assert.match(await folder('室外').innerText(), /室外\s*1 张/);
        assert.match(await folder('室内').innerText(), /室内\s*1 张/);
        assert.match(await folder('室外').locator('img').getAttribute('src'), /#room$/);
        await folder('室外').click();
        await screen('album').getByText('旧公园照片', { exact: true }).waitFor();
        await control('back').click();
        await folder('室内').click();
        await screen('album').getByText('旧室内照片', { exact: true }).waitFor();
        await control('back').click();
        await page.locator('[data-album-action="import"]').click();
        const manifest = { schema: 'gujiguji-album-v1', version: 1, photos: [
            { ownerId: 'world', folder: '家居', file: 'room.gif', title: '旧模板照片' },
        ] };
        await page.locator('[data-album-field="files"]').setInputFiles([
            { name: 'manifest.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(manifest)) },
            { name: 'room.gif', mimeType: 'image/gif', buffer: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') },
        ]);
        await page.locator('[data-album-action="upload"]').click();
        const selectedFolder = page.locator('[data-album-review="folder"]');
        await selectedFolder.waitFor();
        assert.equal(await selectedFolder.inputValue(), '室内');
        assert.deepEqual(errors, []);
    } finally {
        await browser.close();
    }
});

test('magic-wand entry follows live host themes and opens by keyboard', async () => {
    const browser = await chromium.launch({ headless: true,
        ...(process.env.GUJI_BROWSER_PATH ? { executablePath: process.env.GUJI_BROWSER_PATH } : {}) });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.route('http://guji.test/**', route => {
            const file = new URL(route.request().url()).pathname.slice(1);
            if (['bootstrap.js', 'index.js', 'style.css'].includes(file)) {
                return route.fulfill({ path: path.join(root, file) });
            }
            if (file) return route.fulfill({ status: 404 });
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html>
                <style>
                    :root { --SmartThemeBodyColor: #8d97b2; --icon-color: #7581a2; }
                    :root.changed { --SmartThemeBodyColor: #96735c; --icon-color: #a6826b; }
                    #extensionsMenu > .extension_container > div { color: var(--SmartThemeBodyColor); }
                    #extensionsMenu > .extension_container > div > .extensionsMenuExtensionButton::before {
                        content: '●'; color: var(--icon-color);
                    }
                    #extensionsMenu > .extension_container.alert > div,
                    #extensionsMenu > .extension_container.alert > div > .extensionsMenuExtensionButton::before { color: red; }
                </style>
                <link rel="stylesheet" href="/style.css">
                <div id="extensionsMenu">
                    <div class="extension_container" id="native-entry">
                        <div class="list-group-item flex-container flexGap5">
                            <div class="extensionsMenuExtensionButton"></div><span>翻译聊天</span>
                        </div>
                    </div>
                    <div class="extension_container alert">
                        <div class="list-group-item flex-container flexGap5">
                            <div class="extensionsMenuExtensionButton"></div><span>其他扩展</span>
                        </div>
                    </div>
                </div>` });
        });
        await page.goto('http://guji.test/');
        await page.evaluate(async () => {
            const ctx = { extensionSettings: {}, chatMetadata: {} };
            window.SillyTavern = { getContext: () => ctx };
            const boot = await import('/bootstrap.js');
            await boot.onActivate();
        });
        const entry = page.locator('.gujiguji-wand-button');
        await entry.waitFor();
        const colorsFor = element => [getComputedStyle(element.querySelector('span')).color,
            getComputedStyle(element.querySelector('.extensionsMenuExtensionButton'), '::before').color];
        const nativeEntry = page.locator('#native-entry .list-group-item');
        const before = await nativeEntry.evaluate(colorsFor);
        assert.deepEqual(await entry.evaluate(colorsFor), before);
        await page.evaluate(() => document.documentElement.classList.add('changed'));
        const after = await nativeEntry.evaluate(colorsFor);
        assert.notDeepEqual(after, before);
        assert.deepEqual(await entry.evaluate(colorsFor), after);
        await entry.press('Enter');
        assert.equal(await page.locator('dialog').evaluate(node => node.open), true);
    } finally {
        await browser.close();
    }
});

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
        await page.waitForFunction(()=>ctx.chatMetadata.st_little_phone_v1.messages.some(m=>m.from==='user'&&m.stickerImages?.length));
        await page.locator('[data-lp="generate"]').click();
        await page.waitForFunction(()=>ctx.chatMetadata.st_little_phone_v1.messages.some(m=>m.from==='character'&&m.stickerImages?.length));
        assert.equal(await page.evaluate(() => ctx.chatMetadata.st_little_phone_v1.messages[0].text), '保留旧聊天');
        await page.evaluate(() => boot.onDisable());
        assert.equal(await page.locator('#st-little-phone-root, #gujiguji-wand-entry, #gujiguji-floating-launcher').count(), 0);
        await page.evaluate(async () => { await boot.onEnable(); await boot.onActivate(); });
        assert.equal(await page.locator('#st-little-phone-root').count(), 1);
        assert.equal(await page.locator('#gujiguji-wand-entry').count(), 1);
        await page.evaluate(() => { document.getElementById('extensionsMenu').replaceWith(Object.assign(document.createElement('div'), { id: 'extensionsMenu' })); });
        await page.waitForSelector('.gujiguji-wand-button');
        assert.equal(await page.locator('#gujiguji-wand-entry').count(), 1);
        // A transformed/scrolled host body makes ordinary fixed controls drift
        // away from the visible viewport on some Android WebViews.
        const launcherPosition=await page.evaluate(() => {
            document.body.style.minHeight='2400px';
            document.body.style.transform='translateZ(0)';
            const checkbox=document.getElementById('gujiguji-host-floating');
            checkbox.checked=true;
            checkbox.dispatchEvent(new Event('change',{bubbles:true}));
            window.scrollTo(0,950);
            const button=document.getElementById('gujiguji-floating-launcher');
            const rect=button.getBoundingClientRect();
            return {top:rect.top,bottom:rect.bottom,viewport:window.innerHeight,
                topLayer:button.matches(':popover-open'),scrollY:window.scrollY};
        });
        assert.equal(launcherPosition.topLayer,true,'launcher must use the viewport top layer');
        assert.ok(launcherPosition.scrollY>100,'test must exercise the scrolled host');
        assert.ok(launcherPosition.top>=0&&launcherPosition.bottom<=launcherPosition.viewport,
            `launcher escaped viewport: ${JSON.stringify(launcherPosition)}`);
        const beforeDrag=await page.locator('#gujiguji-floating-launcher').boundingBox();
        await page.mouse.move(beforeDrag.x+27,beforeDrag.y+27);
        await page.mouse.down();
        await page.mouse.move(65,150,{steps:5});
        await page.mouse.up();
        const dropped=await page.evaluate(()=>({
            rect:document.getElementById('gujiguji-floating-launcher').getBoundingClientRect().toJSON(),
            saved:ctx.extensionSettings.gujiguji.floatingLauncherPosition,
            open:document.querySelector('.lp-panel').open}));
        assert.ok(dropped.saved&&dropped.saved.x<0.4&&dropped.saved.y<0.3,'drag saves a near-top-left position');
        assert.equal(dropped.open,false,'drag must not generate an open-phone click');
        await page.evaluate(async()=>{boot.onDisable();await boot.onEnable();});
        const restored=await page.locator('#gujiguji-floating-launcher').boundingBox();
        assert.ok(Math.abs(restored.x-dropped.rect.x)<=2&&Math.abs(restored.y-dropped.rect.y)<=2,
            're-enable should restore the last dropped position');
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
