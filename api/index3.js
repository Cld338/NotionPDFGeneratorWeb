const express = require('express');
const fileUpload = require('express-fileupload');
const puppeteer = require('puppeteer');
const unzipper = require('unzipper');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const https = require('https'); 

const app = express();
const PORT = 3000;


app.use(express.static(path.join(__dirname, 'public')));
app.use(
    fileUpload({
        limits: { fileSize: 50 * 1024 * 1024 }, // 50MB 제한 설정
        abortOnLimit: true, // 파일 크기가 제한을 초과하면 요청을 중단
    })
);

const wss = new WebSocket.Server(
    {
        noServer: true,
    }
);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index2.html'));
});


// PDF 변환 함수
const printPdf = async (filePath, options, fileIndex, totalFiles) => {
    const { width, includeBanner, includeTitle, includeTags } = options;
    console.log(`Converting ${path.basename(filePath)} to PDF...`);
    console.log(`Converting ${fileIndex}/${totalFiles}...`);

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-config']
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


app.post('/upload', async (req, res) => {
    if (!req.files || !req.files.zipFile) {
        return res.status(400).send('No files were uploaded.');
    }

    if (req.files.zipFile.truncated) { // 제한 초과 여부 확인
        return res.status(413).send('File size exceeds the 50MB limit.');
        
    }

    const { width, includeBanner, includeTitle, includeTags } = req.body;
    const options = {
        width: width || '1440px',
        includeBanner: includeBanner === 'true',
        includeTitle: includeTitle === 'true',
        includeTags: includeTags === 'true'
    };

    const zipFile = req.files.zipFile;
    const extractDir = path.join(__dirname, 'public/extracted');
    const outputDir = path.join(__dirname, 'public/out');
    const zipFilePath = path.join(__dirname, zipFile.name);

    if (!fs.existsSync(extractDir)) fs.mkdirSync(extractDir);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

    console.log('Starting to unzip the file...');
    await fs.promises.writeFile(zipFilePath, zipFile.data);
    await fs.createReadStream(zipFilePath)
        .pipe(unzipper.Extract({ path: extractDir }))
        .promise();
    console.log('Unzipping completed.');

    const files = await fs.promises.readdir(extractDir);
    const pdfFiles = [];
    let index = 0;
    const totalFiles = files.length;

    for (const file of files) {
        index++;
        const filePath = path.join(extractDir, file);
        if (path.extname(file) === '.html') {
            const pdfBuffer = await printPdf(filePath, options, index, totalFiles);
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(`Converting ${index}/${totalFiles}: ${path.basename(file)}`);
                }
            });
            const pdfName = `${path.basename(file, '.html')}.pdf`;
            const pdfPath = path.join(outputDir, pdfName);
            fs.writeFileSync(pdfPath, pdfBuffer, "utf-8");
            pdfFiles.push(pdfPath);
        }
    }

    console.log('PDF conversion completed. Preparing files for download...');

    const zipOutput = path.join(__dirname, 'pdfs.zip');
    const output = fs.createWriteStream(zipOutput);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', async () => {
        console.log('Zipping completed.');
        res.download(zipOutput, 'pdfs.zip', async (err) => {
            if (err) console.error(err);

            fs.unlinkSync(zipFilePath);
            fs.unlinkSync(zipOutput);

            const extractedFiles = fs.readdirSync(extractDir);
            for (const file of extractedFiles) {
                const filePath = path.join(extractDir, file);
                // if (fs.statSync(filePath).isDirectory()) {
                    fs.rmSync(filePath, { recursive: true, force: true });
            }
            const outputFiles = fs.readdirSync(outputDir);
            for (const file of outputFiles) {
                const filePath = path.join(outputDir, file);
                // if (fs.statSync(filePath).isDirectory()) {
                    fs.rmSync(filePath, { recursive: true, force: true });
                // }
            }
            console.log('Cleanup completed.');
        });
    });

    archive.on('error', (err) => {
        console.error('Archive Error:', err);
        res.status(500).send('An error occurred while creating the ZIP file.');
    });

    archive.pipe(output);
    pdfFiles.forEach(pdf => {
        archive.file(pdf, { name: Buffer.from(path.basename(pdf), 'utf8').toString() });
    });

    await archive.finalize();
});


// app.server = https.createServer(options, app).listen(PORT, () => { // http 대신 https.createServer 사용
    // console.log(`Server is running on port ${PORT}`);
// });

app.server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

app.get('/.well-known/pki-validation/66B0E0B1136DC206C31602BD6C6FC952.txt', (req, res) => {
   res.sendFile(path.join(__dirname, 'public', '66B0E0B1136DC206C31602BD6C6FC952.txt'));
});

app.server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

module.exports = app;