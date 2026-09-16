const https = require('https');
const fs = require('fs');
const path = require('path');
const { log, error } = require('./logger');

// .env 로드
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      process.env[key] = val;
    }
  });
}

/**
 * 노션 DB에서 현재 등록된 공고 목록(URL, 기업명, 직무, 상태)을 조회
 */
async function fetchExistingJobs() {
  const apiKey = process.env.NOTION_API_KEY;
  const dbId = process.env.NOTION_DATABASE_ID;
  if (!apiKey || !dbId) {
    throw new Error('NOTION_API_KEY 또는 NOTION_DATABASE_ID가 누락되었습니다.');
  }

  let results = [];
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore) {
    const bodyObj = { page_size: 100 };
    if (startCursor) {
      bodyObj.start_cursor = startCursor;
    }
    const bodyStr = JSON.stringify(bodyObj);

    const data = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.notion.com',
        path: `/v1/databases/${dbId}/query`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr)
        }
      }, (res) => {
        let respData = '';
        res.on('data', chunk => respData += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(respData);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(json);
            } else {
              reject(new Error(`Notion API [${res.statusCode}]: ${JSON.stringify(json)}`));
            }
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
      req.write(bodyStr);
      req.end();
    });

    if (data.results) {
      for (const page of data.results) {
        const props = page.properties;
        const company = props['기업명']?.title?.[0]?.plain_text || '';
        const position = props['채용직무']?.rich_text?.[0]?.plain_text || '';
        const url = props['채용링크']?.url || '';
        const status = props['상태']?.status?.name || '';
        const pageId = page.id;
        results.push({ pageId, company, position, url, status });
      }
    }

    hasMore = data.has_more;
    startCursor = data.next_cursor;
  }

  return results;
}

if (require.main === module) {
  fetchExistingJobs()
    .then(jobs => {
      log(`[Notion] 총 ${jobs.length}개의 기존 공고를 불러왔습니다.`);
      jobs.forEach((j, i) => {
        log(`${i + 1}. [${j.company}] ${j.position} (${j.status}) - ${j.url}`);
      });
    })
    .catch(err => {
      error('[Notion] 기존 공고 조회 실패:', err);
      process.exit(1);
    });
}

module.exports = { fetchExistingJobs };
