const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup(names, templates, controls = {}) {
    const alerts = [];
    const context = vm.createContext({
        window: {}, console, alert: message => alerts.push(message),
        document: { getElementById: id => controls[id] == null ? null : { value: controls[id] } },
        setTimeout: () => 1, clearTimeout() {},
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/reels-bulk-create.js'), 'utf8'), context);
    context.names = names;
    context.templates = templates;
    vm.runInContext('_bulkState.columns = names.map(name => ({name, type:"text"})); _bulkState.templates = templates;', context);
    return { context, alerts };
}
const template = type => ({ task: { overlays: [{ type }] }, bindings: {} });

test('numbered matching sorts whole groups numerically and binds card and scroll text without crossing groups', () => {
    const { context } = setup(['reels-10-正文', 'reels-2-原始文案', 'reels-10-原始文案', 'reels-2-正文', 'reels-2-内容'], [template('textcard'), template('scroll')]);
    vm.runInContext('_bcAssignNumberedGroups()', context);
    const [card, scroll] = context.templates;
    assert.equal(card.bindings.L0_body_text, 3);
    assert.equal(card.bindings.__ai__, 1);
    assert.equal(scroll.bindings.L0_content, 0);
    assert.equal(scroll.bindings.__ai__, 2);
    assert.equal(scroll.bindings.L0_scroll_title, undefined);
});

test('random pairing uses every group exactly once and stays fixed until the next assignment', () => {
    const { context } = setup(['reels-1-正文', 'reels-2-正文', 'reels-3-正文'], [template('textcard'), template('scroll'), template('text')]);
    vm.runInContext('Math.random = () => 0; _bcAssignNumberedGroups(true)', context);
    const bound = context.templates.map(t => Object.values(t.bindings)[0]);
    assert.deepEqual([...bound].sort(), [0, 1, 2]);
    vm.runInContext('_bcRenderBindings()', context);
    assert.deepEqual(context.templates.map(t => Object.values(t.bindings)[0]), bound);
});

test('fewer templates than copy groups automatically reuse templates and assign every group', () => {
    const { context, alerts } = setup(['reels-1-正文', 'reels-2-正文'], [template('textcard')]);
    vm.runInContext('_bcAssignNumberedGroups(true)', context);
    assert.equal(alerts.length, 0);
    assert.equal(vm.runInContext('_bulkState.groupAssignments.length', context), 2);
    assert.equal(vm.runInContext('_bulkState.allowTemplateReuse', context), true);
});

test('surplus templates remain unused and random selection draws from the full library', () => {
    const { context, alerts } = setup(['reels-1-正文', 'reels-2-正文'], [template('textcard'), template('textcard'), template('textcard')]);
    vm.runInContext('Math.random = () => 0; _bcAssignNumberedGroups(true)', context);
    const entries = JSON.parse(vm.runInContext('JSON.stringify(_bulkState.groupAssignments)', context));
    assert.equal(alerts.length, 0);
    assert.deepEqual(entries.map(e => e.templateIndex), [1, 2]);
    assert.equal(context.templates.length, 3);
});

test('custom separators are literal and absent fields do not reuse another group', () => {
    const tpl = template('scroll'); tpl.bindings.L0_content = 1;
    const { context } = setup(['FB_5.标题', 'FB_6.正文'], [tpl], { 'bc-header-prefix': 'FB', 'bc-header-before': '_', 'bc-header-after': '.' });
    vm.runInContext('_bcBindNumberedGroup(templates[0], _bcNumberedColumnGroups()[0])', context);
    assert.equal(tpl.bindings.L0_scroll_title, 0);
    assert.equal(tpl.bindings.L0_content, undefined);
});

test('reuse distributes more groups than templates and manual choices can repeat', () => {
    const { context } = setup(['reels-1-正文', 'reels-2-正文', 'reels-3-正文'], [template('textcard')]);
    vm.runInContext('_bulkState.allowTemplateReuse = true; _bcAssignNumberedGroups(); _bcSetGroupTemplate("reels-2", 0)', context);
    const result = JSON.parse(vm.runInContext('JSON.stringify(_bulkState.groupAssignments)', context));
    assert.equal(result.length, 3);
    assert.deepEqual(result.map(entry => entry.templateIndex), [0, 0, 0]);
});

test('one-to-one manual reassignment swaps templates instead of repeating them', () => {
    const { context } = setup(['reels-1-正文', 'reels-2-正文'], [template('textcard'), template('scroll')]);
    vm.runInContext('_bcAssignNumberedGroups(); _bcSetGroupTemplate("reels-1", 1)', context);
    assert.equal(vm.runInContext('_bulkState.groupAssignments[0].templateIndex', context), 1);
    assert.equal(vm.runInContext('_bulkState.groupAssignments[1].templateIndex', context), 0);
});

test('generation uses each repeated template assignment and its independent custom fields', () => {
    const { context } = setup(['reels-1-正文', 'reels-2-正文', 'reels-2-内容'], [template('textcard')]);
    vm.runInContext(`
        _bulkState.allowTemplateReuse = true;
        _bcAssignNumberedGroups();
        _bulkState.groupAssignments[1].bindings.L0_body_text = 'reels-2-内容';
        _bulkState.rows = [['第一组', '第二组', '自定义第二组']];
        window._reelsState = {tasks: []};
        _bcBuildTask = (tpl, row) => ({body: row[tpl.bindings.L0_body_text]});
        _bcGenerateTasks();
    `, context);
    assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(window._reelsState.tasks)', context)), [{body:'第一组'}, {body:'自定义第二组'}]);
});

test('draft roundtrip retains reuse and customized assignments', () => {
    const { context } = setup(['reels-1-正文', 'reels-2-正文'], [template('textcard')]);
    let saved;
    context.localStorage = { setItem: (_, data) => { saved = data; }, getItem: () => saved };
    vm.runInContext(`_bulkState.allowTemplateReuse = true; _bcAssignNumberedGroups();
        _bulkState.groupAssignments[0].bindings.L0_body_text = null;
        _bulkState.backgroundFolders = [{path:'/saved',name:'saved',files:['/saved/1.mp4']}];
        _bulkState.groupAssignments[0].backgroundFolder = '/saved';
        _bcSaveDraftNow(); _bulkState.groupAssignments = null; _bulkState.allowTemplateReuse = false;
        _bcLoadDraftOnce();`, context);
    assert.equal(vm.runInContext('_bulkState.allowTemplateReuse', context), true);
    assert.equal(vm.runInContext('_bulkState.groupAssignments.length', context), 2);
    assert.equal(vm.runInContext('_bulkState.groupAssignments[0].bindings.L0_body_text', context), null);
    assert.equal(vm.runInContext('_bulkState.backgroundFolders[0].files[0]', context), '/saved/1.mp4');
    assert.equal(vm.runInContext('_bulkState.groupAssignments[0].backgroundFolder', context), '/saved');
});

test('binding panel shows repeated usage counts and editable group fields', () => {
    const { context } = setup(['reels-1-正文', 'reels-2-正文'], [{...template('textcard'), label:'示例模板'}]);
    vm.runInContext('_bulkState.allowTemplateReuse = true; _bcAssignNumberedGroups()', context);
    const panel = { innerHTML: '' };
    context.document.getElementById = id => id === 'bc-bind-panel' ? panel : null;
    vm.runInContext('_bcRenderBindings()', context);
    assert.match(panel.innerHTML, /已选 2 次/);
    assert.match(panel.innerHTML, /自定义字段匹配/);
    assert.equal((panel.innerHTML.match(/class="bc-group-template"/g) || []).length, 2);
});

test('folder library imports distinct classes, filters media, sorts numerically and refreshes in place', async () => {
    const { context } = setup([], []);
    context.window.electronAPI = { scanDirectory: async path => [
        {path: path + '/10.mp4', name:'10.mp4'}, {path:path+'/2.jpg',name:'2.jpg'},
        {path:path+'/note.txt',name:'note.txt'}, {path:path+'/sub',isDirectory:true},
    ] };
    await vm.runInContext('_bcImportBackgroundFolders(["/A", "/B", "/A"])', context);
    await vm.runInContext('_bcImportBackgroundFolders(["/A"])', context);
    const folders = JSON.parse(vm.runInContext('JSON.stringify(_bulkState.backgroundFolders)', context));
    assert.equal(folders.length, 2);
    assert.deepEqual(folders[0].files, ['/A/2.jpg','/A/10.mp4']);
});

test('background categories are independent per group even when a template is reused', () => {
    const { context } = setup(['reels-1-正文','reels-2-正文'], [template('textcard')]);
    vm.runInContext(`
        _bulkState.allowTemplateReuse = true; _bcAssignNumberedGroups();
        _bulkState.backgroundFolders = [{path:'/A',files:['/A/1.mp4','/A/2.mp4']},{path:'/B',files:['/B/1.jpg']}];
        _bulkState.groupAssignments[0].backgroundFolder = '/A';
        _bulkState.groupAssignments[1].backgroundFolder = '/B';
        _bulkState.rows = [['A1','B1'],['A2','B2']];
        window._reelsState = {tasks:[]};
        _bcBuildTask = (tpl,row) => ({body:row[tpl.bindings.L0_body_text]});
        _bcGenerateTasks();
    `, context);
    assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(window._reelsState.tasks.map(t => t.bgPath))', context)), ['/A/1.mp4','/B/1.jpg','/A/2.mp4','/B/1.jpg']);
});

test('random and concatenated backgrounds stay within the selected category', () => {
    const { context } = setup([], []);
    vm.runInContext(`_bulkState.backgroundFolders = [{path:'/A',files:['/A/1.mp4','/A/2.mp4']}];
        Math.random = () => 0.99;
        var task = {};
        _bcApplyAssignedBackground(task, {assignedBackgroundFolder:'/A',assignedBackgroundMode:'random'},0);`, context);
    assert.equal(context.task.bgPath, '/A/2.mp4');
    vm.runInContext('_bcApplyAssignedBackground(task, {assignedBackgroundFolder:"/A",assignedBackgroundMode:"concat"},0)', context);
    assert.equal(context.task.bgMode,'multi');
    assert.deepEqual(Array.from(context.task.bgClipPool),['/A/1.mp4','/A/2.mp4']);
});

test('random category allocation excludes empty folders and preserves chosen templates', () => {
    const { context } = setup(['reels-1-正文','reels-2-正文'], [template('textcard'),template('scroll')]);
    vm.runInContext(`_bcAssignNumberedGroups();
        _bulkState.backgroundFolders = [{path:'/empty',files:[]},{path:'/A',files:['/A/a.mp4']}];
        _bcRandomizeBackgroundGroups();`, context);
    const entries = JSON.parse(vm.runInContext('JSON.stringify(_bulkState.groupAssignments)', context));
    assert.deepEqual(entries.map(e=>e.templateIndex), [0,1]);
    assert.deepEqual(entries.map(e=>e.backgroundFolder), ['/A','/A']);
});

test('seeded random background is stable between preview and generation for each row', () => {
    const { context } = setup(['reels-1-正文'], [template('textcard')]);
    vm.runInContext(`_bcAssignNumberedGroups();
        _bulkState.backgroundFolders = [{path:'/A',files:['/A/1.mp4','/A/2.mp4','/A/3.mp4']}];
        _bulkState.groupAssignments[0].backgroundFolder = '/A';
        _bulkState.groupAssignments[0].backgroundMode = 'random';
        var previewTpl = _bcAssignedTemplate(_bulkState.groupAssignments[0],_bcNumberedColumnGroups()[0]);
        var generateTpl = _bcAssignedTemplate(_bulkState.groupAssignments[0],_bcNumberedColumnGroups()[0]);
        var previewTask = {}, generatedTask = {};
        _bcApplyAssignedBackground(previewTask,previewTpl,7);
        _bcApplyAssignedBackground(generatedTask,generateTpl,7);`, context);
    assert.equal(context.previewTask.bgPath,context.generatedTask.bgPath);
});

test('batch preview includes every effective row and group, with independent background positions', () => {
    const { context } = setup(['reels-1-正文','reels-2-正文'], [template('textcard'),template('textcard')]);
    vm.runInContext(`_bcAssignNumberedGroups();
        _bulkState.rows = [['A1','B1'],['','B2'],['A3',''],['','']];
        var items = _bcAllPreviewItems();`, context);
    const items = JSON.parse(vm.runInContext('JSON.stringify(items.map(i=>({key:i.key,row:i.rowIndex,local:i.localIndex})))', context));
    assert.deepEqual(items, [
        {key:'reels-1',row:0,local:0},{key:'reels-1',row:2,local:1},
        {key:'reels-2',row:0,local:0},{key:'reels-2',row:1,local:1},
    ]);
    vm.runInContext('_bcSetGroupTemplate("reels-2", -1)', context);
    assert.equal(vm.runInContext('_bcAllPreviewItems().length', context),2);
});

test('suite overlay edits are independent, keep custom bindings when reordered and reset on template change', () => {
    const tpl = template('textcard'); tpl.task.overlays = [{id:'a',type:'textcard',fontsize:20},{id:'b',type:'text',content:'fixed'}];
    const { context } = setup(['reels-1-正文','reels-2-正文'], [tpl]);
    vm.runInContext(`_bulkState.allowTemplateReuse=true; _bcAssignNumberedGroups();
        var entry = _bulkState.groupAssignments[0];
        entry.bindings.L0_body_text = 'reels-1-正文';
        _bcSaveSuiteOverlays(entry,[{id:'b',type:'text',content:'fixed'},{id:'a',type:'textcard',fontsize:88}]);
        var edited=_bcAssignedTemplate(entry,_bcNumberedColumnGroups()[0]);
        var untouched=_bcAssignedTemplate(_bulkState.groupAssignments[1],_bcNumberedColumnGroups()[1]);`, context);
    assert.equal(context.edited.task.overlays[1].fontsize,88);
    assert.equal(context.untouched.task.overlays[0].fontsize,20);
    assert.equal(tpl.task.overlays[0].fontsize,20);
    assert.equal(context.edited.bindings.L1_body_text,0);
    vm.runInContext('_bcSetGroupTemplate("reels-1",0)',context);
    assert.equal(context.entry.overlayOverrides,undefined);
});

test('apply-to-all styles in scoped panel never reach external task overlays', () => {
    const external={type:'textcard',fontsize:12};
    const scope=vm.createContext({window:{_reelsState:{tasks:[{overlays:[external]}]}},document:{getElementById:()=>true}});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/reels-overlay-panel.js'),'utf8'),scope);
    vm.runInContext(`var panel=Object.create(ReelsOverlayPanel.prototype);
        var target={type:'textcard',fontsize:20};
        panel.videoCanvas={scopedTask:{overlays:[target]}};
        panel._extractCardStyle=()=>({fontsize:99});
        panel._applyTextcardStyleToAllTasks({type:'textcard'});`,scope);
    assert.equal(scope.target.fontsize,99);
    assert.equal(external.fontsize,12);
});

test('_bcSanitizeTaskForDraft strips heavy blobs and dom elements while preserving overlays and media paths', () => {
    const { context } = setup([], []);
    vm.runInContext(`
        var rawTask = {
            name: 'Sample',
            videoPath: '/video/test.mp4',
            bgPath: '/bg/bg.png',
            audioPath: '/audio/bgm.mp3',
            _video: { currentTime: 10 },
            _bgThumb: 'data:image/jpeg;base64,verylongstring...',
            _domElement: {},
            overlays: [
                { id: 'ov1', type: 'textcard', content: 'hello', _thumb: 'data:image/png;base64,...' }
            ]
        };
        var sanitized = _bcSanitizeTaskForDraft(rawTask);
    `, context);
    const sanitized = context.sanitized;
    assert.equal(sanitized.videoPath, '/video/test.mp4');
    assert.equal(sanitized.bgPath, '/bg/bg.png');
    assert.equal(sanitized.audioPath, '/audio/bgm.mp3');
    assert.equal(sanitized._video, undefined);
    assert.equal(sanitized._bgThumb, undefined);
    assert.equal(sanitized._domElement, undefined);
    assert.equal(sanitized.overlays[0].content, 'hello');
    assert.equal(sanitized.overlays[0]._thumb, undefined);
});

test('draft persistence roundtrip retains modified templates, overlays and bindings', () => {
    let storage = {};
    const controls = {};
    const alerts = [];
    const context = vm.createContext({
        window: {}, console, alert: m => alerts.push(m),
        document: { getElementById: id => controls[id] == null ? null : { value: controls[id] } },
        setTimeout: () => 1, clearTimeout() {},
        localStorage: {
            getItem: k => storage[k] || null,
            setItem: (k, v) => { storage[k] = String(v); },
            removeItem: k => { delete storage[k]; }
        }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/reels-bulk-create.js'), 'utf8'), context);
    vm.runInContext(`
        _bulkState.columns = [{ name: '标题', type: 'text' }, { name: '正文', type: 'text' }];
        _bulkState.rows = [['T1', 'B1']];
        _bulkState.templates = [{
            label: '自定义模板A',
            task: { name: '自定义模板A', overlays: [{ id: '1', type: 'text', content: '旧内容' }] },
            bindings: { L0_content: 0 },
            bgCycle: null,
            source: null
        }];
        // Edit overlays
        _bulkState.templates[0].task.overlays[0].content = '新内容';
        _bulkState.templates[0].label = '重命名模板A';
        _bulkState.templates[0].bindings.L0_content = 1;
        _bcSaveDraftNow();
        
        // Reset state
        _bulkState.templates = [];
        _bulkState.columns = [];
        _bulkState.rows = [];
        
        // Restore from draft
        _bcRestoreDraft();
    `, context);
    const restoredTpls = JSON.parse(vm.runInContext('JSON.stringify(_bulkState.templates)', context));
    assert.equal(restoredTpls.length, 1);
    assert.equal(restoredTpls[0].label, '重命名模板A');
    assert.equal(restoredTpls[0].task.overlays[0].content, '新内容');
    assert.equal(restoredTpls[0].bindings.L0_content, 1);
});

test('group_apply generation creates separate batch tabs and projections with task group headers', () => {
    const controls = { 'bc-output-mode': 'group_apply' };
    const alerts = [];
    const mockTasks = [];
    const mockTabs = [];
    const Derivation = require('../src/reels-task-derivation.js');
    const context = vm.createContext({
        window: {
            ReelsTaskDerivation: Derivation,
            _reelsState: { tasks: mockTasks, selectedIdx: 0 }
        },
        _reelsState: { tasks: mockTasks, selectedIdx: 0 },
        _batchTableState: { tabs: mockTabs, nextTabId: 1, appliedTabIds: [], activeTabId: null },
        console, alert: m => alerts.push(m),
        document: { getElementById: id => controls[id] == null ? null : { value: controls[id] } },
        setTimeout: () => 1, clearTimeout() {},
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/reels-bulk-create.js'), 'utf8'), context);
    vm.runInContext(`
        _bulkState.columns = [{ name: '文案1', type: 'text' }, { name: '文案2', type: 'text' }];
        _bulkState.rows = [['行1文案1', '行1文案2'], ['行2文案1', '行2文案2']];
        _bulkState.templates = [
            { label: '模板1', task: { overlays: [{ type: 'text' }] }, bindings: { L0_content: 0 } },
            { label: '模板2', task: { overlays: [{ type: 'text' }] }, bindings: { L0_content: 1 } }
        ];
        _bcGenerateTasks();
    `, context);
    assert.equal(mockTabs.length, 2);
    assert.equal(mockTabs[0].name, '批量-模板1');
    assert.equal(mockTabs[1].name, '批量-模板2');
    assert.equal(mockTabs[0].tasks.length, 2);
    assert.equal(mockTabs[1].tasks.length, 2);

    // Check merged projection on window._reelsState.tasks
    const projectedTasks = context.window._reelsState.tasks;
    assert.equal(projectedTasks.length, 4);
    assert.equal(projectedTasks[0]._batchProjection, true);
    assert.equal(projectedTasks[0]._batchTabId, mockTabs[0].id);
    assert.equal(projectedTasks[0]._batchTabName, mockTabs[0].name);
    assert.equal(projectedTasks[2]._batchProjection, true);
    assert.equal(projectedTasks[2]._batchTabId, mockTabs[1].id);
    assert.equal(projectedTasks[2]._batchTabName, mockTabs[1].name);
});

test('numbered group task names use the group key and a contiguous local sequence', () => {
    const controls = { 'bc-output-mode': 'group_apply' };
    const mockTasks = [];
    const mockTabs = [];
    const Derivation = require('../src/reels-task-derivation.js');
    const context = vm.createContext({
        window: { ReelsTaskDerivation: Derivation, _reelsState: { tasks: mockTasks, selectedIdx: -1 } },
        _reelsState: { tasks: mockTasks, selectedIdx: -1 },
        _batchTableState: { tabs: mockTabs, nextTabId: 1, appliedTabIds: [], activeTabId: null },
        console, alert() {},
        document: { getElementById: id => controls[id] == null ? null : { value: controls[id] } },
        setTimeout: () => 1, clearTimeout() {},
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/reels-bulk-create.js'), 'utf8'), context);
    vm.runInContext(`
        _bulkState.columns = [{ name: 'reels-9-正文', type: 'text' }];
        _bulkState.rows = [['第一条'], ['第二条']];
        _bulkState.templates = [{ label: '模板名称不应出现在任务名中', task: { overlays: [{ type: 'text' }] }, bindings: { L0_content: 0 } }];
        _bcAssignNumberedGroups();
        _bcGenerateTasks();
    `, context);
    assert.equal(mockTabs[0].name, '批量-reels-9');
    assert.deepEqual(
        JSON.parse(vm.runInContext('JSON.stringify(_batchTableState.tabs[0].tasks.map(task => task.baseName))', context)),
        ['reels-9_001', 'reels-9_002']
    );
});

test('music library deduplicates audio files, assigns a selected song to a suite, and preserves voice audio', () => {
    const context = vm.createContext({
        window: {}, console, alert() {},
        document: { getElementById: () => null }, setTimeout: () => 1, clearTimeout() {},
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/reels-bulk-create.js'), 'utf8'), context);
    vm.runInContext(`
        _bulkState.columns = [{ name: 'reels-1-正文', type: 'text' }];
        _bulkState.rows = [['文案']];
        _bulkState.templates = [{ label: '模板', task: { audioPath: '/template.mp3', overlays: [{type:'text'}] }, bindings: {L0_content: 0} }];
        _bcImportMusicFiles(['/music/a.mp3', '/music/a.mp3', '/music/b.wav', '/music/no.txt']);
        _bcAssignNumberedGroups();
        _bulkState.groupAssignments[0].musicPath = '/music/b.wav';
        var tpl = _bcAssignedTemplate(_bulkState.groupAssignments[0], _bcNumberedColumnGroups()[0]);
        var task = { audioPath: '/voice.mp3', bgmPath: '/template-bgm.mp3' };
        _bcApplyAssignedMusic(task, tpl);
    `, context);
    assert.equal(vm.runInContext('_bulkState.musicFiles.length', context), 2);
    assert.equal(vm.runInContext('task.audioPath', context), '/voice.mp3');
    assert.equal(vm.runInContext('task.bgmPath', context), '/music/b.wav');
});

test('random music assignment selects only songs in the flat music library', () => {
    const context = vm.createContext({
        window: {}, console, alert() {},
        document: { getElementById: () => null }, setTimeout: () => 1, clearTimeout() {},
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/reels-bulk-create.js'), 'utf8'), context);
    vm.runInContext(`
        _bulkState.columns = [{ name: 'reels-1-正文', type: 'text' }, { name: 'reels-2-正文', type: 'text' }];
        _bulkState.templates = [{ label: '模板', task: { overlays: [{type:'text'}] }, bindings: {} }];
        _bcAssignNumberedGroups();
        _bulkState.musicFiles = [{path:'/m/a.mp3',name:'a.mp3'}, {path:'/m/b.mp3',name:'b.mp3'}];
        Math.random = () => 0.99;
        _bcRandomizeMusicGroups();
    `, context);
    assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(_bulkState.groupAssignments.map(e => e.musicPath))', context)), ['/m/b.mp3', '/m/b.mp3']);
});

test('per-task music mode cycles a short library and leaves surplus songs unused', () => {
    const context = vm.createContext({
        window: {}, console, alert() {},
        document: { getElementById: () => null }, setTimeout: () => 1, clearTimeout() {},
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/reels-bulk-create.js'), 'utf8'), context);
    vm.runInContext(`
        _bulkState.musicFiles = [{path:'/m/1.mp3',name:'1'}, {path:'/m/2.mp3',name:'2'}, {path:'/m/unused.mp3',name:'unused'}];
        var taskA = {}, taskB = {}, taskC = {}, taskD = {};
        var tpl = { assignedMusicMode: 'cycle', assignedMusicPath: '' };
        _bcApplyAssignedMusic(taskA, tpl, 0);
        _bcApplyAssignedMusic(taskB, tpl, 1);
        _bcApplyAssignedMusic(taskC, tpl, 2);
        _bcApplyAssignedMusic(taskD, tpl, 3);
    `, context);
    assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify([taskA.bgmPath,taskB.bgmPath,taskC.bgmPath,taskD.bgmPath])', context)),
        ['/m/1.mp3', '/m/2.mp3', '/m/unused.mp3', '/m/1.mp3']);
});

test('clearing background library unsets background assignments and resets folder list', () => {
    const { context } = setup(['reels-1-正文', 'reels-2-正文'], [template('textcard')]);
    vm.runInContext(`
        _bulkState.backgroundFolders = [{ path: '/bg/A', name: 'A', files: ['/bg/A/1.mp4'] }];
        _bulkState.groupAssignments = [
            { key: 'reels-1', templateIndex: 0, backgroundFolder: '/bg/A', bindings: {} },
            { key: 'reels-2', templateIndex: 0, backgroundFolder: '/bg/A', bindings: {} },
        ];
        _bcClearBackgroundFolders();
    `, context);
    assert.equal(vm.runInContext('_bulkState.backgroundFolders.length', context), 0);
    assert.equal(vm.runInContext('_bulkState.groupAssignments[0].backgroundFolder', context), '');
    assert.equal(vm.runInContext('_bulkState.groupAssignments[1].backgroundFolder', context), '');
});

test('clearing music library unsets music assignments and resets music file list', () => {
    const { context } = setup(['reels-1-正文'], [template('textcard')]);
    vm.runInContext(`
        _bulkState.musicFiles = [{ path: '/music/song.mp3', name: 'song.mp3' }];
        _bulkState.groupAssignments = [
            { key: 'reels-1', templateIndex: 0, musicPath: '/music/song.mp3', bindings: {} },
        ];
        _bcClearMusicFiles();
    `, context);
    assert.equal(vm.runInContext('_bulkState.musicFiles.length', context), 0);
    assert.equal(vm.runInContext('_bulkState.groupAssignments[0].musicPath', context), '');
});

test('binding panel renders clear library buttons for backgrounds and music', () => {
    const { context } = setup(['reels-1-正文'], [template('textcard')]);
    const panel = { innerHTML: '' };
    context.document.getElementById = id => id === 'bc-bind-panel' ? panel : null;
    vm.runInContext('_bcRenderBindings()', context);
    assert.match(panel.innerHTML, /id="bc-clear-backgrounds"/);
    assert.match(panel.innerHTML, /id="bc-clear-music"/);
});

test('randomizing background categories succeeds even when groupAssignments is initially empty array', () => {
    const { context } = setup(['reels-1-正文', 'reels-2-正文'], [template('textcard')]);
    vm.runInContext(`
        _bulkState.groupAssignments = [];
        _bulkState.backgroundFolders = [{ path: '/bg/A', name: 'A', files: ['/bg/A/1.mp4'] }];
        _bcRandomizeBackgroundGroups();
    `, context);
    const assignments = JSON.parse(vm.runInContext('JSON.stringify(_bulkState.groupAssignments)', context));
    assert.equal(assignments.length, 2);
    assert.equal(assignments[0].backgroundFolder, '/bg/A');
    assert.equal(assignments[1].backgroundFolder, '/bg/A');
    assert.equal(assignments[0].templateIndex, 0);
});

test('randomizing music succeeds even when groupAssignments is initially empty array', () => {
    const { context } = setup(['reels-1-正文'], [template('textcard')]);
    vm.runInContext(`
        _bulkState.groupAssignments = [];
        _bulkState.musicFiles = [{ path: '/m/song.mp3', name: 'song.mp3' }];
        _bcRandomizeMusicGroups();
    `, context);
    const assignments = JSON.parse(vm.runInContext('JSON.stringify(_bulkState.groupAssignments)', context));
    assert.equal(assignments.length, 1);
    assert.equal(assignments[0].musicPath, '/m/song.mp3');
});

test('randomizing background categories does not repeat by default when folders are sufficient', () => {
    const { context } = setup(['reels-1-正文', 'reels-2-正文', 'reels-3-正文'], [template('textcard')]);
    vm.runInContext(`
        _bulkState.backgroundFolders = [
            { path: '/bg/A', name: 'A', files: ['/bg/A/1.mp4'] },
            { path: '/bg/B', name: 'B', files: ['/bg/B/1.mp4'] },
            { path: '/bg/C', name: 'C', files: ['/bg/C/1.mp4'] },
        ];
        _bcRandomizeBackgroundGroups();
    `, context);
    const assignments = JSON.parse(vm.runInContext('JSON.stringify(_bulkState.groupAssignments)', context));
    const assignedFolders = assignments.map(a => a.backgroundFolder);
    assert.equal(new Set(assignedFolders).size, 3);
    assert.deepEqual(assignedFolders.sort(), ['/bg/A', '/bg/B', '/bg/C']);
});

test('binding panel renders media thumbnails for background category folders', () => {
    const { context } = setup(['reels-1-正文'], [template('textcard')]);
    const panel = { innerHTML: '' };
    context.document.getElementById = id => id === 'bc-bind-panel' ? panel : null;
    vm.runInContext(`
        _bulkState.backgroundFolders = [
            { path: '/bg/vid_folder', name: '人声-1', files: ['/bg/vid_folder/scene1.mp4', '/bg/vid_folder/scene2.mp4'] },
            { path: '/bg/img_folder', name: '图片-1', files: ['/bg/img_folder/poster.jpg'] },
            { path: '/bg/empty_folder', name: '空目录', files: [] }
        ];
        _bcRenderBindings();
    `, context);
    assert.match(panel.innerHTML, /class="bc-bg-folder-thumb" data-fi="0"/);
    assert.match(panel.innerHTML, /<video src="\/bg\/vid_folder\/scene1\.mp4#t=0\.1"/);
    assert.match(panel.innerHTML, /🎬/);
    assert.match(panel.innerHTML, /class="bc-bg-folder-thumb" data-fi="1"/);
    assert.match(panel.innerHTML, /<img src="\/bg\/img_folder\/poster\.jpg"/);
    assert.match(panel.innerHTML, /🖼/);
    assert.match(panel.innerHTML, /class="bc-bg-folder-thumb" data-fi="2"/);
    assert.match(panel.innerHTML, /📁/);
});

test('folder row renders group assignment dropdown excluding groups that already have materials', () => {
    const { context } = setup(['reels-1-正文', 'reels-2-正文', 'reels-3-正文'], [template('textcard')]);
    const panel = { innerHTML: '' };
    context.document.getElementById = id => id === 'bc-bind-panel' ? panel : null;
    vm.runInContext(`
        _bulkState.backgroundFolders = [
            { path: '/bg/A', name: '分类A', files: ['/bg/A/1.mp4'] },
            { path: '/bg/B', name: '分类B', files: ['/bg/B/1.mp4'] }
        ];
        _bulkState.groupAssignments = [
            { key: 'reels-1', templateIndex: 0, backgroundFolder: '/bg/A', bindings: {} },
            { key: 'reels-2', templateIndex: 0, backgroundFolder: '', bindings: {} },
            { key: 'reels-3', templateIndex: 0, backgroundFolder: '', bindings: {} }
        ];
        _bcRenderBindings();
    `, context);

    // Folder A is assigned to reels-1: dropdown has reels-1 selected, and has unassign button
    assert.match(panel.innerHTML, /data-folder="\/bg\/A" data-current-group="reels-1"/);
    assert.match(panel.innerHTML, /class="bc-folder-unassign" data-group="reels-1"/);

    // In Folder B's dropdown: reels-1 already has material so it must NOT appear in Folder B's options
    // Folder B should only see free groups: reels-2 and reels-3
    const folderBMatch = panel.innerHTML.match(/data-folder="\/bg\/B"[\s\S]*?<\/select>/);
    assert.ok(folderBMatch, 'Folder B select exists');
    const folderBHtml = folderBMatch[0];
    assert.match(folderBHtml, /<option value="reels-2">reels-2<\/option>/);
    assert.match(folderBHtml, /<option value="reels-3">reels-3<\/option>/);
    assert.doesNotMatch(folderBHtml, /<option value="reels-1">/);
});

test('unassigning a group frees it up so it becomes selectable by other folders', () => {
    const { context } = setup(['reels-1-正文', 'reels-2-正文'], [template('textcard')]);
    const panel = { innerHTML: '' };
    context.document.getElementById = id => id === 'bc-bind-panel' ? panel : null;
    vm.runInContext(`
        _bulkState.backgroundFolders = [
            { path: '/bg/A', name: '分类A', files: ['/bg/A/1.mp4'] },
            { path: '/bg/B', name: '分类B', files: ['/bg/B/1.mp4'] }
        ];
        _bulkState.groupAssignments = [
            { key: 'reels-1', templateIndex: 0, backgroundFolder: '/bg/A', bindings: {} },
            { key: 'reels-2', templateIndex: 0, backgroundFolder: '', bindings: {} }
        ];
        // Unassign reels-1
        _bcUnassignFolderFromGroup('reels-1');
    `, context);

    // reels-1 is now unassigned
    assert.equal(vm.runInContext('_bulkState.groupAssignments[0].backgroundFolder', context), '');

    // Now Folder B's dropdown must include reels-1
    const folderBMatch = panel.innerHTML.match(/data-folder="\/bg\/B"[\s\S]*?<\/select>/);
    assert.ok(folderBMatch);
    assert.match(folderBMatch[0], /<option value="reels-1">reels-1<\/option>/);

    // Reassign Folder B to reels-1
    vm.runInContext(`_bcChangeFolderGroupAssignment('/bg/B', '', 'reels-1')`, context);
    assert.equal(vm.runInContext('_bulkState.groupAssignments[0].backgroundFolder', context), '/bg/B');
});

test('modal HTML defaults cyclic header names to 原始文案、标题、内容', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/reels-bulk-create.js'), 'utf8');
    assert.match(src, /id="bc-header-names"[^>]*value="原始文案、标题、内容"/);
});

test('filter unassigned materials toggle shows only unassigned folder cards', () => {
    const { context } = setup(['reels-1-正文', 'reels-2-正文'], [template('textcard')]);
    const panel = { innerHTML: '' };
    context.document.getElementById = id => id === 'bc-bind-panel' ? panel : null;
    vm.runInContext(`
        _bulkState.backgroundFolders = [
            { path: '/bg/assigned', name: '已分配分类', files: ['/bg/assigned/1.mp4'] },
            { path: '/bg/unassigned', name: '未分配分类', files: ['/bg/unassigned/2.mp4'] }
        ];
        _bulkState.groupAssignments = [
            { key: 'reels-1', templateIndex: 0, backgroundFolder: '/bg/assigned', bindings: {} },
            { key: 'reels-2', templateIndex: 0, backgroundFolder: '', bindings: {} }
        ];
        _bulkState.filterUnassignedBackgrounds = true;
        _bcRenderBindings();
    `, context);
    const bgSection = panel.innerHTML.split('id="bc-music-library"')[0];
    assert.match(bgSection, /class="bc-bg-folder-row[^"]*"[\s\S]*?未分配分类/);
    assert.doesNotMatch(bgSection, /class="bc-bg-folder-row[^"]*"[\s\S]*?已分配分类/);
});

test('folder card displays thumbnail on the left and adjustments on the right', () => {
    const { context } = setup(['reels-1-正文'], [template('textcard')]);
    const panel = { innerHTML: '' };
    context.document.getElementById = id => id === 'bc-bind-panel' ? panel : null;
    vm.runInContext(`
        _bulkState.backgroundFolders = [
            { path: '/bg/demo', name: '演示分类', files: ['/bg/demo/pic.jpg'] }
        ];
        _bcRenderBindings();
    `, context);
    assert.match(panel.innerHTML, /class="bc-bg-folder-row[^"]*" style="display:flex;flex-direction:row;/);
    assert.match(panel.innerHTML, /<div class="bc-bg-folder-thumb" data-fi="0"/);
    assert.match(panel.innerHTML, /class="bc-folder-assign-group" data-folder="\/bg\/demo"/);
});

test('custom field matching renders full field labels with expanded width and concise titles', () => {
    const { context } = setup(['reels-1-标题', 'reels-1-正文'], [template('textcard')]);
    const panel = { innerHTML: '' };
    context.document.getElementById = id => id === 'bc-bind-panel' ? panel : null;
    vm.runInContext(`
        _bulkState.groupAssignments = [
            { key: 'reels-1', templateIndex: 0, backgroundFolder: '', bindings: {} }
        ];
        _bcRenderBindings();
    `, context);
    // Verify label styling uses expanded width >= 110px
    assert.match(panel.innerHTML, /width:115px;min-width:115px;/);
    // Verify specific layer field labels are fully rendered (not cut off with 68px truncation)
    assert.match(panel.innerHTML, />📝 层1 覆层标题<\/span>/);
    assert.match(panel.innerHTML, />📝 层1 覆层内容<\/span>/);
    assert.match(panel.innerHTML, />📝 层1 覆层结尾<\/span>/);
});

test('group preview modal allows editing bound copywriting and synchronizes back to table rows', () => {
    const { context, alerts } = setup(['reels-1-标题', 'reels-1-正文'], [template('textcard')]);
    
    const elements = {};
    function makeMockElement(tag) {
        return {
            tagName: tag.toUpperCase(),
            style: {},
            dataset: {},
            listeners: {},
            innerHTML: '',
            value: '',
            children: [],
            addEventListener(evt, fn) { (this.listeners[evt] = this.listeners[evt] || []).push(fn); },
            removeEventListener() {},
            dispatchEvent(event) {
                (this.listeners[event.type] || []).forEach(fn => fn(event));
            },
            querySelector(sel) {
                return elements[sel] || null;
            },
            querySelectorAll() { return []; },
            getContext() { return { clearRect() {}, save() {}, restore() {} }; },
            pause() {}, load() {}, removeAttribute() {}, remove() {}
        };
    }

    const selList = [
        '[data-bg-video]', '[data-bg-image]', 'canvas', '[data-row]', '[data-template]',
        '[data-folder]', '[data-music]', '[data-music-mode]', '[data-pick-music]',
        '[data-pick-template]', '[data-pick-folder]', '[data-time]', '[data-play]',
        '[data-edit-overlays]', '[data-status]', '[data-music-player]', '[data-close]',
        '[data-copy-fields-container]', '[data-copy-sync-tip]'
    ];
    selList.forEach(sel => {
        elements[sel] = makeMockElement(sel === 'canvas' ? 'canvas' : 'div');
    });

    context.document.createElement = tag => makeMockElement(tag);
    context.document.body = { appendChild() {} };
    context.ReelsOverlay = { drawOverlay() {} };
    context.ReelsTaskDerivation = { prepareDerivedTask() {} };
    context.window.ReelsOverlay = context.ReelsOverlay;
    context.window.ReelsTaskDerivation = context.ReelsTaskDerivation;

    vm.runInContext(`
        _bulkState.rows = [
            ['原标题1', '原正文内容1'],
            ['原标题2', '原正文内容2']
        ];
        _bulkState.groupAssignments = [
            { key: 'reels-1', templateIndex: 0, backgroundFolder: '', bindings: { L0_title_text: 'reels-1-标题', L0_body_text: 'reels-1-正文' } }
        ];
        try {
            _bcPreviewGroup('reels-1');
        } catch(e) {
            console.log('PREVIEW_ERROR:', e);
        }
    `, context);

    const container = elements['[data-copy-fields-container]'];
    assert.ok(container, 'Container should exist');
    assert.match(container.innerHTML, /reels-1-标题/);
    assert.match(container.innerHTML, /reels-1-正文/);
    assert.match(container.innerHTML, /原标题1/);
    assert.match(container.innerHTML, /原正文内容1/);

    // Simulate editing title input
    const inputEvent = {
        type: 'input',
        target: {
            hasAttribute: attr => attr === 'data-bound-input',
            dataset: { ci: '0', fk: 'L0_title_text' },
            value: '修改后的超级标题'
        }
    };
    container.dispatchEvent(inputEvent);
    assert.equal(vm.runInContext('_bulkState.rows[0][0]', context), '修改后的超级标题');

    // Simulate editing body textarea
    const textareaEvent = {
        type: 'input',
        target: {
            hasAttribute: attr => attr === 'data-bound-input',
            dataset: { ci: '1', fk: 'L0_body_text' },
            value: '修改后的超级正文内容'
        }
    };
    container.dispatchEvent(textareaEvent);
    assert.equal(vm.runInContext('_bulkState.rows[0][1]', context), '修改后的超级正文内容');

    // Switching row updates editors with row 2's content
    elements['[data-row]'].value = '1';
    elements['[data-row]'].onchange();
    assert.match(container.innerHTML, /原标题2/);
    assert.match(container.innerHTML, /原正文内容2/);
});

test('each binding module can be collapsed and expanded individually or altogether', () => {
    const { context } = setup(['reels-1-标题', 'reels-1-正文'], [template('textcard')]);
    const panel = { innerHTML: '' };
    context.document.getElementById = id => id === 'bc-bind-panel' ? panel : null;

    vm.runInContext(`
        _bulkState.backgroundFolders = [{ path: '/bg/A', name: '分类A', files: ['/bg/A/1.mp4'] }];
        _bulkState.musicFiles = [{ path: '/m/1.mp3', name: '配乐1' }];
        _bulkState.groupAssignments = [
            { key: 'reels-1', templateIndex: 0, backgroundFolder: '/bg/A', bindings: {} }
        ];
        _bcRenderBindings();
    `, context);

    // Verify all 4 collapsible section headers exist
    assert.match(panel.innerHTML, /data-toggle-section="templates"/);
    assert.match(panel.innerHTML, /data-toggle-section="backgrounds"/);
    assert.match(panel.innerHTML, /data-toggle-section="music"/);
    assert.match(panel.innerHTML, /data-toggle-section="groups"/);
    assert.match(panel.innerHTML, /id="bc-toggle-all-sections"[^>]*>折叠全部模块</);

    // Verify initial uncollapsed state has content rendered
    assert.match(panel.innerHTML, /class="bc-group-card"/);
    assert.match(panel.innerHTML, /class="bc-bg-folder-row/);
    assert.match(panel.innerHTML, /class="bc-music-row"/);

    // Collapse templates & backgrounds
    vm.runInContext(`
        _bulkState.collapsedSections.templates = true;
        _bulkState.collapsedSections.backgrounds = true;
        _bcRenderBindings();
    `, context);

    // Templates and backgrounds show "已收起" badge
    assert.match(panel.innerHTML, /🎨 模版库[\s\S]*?已收起/);
    assert.match(panel.innerHTML, /📁 背景库[\s\S]*?已收起/);
    // Background folder cards are hidden when collapsed
    assert.doesNotMatch(panel.innerHTML, /class="bc-bg-folder-row/);
    // Music is still uncollapsed
    assert.match(panel.innerHTML, /class="bc-music-row"/);

    // Collapse all modules
    vm.runInContext(`
        _bulkState.collapsedSections.music = true;
        _bulkState.collapsedSections.groups = true;
        _bcRenderBindings();
    `, context);

    assert.match(panel.innerHTML, /id="bc-toggle-all-sections"[^>]*>展开全部模块</);
    assert.doesNotMatch(panel.innerHTML, /class="bc-group-card"/);
    assert.doesNotMatch(panel.innerHTML, /class="bc-music-row"/);
});

test('library toolbars clear assignments, filter unassigned items, and support individual unassign and sequential allocation', () => {
    const { context } = setup(['reels-1-标题', 'reels-1-正文', 'reels-2-标题', 'reels-2-正文'], [template('textcard'), template('textcard')]);
    vm.runInContext(`
        _bulkState.backgroundFolders = [
            { path: '/bg/A', name: '分类A', files: ['/bg/A/1.mp4'] },
            { path: '/bg/B', name: '分类B', files: ['/bg/B/1.mp4'] }
        ];
        _bulkState.musicFiles = [
            { path: '/m/1.mp3', name: '配乐1' },
            { path: '/m/2.mp3', name: '配乐2' }
        ];
        _bcAssignNumberedGroups();
        _bcAssignBackgroundGroups(false);
        _bcAssignMusicGroups(false);
    `, context);

    const initial = JSON.parse(vm.runInContext('JSON.stringify(_bulkState.groupAssignments)', context));
    assert.equal(initial[0].templateIndex, 0);
    assert.equal(initial[0].backgroundFolder, '/bg/A');
    assert.equal(initial[0].musicPath, '/m/1.mp3');
    assert.equal(initial[1].templateIndex, 1);
    assert.equal(initial[1].backgroundFolder, '/bg/B');
    assert.equal(initial[1].musicPath, '/m/2.mp3');

    // Test unassigning individual items
    vm.runInContext(`
        _bcUnassignTemplateFromGroup('reels-1');
        _bcUnassignFolderFromGroup('reels-1');
        _bcUnassignMusicFromGroup('reels-1');
    `, context);
    const unassignedFirst = JSON.parse(vm.runInContext('JSON.stringify(_bulkState.groupAssignments)', context));
    assert.equal(unassignedFirst[0].templateIndex, -1);
    assert.equal(unassignedFirst[0].backgroundFolder, '');
    assert.equal(unassignedFirst[0].musicPath, '');
    assert.equal(unassignedFirst[1].templateIndex, 1);

    // Test reassigning via change handlers
    vm.runInContext(`
        _bcChangeTemplateGroupAssignment(0, '', 'reels-1');
        _bcChangeFolderGroupAssignment('/bg/A', '', 'reels-1');
        _bcChangeMusicGroupAssignment('/m/1.mp3', '', 'reels-1');
    `, context);
    const reassigned = JSON.parse(vm.runInContext('JSON.stringify(_bulkState.groupAssignments)', context));
    assert.equal(reassigned[0].templateIndex, 0);
    assert.equal(reassigned[0].backgroundFolder, '/bg/A');
    assert.equal(reassigned[0].musicPath, '/m/1.mp3');

    // Test clearing all assignments
    vm.runInContext(`
        _bcClearTemplateAssignments();
        _bcClearBackgroundAssignments();
        _bcClearMusicAssignments();
    `, context);
    const cleared = JSON.parse(vm.runInContext('JSON.stringify(_bulkState.groupAssignments)', context));
    assert.equal(cleared[0].templateIndex, -1);
    assert.equal(cleared[0].backgroundFolder, '');
    assert.equal(cleared[0].musicPath, '');
    assert.equal(cleared[1].templateIndex, -1);
    assert.equal(cleared[1].backgroundFolder, '');
    assert.equal(cleared[1].musicPath, '');
});

test('binding panel uses unified library names and eliminates duplicate bottom template cards', () => {
    const { context } = setup(['reels-1-标题', 'reels-1-正文'], [template('textcard')]);
    const panel = { innerHTML: '' };
    context.document.getElementById = id => id === 'bc-bind-panel' ? panel : null;
    vm.runInContext(`
        _bulkState.backgroundFolders = [{ path: '/bg/A', name: '风景', files: ['/bg/A/1.mp4'] }];
        _bulkState.musicFiles = [{ path: '/m/1.mp3', name: '欢快' }];
        _bcAssignNumberedGroups();
        _bcRenderBindings();
    `, context);

    // Verify clear and unified module naming
    assert.match(panel.innerHTML, /🎨 模版库/);
    assert.match(panel.innerHTML, /📁 背景库/);
    assert.match(panel.innerHTML, /🎵 配乐库/);
    assert.doesNotMatch(panel.innerHTML, /模版库与分配/);
    assert.doesNotMatch(panel.innerHTML, /背景素材分类库/);

    // Verify template card features exist in template library
    assert.match(panel.innerHTML, /class="bc-tpl-edit-overlays/);
    assert.match(panel.innerHTML, /class="bc-tpl-save-preset/);
    assert.match(panel.innerHTML, /class="bc-tpl-rename/);
    assert.match(panel.innerHTML, /class="bc-tpl-del/);
    assert.match(panel.innerHTML, /class="bc-tpl-folder-pick/);

    // Ensure template card is rendered exactly once (no bottom duplicates)
    const tplCardMatches = panel.innerHTML.match(/class="bc-tpl-card-row/g) || [];
    assert.equal(tplCardMatches.length, 1);
    const savePresetMatches = panel.innerHTML.match(/class="bc-tpl-save-preset/g) || [];
    assert.equal(savePresetMatches.length, 1);
});

