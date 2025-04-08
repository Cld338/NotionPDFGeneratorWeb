// api/convert-url.js
const puppeteer = require('puppeteer');
const { URL } = require('url');

/**
 * 주어진 URL을 PDF로 변환하는 함수.
 * @param {string} targetUrl - 변환 대상 URL.
 * @param {object} options - PDF 생성 옵션 (width, includeBanner, includeTitle, includeTags)
 * @returns {Buffer} PDF 데이터 버퍼
 */
const printPdfFromUrl = async (targetUrl, options) => {
  // 옵션 기본값 설정
  const { width = '1080px', includeBanner = false, includeTitle = false, includeTags = false } = options;
  console.log(`Converting URL ${targetUrl} to PDF...`);
  console.log(`Options: width=${width}, banner=${includeBanner}, title=${includeTitle}, tags=${includeTags}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));

    // 초기에 기본 뷰포트 설정
    await page.setViewport({ width: parseInt(width), height: 100 });

    // URL로 이동 (네트워크 정체가 없을 때까지 기다림)
    await page.goto(targetUrl, { waitUntil: 'networkidle0', timeout: 60000 });

    // DOM 요소 제거 등 옵션에 따른 조작 실행
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
      // 링크 수정 (Notion 형식의 경우)
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
    }, { includeBanner, includeTitle, includeTags });

    // 모든 이미지가 로드될 때까지 대기 (최대한 PDF 변환에 반영)
    await page.evaluate(async () => {
      const selectors = Array.from(document.querySelectorAll("img"));
      await Promise.all(
        selectors.map(img => {
          if (img.complete) return;
          return new Promise((resolve) => {
            img.addEventListener("load", resolve);
            img.addEventListener("error", resolve);
          });
        })
      );
    });

    // 변환할 영역의 높이 계산 (Notion 형식의 선택자 사용)
    const calculateBodyHeight = async () => {
      return await page.evaluate(() => {
        const targetElement = document.querySelector('#notion-app > div > div:nth-child(1) > div > div:nth-child(1) > main > div > div > div.whenContentEditable > div');
        if (targetElement) {
          const rect = targetElement.getBoundingClientRect();
          console.log('Width:', rect.width, 'Height:', rect.height);
          return Math.ceil(rect.height);
        } else {
          console.log('#notion-app 요소를 찾을 수 없습니다.');
          return 1000; // 기본 높이
        }
      });
    };

    const bodyHeight = await calculateBodyHeight();
    await page.setViewport({ width: parseInt(width), height: bodyHeight });

    // PDF 생성 – 페이지 크기와 옵션 반영
    const pdfBuffer = await page.pdf({
      width: width,
      height: `${bodyHeight}px`,
      printBackground: true,
      displayHeaderFooter: false,
      margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' },
      pageRanges: '1',
      tagged: true,
      outline: true,
    });

    console.log(`Successfully converted ${targetUrl} to PDF`);
    return pdfBuffer;
  } catch (error) {
    console.error(`Error converting URL ${targetUrl} to PDF:`, error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
      console.log('Browser closed.');
    }
  }
};

// Vercel 서버리스 함수 엔트리 포인트
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const { url: targetUrl, width, includeBanner, includeTitle, includeTags } = req.body;

  // URL 필수 체크 및 포맷 검증
  if (!targetUrl) {
    res.status(400).json({ error: 'Missing "url" in request body.' });
    return;
  }
  try {
    new URL(targetUrl);
  } catch (error) {
    res.status(400).json({ error: 'Invalid URL format provided.' });
    return;
  }

  // 옵션 객체 준비 (문자열 true/false를 boolean으로 변환)
  const options = {
    width: width || '1080px',
    includeBanner: String(includeBanner).toLowerCase() === 'true',
    includeTitle: String(includeTitle).toLowerCase() === 'true',
    includeTags: String(includeTags).toLowerCase() === 'true'
  };

  try {
    // URL의 fragment가 존재하면 로그 남김 (옵션 처리 예시)
    let urlFragment = '';
    try {
      const parsedUrl = new URL(targetUrl);
      if (parsedUrl.hash) {
        urlFragment = parsedUrl.hash.substring(1);
        console.log('Extracted URL Fragment:', urlFragment);
      }
    } catch (fragmentError) {
      console.error('Error extracting URL fragment:', fragmentError);
    }

    const pdfBuffer = await printPdfFromUrl(targetUrl, options);

    // 다운로드 파일명 생성 (호스트명 기반)
    let filename = "converted.pdf";
    try {
      const parsedUrl = new URL(targetUrl);
      filename = `${parsedUrl.hostname || 'page'}.pdf`;
    } catch {
      // 별도 처리 없이 기본 파일명 사용
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    console.error(`Failed to process URL ${targetUrl}:`, error);
    res.status(500).json({ error: 'Failed to convert URL to PDF and modify links. Check server logs for details.' });
  }
};
