const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../src/app.js'), 'utf8');

function extractFunction(name) {
    const start = source.indexOf(`function ${name}(`);
    if (start === -1) throw new Error(`Function ${name} not found in app.js`);
    const end = source.indexOf('\nfunction ', start + 1);
    return end === -1 ? source.slice(start) : source.slice(start, end);
}

test('solveAutoEditBatchSmartAssignment: handles fewer scripts than tasks (empty cell scenario)', () => {
    const context = {};
    vm.createContext(context);
    vm.runInContext(extractFunction('solveAutoEditBatchSmartAssignment'), context);

    // 3 个任务，但只有 2 篇文案（说明有一行单元格为空或缺少 1 篇文案）
    // task 0 和 script 0 高度契合 (0.95)
    // task 1 和 script 1 高度契合 (0.88)
    // task 2 契合度较低 (0.2, 0.3)
    const scores = [
        [0.95, 0.10], // task 0
        [0.05, 0.88], // task 1
        [0.20, 0.30]  // task 2 (对应缺少文案的任务)
    ];

    const assignment = context.solveAutoEditBatchSmartAssignment(scores);
    assert.equal(assignment.length, 3, 'Assignment length should equal task count');
    assert.equal(assignment[0], 0, 'Task 0 should be assigned script 0');
    assert.equal(assignment[1], 1, 'Task 1 should be assigned script 1');
    assert.equal(assignment[2], -1, 'Task 2 should be unassigned (-1) and skipped');
});

test('solveAutoEditBatchSmartAssignment: standard 1-to-1 matching', () => {
    const context = {};
    vm.createContext(context);
    vm.runInContext(extractFunction('solveAutoEditBatchSmartAssignment'), context);

    const scores = [
        [0.1, 0.9],
        [0.8, 0.2]
    ];
    const assignment = context.solveAutoEditBatchSmartAssignment(scores);
    assert.equal(assignment[0], 1);
    assert.equal(assignment[1], 0);
});

test('solveAutoEditBatchSmartAssignment: handles more scripts than tasks', () => {
    const context = {};
    vm.createContext(context);
    vm.runInContext(extractFunction('solveAutoEditBatchSmartAssignment'), context);

    // 2 个任务，3 篇文案
    const scores = [
        [0.2, 0.8, 0.1], // task 0
        [0.9, 0.1, 0.3]  // task 1
    ];
    const assignment = context.solveAutoEditBatchSmartAssignment(scores);
    assert.equal(assignment.length, 2);
    assert.equal(assignment[0], 1, 'Task 0 takes script 1');
    assert.equal(assignment[1], 0, 'Task 1 takes script 0');
});
