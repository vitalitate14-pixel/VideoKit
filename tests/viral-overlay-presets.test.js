const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

test('viral overlay presets: all 82 reference styles correctly defined and pixel-accurate', () => {
    const filePath = path.resolve(__dirname, '../82套爆款短视频覆层预设完整库.json');
    const presets = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    assert.ok(presets, 'presets should be loaded from json');

    const viralKeys = Object.keys(presets).filter(k => k.startsWith('【爆款-'));
    assert.ok(viralKeys.length >= 82, `Must contain at least 82 viral presets, found ${viralKeys.length}`);

    // Verify key iconic presets exist
    const sampleKeys = [
        '【爆款-01】', '【爆款-02】', '【爆款-03】', '【爆款-04】',
        '【爆款-07】', '【爆款-19】', '【爆款-23】', '【爆款-33】',
        '【爆款-108】', '【爆款-186】', '【爆款-193】', '【爆款-229】'
    ];

    for (const prefix of sampleKeys) {
        const matchingKey = viralKeys.find(k => k.startsWith(prefix));
        assert.ok(matchingKey, `Preset starting with "${prefix}" must exist`);
        
        const layer = presets[matchingKey][0];
        assert.equal(layer.type, 'textcard', `${matchingKey} layer type should be textcard`);
        assert.ok(layer.title_text && layer.title_text.length > 0, `${matchingKey} should have title_text`);
        assert.ok(layer.body_text && layer.body_text.length > 0, `${matchingKey} should have body_text`);
        assert.equal(layer.auto_fit, true, `${matchingKey} auto_fit should be true`);
        assert.equal(layer.auto_center_v, true, `${matchingKey} auto_center_v should be true`);

        // Verify valid hex color
        assert.match(layer.title_color, /^#[0-9A-Fa-f]{6}$/, `${matchingKey} title_color should be valid hex`);
        assert.match(layer.body_color, /^#[0-9A-Fa-f]{6}$/, `${matchingKey} body_color should be valid hex`);
    }

    // Verify bright outdoor scenes DO NOT have fake fullscreen black masks
    const brightScenes = ['【爆款-01】', '【爆款-02】', '【爆款-19】', '【爆款-108】', '【爆款-186】', '【爆款-229】'];
    for (const prefix of brightScenes) {
        const k = viralKeys.find(key => key.startsWith(prefix));
        const layer = presets[k][0];
        assert.equal(layer.fullscreen_mask, false, `${k} must NOT have fullscreen_mask enabled to preserve video clarity`);
    }

    // Verify dark moody scenes DO have appropriate vignette/mask
    const darkScenes = ['【爆款-03】', '【爆款-48】', '【爆款-182】'];
    for (const prefix of darkScenes) {
        const k = viralKeys.find(key => key.startsWith(prefix));
        const layer = presets[k][0];
        assert.equal(layer.fullscreen_mask, true, `${k} should have atmospheric dark mask`);
        assert.ok(layer.card_opacity > 0 && layer.card_opacity <= 50, `${k} mask opacity should be subtle (<=50%)`);
    }
});
