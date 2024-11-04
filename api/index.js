const express = require('express');
const fileUpload = require('express-fileupload');
const puppeteer = require('puppeteer');
const unzipper = require('unzipper');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const sharp = require('sharp');


const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = 3000;

app.use(express.static('public'));
app.use(fileUpload());

// PDF 변환 함수
const printPdf = async (filePath, options, socket, fileIndex, totalFiles) => {
    const { width, includeBanner, includeTitle, includeTags } = options;
    socket.emit('log', `Converting ${path.basename(filePath)} to PDF...`);
    socket.emit('message', `Converting ${fileIndex}/${totalFiles}...`);

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(`file://${filePath}`, { waitUntil: 'networkidle2' });
    /* 배너 이미지*/
    // await page.evaluate(async () => { 
    //     const banner = document.querySelector('.page-cover-image');
    //     if (banner) {
    //         const imageUrl = banner.src;
    //         console.log(imageUrl);
    //         if (imageUrl) {
    //             const response = await fetch(imageUrl);
    //             const buffer = await response.buffer();
    //             const bannerImage = sharp(buffer);
    //             const metadata = await bannerImage.metadata();
    //             const aspectRatio = metadata.width / metadata.height;
    //             if (aspectRatio < 2) {
    //                 const scaledBuffer = await bannerImage.resize({ width: metadata.width, height: Math.ceil(metadata.width / 2) }).toBuffer();
    //                 const base64Image = scaledBuffer.toString('base64');
    //                 banner.src = `data:image/jpeg;base64,${base64Image}`;
    //             }
    //         }
    //     }
    // });

    await page.goto(`file://${filePath}`, { waitUntil: 'networkidle2' });

    await page.evaluate((options) => {
        const { includeBanner, includeTitle, includeTags } = options;
    
        if (!includeBanner) {
            const banner = document.querySelector('.page-cover-image');
            if (banner) {
                banner.remove();
            }
        }

    
        if (!includeTitle) {
            const title = document.querySelector('.page-title');
            if (title) title.remove();
        }
    
        if (!includeTags) {
            const tags = document.querySelector('.properties');
            if (tags) tags.remove();
        }

        // .page-header-icon의 display 스타일을 inline으로 변경
        const headerIcon = document.querySelector('.page-header-icon');
        if (headerIcon && !includeBanner) {
            headerIcon.style.display = 'inline';
        }
    }, { includeBanner, includeTitle, includeTags });
    

    // 모든 이미지가 로드될 때까지 기다린 후 전체 페이지 높이를 계산
    await page.evaluate(async () => {
        const images = Array.from(document.images);
        await Promise.all(images.map(img => {
            if (img.complete) return Promise.resolve();
            return new Promise(resolve => {
                img.onload = img.onerror = resolve;
            });
        }));
    });

    // 모든 리소스가 로드된 후 페이지 높이 계산 (이미지 높이 포함)
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

    // Puppeteer의 setViewport 함수는 정수 값을 사용해야 하므로 높이를 정수로 변환
    page.setViewport({ width: parseInt(width), height: Math.ceil(bodyHeight) });

    const pdfBuffer = await page.pdf({
        width: width,
        height: `${Math.ceil(bodyHeight)}px`,
        printBackground: true,
        displayHeaderFooter: false,
        margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' },
    });

    await browser.close();

    socket.emit('log', `Converted ${path.basename(filePath)} to PDF`);
    return pdfBuffer;
};

// ZIP 파일 압축 해제 및 PDF 변환
app.post('/upload', async (req, res) => {
    const socket = req.headers['x-socket-id'] ? io.sockets.sockets.get(req.headers['x-socket-id']) : null;
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
    const extractDir = path.join(__dirname, 'extracted');
    const outputDir = path.join(__dirname, 'out');

    if (!fs.existsSync(extractDir)) fs.mkdirSync(extractDir);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

    socket?.emit('log', 'Starting to unzip the file...');
    await fs.promises.writeFile(path.join(__dirname, zipFile.name), zipFile.data);
    await fs.createReadStream(path.join(__dirname, zipFile.name))
        .pipe(unzipper.Extract({ path: extractDir }))
        .promise();
    socket?.emit('log', 'Unzipping completed.');

    const files = await fs.promises.readdir(extractDir);
    const pdfFiles = [];
    let index = 0;

    for (const file of files) {
        index++;
        const filePath = path.join(extractDir, file);
        if (path.extname(file) === '.html') {
            const pdfBuffer = await printPdf(filePath, options, socket, index, files.length);
            const pdfName = `${path.basename(file, '.html')}.pdf`;
            const pdfPath = path.join(outputDir, pdfName);
            fs.writeFileSync(pdfPath, pdfBuffer);
            pdfFiles.push(pdfPath);
        }
    }

    socket?.emit('log', 'PDF conversion completed. Preparing files for download...');

    const zipOutput = path.join(__dirname, 'pdfs.zip');
    const output = fs.createWriteStream(zipOutput);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
        socket?.emit('log', 'Zipping completed.');
        res.download(zipOutput, 'pdfs.zip', async (err) => {
            if (err) console.error(err);

            // 파일 정리
            fs.unlinkSync(zipOutput);
            fs.rmSync(extractDir, { recursive: true, force: true });
            fs.rmSync(outputDir, { recursive: true, force: true });
            socket?.emit('log', 'Cleanup completed.');
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

io.on('connection', (socket) => {
    socket.emit('socketId', socket.id);
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

module.exports = app;