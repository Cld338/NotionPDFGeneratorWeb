// const express = require('express');
// const puppeteer = require('puppeteer');
// const fs = require('fs');
// const path = require('path');
// const https = require('https');
// const { URL } = require('url'); // Built-in URL parser

// const app = express();
// const PORT = 3000;

// // Middleware to parse JSON bodies
// app.use(express.json());
// // Middleware to parse URL-encoded bodies (optional, but good practice)
// app.use(express.urlencoded({ extended: true }));

// // Serve static files (like your index.html if needed for the UI)
// app.use(express.static(path.join(__dirname, 'public')));

// // --- Removed WebSocket and file upload/unzip/zip logic ---

// // --- Modified PDF Conversion Function ---
// // Now takes a URL instead of a file path
// const printPdfFromUrl = async (targetUrl, options) => {
//     // Destructure options with defaults
//     const { width = '1080px', includeBanner = false, includeTitle = false, includeTags = false } = options;

//     console.log(`Converting URL ${targetUrl} to PDF...`);
//     console.log(`Options: width=${width}, banner=${includeBanner}, title=${includeTitle}, tags=${includeTags}`);

//     let browser;
//     try {
//         browser = await puppeteer.launch({
//             headless: true,
//             args: ['--no-sandbox', '--disable-setuid-sandbox'] // Common args for server environments
//         });
//         const page = await browser.newPage();

//         // Set a reasonable default viewport height initially
//         await page.setViewport({ width: parseInt(width), height: 100 });

//         // Navigate to the URL
//         await page.goto(targetUrl, { waitUntil: 'networkidle0', timeout: 60000 }); // Increased timeout, networkidle0 waits for fewer network connections

//         // --- DOM Manipulation (Important Note!) ---
//         // The selectors used here (.page-cover-image, .page-title, .properties)
//         // were specific to the Notion export format in your original code.
//         // These selectors will likely NOT WORK on arbitrary websites.
//         // You might need to:
//         // 1. Remove this section if you want a general URL-to-PDF converter.
//         // 2. Make the selectors configurable if you target specific site structures.
//         // 3. Use more generic approaches if applicable (though difficult).
//         await page.evaluate((evalOptions) => {
//             const { includeBanner, includeTitle, includeTags } = evalOptions;

//             // Attempt to remove elements based on the *original* selectors
//             // This part is highly likely to fail on general websites
//             if (!includeBanner) {
//                 const banner = document.querySelector('.page-cover-image');
//                 if (banner) banner.remove();
//                 // Notion specific icon adjustment - likely irrelevant now
//                 // const headerIcon = document.querySelector('.page-header-icon');
//                 // if (headerIcon) headerIcon.style.display = 'inline';
//             }
//             if (!includeTitle) {
//                 const title = document.querySelector('.page-title');
//                 if (title) title.remove();
//             }
//             if (!includeTags) {
//                 const tags = document.querySelector('.properties');
//                 if (tags) tags.remove();
//             }
//         }, { includeBanner, includeTitle, includeTags }); // Pass options correctly

//         // Ensure all images are loaded (best effort)
//         await page.evaluate(async () => {
//             const selectors = Array.from(document.querySelectorAll("img"));
//             await Promise.all(
//                 selectors.map(img => {
//                     if (img.complete) return;
//                     return new Promise((resolve, reject) => {
//                         img.addEventListener("load", resolve);
//                         img.addEventListener("error", resolve); // Resolve on error too to not block PDF generation
//                     });
//                 })
//             );
//         });

//         // 높이 재계산
//         const calculateBodyHeight = async () => {
//             return await page.evaluate(() => {
//                 const body = document.body;
//                 const html = document.documentElement;
//                 const images = Array.from(document.images);
//                 let totalImageHeight = 0;

//                 images.forEach((img) => {
//                     const rect = img.getBoundingClientRect();
//                     totalImageHeight += rect.height;
//                 });
//                 const targetElement = document.querySelector('#notion-app > div > div:nth-child(1) > div > div:nth-child(1) > main > div > div > div.whenContentEditable > div');

//                 if (targetElement) {
//                     const rect = targetElement.getBoundingClientRect();
//                     console.log('Width:', rect.width, 'Height:', rect.height);
//                     return Math.max(
//                         rect.height
//                     );
//                 } else {
//                     console.log('#notion-app 요소를 찾을 수 없습니다.');
//                 }

                
//             });
//         };

//         const bodyHeight = await calculateBodyHeight();

//         page.setViewport({ width: parseInt(width), height: Math.ceil(bodyHeight)});

//         const pdfBuffer = await page.pdf({
//             width: width,
//             height: `${Math.ceil(bodyHeight)}px`,
//             printBackground: true,
//             displayHeaderFooter: false,
//             margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' },
//         });
//             console.log(`Successfully converted ${targetUrl} to PDF`);
//             return pdfBuffer;

//     } catch (error) {
//         console.error(`Error converting URL ${targetUrl} to PDF:`, error);
//         throw error; // Re-throw the error to be caught by the route handler
//     } finally {
//         if (browser) {
//             await browser.close();
//             console.log('Browser closed.');
//         }
//     }
// };
    

// // --- New Endpoint for URL Conversion ---
// app.post('/convert-url', async (req, res) => {
//     const { url: targetUrl, width, includeBanner, includeTitle, includeTags } = req.body;

//     // Basic URL validation
//     if (!targetUrl) {
//         return res.status(400).send({ error: 'Missing "url" in request body.' });
//     }
//     try {
//         new URL(targetUrl); // Check if it's a valid URL format
//     } catch (error) {
//         return res.status(400).send({ error: 'Invalid URL format provided.' });
//     }

//     // Prepare options for the conversion function
//     const options = {
//         width: width || '1080px', // Default width if not provided
//         // Convert string 'true'/'false' from form data/JSON to boolean
//         includeBanner: String(includeBanner).toLowerCase() === 'true',
//         includeTitle: String(includeTitle).toLowerCase() === 'true',
//         includeTags: String(includeTags).toLowerCase() === 'true'
//     };

//     try {
//         const pdfBuffer = await printPdfFromUrl(targetUrl, options);
        

//         // Generate a filename (optional, enhances download UX)
//         let filename = "converted.pdf";
//         try {
//             const parsedUrl = new URL(targetUrl);
//             filename = `${parsedUrl.hostname || 'page'}.pdf`;
//         } catch { /* Ignore errors in filename generation */ }


//         // Set headers for PDF download
//         res.setHeader('Content-Type', 'application/pdf');
//         res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
//         res.setHeader('Content-Length', pdfBuffer.length);

//         // Send the PDF buffer as the response
//         res.send(pdfBuffer);

//     } catch (error) {
//         // Log the detailed error on the server
//         console.error(`Failed to process URL ${targetUrl}:`, error);
//         // Send a generic error message to the client
//         res.status(500).send({ error: 'Failed to convert URL to PDF. Check server logs for details.' });
//     }
// });

// // --- Root Route and Server Start ---
// // In server.js (should already be there)
// app.use(express.static(path.join(__dirname, 'public')));

// app.get('/', (req, res) => {
//     res.sendFile(path.join(__dirname, 'public', 'index2.html'));
// });
// // Optional: Keep for SSL certificate validation if needed
// app.get('/.well-known/pki-validation/66B0E0B1136DC206C31602BD6C6FC952.txt', (req, res) => {
//     res.sendFile(path.join(__dirname, 'public', '66B0E0B1136DC206C31602BD6C6FC952.txt'));
// });

// // Start HTTP server (or HTTPS if you uncomment the section below)
// app.listen(PORT, () => {
//     console.log(`Server is running on http://localhost:${PORT}`); // Use HTTP for local dev
// });

// /*
// // --- HTTPS Server Setup (Example - Needs actual certificate files) ---
// // const httpsOptions = {
// //   key: fs.readFileSync('path/to/your/private.key'), // Replace with actual path
// //   cert: fs.readFileSync('path/to/your/certificate.crt') // Replace with actual path
// // };
// //
// // https.createServer(httpsOptions, app).listen(PORT, () => {
// //   console.log(`HTTPS Server is running on https://localhost:${PORT}`);
// // });
// */

// module.exports = app; // Export for potential testing or modular use
const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const { URL } = require('url'); // Built-in URL parser

const app = express();
// Vercel 환경에서는 포트 번호를 직접 지정할 필요가 없습니다.
// const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// --- PDF Conversion Function ---
// (수정 없이 그대로 사용 가능, 단 Puppeteer 실행 환경 고려 필요)
const printPdfFromUrl = async (targetUrl, options) => {
    const { width = '1080px', includeBanner = false, includeTitle = false, includeTags = false } = options;

    console.log(`Converting URL ${targetUrl} to PDF...`);
    console.log(`Options: width=${width}, banner=${includeBanner}, title=${includeTitle}, tags=${includeTags}`);

    let browser = null; // browser 변수를 try 외부에서 선언
    try {
        // Vercel 환경에서는 puppeteer.launch 인수가 중요할 수 있습니다.
        // 기본값이 잘 동작하지 않으면 'chrome-aws-lambda' 관련 설정을 찾아보세요.
        browser = await puppeteer.launch({
            headless: true, // Vercel에서는 항상 true여야 함
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                // Vercel 메모리 제한 고려 필요시 추가 인수:
                // '--disable-dev-shm-usage',
                // '--single-process'
            ]
        });
        const page = await browser.newPage();
        page.on('console', msg => console.log('PAGE LOG:', msg.text()));


        await page.setViewport({ width: parseInt(width), height: 100 }); // 초기 높이

        await page.goto(targetUrl, { waitUntil: 'networkidle0', timeout: 60000 });

        // DOM 조작 (배너, 제목, 태그 제거 및 링크 수정)
        await page.evaluate((evalOptions) => {
            const { includeBanner, includeTitle, includeTags } = evalOptions;
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
            // 링크 수정 (Table of Contents)
            const links = document.querySelectorAll('div.notion-selectable.notion-table_of_contents-block > div > div > a');
            links.forEach(link => {
                const href = link.getAttribute('href');
                if (href && href.includes('#')) { // href가 null이 아니고 #을 포함하는지 확인
                     const hashIndex = href.indexOf('#');
                     const hash = href.substring(hashIndex);
                     link.setAttribute('href', hash);
                     link.setAttribute('role', ""); // role 속성 제거 또는 빈 값으로 설정
                } else {
                    console.log("Warning: No hash found or invalid href:", href);
                }
            });
        }, { includeBanner, includeTitle, includeTags });

        // 이미지 로딩 대기 (Best effort)
        await page.evaluate(async () => {
            const selectors = Array.from(document.querySelectorAll("img"));
            await Promise.all(
                selectors.map(img => {
                    if (img.complete) return;
                    return new Promise((resolve, reject) => {
                        img.addEventListener("load", resolve);
                        img.addEventListener("error", resolve); // 에러 발생 시에도 계속 진행
                    });
                })
            );
        });

        // 높이 재계산 함수 정의
        const calculateBodyHeight = async () => {
             return await page.evaluate(() => {
                 // Notion 페이지 구조에 맞는 정확한 선택자 사용 필요
                 // 개발자 도구로 확인하여 가장 적절한 컨텐츠 래퍼 선택
                 const targetElement = document.querySelector('.notion-page-content'); // 예시 선택자, 실제 구조에 맞게 수정 필요
                 // const targetElement = document.querySelector('#notion-app > div > div:nth-child(1) > div > div:nth-child(1) > main > div > div > div.whenContentEditable > div'); // 원래 코드 선택자

                 if (targetElement) {
                     const rect = targetElement.getBoundingClientRect();
                     // scrollHeight가 더 정확할 수 있음
                     // console.log('Element scrollHeight:', targetElement.scrollHeight);
                     // return Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, targetElement.scrollHeight);
                     console.log('Content element height:', rect.height);
                     return rect.height; // getBoundingClientRect 높이 사용
                 } else {
                     console.log('Content element not found. Using document height.');
                     // 페이지 전체 높이 사용 (fallback)
                     return Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
                 }
             });
         };

        let bodyHeight = await calculateBodyHeight();
        // 계산된 높이가 너무 작으면 최소 높이 보장
        if (!bodyHeight || bodyHeight < 500) {
             console.warn(`Calculated height (${bodyHeight}) seems too small. Using default 1080px.`);
             bodyHeight = 1080; // 기본 최소 높이
        } else {
            bodyHeight += 100; // 약간의 여백 추가 (렌더링 차이 고려)
        }

        console.log(`Setting viewport height to: ${Math.ceil(bodyHeight)}px`);
        await page.setViewport({ width: parseInt(width), height: Math.ceil(bodyHeight) });

        // 잠시 대기하여 레이아웃 안정화 (선택적)
        await new Promise(resolve => setTimeout(resolve, 500));


        // PDF 생성
        const fullPdfBuffer = await page.pdf({
            width: width,
            height: `${Math.ceil(bodyHeight)}px`, // 계산된 높이 사용
            printBackground: true,
            displayHeaderFooter: false,
            margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' },
            pageRanges: '1', // 단일 페이지 PDF
            // tagged 와 outline 옵션은 필요에 따라 사용
            // tagged: true,
            // outline: true,
        });

        console.log(`Successfully converted ${targetUrl} to PDF`);
        return fullPdfBuffer;

    } catch (error) {
        console.error("Error during PDF conversion:", error);
        // 에러 발생 시에도 browser 객체가 존재하면 닫아줍니다.
        if (browser) {
             console.log("Closing browser due to error.");
             await browser.close();
             browser = null; // 닫혔음을 명시
        }
        throw new Error('Failed to generate PDF: ' + error.message); // 에러를 다시 던져서 상위 핸들러가 처리하도록 함
    } finally {
        // 정상 종료 시 browser 객체가 존재하고 아직 열려있으면 닫습니다.
        if (browser) {
            console.log("Closing browser after successful PDF generation.");
            await browser.close();
        }
    }
};


// --- API Endpoint ---
app.post('/api/convert-url', async (req, res) => {
    const { url: targetUrl, width, includeBanner, includeTitle, includeTags } = req.body;

    if (!targetUrl) {
        return res.status(400).send({ error: 'Missing "url" in request body.' });
    }
    try {
        new URL(targetUrl);
    } catch (error) {
        return res.status(400).send({ error: 'Invalid URL format provided.' });
    }

    const options = {
        width: width || '1080px',
        includeBanner: String(includeBanner).toLowerCase() === 'true',
        includeTitle: String(includeTitle).toLowerCase() === 'true',
        includeTags: String(includeTags).toLowerCase() === 'true'
    };

    try {
        console.log("Starting PDF generation process for:", targetUrl);
        const pdfBuffer = await printPdfFromUrl(targetUrl, options);
        console.log("PDF generation complete. Sending response.");

        let filename = "converted.pdf";
        try {
            const parsedUrl = new URL(targetUrl);
            // 파일 이름에 포함될 수 없는 문자 제거 또는 대체
            const safeHostname = (parsedUrl.hostname || 'page').replace(/[^a-z0-9_.-]/gi, '_');
            filename = `${safeHostname}.pdf`;
        } catch { /* Ignore filename generation errors */ }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`); // 파일 이름에 따옴표 추가
        res.setHeader('Content-Length', pdfBuffer.length);

        res.send(pdfBuffer);
        console.log("PDF sent successfully.");

    } catch (error) {
        console.error(`Failed to process URL ${targetUrl}:`, error);
        // 클라이언트에게 간단한 에러 메시지 전송
        res.status(500).send({ error: 'Failed to convert URL to PDF. Please check the URL or server logs.' });
    }
});

// --- Root Route ---
// public/index2.html 을 기본 페이지로 제공
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index2.html'));
});

// --- 서버 시작 부분 제거 ---
// Vercel이 서버를 관리하므로 이 부분을 제거합니다.
app.listen(PORT, () => {
 console.log(`Server is running on http://localhost:${PORT}`);
});

// --- Vercel이 사용할 수 있도록 app 객체를 export ---
// module.exports = app;