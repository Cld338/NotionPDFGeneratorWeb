const express = require('express');
const fileUpload = require('express-fileupload');
const puppeteer = require('puppeteer');
const unzipper = require('unzipper');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');

const app = express();

app.use(express.static('public'));
app.use(fileUpload());

// 기본 경로에서 index.html 제공
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// PDF 변환 함수
const printPdf = async (filePath, options, fileIndex, totalFiles) => {
    const { width, includeBanner, includeTitle, includeTags } = options;
    console.log(`Converting ${path.basename(filePath)} to PDF...`);
    console.log(`Converting ${fileIndex}/${totalFiles}...`);

    // Vercel에서 호환 가능한 Chromium 실행 파일 경로
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        executablePath: '/usr/bin/chromium-browser' // Vercel에서 사용할 수 있는 Chromium 경로
    });

    const page = await browser.newPage();

    await page.goto(`file://${filePath}`, { waitUntil: 'networkidle2' });

    await page.evaluate((options) => {
        const { includeBanner, includeTitle, includeTags } = options;

        if (!includeBanner) {
            const banner = document.querySelector('.page-cover-image');
            if (banner) banner.remove();
        }

        if (!includeTitle) {
            const title = document.querySelector('.page-title');
            if (title) title.remove();
        }

        if (!includeTags) {
            const tags = document.querySelector('.properties');
            if (tags) tags.remove();
        }

        const headerIcon = document.querySelector('.page-header-icon');
        if (headerIcon && !includeBanner) {
            headerIcon.style.display = 'inline';
        }
    }, { includeBanner, includeTitle, includeTags });

    await page.evaluate(async () => {
        const images = Array.from(document.images);
        await Promise.all(images.map(img => {
            if (img.complete) return Promise.resolve();
            return new Promise(resolve => (img.onload = img.onerror = resolve));
        }));
    });

    const bodyHeight = await page.evaluate(() => {
        const body = document.body;
        const html = document.documentElement;
        const images = Array.from(document.images);
        let totalImageHeight = 0;

        images.forEach((img) => {
            const rect = img.getBoundingClientRect();
            totalImageHeight += rect.height;
        });

        return Math.max(
            body.scrollHeight,
            body.offsetHeight,
            html.clientHeight,
            html.scrollHeight,
            html.offsetHeight
        ) + totalImageHeight;
    });

    page.setViewport({ width: parseInt(width), height: Math.ceil(bodyHeight) });

    const pdfBuffer = await page.pdf({
        width: width,
        height: `${Math.ceil(bodyHeight)}px`,
        printBackground: true,
        displayHeaderFooter: false,
        margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' },
    });

    await browser.close();

    console.log(`Converted ${path.basename(filePath)} to PDF`);
    return pdfBuffer;
};

// ZIP 파일 압축 해제 및 PDF 변환
app.post('/upload', async (req, res) => {
    if (!req.files || !req.files.zipFile) {
        return res.status(400).send('No files were uploaded.');
    }

    const { width, includeBanner, includeTitle, includeTags } = req.body;
    const options = {
        width: width || '1440px',
        includeBanner: includeBanner === 'true',
        includeTitle: includeTitle === 'true',
        includeTags: includeTags === 'true'
    };

    const zipFile = req.files.zipFile;
    
    // /tmp 디렉토리를 사용하여 임시 파일 및 폴더 생성
    const extractDir = path.join('/tmp', 'extracted');
    const outputDir = path.join('/tmp', 'out');

    if (!fs.existsSync(extractDir)) fs.mkdirSync(extractDir);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

    console.log('Starting to unzip the file...');
    await fs.promises.writeFile(path.join('/tmp', zipFile.name), zipFile.data);
    await fs.createReadStream(path.join('/tmp', zipFile.name))
        .pipe(unzipper.Extract({ path: extractDir }))
        .promise();
    console.log('Unzipping completed.');

    const files = await fs.promises.readdir(extractDir);
    const pdfFiles = [];
    let index = 0;

    for (const file of files) {
        index++;
        const filePath = path.join(extractDir, file);
        if (path.extname(file) === '.html') {
            const pdfBuffer = await printPdf(filePath, options, index, files.length);
            const pdfName = `${path.basename(file, '.html')}.pdf`;
            const pdfPath = path.join(outputDir, pdfName);
            fs.writeFileSync(pdfPath, pdfBuffer);
            pdfFiles.push(pdfPath);
        }
    }

    console.log('PDF conversion completed. Preparing files for download...');

    const zipOutput = path.join('/tmp', 'pdfs.zip');
    const output = fs.createWriteStream(zipOutput);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
        console.log('Zipping completed.');
        res.download(zipOutput, 'pdfs.zip', async (err) => {
            if (err) console.error(err);

            // 파일 정리
            fs.unlinkSync(zipOutput);
            fs.rmSync(extractDir, { recursive: true, force: true });
            fs.rmSync(outputDir, { recursive: true, force: true });
            console.log('Cleanup completed.');
        });
    });

    archive.on('error', (err) => {
        console.error('Archive Error:', err);
        res.status(500).send('An error occurred while creating the ZIP file.');
    });

    archive.pipe(output);
    pdfFiles.forEach(pdf => {
        archive.file(pdf, { name: path.basename(pdf) });
    });

    await archive.finalize();
});

module.exports = app;
