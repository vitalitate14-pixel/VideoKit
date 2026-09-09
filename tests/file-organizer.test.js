const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const fileOrganizer = require('../electron/services/fileOrganizer');

test('fileOrganizer.splitTokens: correctly breaks down filenames into clean tokens', () => {
    const res1 = fileOrganizer.splitTokens('219 (1)_男1_动作01.mp4', 'auto');
    assert.deepEqual(res1.tokens, ['219', '1', '男1', '动作01']);

    const res2 = fileOrganizer.splitTokens('百草-特写-01.mov', 'auto');
    assert.deepEqual(res2.tokens, ['百草', '特写', '01']);

    const res3 = fileOrganizer.splitTokens('海边日落 4K 01.mp4', 'auto');
    assert.deepEqual(res3.tokens, ['海边日落', '4K', '01']);

    const res4 = fileOrganizer.splitTokens('【探店】_海底捞_吃火锅_v2.mp4', 'auto');
    assert.deepEqual(res4.tokens, ['探店', '海底捞', '吃火锅', 'v2']);

    const resUnderscore = fileOrganizer.splitTokens('219 (1)_男1_动作01.mp4', '_');
    assert.deepEqual(resUnderscore.tokens, ['219 (1)', '男1', '动作01']);
});

test('fileOrganizer.evaluateRule: evaluates content condition and formats folder name', () => {
    const fileInfo = fileOrganizer.splitTokens('219 (1)_男1_动作01.mp4');

    // Rule 1: contains '男', slots [2] -> '男1'
    const r1 = {
        id: 'r1',
        name: '角色规则',
        enabled: true,
        matchType: 'contains',
        matchValue: '男',
        folderMode: 'slots',
        slots: [2]
    };
    const res1 = fileOrganizer.evaluateRule(fileInfo, r1);
    assert.ok(res1);
    assert.equal(res1.group, '男1');

    // Rule 2: contains '219', slots [0, 2] -> '219_男1'
    const r2 = {
        id: 'r2',
        name: '编号加角色',
        enabled: true,
        matchType: 'contains',
        matchValue: '219',
        folderMode: 'slots',
        slots: [0, 2],
        slotJoiner: '_'
    };
    const res2 = fileOrganizer.evaluateRule(fileInfo, r2);
    assert.ok(res2);
    assert.equal(res2.group, '219_男1');

    // Rule 3: folderMode: 'matchedKeyword'
    const r3 = {
        id: 'r3',
        name: '关键字',
        enabled: true,
        matchType: 'contains',
        matchValue: '219',
        folderMode: 'matchedKeyword'
    };
    const res3 = fileOrganizer.evaluateRule(fileInfo, r3);
    assert.ok(res3);
    assert.equal(res3.group, '219');

    // Rule 4: non-matching rule
    const r4 = {
        id: 'r4',
        name: '不匹配',
        enabled: true,
        matchType: 'contains',
        matchValue: '百草'
    };
    const res4 = fileOrganizer.evaluateRule(fileInfo, r4);
    assert.equal(res4, null);
});

test('fileOrganizer.preview, apply and undo: manages multi-rule batch processing', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'videokit-organizer-test-'));

    // Create mock mixed files
    const fileNames = [
        '男1_动作01.mp4',
        '男1_动作02.mp4',
        '女2_跳舞01.mp4',
        '219 (1)_行15_A.mp4',
        '219 (2)_行16_B.mp4',
        '百草-特写-01.mp4',
        '未匹配特殊文件.mp4'
    ];
    fileNames.forEach(f => fs.writeFileSync(path.join(tmpDir, f), 'content'));

    const rules = [
        { id: 'r1', name: '男角色', enabled: true, matchType: 'contains', matchValue: '男', folderMode: 'slots', slots: [0] },
        { id: 'r2', name: '女角色', enabled: true, matchType: 'contains', matchValue: '女', folderMode: 'slots', slots: [0] },
        { id: 'r3', name: '219组', enabled: true, matchType: 'contains', matchValue: '219', folderMode: 'slots', slots: [0, 2], slotJoiner: '_' },
        { id: 'r4', name: '百草项目', enabled: true, matchType: 'contains', matchValue: '百草', folderMode: 'matchedKeyword' }
    ];

    const plan = fileOrganizer.preview(tmpDir, rules);
    assert.equal(plan.total, 7);
    assert.equal(plan.pending.length, 1);
    assert.equal(plan.pending[0].name, '未匹配特殊文件.mp4');

    const groupNames = plan.groups.map(g => g.name).sort();
    assert.deepEqual(groupNames, ['219_行15', '219_行16', '女2', '男1', '百草']);

    // Test apply (move mode)
    const applyRes = fileOrganizer.apply(plan);
    assert.equal(applyRes.moved, 6);
    assert.ok(fs.existsSync(path.join(tmpDir, '男1', '男1_动作01.mp4')));
    assert.ok(fs.existsSync(path.join(tmpDir, '百草', '百草-特写-01.mp4')));
    assert.ok(fs.existsSync(path.join(tmpDir, '未匹配特殊文件.mp4'))); // Unmoved

    // Test undo
    const undoRes = fileOrganizer.undo(applyRes.logPath);
    assert.equal(undoRes.restored, 6);
    assert.ok(fs.existsSync(path.join(tmpDir, '男1_动作01.mp4')));
    assert.ok(fs.existsSync(path.join(tmpDir, '百草-特写-01.mp4')));

    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('fileOrganizer.evaluateRule: multi-keyword matching (OR and AND)', () => {
    const f1 = fileOrganizer.splitTokens('001_男1_副本_0907_01.mp4');
    const f2 = fileOrganizer.splitTokens('002_男2_主片_0907_02.mp4');
    const f3 = fileOrganizer.splitTokens('003_女1_特写_0907_03.mp4');

    // Rule A: match ANY keyword (OR): '男1, 男2', folderMode: matchedKeyword
    const rA = {
        id: 'rA',
        name: '男生角色组',
        enabled: true,
        matchType: 'contains',
        matchValue: '男1, 男2',
        folderMode: 'matchedKeyword'
    };
    const resA1 = fileOrganizer.evaluateRule(f1, rA);
    assert.ok(resA1);
    assert.equal(resA1.group, '男1'); // 实际命中了 男1

    const resA2 = fileOrganizer.evaluateRule(f2, rA);
    assert.ok(resA2);
    assert.equal(resA2.group, '男2'); // 实际命中了 男2

    const resA3 = fileOrganizer.evaluateRule(f3, rA);
    assert.equal(resA3, null); // 女1 不匹配

    // Rule B: match ALL keywords (AND): '男1, 副本'
    const rB = {
        id: 'rB',
        name: '男1副本组',
        enabled: true,
        matchType: 'containsAll',
        matchValue: '男1, 副本',
        folderMode: 'custom',
        customName: '男1副本专属'
    };
    const resB1 = fileOrganizer.evaluateRule(f1, rB);
    assert.ok(resB1);
    assert.equal(resB1.group, '男1副本专属');

    const resB2 = fileOrganizer.evaluateRule(f2, rB);
    assert.equal(resB2, null); // 男2 没副本，不满足 containsAll
});
