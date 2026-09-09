const fs = require('fs');
const path = require('path');

const IGNORE = new Set(['.ds_store', 'thumbs.db']);
const MEDIA = new Set([
    '.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v',
    '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg',
    '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp',
    '.srt', '.ass', '.vtt', '.txt'
]);

function safeName(value) {
    return String(value || '').replace(/[\\/:*?"<>|]/g, '_').trim();
}

/**
 * 将文件名拆分为字段（Tokens）
 * @param {string} filename 完整文件名或文件名路径
 * @param {string} delimiterMode 分隔符模式: 'auto' | '_' | '-' | 'space' | 自定义正则
 */
function splitTokens(filename, delimiterMode = 'auto') {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);

    let regex;
    if (delimiterMode === '_') {
        regex = /_+/;
    } else if (delimiterMode === '-') {
        regex = /\-+/;
    } else if (delimiterMode === 'space') {
        regex = /\s+/;
    } else {
        // 'auto': 常用分隔符 _ - 空格 # ~ 以及各种中英文括号边界
        regex = /[_\-\s#~·|()（）\[\]【】]+/;
    }

    const tokens = base.split(regex).map(s => s.trim()).filter(Boolean);
    return {
        name: path.basename(filename),
        base,
        ext,
        tokens: tokens.length > 0 ? tokens : [base]
    };
}

function parseKeywords(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val.map(s => String(s).trim()).filter(Boolean);
    const parts = String(val)
        .split(/[,，|/、;\n]+/)
        .map(s => s.trim())
        .filter(Boolean);
    return parts.length > 0 ? parts : [String(val).trim()];
}

function isDateOrIndexToken(token) {
    if (!token) return true;
    const t = String(token).trim();
    if (/^\d{2,}$/.test(t)) return true;
    if (/^\d{4}[-._/]?\d{2}[-._/]?\d{2}$/.test(t)) return true;
    return false;
}

/**
 * 单条规则针对单个文件的匹配评估
 */
function evaluateRule(fileInfo, rule) {
    if (!rule || rule.enabled === false) return null;
    const name = fileInfo.base;
    let matched = false;
    let matchedKeyword = '';

    const matchType = rule.matchType || 'contains';
    const matchValue = String(rule.matchValue || '').trim();
    const keywords = parseKeywords(matchValue);

    if (matchType === 'always') {
        matched = true;
        matchedKeyword = '全部文件';
    } else if (matchType === 'contains' || matchType === 'containsAny') {
        // 包含任一关键词 (支持多个，逗号/竖线分隔)
        if (keywords.length === 0) return null;
        // 按关键词长度降序排序，优先匹配更长更精确的词 (例如优先匹配 "男1-副本2" 避免被 "男1-副本" 提前拦截)
        const sortedKws = [...keywords].sort((a, b) => b.length - a.length);
        for (const kw of sortedKws) {
            if (name.toLowerCase().includes(kw.toLowerCase())) {
                matched = true;
                matchedKeyword = kw;
                break;
            }
        }
    } else if (matchType === 'containsAll') {
        // 同时包含全部关键词
        if (keywords.length === 0) return null;
        matched = keywords.every(kw => name.toLowerCase().includes(kw.toLowerCase()));
        if (matched) {
            matchedKeyword = keywords.join('_');
        }
    } else if (matchType === 'startsWith') {
        if (keywords.length === 0) return null;
        const sortedKws = [...keywords].sort((a, b) => b.length - a.length);
        for (const kw of sortedKws) {
            if (name.toLowerCase().startsWith(kw.toLowerCase())) {
                matched = true;
                matchedKeyword = kw;
                break;
            }
        }
    } else if (matchType === 'endsWith') {
        if (keywords.length === 0) return null;
        const sortedKws = [...keywords].sort((a, b) => b.length - a.length);
        for (const kw of sortedKws) {
            if (name.toLowerCase().endsWith(kw.toLowerCase())) {
                matched = true;
                matchedKeyword = kw;
                break;
            }
        }
    } else if (matchType === 'regex') {
        try {
            const re = new RegExp(matchValue, 'i');
            const m = re.exec(name);
            if (m) {
                matched = true;
                matchedKeyword = m[1] || m[0];
            }
        } catch (_) {
            matched = false;
        }
    }

    if (!matched) return null;

    let folder = '';
    if (rule.folderMode === 'matchedKeyword') {
        folder = matchedKeyword || matchValue;
    } else if (rule.folderMode === 'custom') {
        folder = rule.customName || rule.name;
    } else {
        // slots mode (默认)
        const slots = Array.isArray(rule.slots) && rule.slots.length > 0 ? rule.slots : [0];
        const parts = [];
        for (const idx of slots) {
            const tok = fileInfo.tokens[idx];
            if (tok !== undefined) {
                if (rule.skipDateSlots && parts.length > 0 && isDateOrIndexToken(tok)) {
                    continue;
                }
                parts.push(tok);
            }
        }
        folder = parts.join(rule.slotJoiner !== undefined ? rule.slotJoiner : '_');
        if (!folder && fileInfo.tokens[0]) folder = fileInfo.tokens[0];
    }

    folder = safeName(folder);
    return folder ? { group: folder, ruleId: rule.id, ruleName: rule.name || '未命名规则' } : null;
}

const IGNORED_DIRS = new Set([
    '_auto_edit',
    '裁切缓存',
    '剪辑缓存',
    '自动剪辑分析',
    'reels工程',
    'node_modules',
    '.git',
    '__macosx',
    '.cache',
    'cache',
    '.trash',
    '.trashes',
    'temp',
    'tmp'
]);

function isIgnoredDir(name) {
    if (!name) return true;
    const lower = name.toLowerCase();
    if (lower.startsWith('.')) return true;
    if (lower.endsWith('-工程') || lower.endsWith('_工程') || lower.includes('工程文件')) return true;
    return IGNORED_DIRS.has(lower);
}

function isHashCacheFileName(filename) {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    // 32 位或 64 位纯 16 进制哈希（如 MD5, SHA-256 生成的切片缓存视频）
    return /^[0-9a-f]{32}$/i.test(base) || /^[0-9a-f]{64}$/i.test(base);
}

/**
 * 递归扫描文件夹获取所有真实媒体文件（严格排除系统缓存与剪辑工程临时目录）
 */
function filesIn(dir, options = {}) {
    const recursive = options.recursive !== false;
    const found = [];
    const walk = (current, depth) => {
        let entries = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch (_) { return; }

        for (const entry of entries) {
            if (entry.isSymbolicLink()) continue;
            const item = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (isIgnoredDir(entry.name)) continue;
                if (recursive) walk(item, depth + 1);
            } else if (entry.isFile()) {
                if (entry.name.startsWith('.')) continue;
                if (isHashCacheFileName(entry.name)) continue;
                if (!IGNORE.has(entry.name.toLowerCase()) && MEDIA.has(path.extname(entry.name).toLowerCase())) {
                    found.push(item);
                }
            }
        }
    };
    walk(dir, 0);
    return found;
}

/**
 * 分析文件列表并预览整理计划
 * @param {string} sourceDir 待整理根目录
 * @param {Array} rules 用户设置的多条规则
 * @param {Object} options 可选配置 (delimiterMode 等)
 */
function preview(sourceDir, rules = [], options = {}) {
    if (!sourceDir || !fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
        throw new Error('请选择有效文件夹');
    }

    const mediaFiles = filesIn(sourceDir, options);
    const delimiterMode = options.delimiterMode || 'auto';

    // 预切分所有文件字段
    const fileInfos = mediaFiles.map(filePath => {
        const tokenized = splitTokens(filePath, delimiterMode);
        return {
            path: filePath,
            ...tokenized
        };
    });

    // 如果用户尚未配置任何规则，自动生成一个智能初始规则供直接使用
    let activeRules = Array.isArray(rules) ? rules : [];
    if (activeRules.length === 0) {
        // 自动按第 1 字段分组作为默认初始规则
        activeRules = [
            {
                id: 'rule_default',
                name: '默认规则 (按第 1 字段分组)',
                enabled: true,
                matchType: 'always',
                matchValue: '',
                folderMode: 'slots',
                slots: [0],
                slotJoiner: '_'
            }
        ];
    }

    const groupsMap = new Map();
    const pending = [];
    const ruleMatchCounts = {};
    activeRules.forEach(r => { ruleMatchCounts[r.id] = 0; });

    // 文件逐个通过流水线
    for (const fileInfo of fileInfos) {
        let matchedResult = null;
        for (const rule of activeRules) {
            matchedResult = evaluateRule(fileInfo, rule);
            if (matchedResult) {
                ruleMatchCounts[rule.id] = (ruleMatchCounts[rule.id] || 0) + 1;
                break;
            }
        }

        const item = {
            path: fileInfo.path,
            name: fileInfo.name,
            base: fileInfo.base,
            ext: fileInfo.ext,
            tokens: fileInfo.tokens,
            group: matchedResult ? matchedResult.group : '',
            ruleId: matchedResult ? matchedResult.ruleId : null,
            ruleName: matchedResult ? matchedResult.ruleName : null
        };

        if (!matchedResult || !matchedResult.group) {
            pending.push(item);
        } else {
            if (!groupsMap.has(matchedResult.group)) {
                groupsMap.set(matchedResult.group, []);
            }
            groupsMap.get(matchedResult.group).push(item);
        }
    }

    const groups = [...groupsMap].map(([name, files]) => ({
        name,
        files,
        count: files.length
    }));

    // 统计全文件夹中的特征高频词 (供快速建规则选用)
    const tokenFreq = new Map();
    for (const fileInfo of fileInfos) {
        for (const t of fileInfo.tokens) {
            if (!t || t.length < 1 || t.length > 30) continue;
            tokenFreq.set(t, (tokenFreq.get(t) || 0) + 1);
        }
    }
    const topKeywords = [...tokenFreq.entries()]
        .filter(([t, count]) => count >= 2 || fileInfos.length < 10)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 150)
        .map(([token, count]) => ({ token, count }));

    return {
        sourceDir,
        total: fileInfos.length,
        groups,
        pending,
        rules: activeRules,
        ruleMatchCounts,
        topKeywords,
        sampleFiles: fileInfos.slice(0, 100) // 前 100 个样本供前端点选字段建规则
    };
}

/**
 * 获取不冲突的下一个目标路径
 */
function nextPath(dir, filename) {
    let candidate = path.join(dir, filename);
    if (!fs.existsSync(candidate)) return candidate;
    const parsed = path.parse(filename);
    let i = 2;
    while (fs.existsSync(candidate = path.join(dir, `${parsed.name} (${i})${parsed.ext}`))) i += 1;
    return candidate;
}

/**
 * 执行整理（支持移动或复制，以及清理空目录）
 * @param {Object} plan 整理方案
 */
function apply(plan) {
    const sourceDir = plan?.sourceDir;
    const groups = Array.isArray(plan?.groups) ? plan.groups : [];
    const mode = plan?.mode === 'copy' ? 'copy' : 'move'; // 'move' 或 'copy'
    const cleanEmptyDirs = Boolean(plan?.cleanEmptyDirs);

    if (!sourceDir || !fs.existsSync(sourceDir)) throw new Error('源文件夹不存在');

    const moves = [];
    const sourceRoot = path.resolve(sourceDir);

    for (const group of groups) {
        const folder = safeName(group.name);
        if (!folder) continue;
        const targetDir = path.join(sourceDir, folder);
        fs.mkdirSync(targetDir, { recursive: true });

        for (const file of group.files || []) {
            if (file.excluded) continue; // 用户在界面勾选排除了此文件
            const sourcePath = path.resolve(file.path || '');
            if (!sourcePath || !fs.existsSync(sourcePath)) continue;

            // 限制只能在选中目录下操作
            if (sourcePath !== sourceRoot && !sourcePath.startsWith(`${sourceRoot}${path.sep}`)) continue;

            // 已经在目标目录则跳过
            if (path.dirname(sourcePath) === targetDir) continue;

            const to = nextPath(targetDir, path.basename(sourcePath));
            if (mode === 'copy') {
                fs.copyFileSync(sourcePath, to);
                moves.push({ from: sourcePath, to, action: 'copy' });
            } else {
                fs.renameSync(sourcePath, to);
                moves.push({ from: sourcePath, to, action: 'move' });
            }
        }
    }

    // 移动模式下，若勾选清理空目录，递归删除源空目录
    if (mode === 'move' && cleanEmptyDirs) {
        _removeEmptyDirs(sourceRoot);
    }

    const logPath = path.join(sourceDir, `.videokit-organize-${Date.now()}.json`);
    fs.writeFileSync(logPath, JSON.stringify({
        createdAt: new Date().toISOString(),
        mode,
        moves
    }, null, 2));

    return {
        moved: moves.length,
        mode,
        logPath,
        moves
    };
}

function _removeEmptyDirs(dir) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
        if (entry.isDirectory()) {
            const fullPath = path.join(dir, entry.name);
            _removeEmptyDirs(fullPath);
            try {
                if (fs.readdirSync(fullPath).length === 0) {
                    fs.rmdirSync(fullPath);
                }
            } catch (_) { }
        }
    }
}

/**
 * 撤销上一次整理操作
 */
function undo(logPath) {
    if (!logPath || !fs.existsSync(logPath)) {
        throw new Error('未找到整理日志文件');
    }
    const data = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    const mode = data.mode || 'move';
    let restored = 0;

    for (const move of [...(data.moves || [])].reverse()) {
        if (!fs.existsSync(move.to)) continue;

        if (mode === 'copy') {
            // 复制模式：直接删除生成的副本文件
            try {
                fs.unlinkSync(move.to);
                restored += 1;
            } catch (_) { }
        } else {
            // 移动模式：移回原始路径
            let target = move.from;
            const parentDir = path.dirname(target);
            if (!fs.existsSync(parentDir)) {
                fs.mkdirSync(parentDir, { recursive: true });
            }
            if (fs.existsSync(target)) {
                target = nextPath(parentDir, path.basename(target));
            }
            fs.renameSync(move.to, target);
            restored += 1;
        }
    }

    // 清理日志文件自身
    try { fs.unlinkSync(logPath); } catch (_) { }

    return { restored, mode };
}

module.exports = {
    splitTokens,
    evaluateRule,
    filesIn,
    preview,
    apply,
    undo,
    parseKeywords
};
