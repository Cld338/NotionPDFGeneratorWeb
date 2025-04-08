const puppeteer = require('puppeteer');
const { URL } = require('url');

async function printPdfFromUrl(targetUrl, options) {
  // 옵션 기본값 설정
  const { width = '1080px', includeBanner = false, includeTitle = false, includeTags = false } = options;

  console.log(`Converting URL ${targetUrl} to PDF...`);
  console.log(`Options: width=${width}, banner=${includeBanner}, title=${includeTitle}, tags=${includeTags}`);

  // Vercel 환경에서는 puppeteer를 사용할 때 추가 설정이 필요할 수 있음
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

  // 초기 뷰포트 설정
  await page.setViewport({ width: parseInt(width), height: 100 });

  // URL 로 이동 (대기 시간을 충분히 설정)
  await page.goto(targetUrl, { waitUntil: 'networkidle0', timeout: 60000 });

  // 불필요한 요소 제거 (배너, 제목, 태그 등)
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
  }, { includeBanner, includeTitle, includeTags });

  // 이미지 로딩 대기 (PDF 생성 전)
  await page.evaluate(async () => {
    const images = Array.from(document.querySelectorAll("img"));
    await Promise.all(
      images.map(img => {
        if (img.complete) return;
        return new Promise(resolve => {
          img.addEventListener("load", resolve);
          img.addEventListener("error", resolve);
        });
      })
    );
  });

  // 페이지 내 특정 요소의 높이를 재계산
  const calculateBodyHeight = async () => {
    return await page.evaluate(() => {
      const targetElement = document.querySelector('#notion-app > div > div:nth-child(1) > div > div:nth-child(1) > main > div > div > div.whenContentEditable > div');
      if (targetElement) {
        const rect = targetElement.getBoundingClientRect();
        console.log('Width:', rect.width, 'Height:', rect.height);
        return Math.ceil(rect.height);
      } else {
        console.log('#notion-app 요소를 찾을 수 없습니다.');
        return 1000; // 기본값 설정
      }
    });
  };

  const bodyHeight = await calculateBodyHeight();
  await page.setViewport({ width: parseInt(width), height: bodyHeight });

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
  
  await browser.close();
  return pdfBuffer;
}

module.exports = async (req, res) => {
  // POST 메서드만 허용
  if (req.method !== 'POST') {
    res.status(405).send({ error: 'Method Not Allowed. POST 메서드만 지원됩니다.' });
    return;
  }

  // 요청 본문에서 필요한 데이터 추출
  const { url: targetUrl, width, includeBanner, includeTitle, includeTags } = req.body;

  if (!targetUrl) {
    res.status(400).json({ error: '요청 본문에 "url"이 포함되어야 합니다.' });
    return;
  }

  try {
    new URL(targetUrl); // URL 유효성 검사
  } catch (error) {
    res.status(400).json({ error: '유효하지 않은 URL 형식입니다.' });
    return;
  }

  // 옵션 객체 구성 (문자열로 전달된 true/false 처리)
  const options = {
    width: width || '1080px',
    includeBanner: String(includeBanner).toLowerCase() === 'true',
    includeTitle: String(includeTitle).toLowerCase() === 'true',
    includeTags: String(includeTags).toLowerCase() === 'true'
  };

  try {
    // URL의 hash fragment 추출 (선택 사항)
    let urlFragment = '';
    try {
      const parsedUrl = new URL(targetUrl);
      if (parsedUrl.hash) {
        urlFragment = parsedUrl.hash.substring(1); // '#' 제거
        console.log('Extracted URL Fragment:', urlFragment);
      }
    } catch (fragmentError) {
      console.error('Error extracting URL fragment:', fragmentError);
    }

    const pdfBuffer = await printPdfFromUrl(targetUrl, options);

    // 파일 이름 생성 (호스트명 사용)
    let filename = "converted.pdf";
    try {
      const parsedUrl = new URL(targetUrl);
      filename = `${parsedUrl.hostname || 'page'}.pdf`;
    } catch (e) {
      // 파일 이름 생성 오류 무시
    }

    // PDF 다운로드를 위한 헤더 설정
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.setHeader('Content-Length', pdfBuffer.length);

    // PDF 버퍼 전송
    res.status(200).send(pdfBuffer);

  } catch (error) {
    console.error(`URL ${targetUrl} 처리 실패:`, error);
    res.status(500).json({
      error: 'URL을 PDF로 변환하는 중 오류가 발생했습니다. 서버 로그를 확인하세요.'
    });
  }
};
