// ============================================================
// أداة إنشاء نسخة مستقلة جديدة من نظام إدارة القضايا (لأي صديق)
// ============================================================
// بتعمل نسخة كاملة من مشروع البرنامج في مجلد جديد، وبتغيّر رابط قاعدة
// بيانات Firebase فيها ليكون مستقل تمامًا عن نسختك الأصلية وعن أي نسخة
// تانية. شغّل السكريبت ده من جوه مجلد المشروع الأصلي (case-manager-desktop).
// ============================================================

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
    return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));
}

function copyDirRecursive(src, dest, excludeFiles) {
    excludeFiles = excludeFiles || [];
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        if (excludeFiles.includes(entry.name)) continue; // تجاهل الملفات المستبعدة
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(s, d, excludeFiles);
        } else {
            fs.copyFileSync(s, d);
        }
    }
}

async function main() {
    console.log('============================================================');
    console.log('   إنشاء نسخة مستقلة جديدة من نظام إدارة القضايا');
    console.log('============================================================\n');

    // تأكيد إننا شغالين من المكان الصح
    if (!fs.existsSync(path.join(__dirname, 'main.js')) || !fs.existsSync(path.join(__dirname, 'app', 'index.html'))) {
        console.log('❌ خطأ: لازم تشغّل السكريبت ده من جوه مجلد المشروع نفسه');
        console.log('   (المجلد اللي فيه main.js ومجلد app).');
        rl.close();
        process.exit(1);
    }

    const friendNameRaw = await ask('اسم الصديق/النسخة (حروف إنجليزي وأرقام بدون مسافات، مثال: ahmed): ');
    const friendName = friendNameRaw.replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!friendName) {
        console.log('❌ لازم تدخل اسم صحيح (حروف إنجليزي/أرقام بس).');
        rl.close();
        process.exit(1);
    }

    console.log('\nمحتاج رابط قاعدة بيانات Firebase الجديدة الخاصة بالصديق ده.');
    console.log('شكله بيكون زي: https://اسم-المشروع-default-rtdb.firebaseio.com');
    console.log('(لو لسه معملتش المشروع ده، اقرأ ملف "دليل_توزيع_نسخ_مستقلة.md" أولاً)\n');
    const dbUrl = await ask('رابط قاعدة البيانات: ');

    if (!/^https:\/\/.+firebaseio\.com\/?$/.test(dbUrl)) {
        console.log('❌ الرابط شكله مش صح. لازم يبدأ بـ https:// ويحتوي على firebaseio.com');
        rl.close();
        process.exit(1);
    }
    const cleanDbUrl = dbUrl.replace(/\/$/, '');

    const targetDir = path.join(__dirname, '..', `case-manager-${friendName}`);
    if (fs.existsSync(targetDir)) {
        console.log(`❌ في مجلد بنفس الاسم موجود بالفعل: ${targetDir}`);
        console.log('   اختر اسم مختلف أو احذف المجلد القديم أولاً.');
        rl.close();
        process.exit(1);
    }

    console.log('\nجارٍ نسخ الملفات...');
    fs.mkdirSync(targetDir, { recursive: true });

    for (const f of ['main.js', 'preload.js', 'package.json']) {
        if (fs.existsSync(path.join(__dirname, f))) {
            fs.copyFileSync(path.join(__dirname, f), path.join(targetDir, f));
        }
    }
    copyDirRecursive(path.join(__dirname, 'app'), path.join(targetDir, 'app'), ['backup-seed.json']);
    if (fs.existsSync(path.join(__dirname, 'app', 'backup-seed.json'))) {
        console.log('✔ تم استبعاد ملف backup-seed.json (نسختك الأصلية) من نسخة هذا الصديق');
    }
    if (fs.existsSync(path.join(__dirname, 'build'))) {
        copyDirRecursive(path.join(__dirname, 'build'), path.join(targetDir, 'build'));
    }

    // تحديث رابط قاعدة البيانات في نسخة index.html الجديدة
    const indexPath = path.join(targetDir, 'app', 'index.html');
    let html = fs.readFileSync(indexPath, 'utf-8');
    const pattern = /const FIREBASE_DB_BASE = '[^']*';/;
    if (!pattern.test(html)) {
        console.log('⚠️  تحذير: مالقيتش سطر رابط قاعدة البيانات في index.html.');
        console.log('   محتاج تعدله يدويًا بنفسك.');
    } else {
        html = html.replace(pattern, `const FIREBASE_DB_BASE = '${cleanDbUrl}';`);
        fs.writeFileSync(indexPath, html, 'utf-8');
        console.log('✔ تم تحديث رابط قاعدة البيانات في app/index.html');
    }

    // تخصيص اسم البرنامج وملف package.json (اختياري لكن مفيد لتمييز النسخ)
    const pkgPath = path.join(targetDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            pkg.name = `case-manager-${friendName}`;
            if (pkg.build) {
                pkg.build.appId = `eg.stateslawsuits.casemanager.${friendName}`;
                if (pkg.build.nsis) {
                    pkg.build.nsis.artifactName = `تثبيت-نظام-إدارة-القضايا-${friendName}-\${version}.\${ext}`;
                }
            }
            fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf-8');
            console.log('✔ تم تخصيص package.json لهذه النسخة');
        } catch (e) {
            console.log('⚠️  تعذر تعديل package.json:', e.message);
        }
    }

    // إعداد ملفات Firebase Hosting لنسخة الموبايل بتاعة هذا الصديق
    const firebaseJsonContent = {
        hosting: {
            public: 'app',
            ignore: ['firebase.json', '**/.*', '**/node_modules/**'],
            headers: [{ source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] }],
            rewrites: [{ source: '**', destination: '/index.html' }]
        }
    };
    fs.writeFileSync(path.join(targetDir, 'firebase.json'), JSON.stringify(firebaseJsonContent, null, 2), 'utf-8');
    console.log('✔ تم إنشاء firebase.json (لنشر نسخة الموبايل لاحقًا)');

    console.log(`\n✅ تم إنشاء نسخة مستقلة كاملة في:\n   ${targetDir}\n`);
    console.log('الخطوات التالية (نفذها بالترتيب):');
    console.log(`  1. cd "${targetDir}"`);
    console.log('  2. npm install');
    console.log('  3. npm run dist          (لعمل مثبت اللاب توب)');
    console.log('  4. firebase use --add    (اختر مشروع Firebase بتاع الصديق ده تحديدًا)');
    console.log('  5. firebase deploy --only hosting   (لنشر نسخة الموبايل)');
    console.log('\nابعت ملف المثبت (من مجلد release) ورابط الموبايل لصاحبك، وخلاص! 🎉');

    rl.close();
}

main();
