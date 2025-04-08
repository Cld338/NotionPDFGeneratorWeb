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
const fs = require('fs');
const path = require('path');
// const https = require('https');
const { URL } = require('url'); // Built-in URL parser
// const pdfParse = require('pdf-parse'); // Import the pdf-parse library
// const { PDFDocument, rgb } = require('pdf-lib'); // Import PDFDocument and rgb from pdf-lib

const app = express();
const PORT = 3000;

// Middleware to parse JSON bodies
app.use(express.json());
// Middleware to parse URL-encoded bodies (optional, but good practice)
app.use(express.urlencoded({ extended: true }));

// Serve static files (like your index.html if needed for the UI)
app.use(express.static(path.join(__dirname, 'public')));

// --- Removed WebSocket and file upload/unzip/zip logic ---

// --- Modified PDF Conversion Function ---
// Now takes a URL instead of a file path
const printPdfFromUrl = async (targetUrl, options) => {
    // Destructure options with defaults
    const { width = '1080px', includeBanner = false, includeTitle = false, includeTags = false } = options;

    console.log(`Converting URL ${targetUrl} to PDF...`);
    console.log(`Options: width=${width}, banner=${includeBanner}, title=${includeTitle}, tags=${includeTags}`);

    let browser;
    browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // Common args for server environments
    });
    const page = await browser.newPage();
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));


    // Set a reasonable default viewport height initially
    await page.setViewport({ width: parseInt(width), height: 100 });

    // Navigate to the URL
    await page.goto(targetUrl, { waitUntil: 'networkidle0', timeout: 60000 }); // Increased timeout, networkidle0 waits for fewer network connections

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
        const links = document.querySelectorAll('div.notion-selectable.notion-table_of_contents-block > div > div > a');
        links.forEach(link => {
            const href = link.getAttribute('href');
            const hashIndex = href.indexOf('#');
            if (hashIndex !== -1) {
                const hash = href.substring(hashIndex);
                link.setAttribute('href', hash);
                link.setAttribute('role', "");
            } else {
                console.log("Warning: No hash found in href:", href);
            }
        });
    }, { includeBanner, includeTitle, includeTags }); // Pass options correctly

    // Ensure all images are loaded (best effort)
    await page.evaluate(async () => {
        const selectors = Array.from(document.querySelectorAll("img"));
        await Promise.all(
            selectors.map(img => {
                if (img.complete) return;
                return new Promise((resolve, reject) => {
                    img.addEventListener("load", resolve);
                    img.addEventListener("error", resolve); // Resolve on error too to not block PDF generation
                });
            })
        );
    });

    // 높이 재계산
    const calculateBodyHeight = async () => {
        return await page.evaluate(() => {
            const targetElement = document.querySelector('#notion-app > div > div:nth-child(1) > div > div:nth-child(1) > main > div > div > div.whenContentEditable > div');

            if (targetElement) {
                const rect = targetElement.getBoundingClientRect();
                console.log('Width:', rect.width, 'Height:', rect.height);
                return Math.max(
                    rect.height
                );
            } else {
                console.log('#notion-app 요소를 찾을 수 없습니다.');
            }


        });
    };

    const bodyHeight = await calculateBodyHeight();

    page.setViewport({ width: parseInt(width), height: Math.ceil(bodyHeight)});

    const fullPdfBuffer = await page.pdf({
        width: width,
        height: `${Math.ceil(bodyHeight)}px`,
        printBackground: true,
        displayHeaderFooter: false,
        margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' },
        pageRanges: '1',
        tagged: true,
        outline: true,
    });
    console.log(`Successfully converted ${targetUrl} to PDF`);
    return fullPdfBuffer;

};


// --- New Endpoint for URL Conversion ---
app.post('/convert-url', async (req, res) => {
    const { url: targetUrl, width, includeBanner, includeTitle, includeTags } = req.body;

    // Basic URL validation
    if (!targetUrl) {
        return res.status(400).send({ error: 'Missing "url" in request body.' });
    }
    try {
        new URL(targetUrl); // Check if it's a valid URL format
    } catch (error) {
        return res.status(400).send({ error: 'Invalid URL format provided.' });
    }

    // Prepare options for the conversion function
    const options = {
        width: width || '1080px', // Default width if not provided
        // Convert string 'true'/'false' from form data/JSON to boolean
        includeBanner: String(includeBanner).toLowerCase() === 'true',
        includeTitle: String(includeTitle).toLowerCase() === 'true',
        includeTags: String(includeTags).toLowerCase() === 'true'
    };

    try {
        let urlFragment = '';
        try {
            const parsedUrl = new URL(targetUrl);
            if (parsedUrl.hash) {
                urlFragment = parsedUrl.hash.substring(1); // Remove the '#'
                console.log('Extracted URL Fragment:', urlFragment);
            }
        } catch (fragmentError) {
            console.error('Error extracting URL fragment:', fragmentError);
        }

        const pdfBuffer = await printPdfFromUrl(targetUrl, options);
        // Generate a filename (optional, enhances download UX)
        let filename = "converted.pdf";
        try {
            const parsedUrl = new URL(targetUrl);
            filename = `${parsedUrl.hostname || 'page'}.pdf`;
        } catch { /* Ignore errors in filename generation */ }


        // Set headers for PDF download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        res.setHeader('Content-Length', pdfBuffer.length);

        // Send the PDF buffer as the response
        res.send(pdfBuffer);

    } catch (error) {
        // Log the detailed error on the server
        console.error(`Failed to process URL ${targetUrl}:`, error);
        // Send a generic error message to the client
        res.status(500).send({ error: 'Failed to convert URL to PDF and modify links. Check server logs for details.' });
    }
});

// --- Root Route and Server Start ---
// In server.js (should already be there)
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index2.html'));
});

// Start HTTP server (or HTTPS if you uncomment the section below)
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`); // Use HTTP for local dev
});


module.exports = app; // Export for potential testing or modular use