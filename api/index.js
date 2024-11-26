const express = require('express');
const fileUpload = require('express-fileupload');
const puppeteer = require('puppeteer-core');
const unzipper = require('unzipper');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const chromium = require('@sparticuz/chrome-aws-lambda'); // AWS Lambda용 Chromium

const app = express();

app.use(express.static(__dirname + '/public'));
app.use(fileUpload());

// 기본 경로에서 index.html 제공
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// PDF 변환 함수
const printPdf = async (filePath, options, fileIndex, totalFiles) => {
    const { width, includeBanner, includeTitle, includeTags } = options;
    let browser = null;

    try {
        console.log(`=== PDF 변환 시작 (${fileIndex}/${totalFiles}) ===`);
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath,
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        const htmlContent = await fs.promises.readFile(filePath, 'utf8');
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

        await page.evaluate(({ includeBanner, includeTitle, includeTags }) => {
            if (!includeBanner) document.querySelector('.page-cover-image')?.remove();
            if (!includeTitle) document.querySelector('.page-title')?.remove();
            if (!includeTags) document.querySelector('.properties')?.remove();
        }, { includeBanner, includeTitle, includeTags });

        const pdfBuffer = await page.pdf({
            width: width,
            printBackground: true,
            margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' },
        });

        return pdfBuffer;
    } finally {
        if (browser) await browser.close();
    }
};

// 파일 업로드 및 변환 처리
app.post('/upload', async (req, res) => {
    try {
        if (!req.files || !req.files.zipFile) return res.status(400).send('No files were uploaded.');

        const { width, includeBanner, includeTitle, includeTags } = req.body;
        const options = {
            width: width || '1440px',
            includeBanner: includeBanner === 'true',
            includeTitle: includeTitle === 'true',
            includeTags: includeTags === 'true',
        };

        const zipFile = req.files.zipFile;
        const extractDir = path.join('/tmp', 'extracted');
        const outputDir = path.join('/tmp', 'out');

        if (!fs.existsSync(extractDir)) fs.mkdirSync(extractDir, { recursive: true });
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

        await fs.promises.writeFile(path.join('/tmp', zipFile.name), zipFile.data);
        await fs.createReadStream(path.join('/tmp', zipFile.name))
            .pipe(unzipper.Extract({ path: extractDir }))
            .promise();

        const files = await fs.promises.readdir(extractDir);
        const pdfFiles = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const filePath = path.join(extractDir, file);
            if (path.extname(file) === '.html') {
                const pdfBuffer = await printPdf(filePath, options, i + 1, files.length);
                const pdfPath = path.join(outputDir, `${path.basename(file, '.html')}.pdf`);
                fs.writeFileSync(pdfPath, pdfBuffer);
                pdfFiles.push(pdfPath);
            }
        }

        const zipOutput = path.join('/tmp', 'pdfs.zip');
        const output = fs.createWriteStream(zipOutput);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => res.download(zipOutput, 'pdfs.zip'));
        archive.on('error', (err) => res.status(500).send(err.message));
        archive.pipe(output);
        pdfFiles.forEach(pdf => archive.file(pdf, { name: path.basename(pdf) }));
        await archive.finalize();
    } catch (error) {
        res.status(500).send('An error occurred.');
    }
});

module.exports = app;
