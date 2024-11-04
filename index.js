const puppeteer = require('puppeteer');
const fs = require('fs');
const PDFMerger = require('pdf-merger-js');
const util = require('util');
const readdir = util.promisify(fs.readdir);

const url = 'file:///C:/Users/교사1/Downloads/3eac6c7e-ebfc-4b0f-9056-9161663d8bcf_Export-066c622e-d4fa-4b50-9948-1d796a980343/aa.html';
const mkdir = util.promisify(fs.mkdir);
let depth = 1;
let printed = [];

// 가로와 세로 길이를 설정할 수 있도록 파라미터 추가
const printPdf = async (url, width) => {
    console.log('Generating PDF for: ' + url);

    if (depth >= 100) return;

    const browser = await puppeteer.launch({
        headless: true
    });

    const page = await browser.newPage();

    await page.goto(url, {
        waitUntil: 'networkidle2'
    });

    // 페이지의 정확한 콘텐츠 높이 가져오기
    const bodyHeight = await page.evaluate(() => {
        const body = document.body;
        const html = document.documentElement;
        return Math.max(
            body.scrollHeight,
            body.offsetHeight,
            html.clientHeight,
            html.scrollHeight,
            html.offsetHeight
        );
    });

    // 뷰포트와 PDF 높이를 페이지 콘텐츠 높이로 설정
    page.setViewport({
        width: parseInt(width),
        height: bodyHeight
    });

    const hrefs = await page.$$eval('a', as => as.map(a => a.href));
    for (let href of hrefs) {
        if (href.indexOf("file://") === 0) {
            if (printed.indexOf(href) !== -1) {
                console.log("Already visited " + href + "! Skipping...");
                continue;
            }

            printed.push(href);

            let newUrl = href;
            let extensionSplit = newUrl.split(".");
            if (extensionSplit[1].trim() !== "html") {
                continue;
            }

            let thisDepth = depth;
            depth++;

            const newBuff = await (printPdf(newUrl, width));
            writeBufferToFile(newBuff, thisDepth + ".pdf");
        }
    }

    const pdfFile = await page.pdf({
        width: width,
        height: `${bodyHeight}px`,  // PDF 높이도 페이지 실제 높이로 설정
        printBackground: true,
        displayHeaderFooter: false,
        margin: {  // 모든 여백을 0으로 설정
            top: '0px',
            bottom: '0px',
            left: '0px',
            right: '0px'
        }
    });

    await browser.close();
    return pdfFile;
};

function writeBufferToFile(buffer, file) {
    fs.writeFileSync("./out/" + file, buffer, "binary", function (err) {
        if (err) console.error(err);
    });
}

async function mergeAllPDF() {
    console.log("Merging PDF");
    let merger = new PDFMerger();

    try {
        await mkdir('./out', { recursive: true });
    } catch (err) {
        if (err.code !== 'EEXIST') throw err;
    }

    const files = await readdir("./out");

    files.sort((a, b) => parseInt(a) - parseInt(b)).forEach(function (file) {
        console.log("Adding " + file + " to merge");
        merger.add('./out/' + file); 
    });

    await merger.save('Export.pdf');
    console.log("PDF Saved!");
    
    console.log("Cleanup started");
    files.forEach(function (file) {
        console.log("Deleting " + file + "!");
        fs.unlinkSync("./out/" + file);
    });
}

(async () => {
    const buffer = await printPdf(url, '1440px'); // 2000px 너비 적용
    writeBufferToFile(buffer, "0.pdf");

    await mergeAllPDF();
})();

