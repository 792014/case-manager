// ============================================================
// نظام إدارة القضايا - تطبيق سطح المكتب (Electron)
// ============================================================
// ملحوظة مهمة عن آلية المزامنة:
// - بيانات القضايا والأحكام (cases, favorableJudgments...) بتتزامن
//   مباشرة مع Firebase Realtime Database من داخل index.html نفسه،
//   بنفس الطريقة اللي بتحصل على الموبايل تمامًا. الملف ده (main.js)
//   عمدًا مبيتدخلش في ده، عشان التطبيق يفضل مرتبط ببيانات الموبايل
//   بدون أي فرق.
// - الحاجة الوحيدة اللي التطبيق ده بيضيفها كنسخة "سطح مكتب حقيقية"
//   هي تخزين المستندات (PDF, صور, Word...) فعليًا على قرص الجهاز
//   بدل تخزينها كـ Base64 داخل قاعدة البيانات، عشان الأداء والسعة.
// ============================================================

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Menu } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');

const DEFAULT_STORAGE_DIRNAME = 'مستندات نظام إدارة القضايا';
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');

let mainWindow = null;

app.setName('نظام إدارة القضايا');

// ---------------------------------------------------------------
// إدارة الإعدادات (مسار مجلد التخزين المختار)
// ---------------------------------------------------------------
function readConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
        }
    } catch (e) {
        console.warn('تعذرت قراءة ملف الإعدادات:', e.message);
    }
    return {};
}

function writeConfig(cfg) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
}

function getStorageFolder() {
    const cfg = readConfig();
    if (cfg.storageFolder && fs.existsSync(cfg.storageFolder)) {
        return cfg.storageFolder;
    }
    // مجلد افتراضي داخل "المستندات" الخاصة بالمستخدم أول مرة يتم تشغيل التطبيق
    const defaultFolder = path.join(app.getPath('documents'), DEFAULT_STORAGE_DIRNAME);
    fs.mkdirSync(defaultFolder, { recursive: true });
    const newCfg = { ...cfg, storageFolder: defaultFolder };
    writeConfig(newCfg);
    return defaultFolder;
}

function getIndexFilePath() {
    return path.join(getStorageFolder(), 'documents-index.json');
}

function readIndex() {
    try {
        const p = getIndexFilePath();
        if (fs.existsSync(p)) {
            return JSON.parse(fs.readFileSync(p, 'utf-8'));
        }
    } catch (e) {
        console.warn('تعذرت قراءة فهرس المستندات:', e.message);
    }
    return {};
}

function writeIndex(indexData) {
    fs.writeFileSync(getIndexFilePath(), JSON.stringify(indexData, null, 2), 'utf-8');
}

function sanitizeName(name) {
    return String(name || 'file').replace(/[\\/:*?"<>|]/g, '_').trim();
}

// ---------------------------------------------------------------
// تسمية مجلدات القضايا تلقائيًا بأسماء الأطراف ورقم وسنة الدعوى
// ---------------------------------------------------------------
// بدل ما يتعمل مجلد باسم رقم داخلي (caseId) غير مفهوم، بنعمل مجلد باسم
// واضح زي: "محمد أحمد ضد شركة النور - قضية رقم 1234 لسنة 2026".
// بنحتفظ بربط ثابت (caseId -> اسم المجلد) في ملف فهرس منفصل، عشان لو
// المستخدم عدّل بيانات القضية بعدين، نقدر نعيد تسمية المجلد تلقائيًا
// بدل ما نعمل مجلد تاني ونفقد الملفات القديمة.

const CASE_FOLDERS_INDEX_FILENAME = 'case-folders-index.json';

function getCaseFoldersIndexPath() {
    return path.join(getStorageFolder(), CASE_FOLDERS_INDEX_FILENAME);
}

function readCaseFoldersIndex() {
    try {
        const p = getCaseFoldersIndexPath();
        if (fs.existsSync(p)) {
            return JSON.parse(fs.readFileSync(p, 'utf-8'));
        }
    } catch (e) {
        console.warn('تعذرت قراءة فهرس مجلدات القضايا:', e.message);
    }
    return {};
}

function writeCaseFoldersIndex(data) {
    fs.writeFileSync(getCaseFoldersIndexPath(), JSON.stringify(data, null, 2), 'utf-8');
}

function buildCaseFolderName(caseData, caseId) {
    const plaintiff = String((caseData && caseData.plaintiff) || '').trim();
    const defendant = String((caseData && caseData.defendant) || '').trim();
    const number = String((caseData && (caseData.number || caseData.caseNumber)) || '').trim();
    const year = String((caseData && (caseData.year || caseData.caseYear)) || '').trim();

    // نفس أسلوب التسمية اللي المستخدم شغال بيه يدويًا بالفعل:
    // "اسم المدعي_اسم المدعي عليه_رقم_سنة" (المسافات بتتحول لـ "_")
    const parts = [];
    if (plaintiff) parts.push(plaintiff);
    if (defendant) parts.push(defendant);
    if (number) parts.push(number);
    if (year) parts.push(year);

    let name = parts.length ? parts.join('_') : `قضية_${caseId}`;

    name = sanitizeName(name);
    // تقصير الاسم لو طويل جدًا عشان نتجنب مشاكل حدود طول المسار في ويندوز
    const MAX_LEN = 120;
    if (name.length > MAX_LEN) {
        name = name.slice(0, MAX_LEN).trim();
    }
    return name;
}

// مقارنة رقمية مرنة: بتتجاهل المسافات والأصفار الزيادة في البداية
// (مثلاً "08" هتتطابق مع "8")
function numbersMatch(a, b) {
    const sa = String(a || '').trim();
    const sb = String(b || '').trim();
    if (!sa || !sb) return false;
    if (sa === sb) return true;
    const na = parseInt(sa, 10);
    const nb = parseInt(sb, 10);
    return !isNaN(na) && !isNaN(nb) && na === nb;
}

function normalizeForFolderMatch(s) {
    return String(s || '').trim().replace(/\s+/g, ' ');
}

// بتدور على مجلد موجود بالفعل جوه مجلد التخزين خاص بنفس القضية دي، حتى
// لو كان اتعمل يدويًا قبل استخدام هذه الميزة. بتجرب أولاً مطابقة بادئة
// اسم المدعي + المدعي عليه (وهو الأسلوب الثابت اللي المستخدم بيسمي بيه
// كل مجلداته)، ولو مالقتش، بتدور على رقم وسنة الدعوى في أي ترتيب داخل
// اسم المجلد (قبل أو بعد بعض).
function findExistingFolderForCase(storageFolder, caseData, excludeFolderName) {
    if (!caseData) return null;

    let entries = [];
    try {
        entries = fs.readdirSync(storageFolder, { withFileTypes: true }).filter(e => e.isDirectory());
    } catch (err) {
        console.warn('تعذر قراءة مجلد التخزين:', err.message);
        return null;
    }

    const plaintiff = normalizeForFolderMatch(caseData.plaintiff);
    const defendant = normalizeForFolderMatch(caseData.defendant);
    const number = String((caseData.number || caseData.caseNumber) || '').trim();
    const year = String((caseData.year || caseData.caseYear) || '').trim();

    // المرحلة 1: مطابقة بادئة اسم المدعي + المدعي عليه
    if (plaintiff && defendant) {
        const prefix = `${plaintiff}_${defendant}`;
        for (const e of entries) {
            if (excludeFolderName && e.name === excludeFolderName) continue;
            if (e.name.indexOf(prefix) === 0) return e.name;
        }
    }

    // المرحلة 2: مطابقة مرنة برقم وسنة الدعوى في أي مكان بالاسم
    if (number && year) {
        for (const e of entries) {
            if (excludeFolderName && e.name === excludeFolderName) continue;
            const tokens = e.name.split(/[_\-\s]+/);
            for (let i = 0; i < tokens.length; i++) {
                if (!/^\d{4}$/.test(tokens[i]) || !numbersMatch(tokens[i], year)) continue;
                const before = tokens[i - 1];
                const after = tokens[i + 1];
                if ((before && /^\d+$/.test(before) && numbersMatch(before, number)) ||
                    (after && /^\d+$/.test(after) && numbersMatch(after, number))) {
                    return e.name;
                }
            }
        }
    }

    return null;
}

// بتنقل أي ملفات كانت اتحفظت بالغلط في مجلد قديم (نتيجة محاولة سابقة قبل
// اكتشاف المجلد الصحيح) إلى المجلد الصحيح الموجود بالفعل على القرص،
// وبتحدث فهرس المستندات لو اضطرينا نغير اسم أي ملف عشان تعارض أسماء،
// وبتحذف المجلد القديم لو فضل فاضي بعد النقل.
function mergeFolderInto(storageFolder, sourceFolderName, targetFolderName, caseId) {
    try {
        const sourcePath = path.join(storageFolder, sourceFolderName);
        const targetPath = path.join(storageFolder, targetFolderName);
        if (!fs.existsSync(sourcePath)) return;
        fs.mkdirSync(targetPath, { recursive: true });

        const files = fs.readdirSync(sourcePath, { withFileTypes: true }).filter(f => f.isFile());
        if (files.length === 0) {
            try { fs.rmdirSync(sourcePath); } catch (e) { /* تجاهل */ }
            return;
        }

        const index = readIndex();
        let indexChanged = false;

        for (const f of files) {
            const src = path.join(sourcePath, f.name);
            let destName = f.name;
            let dest = path.join(targetPath, destName);
            if (fs.existsSync(dest)) {
                const parsed = path.parse(f.name);
                destName = `${parsed.name}_${Date.now()}${parsed.ext}`;
                dest = path.join(targetPath, destName);
            }
            try {
                fs.renameSync(src, dest);
                if (destName !== f.name && caseId && index[caseId]) {
                    index[caseId].forEach(entry => {
                        if (entry.storedFileName === f.name) {
                            entry.storedFileName = destName;
                            indexChanged = true;
                        }
                    });
                }
            } catch (e) {
                console.warn('تعذر نقل ملف أثناء الدمج:', e.message);
            }
        }

        if (indexChanged) writeIndex(index);

        try {
            const remaining = fs.readdirSync(sourcePath);
            if (remaining.length === 0) fs.rmdirSync(sourcePath);
        } catch (e) { /* تجاهل */ }
    } catch (e) {
        console.warn('تعذر دمج مجلد القضية القديم مع المجلد الصحيح:', e.message);
    }
}

// بيرجع المسار الكامل لمجلد القضية على القرص، وبينشئه لو مش موجود.
// لو اتبعتت caseData (بيانات المدعي/المدعي عليه/الرقم/السنة)، وكان اسم
// المجلد القديم مختلف عن الاسم المفروض حاليًا (يعني بيانات القضية اتغيرت)،
// بيتم إعادة تسمية المجلد تلقائيًا مع الحفاظ على كل الملفات جواه.
function getCaseFolderPath(caseId, caseData) {
    const storageFolder = getStorageFolder();
    const mapping = readCaseFoldersIndex();
    let folderName = mapping[caseId];

    if (caseData) {
        // ندور دايمًا (مش أول مرة بس) على مجلد حقيقي موجود بالفعل على القرص
        // خاص بنفس القضية دي، غير المجلد المربوط حاليًا. لو لقينا واحد، ده
        // معناه إن الربط الحالي (لو موجود) كان غلط من محاولة قديمة، فبننقل
        // أي ملفات كانت اتحفظت فيه للمجلد الصحيح، ونصحح الربط.
        const realFolder = findExistingFolderForCase(storageFolder, caseData, folderName);

        if (realFolder && realFolder !== folderName) {
            if (folderName) {
                mergeFolderInto(storageFolder, folderName, realFolder, caseId);
            }
            folderName = realFolder;
            mapping[caseId] = folderName;
            writeCaseFoldersIndex(mapping);
        } else if (!folderName) {
            folderName = buildCaseFolderName(caseData, caseId);
            mapping[caseId] = folderName;
            writeCaseFoldersIndex(mapping);
        } else {
            // معندناش مجلد حقيقي تاني، بس ممكن بيانات القضية اتغيرت (رقمها
            // أو اسم الأطراف)، فنعيد تسمية المجلد الحالي ليطابق التغيير
            const desiredName = buildCaseFolderName(caseData, caseId);
            if (desiredName && desiredName !== folderName) {
                const oldPath = path.join(storageFolder, folderName);
                const newPath = path.join(storageFolder, desiredName);
                try {
                    if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
                        fs.renameSync(oldPath, newPath);
                    }
                } catch (e) {
                    console.warn('تعذر إعادة تسمية مجلد القضية:', e.message);
                }
                folderName = desiredName;
                mapping[caseId] = folderName;
                writeCaseFoldersIndex(mapping);
            }
        }
    } else if (!folderName) {
        folderName = sanitizeName(String(caseId));
        mapping[caseId] = folderName;
        writeCaseFoldersIndex(mapping);
    }

    const fullPath = path.join(storageFolder, folderName);
    fs.mkdirSync(fullPath, { recursive: true });
    return fullPath;
}

function guessMimeType(filename) {
    const ext = (String(filename).split('.').pop() || '').toLowerCase();
    const map = {
        pdf: 'application/pdf',
        doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xls: 'application/vnd.ms-excel',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        txt: 'text/plain'
    };
    return map[ext] || 'application/octet-stream';
}

// ---------------------------------------------------------------
// إنشاء نافذة التطبيق
// ---------------------------------------------------------------
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1366,
        height: 850,
        minWidth: 1000,
        minHeight: 650,
        title: 'نظام إدارة القضايا - المستشار محمود العوابدي',
        icon: path.join(__dirname, 'build', 'icon.png'),
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });

    Menu.setApplicationMenu(null);
    mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));

    // بدون هذا الإعداد، Electron بيمنع أي نافذة جديدة تتفتح بـ window.open()
    // بشكل افتراضي، وده اللي كان بيسبب ظهور نافذة بيضاء فاضية عند محاولة
    // عرض مستند (اللي بيستخدم window.open داخليًا). هنا بنسمح بفتحها صراحة.
    mainWindow.webContents.setWindowOpenHandler(() => {
        return {
            action: 'allow',
            overrideBrowserWindowOptions: {
                autoHideMenuBar: true,
                webPreferences: {
                    contextIsolation: true,
                    nodeIntegration: false,
                    sandbox: false,
                    // لازم نفعّل ده صراحة، وإلا وسم <embed type="application/pdf">
                    // هيفضل شاشة بيضاء فاضية من غير ما يعرض محتوى ملف الـ PDF
                    plugins: true
                }
            }
        };
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// نسخة واحدة فقط من التطبيق تعمل في نفس الوقت
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady().then(createWindow);

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit();
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
}

// ---------------------------------------------------------------
// واجهات IPC الخاصة بتخزين المستندات على القرص (Electron API الحقيقية)
// ---------------------------------------------------------------

ipcMain.handle('saveFile', async (event, { caseId, filename, dataBase64, docType, caseData }) => {
    try {
        if (!caseId || !filename || !dataBase64) {
            return { success: false, error: 'بيانات ناقصة لحفظ الملف' };
        }
        const caseFolder = getCaseFolderPath(caseId, caseData);

        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const cleanName = sanitizeName(filename);
        const storedFileName = `${id}__${cleanName}`;
        const fullPath = path.join(caseFolder, storedFileName);

        fs.writeFileSync(fullPath, Buffer.from(dataBase64, 'base64'));

        const index = readIndex();
        if (!index[caseId]) index[caseId] = [];
        index[caseId].push({
            id,
            originalName: filename,
            storedFileName,
            type: docType || '',
            uploadedAt: Date.now(),
            caseData: caseData || null
        });
        writeIndex(index);

        return { success: true };
    } catch (e) {
        console.error('saveFile error:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('listFiles', async (event, { caseId }) => {
    try {
        const index = readIndex();
        const files = (index[caseId] || [])
            .map(f => ({ id: f.id, originalName: f.originalName, type: f.type, uploadedAt: f.uploadedAt }))
            .sort((a, b) => (a.uploadedAt || 0) - (b.uploadedAt || 0));
        return { success: true, files };
    } catch (e) {
        console.error('listFiles error:', e);
        return { success: false, files: [] };
    }
});

function findEntry(caseId, id) {
    const index = readIndex();
    const list = index[caseId] || [];
    const entry = list.find(f => f.id === id);
    return { index, list, entry };
}

ipcMain.handle('readFile', async (event, { caseId, id }) => {
    try {
        const { entry } = findEntry(caseId, id);
        if (!entry) return { success: false, error: 'الملف غير موجود' };
        const fullPath = path.join(getCaseFolderPath(caseId), entry.storedFileName);
        if (!fs.existsSync(fullPath)) return { success: false, error: 'الملف غير موجود على القرص' };
        const buffer = fs.readFileSync(fullPath);
        return {
            success: true,
            mime: guessMimeType(entry.originalName),
            dataBase64: buffer.toString('base64'),
            name: entry.originalName
        };
    } catch (e) {
        console.error('readFile error:', e);
        return { success: false, error: e.message };
    }
});

// بيرجع رابط (file://) بيشاور على الملف الأصلي على القرص مباشرة، بدل ما
// نحوّله لنص Base64 طويل وندسّه في رابط data: — لأن الملفات الكبيرة
// (زي مستندات PDF كبيرة) بتخلي رابط الـ data: يتجاوز الحد الأقصى لطول
// الروابط اللي المتصفح بيقبله، فيفشل العرض بصمت وتفضل الشاشة بيضاء.
ipcMain.handle('getFileUrl', async (event, { caseId, id }) => {
    try {
        const { entry } = findEntry(caseId, id);
        if (!entry) return { success: false, error: 'الملف غير موجود' };
        const fullPath = path.join(getCaseFolderPath(caseId), entry.storedFileName);
        if (!fs.existsSync(fullPath)) return { success: false, error: 'الملف غير موجود على القرص' };
        return {
            success: true,
            url: pathToFileURL(fullPath).href,
            mime: guessMimeType(entry.originalName),
            name: entry.originalName
        };
    } catch (e) {
        console.error('getFileUrl error:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('deleteFile', async (event, { caseId, id }) => {
    try {
        const { index, list, entry } = findEntry(caseId, id);
        if (!entry) return { success: false, error: 'الملف غير موجود' };
        const fullPath = path.join(getCaseFolderPath(caseId), entry.storedFileName);
        try { if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath); } catch (e) { /* تجاهل لو الملف اتنقل يدويًا */ }
        index[caseId] = list.filter(f => f.id !== id);
        writeIndex(index);
        return { success: true };
    } catch (e) {
        console.error('deleteFile error:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('downloadFile', async (event, { caseId, id }) => {
    try {
        const { entry } = findEntry(caseId, id);
        if (!entry) return { success: false, error: 'الملف غير موجود' };
        const fullPath = path.join(getCaseFolderPath(caseId), entry.storedFileName);
        if (!fs.existsSync(fullPath)) return { success: false, error: 'الملف غير موجود على القرص' };

        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
            title: 'حفظ المستند',
            defaultPath: entry.originalName
        });
        if (canceled || !filePath) return { success: false, error: 'cancelled' };

        fs.copyFileSync(fullPath, filePath);
        return { success: true };
    } catch (e) {
        console.error('downloadFile error:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('openFileNative', async (event, { caseId, id }) => {
    try {
        const { entry } = findEntry(caseId, id);
        if (!entry) return { success: false, error: 'الملف غير موجود' };
        const fullPath = path.join(getCaseFolderPath(caseId), entry.storedFileName);
        if (!fs.existsSync(fullPath)) return { success: false, error: 'الملف غير موجود على القرص' };
        const result = await shell.openPath(fullPath);
        if (result) return { success: false, error: result };
        return { success: true };
    } catch (e) {
        console.error('openFileNative error:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('chooseStorageFolder', async () => {
    try {
        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
            title: 'اختر مجلد تخزين المستندات',
            properties: ['openDirectory', 'createDirectory']
        });
        if (canceled || !filePaths || !filePaths[0]) return { success: false, error: 'cancelled' };

        const chosen = filePaths[0];
        const cfg = readConfig();
        writeConfig({ ...cfg, storageFolder: chosen });
        return { success: true, path: chosen };
    } catch (e) {
        console.error('chooseStorageFolder error:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('getStoragePath', async () => {
    try {
        return { success: true, path: getStorageFolder() };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('readClipboard', async () => {
    try {
        return { success: true, text: clipboard.readText() };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('writeClipboard', async (event, { text }) => {
    try {
        clipboard.writeText(text || '');
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// ---------------------------------------------------------------
// بعض الملفات مش مستندات قضية حقيقية، دي ملفات نظام داخلية (فهارس
// بيانات، إعدادات...) لازم نستبعدها من الاستيراد عشان متتحسبش كأنها
// مستند حقيقي.
const NON_DOCUMENT_FILENAMES = new Set([
    'documents-index.json',
    'case-folders-index.json',
    'config.json',
    'index.json',
    'thumbs.db',
    'desktop.ini',
    '.ds_store'
]);

function isImportableDocument(filename) {
    return !NON_DOCUMENT_FILENAMES.has(String(filename).toLowerCase());
}

// مسح مجلد التخزين واستيراد المستندات الموجودة بالفعل (اللي كانت
// مرفوعة يدويًا قبل كده) ومطابقتها مع القضايا المسجلة في البرنامج
// ---------------------------------------------------------------

// بيرجع قائمة بكل المجلدات الفرعية الموجودة داخل مجلد التخزين، مع محاولة
// استخراج رقم وسنة الدعوى من أول التسمية (بافتراض الصيغة: "رقم_سنة_...")
ipcMain.handle('scanStorageFolders', async () => {
    try {
        const storageFolder = getStorageFolder();
        const entries = fs.readdirSync(storageFolder, { withFileTypes: true })
            .filter(e => e.isDirectory());

        const folders = entries.map(dirEntry => {
            const folderName = dirEntry.name;
            const folderPath = path.join(storageFolder, folderName);
            let files = [];
            try {
                files = fs.readdirSync(folderPath, { withFileTypes: true })
                    .filter(f => f.isFile() && isImportableDocument(f.name))
                    .map(f => {
                        let size = 0, mtime = 0;
                        try {
                            const stat = fs.statSync(path.join(folderPath, f.name));
                            size = stat.size;
                            mtime = stat.mtimeMs;
                        } catch (e) { /* تجاهل */ }
                        return { name: f.name, size, mtime };
                    });
            } catch (e) { /* تجاهل مجلد يتعذر قراءته */ }

            // محاولة استخراج "رقم_سنة" من أول التسمية
            let number = '';
            let year = '';
            const m = folderName.match(/^(\d+)[_\-\s]+(\d{4})(?:[_\-\s]|$)/);
            if (m) {
                number = m[1];
                year = m[2];
            }

            return { folderName, number, year, files };
        });

        return { success: true, folders };
    } catch (e) {
        console.error('scanStorageFolders error:', e);
        return { success: false, error: e.message, folders: [] };
    }
});

// بيربط مجلد موجود بالفعل على القرص بقضية معينة (caseId)، وبيسجل كل
// الملفات الموجودة جواه في فهرس المستندات الخاص بالقضية دي، من غير ما
// ينقل أو ينسخ أي ملف فعليًا (الملفات فضلة في مكانها بالظبط).
ipcMain.handle('importCaseFolder', async (event, { caseId, folderName }) => {
    try {
        if (!caseId || !folderName) {
            return { success: false, error: 'بيانات ناقصة للاستيراد' };
        }
        const storageFolder = getStorageFolder();
        const folderPath = path.join(storageFolder, folderName);
        if (!fs.existsSync(folderPath)) {
            return { success: false, error: 'المجلد غير موجود على القرص' };
        }

        // اربط المجلد ده بالقضية دي بشكل دائم، عشان أي مستند جديد يتضاف
        // لنفس القضية بعد كده يروح لنفس المجلد ده بالظبط
        const mapping = readCaseFoldersIndex();
        mapping[caseId] = folderName;
        writeCaseFoldersIndex(mapping);

        const files = fs.readdirSync(folderPath, { withFileTypes: true })
            .filter(f => f.isFile() && isImportableDocument(f.name));
        const index = readIndex();
        if (!index[caseId]) index[caseId] = [];

        const existingStoredNames = new Set(index[caseId].map(f => f.storedFileName));
        let addedCount = 0;

        for (const f of files) {
            if (existingStoredNames.has(f.name)) continue; // متسجل بالفعل، تجاهله عشان ميتكررش
            let mtime = Date.now();
            try {
                mtime = fs.statSync(path.join(folderPath, f.name)).mtimeMs;
            } catch (e) { /* تجاهل */ }

            index[caseId].push({
                id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                originalName: f.name,
                storedFileName: f.name,
                type: 'مستند مستورد',
                uploadedAt: mtime,
                caseData: null
            });
            addedCount++;
        }

        writeIndex(index);
        return { success: true, addedCount, totalFilesInFolder: files.length };
    } catch (e) {
        console.error('importCaseFolder error:', e);
        return { success: false, error: e.message };
    }
});
