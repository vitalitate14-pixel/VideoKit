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

test('buildAutoEditBatchIssuesTable: extracts problem video names and quoted issue scripts', () => {
    const context = {};
    vm.createContext(context);
    vm.runInContext(extractFunction('buildAutoEditBatchIssuesTable'), context);

    const mockTasks = [
        {
            name: '025_男1_副本5_精选',
            outputName: '025_男1_副本5_精选',
            result: {
                missing_blocks: [
                    {
                        text: 'so that the power and grace of God may continue to spread',
                        review_assignment: null
                    }
                ]
            }
        },
        {
            name: '055_女15_精选',
            outputName: '055_女15_精选',
            result: {
                missing_blocks: [
                    {
                        text: 'And may you no longer shed tears of sadness',
                        review_assignment: null
                    },
                    {
                        text: 'If you have time please share this message',
                        review_assignment: null
                    }
                ]
            }
        },
        {
            name: '099_完美通过任务',
            outputName: '099_完美通过任务',
            result: {
                missing_blocks: [
                    {
                        text: '已被归属的文案',
                        review_assignment: { targets: [{ source_index: 1 }] }
                    }
                ],
                segments: [{ status: 'ready' }]
            }
        }
    ];

    const res = context.buildAutoEditBatchIssuesTable(mockTasks);
    assert.equal(res.rows.length, 2, 'Should only contain the 2 tasks with unresolved issues');

    // 检查第 1 个视频
    assert.equal(res.rows[0].videoName, '025_男1_副本5_精选');
    assert.equal(res.rows[0].videoCellContent, '025_男1_副本5_精选\n需修改');
    assert.equal(res.rows[0].cellContent, '"so that the power and grace of God may continue to spread"');
    // TSV 规范：第一列与第二列均外层包引号，第一列包含换行+需修改
    assert.equal(res.rows[0].tsvLine, '"025_男1_副本5_精选\n需修改"\t"""so that the power and grace of God may continue to spread"""');

    // 检查第 2 个视频（包含多段问题文案，应该都在同一个 cellContent 中换行并各自用英文双引号包裹）
    assert.equal(res.rows[1].videoName, '055_女15_精选');
    assert.equal(res.rows[1].videoCellContent, '055_女15_精选\n需修改');
    const expectedMultiCell = '"And may you no longer shed tears of sadness"\n"If you have time please share this message"';
    assert.equal(res.rows[1].cellContent, expectedMultiCell);
    assert.ok(res.rows[1].tsvLine.startsWith('"055_女15_精选\n需修改"\t'));
    assert.ok(res.rows[1].tsvLine.includes('""And may you no longer shed tears of sadness""'));
    assert.ok(res.rows[1].tsvLine.includes('""If you have time please share this message""'));

    // 检查 HTML 表格生成与单元格内换行标签 <br>
    assert.ok(res.htmlText.includes('<table>'));
    assert.ok(res.htmlText.includes('025_男1_副本5_精选<br>需修改'));
    assert.ok(res.htmlText.includes('white-space:pre-wrap;'));
    assert.ok(res.htmlText.includes('&quot;And may you no longer shed tears of sadness&quot;<br>&quot;If you have time please share this message&quot;'));
});

test('buildAutoEditBatchIssuesTable: handles quotes in original text without breaking format', () => {
    const context = {};
    vm.createContext(context);
    vm.runInContext(extractFunction('buildAutoEditBatchIssuesTable'), context);

    const mockTasks = [
        {
            name: '060_含双引号文案',
            outputName: '060_含双引号文案',
            result: {
                missing_blocks: [
                    {
                        text: '"already quoted" and normal text',
                        review_assignment: null
                    }
                ]
            }
        }
    ];

    const res = context.buildAutoEditBatchIssuesTable(mockTasks);
    assert.equal(res.rows.length, 1);
    assert.ok(res.rows[0].cellContent.startsWith('"'));
    assert.ok(res.rows[0].cellContent.endsWith('"'));
    // TSV 行中第一列与第二列必须以制表符隔开
    const parts = res.tsvText.split('\t');
    assert.equal(parts[0], '"060_含双引号文案\n需修改"');
});
