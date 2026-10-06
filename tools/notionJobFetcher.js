const https = require('https');
const fs = require('fs');
const path = require('path');
require('./loadEnv');
const { log, error } = require('./logger');

function notionRequest(method, apiPath, body) {
  const apiKey = process.env.NOTION_API_KEY;
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Notion-Version': '2022-06-28'
    };
    if (bodyStr) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }
    const req = https.request({ hostname: 'api.notion.com', path: apiPath, method, headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
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
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

const { extractJobKey, normalizeUrl, companyKey, titleKey } = require('./jobKeys');

/**
 * 노션 DB에서 현재 등록된 공고 목록을 조회 (pipeline-spec 4.1 노션 캐시 항목 스키마)
 */
async function fetchExistingJobs() {
  const apiKey = process.env.NOTION_API_KEY;
  const dbId = process.env.NOTION_DATABASE_ID;
  if (!apiKey || !dbId) {
    throw new Error('NOTION_API_KEY 또는 NOTION_DATABASE_ID가 누락되었습니다.');
  }

  const results = [];
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore) {
    const bodyObj = { page_size: 100 };
    if (startCursor) bodyObj.start_cursor = startCursor;
    const data = await notionRequest('POST', `/v1/databases/${dbId}/query`, bodyObj);

    if (data.results) {
      for (const page of data.results) {
        const props = page.properties;
        const company = (props['기업명']?.title || []).map(t => t.plain_text).join('');
        const position = (props['채용직무']?.rich_text || []).map(t => t.plain_text).join('');
        const url = props['채용링크']?.url || '';
        const status = props['상태']?.status?.name || '';
        const keyProp = (props['공고키']?.rich_text || []).map(t => t.plain_text).join('').trim();
        results.push({
          pageId: page.id,
          jobKey: keyProp || extractJobKey(url),
          url,
          normalizedUrl: normalizeUrl(url),
          company,
          companyKey: companyKey(company),
          position,
          titleKey: titleKey(position),
          status
        });
      }
    }

    hasMore = data.has_more;
    startCursor = data.next_cursor;
  }

  return results;
}

/**
 * DB 속성 및 select/multi_select/status 옵션 목록 조회
 */
async function fetchSchema() {
  const apiKey = process.env.NOTION_API_KEY;
  const dbId = process.env.NOTION_DATABASE_ID;
  if (!apiKey || !dbId) {
    throw new Error('NOTION_API_KEY 또는 NOTION_DATABASE_ID가 누락되었습니다.');
  }
  const db = await notionRequest('GET', `/v1/databases/${dbId}`);
  const schema = {};
  for (const [name, prop] of Object.entries(db.properties || {})) {
    const entry = { type: prop.type };
    if (['select', 'multi_select', 'status'].includes(prop.type)) {
      entry.options = (prop[prop.type]?.options || []).map(o => o.name);
    }
    schema[name] = entry;
  }
  return schema;
}

function parseArgs(argv) {
  const opts = { schema: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--schema') opts.schema = true;
    else if (argv[i] === '--out') opts.out = argv[++i];
  }
  return opts;
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  (async () => {
    if (opts.schema) {
      const schema = await fetchSchema();
      for (const [name, e] of Object.entries(schema)) {
        console.log(`- ${name} (${e.type})${e.options ? ': ' + e.options.join(', ') : ''}`);
      }
      return;
    }
    const jobs = await fetchExistingJobs();
    if (opts.out) {
      const outPath = path.resolve(opts.out);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(jobs, null, 2), 'utf8');
      log(`[Notion] ${jobs.length}개 공고를 ${opts.out} 에 저장했습니다.`);
      return;
    }
    log(`[Notion] 총 ${jobs.length}개의 기존 공고를 불러왔습니다.`);
    jobs.forEach((j, i) => {
      log(`${i + 1}. [${j.company}] ${j.position} (${j.status}) - ${j.url}`);
    });
  })().catch(err => {
    error('[Notion] 기존 공고 조회 실패:', err);
    process.exit(1);
  });
}

module.exports = { fetchExistingJobs, fetchSchema };
