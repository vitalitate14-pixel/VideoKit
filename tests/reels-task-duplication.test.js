const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function createMockEnv() {
    const alerts = [];
    const elements = new Map();
    const docMock = {
        addEventListener: () => {},
        removeEventListener: () => {},
        getElementById: id => elements.get(id) || {
            value: '',
            tagName: 'DIV',
            dataset: {},
            style: {},
            classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
            querySelector: () => null,
            querySelectorAll: () => [],
            scrollIntoView: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            pause: () => {},
            play: () => {},
            removeAttribute: () => {},
            setAttribute: () => {},
        },
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: () => ({
            value: '',
            tagName: 'DIV',
            dataset: {},
            style: {},
            classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
            querySelector: () => ({ focus() {} }),
            querySelectorAll: () => [],
            appendChild: () => {},
            addEventListener: () => {},
            remove: () => {},
            pause: () => {},
            play: () => {},
            removeAttribute: () => {},
            setAttribute: () => {},
        }),
        body: {
            appendChild: () => {},
            removeChild: () => {},
        },
    };

    const storage = new Map();
    const localStorageMock = {
        getItem: k => (storage.has(k) ? storage.get(k) : null),
        setItem: (k, v) => storage.set(k, String(v)),
        removeItem: k => storage.delete(k),
        clear: () => storage.clear(),
    };

    const context = vm.createContext({
        console,
        alert: msg => alerts.push(msg),
        document: docMock,
        localStorage: localStorageMock,
        setTimeout: () => 1,
        clearTimeout: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        navigator: { userAgent: 'node' },
        window: {},
        ReelsTaskDerivation: {
            prepareDerivedTask: t => t,
            rekeyTask: t => {
                t.id = 'rekeyed_' + Math.random().toString(36).slice(2, 7);
                return t;
            },
        },
    });
    context.window = context;
    context.window.addEventListener = () => {};
    context.window.removeEventListener = () => {};
    context.window.ReelsTaskDerivation = context.ReelsTaskDerivation;
    return { context, alerts, elements, docMock };
}

test('bulk create table duplicates single row with version tag and inserts below source', () => {
    const { context } = createMockEnv();
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/reels-bulk-create.js'), 'utf8'), context);

    vm.runInContext(`
        _bulkState.columns = [
            { name: '导出命名', type: 'text' },
            { name: '标题', type: 'text' },
            { name: '正文', type: 'text' }
        ];
        _bulkState.rows = [
            ['video_01', '标题一', '正文内容一'],
            ['video_02', '标题二', '正文内容二']
        ];
    `, context);

    // Duplicate row 0 with versionTag 'Hook-B'
    const newRows = vm.runInContext(`_bcDuplicateRows([0], 'Hook-B')`, context);
    assert.equal(newRows.length, 1);
    assert.equal(newRows[0][0], 'video_01_Hook-B');
    assert.equal(newRows[0][1], '标题一');
    assert.equal(newRows[0]._versionTag, 'Hook-B');

    // Verify row insertion position (inserted right after row 0 at index 1)
    const rows = vm.runInContext(`_bulkState.rows`, context);
    assert.equal(rows.length, 3);
    assert.equal(rows[0][0], 'video_01');
    assert.equal(rows[1][0], 'video_01_Hook-B');
    assert.equal(rows[2][0], 'video_02');

    // Check selection updated to newly inserted row 1
    const sel = vm.runInContext(`_bcSelection`, context);
    assert.equal(sel.r1, 1);
    assert.equal(sel.r2, 1);
});

test('bulk create table duplicates multiple selected rows in batch', () => {
    const { context } = createMockEnv();
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/reels-bulk-create.js'), 'utf8'), context);

    vm.runInContext(`
        _bulkState.columns = [
            { name: '视频标题', type: 'text' },
            { name: '文案', type: 'text' }
        ];
        _bulkState.rows = [
            ['TopicA', 'CopyA'],
            ['TopicB', 'CopyB'],
            ['TopicC', 'CopyC']
        ];
    `, context);

    // Duplicate rows 0 and 1 with versionTag '短版'
    const newRows = vm.runInContext(`_bcDuplicateRows([0, 1], '短版')`, context);
    assert.equal(newRows.length, 2);
    assert.equal(newRows[0][0], 'TopicA_短版');
    assert.equal(newRows[1][0], 'TopicB_短版');

    const rows = vm.runInContext(`_bulkState.rows`, context);
    assert.equal(rows.length, 5);
    // Rows 0 and 1 duplicated, inserted right after row 1
    assert.equal(rows[0][0], 'TopicA');
    assert.equal(rows[1][0], 'TopicB');
    assert.equal(rows[2][0], 'TopicA_短版');
    assert.equal(rows[3][0], 'TopicB_短版');
    assert.equal(rows[4][0], 'TopicC');

    // Check selection span (from index 2 to index 3)
    const sel = vm.runInContext(`_bcSelection`, context);
    assert.equal(sel.r1, 2);
    assert.equal(sel.r2, 3);
});

test('_bcBuildTask passes row._versionTag to generated task', () => {
    const { context } = createMockEnv();
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/reels-bulk-create.js'), 'utf8'), context);

    const task = vm.runInContext(`
        const tpl = { label: 'T1', task: { overlays: [] }, bindings: { __export_name__: 0 } };
        const row = ['test_export', 'title'];
        row._versionTag = 'Hook-C';
        const cols = [{ name: '导出命名', type: 'text' }, { name: '标题', type: 'text' }];
        _bcBuildTask(tpl, row, 0, 1, cols);
    `, context);

    assert.equal(task.exportName, 'test_export');
    assert.equal(task.versionTag, 'Hook-C');
});

test('_resolveReelsExportBaseName appends versionTag suffix to export filename', () => {
    const { context } = createMockEnv();
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/batch-reels.js'), 'utf8'), context);

    // 1. Task with exportName and versionTag
    const res1 = vm.runInContext(`
        _resolveReelsExportBaseName({ exportName: 'MyVideo', versionTag: 'Hook-B' });
    `, context);
    assert.equal(res1, 'MyVideo_Hook-B');

    // 2. Task where exportName already ends with _Hook-B (no duplicate suffix)
    const res2 = vm.runInContext(`
        _resolveReelsExportBaseName({ exportName: 'MyVideo_Hook-B', versionTag: 'Hook-B' });
    `, context);
    assert.equal(res2, 'MyVideo_Hook-B');

    // 3. Task without exportName but with fileName and versionTag
    const res3 = vm.runInContext(`
        _resolveReelsExportBaseName({ fileName: 'nature_clip.mp4', versionTag: '短版' }, 'custom');
    `, context);
    assert.equal(res3, 'nature_clip_短版');

    // 4. Task without versionTag
    const res4 = vm.runInContext(`
        _resolveReelsExportBaseName({ exportName: 'NormalVideo' });
    `, context);
    assert.equal(res4, 'NormalVideo');
});

test('reelsDuplicateTask and reelsDuplicateSelectedTasks clone tasks and set versionTag', async () => {
    const { context } = createMockEnv();
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/batch-reels.js'), 'utf8'), context);

    // Setup initial tasks in _reelsState
    vm.runInContext(`
        _reelsState.tasks = [
            { id: 't1', baseName: 'task1', fileName: 'task1.mp4', exportName: 'video1', _exportSelected: true },
            { id: 't2', baseName: 'task2', fileName: 'task2.mp4', exportName: 'video2', _exportSelected: true },
            { id: 't3', baseName: 'task3', fileName: 'task3.mp4', exportName: 'video3', _exportSelected: false }
        ];
        _reelsState.selectedIdx = 0;
    `, context);

    // Test single task duplicate
    await vm.runInContext(`reelsDuplicateTask(0, 'Hook-B')`, context);
    const tasksAfterSingle = vm.runInContext(`_reelsState.tasks`, context);
    assert.equal(tasksAfterSingle.length, 4);
    assert.equal(tasksAfterSingle[0].id, 't1');
    assert.notEqual(tasksAfterSingle[1].id, 't1'); // Rekeyed unique ID
    assert.equal(tasksAfterSingle[1].versionTag, 'Hook-B');
    assert.equal(tasksAfterSingle[1].exportName, 'video1_Hook-B');
    assert.equal(vm.runInContext(`_reelsState.selectedIdx`, context), 1);

    // Test batch duplicate for selected tasks
    vm.runInContext(`
        _reelsState.tasks = [
            { id: 't1', baseName: 'task1', fileName: 'task1.mp4', exportName: 'video1', _exportSelected: true },
            { id: 't2', baseName: 'task2', fileName: 'task2.mp4', exportName: 'video2', _exportSelected: false },
            { id: 't3', baseName: 'task3', fileName: 'task3.mp4', exportName: 'video3', _exportSelected: true }
        ];
    `, context);

    await vm.runInContext(`reelsDuplicateSelectedTasks('精简版')`, context);
    const tasksAfterBatch = vm.runInContext(`_reelsState.tasks`, context);
    assert.equal(tasksAfterBatch.length, 5); // 3 original + 2 duplicated (t1 and t3)
    assert.equal(tasksAfterBatch[3].versionTag, '精简版');
    assert.equal(tasksAfterBatch[3].exportName, 'video1_精简版');
    assert.equal(tasksAfterBatch[4].versionTag, '精简版');
    assert.equal(tasksAfterBatch[4].exportName, 'video3_精简版');
});

test('UI elements for task duplication exist in source and HTML templates', () => {
    const bulkJs = fs.readFileSync(path.join(__dirname, '../src/reels-bulk-create.js'), 'utf8');
    const batchJs = fs.readFileSync(path.join(__dirname, '../src/batch-reels.js'), 'utf8');
    const indexHtml = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');

    // Bulk create table
    assert.ok(bulkJs.includes('bc-row-copy'), 'bulk create table must have bc-row-copy');
    assert.ok(bulkJs.includes('bc-duplicate-rows'), 'bulk create toolbar must have bc-duplicate-rows');

    // Left task list
    assert.ok(batchJs.includes('reels-version-tag'), 'task list must render reels-version-tag badge');
    assert.ok(batchJs.includes('reels-task-duplicate-btn'), 'task item must have duplicate button');
    assert.ok(batchJs.includes('reelsDuplicateTask'), 'reelsDuplicateTask function must be defined');
    assert.ok(batchJs.includes('reelsDuplicateSelectedTasks'), 'reelsDuplicateSelectedTasks function must be defined');

    // HTML toolbar
    assert.ok(indexHtml.includes('reels-batch-duplicate-btn'), 'index.html must have reels-batch-duplicate-btn');
    assert.ok(indexHtml.includes('reelsDuplicateSelectedTasks()'), 'index.html button must trigger reelsDuplicateSelectedTasks()');
});
