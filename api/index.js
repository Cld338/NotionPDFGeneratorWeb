const express = require('express');
const fileUpload = require('express-fileupload');
const puppeteer = require('puppeteer-core');
const unzipper = require('unzipper');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const chromium = require('chrome-aws-lambda');

const app = express();

app.use(express.static(__dirname + '/public'));
app.use(fileUpload());

// 기본 경로에서 index.html 제공
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// PDF 변환 함수tm
const printPdf = async (filePath, options, fileIndex, totalFiles) => {
    const { width, includeBanner, includeTitle, includeTags } = options;
    console.log('=== PDF 변환 시작 ===');
    console.log('옵션:', JSON.stringify(options));
    console.log(`파일 경로: ${filePath}`);
    console.log(`진행상황: ${fileIndex}/${totalFiles}`);

    try {
        console.log('Chrome 실행 설정...');
        const browser = await puppeteer.launch({
            args: [...chromium.args, '--no-sandbox'],
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath,
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });
        console.log('Chrome 실행 완료');

        console.log('새 페이지 생성...');
        const page = await browser.newPage();
        console.log('페이지 생성 완료');
        
        console.log('HTML 파일 읽기 시작...');
        const htmlContent = await fs.promises.readFile(filePath, 'utf8');
        console.log('HTML 파일 읽기 완료');

        console.log('페이지에 HTML 콘텐츠 설정...');
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        console.log('HTML 콘텐츠 설정 완료');

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

        console.log('PDF 생성 시작...');
        const pdfBuffer = await page.pdf({
            width: width,
            height: `${Math.ceil(bodyHeight)}px`,
            printBackground: true,
            displayHeaderFooter: false,
            margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' },
        });
        console.log('PDF 생성 완료');

        return pdfBuffer;
    } catch (error) {
        console.error('=== PDF 변환 오류 발생 ===');
        console.error('오류 메시지:', error.message);
        console.error('오류 스택:', error.stack);
        throw error;
    } finally {
        if (browser) {
            console.log('브라우저 종료...');
            await browser.close();
            console.log('브라우저 종료 완료');
        }
    }
};

// ZIP 파일 압축 해제 및 PDF 변환
app.post('/upload', async (req, res) => {
    console.log('=== 파일 업로드 시작 ===');
    try {
        if (!req.files || !req.files.zipFile) {
            console.error('업로드된 파일 없음');
            return res.status(400).send('No files were uploaded.');
        }

        const { width, includeBanner, includeTitle, includeTags } = req.body;
        console.log('요청 옵션:', { width, includeBanner, includeTitle, includeTags });

        const options = {
            width: width || '1440px',
            includeBanner: includeBanner === 'true',
            includeTitle: includeTitle === 'true',
            includeTags: includeTags === 'true'
        };

        const zipFile = req.files.zipFile;
        console.log('업로드된 ZIP 파일:', zipFile.name);
        
        const extractDir = path.join('/tmp', 'extracted');
        const outputDir = path.join('/tmp', 'out');

        console.log('디렉토리 생성...');
        if (!fs.existsSync(extractDir)) fs.mkdirSync(extractDir, { recursive: true });
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
        console.log('디렉토리 생성 완료');

        console.log('ZIP 파일 압축 해제 시작...');
        await fs.promises.writeFile(path.join('/tmp', zipFile.name), zipFile.data);
        await fs.createReadStream(path.join('/tmp', zipFile.name))
            .pipe(unzipper.Extract({ path: extractDir }))
            .promise();
        console.log('ZIP 파일 압축 해제 완료');

        const files = await fs.promises.readdir(extractDir);
        console.log('추출된 파일 목록:', files);

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
    } catch (error) {
        console.error('=== 처리 중 오류 발생 ===');
        console.error('오류 메시지:', error.message);
        console.error('오류 스택:', error.stack);
        res.status(500).send('An error occurred during processing.');
    }
});

// Vercel을 위한 export 설정
module.exports = app;
