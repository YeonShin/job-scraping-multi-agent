const https = require('https');
const fs = require('fs');
const path = require('path');
require('./loadEnv');
const { log, error } = require('./logger');

const MAX_TEXT = 2000;
const MAX_CHILDREN = 100;
const MAX_RETRY_429 = 3;

// ---------------------------------------------------------------------------
// Notion HTTP (테스트에서 교체 가능)
// ---------------------------------------------------------------------------
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function defaultRequester(method, apiPath, payload, attempt = 0) {
  const apiKey = process.env.NOTION_API_KEY;
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.notion.com',
      path: apiPath,
      method,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', async () => {
        try {
          if (res.statusCode === 429 && attempt < MAX_RETRY_429) {
            const wait = (parseFloat(res.headers['retry-after']) || 1) * 1000;
            await sleep(wait);
            return resolve(defaultRequester(method, apiPath, payload, attempt + 1));
          }
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
    req.write(bodyStr);
    req.end();
  });
}

let requester = defaultRequester;
function setRequester(fn) {
  requester = fn || defaultRequester;
}

// ---------------------------------------------------------------------------
// 유틸
// ---------------------------------------------------------------------------
function truncate(value, max = MAX_TEXT) {
  return String(value == null ? '' : value).slice(0, max);
}

function richText(value) {
  return [{ text: { content: truncate(value) } }];
}

function kstDateString(nowMs = Date.now()) {
  return new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
}

/**
 * 날짜 문자열을 YYYY-MM-DD 로 정규화.
 * 'MM.DD' 형식은 현재 연도를 붙였을 때 오늘(KST)보다 과거면 다음 연도로 계산한다(opts.rollForward=false 로 끌 수 있음).
 */
function normalizeDate(raw, opts = {}) {
  if (!raw || typeof raw !== 'string') return null;
  const nowMs = opts.now !== undefined ? opts.now : Date.now();
  const rollForward = opts.rollForward !== false;
  const str = raw.trim();

  // YYYY-MM-DD 또는 YYYY.MM.DD 또는 YYYY/MM/DD
  const isoMatch = str.match(/(\d{4})[-\.\/](\d{1,2})[-\.\/](\d{1,2})/);
  if (isoMatch) {
    const y = isoMatch[1];
    const m = isoMatch[2].padStart(2, '0');
    const d = isoMatch[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // ~MM.DD 또는 MM/DD
  const mdMatch = str.match(/(\d{1,2})[\.\/](\d{1,2})/);
  if (mdMatch) {
    const today = kstDateString(nowMs);
    let year = parseInt(today.slice(0, 4), 10);
    const m = mdMatch[1].padStart(2, '0');
    const d = mdMatch[2].padStart(2, '0');
    if (rollForward && `${year}-${m}-${d}` < today) year += 1;
    return `${year}-${m}-${d}`;
  }

  // D-Day 형식 (D-5, D-12 등)
  const ddayMatch = str.match(/D[-–](\d+)/i);
  if (ddayMatch) {
    const days = parseInt(ddayMatch[1], 10);
    return kstDateString(nowMs + days * 24 * 60 * 60 * 1000);
  }

  return null;
}

function bulletBlocks(items) {
  return items.map(item => ({
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: richText(item) }
  }));
}

function heading(text) {
  return { object: 'block', type: 'heading_2', heading_2: { rich_text: richText(text) } };
}

const divider = () => ({ object: 'block', type: 'divider', divider: {} });

/**
 * 본문 블록 생성
 */
function buildChildren(job) {
  const children = [];

  if (job.summary) {
    // 본문에 이미 붙어 있는 '💡' 접두를 정리 (아이콘이 💡 이므로 중복 방지)
    const cleaned = String(job.summary).replace(/^[ \t]*💡[ \t]*/gm, '');
    children.push({
      object: 'block',
      type: 'callout',
      callout: {
        rich_text: richText(`[AI 핵심 3줄 요약]\n${cleaned}`),
        icon: { emoji: '💡' },
        color: 'blue_background'
      }
    });
  }

  const sections = [
    ['📌 주요 업무 (Responsibilities)', job.mainTasks, true],
    ['✅ 지원 자격 (Qualifications)', job.requirements, true],
    ['🌟 우대 사항 (Preferred Points)', job.preferredPoints, true],
    ['🎁 복리후생 & 개발 문화', job.benefits, false]
  ];
  for (const [title, items, withDivider] of sections) {
    if (items && items.length) {
      children.push(heading(title));
      children.push(...bulletBlocks(items));
      if (withDivider) children.push(divider());
    }
  }
  return children;
}

/**
 * 노션 페이지 속성 + 본문(children) payload 생성 (API 호출 없음)
 */
function buildPayload(job, dbId) {
  const properties = {
    '기업명': { title: richText(job.company || '기업명 미상') },
    '채용직무': { rich_text: richText(job.position || '') },
    '채용링크': { url: job.url },
    '상태': { status: { name: '미지원' } },
    'AI 수집': { checkbox: true },
    'created_at': { date: { start: kstDateString() } }
  };

  if (job.jobKey) properties['공고키'] = { rich_text: richText(job.jobKey) };
  if (job.jobCategory) properties['직무분류'] = { select: { name: job.jobCategory } };
  if (job.experienceLevel) properties['경력조건'] = { select: { name: job.experienceLevel } };
  if (job.employmentType) properties['고용형태'] = { select: { name: job.employmentType } };
  if (job.industry) properties['산업군'] = { select: { name: job.industry } };
  if (job.industryDetail) properties['산업군 (상세)'] = { rich_text: richText(job.industryDetail) };
  if (job.companyScale) properties['회사규모'] = { select: { name: job.companyScale } };
  if (job.location) properties['근무지'] = { rich_text: richText(job.location) };

  const deadline = normalizeDate(job.deadline);
  if (deadline) properties['마감일'] = { date: { start: deadline } };

  const posted = normalizeDate(job.postedDate, { rollForward: false });
  if (posted) properties['공고 등록일'] = { date: { start: posted } };

  if (job.documents && job.documents.length) {
    properties['제출 서류'] = { multi_select: job.documents.map(d => ({ name: d })) };
  }

  ['1차', '2차', '3차', '4차', '5차', '6차'].forEach(round => {
    if (job[round]) properties[round] = { select: { name: job[round] } };
  });

  const allChildren = buildChildren(job);
  const first = allChildren.slice(0, MAX_CHILDREN);
  const rest = splitChildren(allChildren.slice(MAX_CHILDREN));

  return {
    payload: {
      parent: { database_id: dbId },
      icon: { type: 'emoji', emoji: '🏢' },
      properties,
      children: first
    },
    restChunks: rest
  };
}

/** 100개 단위로 분할 */
function splitChildren(blocks, size = MAX_CHILDREN) {
  const chunks = [];
  for (let i = 0; i < blocks.length; i += size) chunks.push(blocks.slice(i, i + size));
  return chunks;
}

async function publishJob(job) {
  const dbId = process.env.NOTION_DATABASE_ID;
  if (!dbId) throw new Error('NOTION_DATABASE_ID가 설정되지 않았습니다.');

  const { payload, restChunks } = buildPayload(job, dbId);
  const result = await requester('POST', '/v1/pages', payload);

  for (const chunk of restChunks) {
    await requester('PATCH', `/v1/blocks/${result.id}/children`, { children: chunk });
  }

  log(`[Notion Publish] ✅ [${job.company}] ${job.position} ➔ ${result.url}`);
  return { ...result, pageId: result.id, notionUrl: result.url };
}

// ---------------------------------------------------------------------------
// CLI: node tools/notionJobPublisher.js <input.json> [--out <result.json>]
// exit: 0 전부 성공 / 2 일부 실패 / 1 전체 실패 또는 입력 오류
// ---------------------------------------------------------------------------
function parseCliArgs(argv) {
  const opts = { input: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') opts.out = argv[++i];
    else if (!opts.input) opts.input = argv[i];
  }
  return opts;
}

function extractJobs(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.jobs)) return raw.jobs;
  if (raw) return [raw];
  return [];
}

async function runCli(argv) {
  const opts = parseCliArgs(argv);
  if (!opts.input || !fs.existsSync(opts.input)) {
    console.log('사용법: node tools/notionJobPublisher.js <input.json> [--out <result.json>]');
    return 1;
  }

  let jobs;
  try {
    jobs = extractJobs(JSON.parse(fs.readFileSync(opts.input, 'utf8')));
  } catch (e) {
    error('입력 JSON 파싱 실패:', e);
    return 1;
  }

  const published = [];
  const failed = [];
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i];
    try {
      log(`[${i + 1}/${jobs.length}] 노션 등록 중: [${j.company}] ${j.position}`);
      const r = await publishJob(j);
      published.push({
        jobKey: j.jobKey || null,
        company: j.company,
        position: j.position,
        url: j.url,
        pageId: r.pageId,
        notionUrl: r.notionUrl
      });
    } catch (e) {
      error(`[${i + 1}/${jobs.length}] 등록 실패: [${j.company}]`, e);
      failed.push({ jobKey: j.jobKey || null, company: j.company, position: j.position, error: e.message });
    }
  }
  log(`[CLI] 등록 완료: 총 ${published.length}건 성공 / ${failed.length}건 실패`);

  if (opts.out) {
    fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
    fs.writeFileSync(opts.out, JSON.stringify({ published, failed }, null, 2), 'utf8');
  }

  if (failed.length === 0) return 0;
  return published.length === 0 ? 1 : 2;
}

if (require.main === module) {
  runCli(process.argv.slice(2))
    .then(code => process.exit(code))
    .catch(err => {
      error('CLI 실행 에러:', err);
      process.exit(1);
    });
}

module.exports = { publishJob, buildPayload, buildChildren, splitChildren, normalizeDate, truncate, setRequester, runCli };
