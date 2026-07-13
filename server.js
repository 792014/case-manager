// ============================================================
// سيرفر محلي بسيط لتطبيق "نظام إدارة القضايا"
// وظيفته: يشغّل التطبيق ويشارك نفس البيانات بين اللاب توب والموبايل
// طالما الجهازين على نفس شبكة الواي فاي.
// ============================================================

const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = 5000;
const DATA_FILE = path.join(__dirname, 'data.json');
const SEED_FILE = path.join(__dirname, 'backup-seed.json');

// يسمح بقراءة أجسام الطلبات الكبيرة (بيانات القضايا ممكن تكبر مع الوقت)
app.use(express.json({ limit: '25mb' }));

// تقديم كل ملفات التطبيق (index.html, manifest.json, sw.js, الأيقونات...)
app.use(express.static(__dirname));

// إنشاء ملف البيانات المشترك أول مرة من النسخة الاحتياطية المرفقة إن وجدت
function ensureDataFile() {
    if (!fs.existsSync(DATA_FILE)) {
        let initial = {
            cases: [], favorableJudgments: [], againstJudgments: [],
            reservedCases: [], cancelledCases: [], suspendedCases: [],
            archivedCases: [], notifications: [], lastSavedAt: Date.now()
        };
        if (fs.existsSync(SEED_FILE)) {
            try {
                const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf-8'));
                initial = { ...initial, ...seed, lastSavedAt: Date.now() };
                console.log('تم إنشاء قاعدة بيانات مشتركة (data.json) من النسخة الاحتياطية المرفقة.');
            } catch (e) {
                console.warn('تعذرت قراءة backup-seed.json، هيتم البدء ببيانات فارغة.', e.message);
            }
        }
        fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    }
}
ensureDataFile();

// جلب البيانات المشتركة
app.get('/api/data', (req, res) => {
    try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
        res.json(data);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// حفظ البيانات المشتركة (من أي جهاز: لاب توب أو موبايل)
app.post('/api/data', (req, res) => {
    try {
        const incoming = req.body || {};
        incoming.lastSavedAt = incoming.lastSavedAt || Date.now();
        fs.writeFileSync(DATA_FILE, JSON.stringify(incoming, null, 2), 'utf-8');
        res.json({ success: true, lastSavedAt: incoming.lastSavedAt });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// استخراج عنوان الـ IP المحلي لعرضه في رسالة التشغيل (مفيد عشان تفتحه من الموبايل)
function getLocalIPs() {
    const nets = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
        }
    }
    return ips;
}

app.listen(PORT, '0.0.0.0', () => {
    const ips = getLocalIPs();
    console.log('==============================================');
    console.log('  نظام إدارة القضايا - السيرفر شغّال الآن');
    console.log('==============================================');
    console.log(`  على نفس اللاب توب: http://localhost:${PORT}`);
    if (ips.length) {
        console.log('  من الموبايل (لازم يكون على نفس الواي فاي):');
        ips.forEach((ip) => console.log(`    http://${ip}:${PORT}`));
    } else {
        console.log('  لم يتم العثور على عنوان شبكة محلي - تأكد إنك متصل بالواي فاي.');
    }
    console.log('==============================================');
});
