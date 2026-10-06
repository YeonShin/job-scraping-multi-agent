const fs = require('fs');
const path = require('path');
const registry = require('./registry');
const { companyKey, titleKey } = require('./jobKeys');
const { log, error: logError } = require('./logger');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const CONFIG_PATH = path.resolve(__dirname, '..', 'config', 'pipeline.json');
const LEASE_DURATION_MS = 30 * 60 * 1000; // 30분

// 허용 enum 목록 (pipeline-spec.md 섹션 5 기준)
const ALLOWED_JOB_CATEGORIES = new Set([
  '프론트엔드', '풀스택', '웹개발', '소프트웨어', '시스템엔지니어', 'SW개발', '백엔드', '앱개발'
]);
const ALLOWED_EXPERIENCE_LEVELS = new Set([
  '신입', '경력무관', '신입/경력'
]);
const ALLOWED_EMPLOYMENT_TYPES = new Set([
  '정규직', '계약직', '인턴', '전환형 인턴', '채용연계형 인턴', '체험형 인턴'
]);
const ALLOWED_COMPANY_SCALES = new Set([
  '스타트업', '중소기업', '중견기업', '대기업', '공기업', '외국계기업', '대기업계열사', '벤처기업'
]);
const ALLOWED_INDUSTRIES = new Set([
  'IT/소프트웨어', '핀테크', '커머스', '이커머스', '게임', 'B2B / SaaS', '클라우드/인프라',
  'AI', '데이터 분석', '헬스케어', '블록체인', '모빌리티', '엔터테이먼트', '미디어/엔터테인먼트',
  'SNS', '에듀테크', '스마트팩토리', 'O2O/플랫폼', '금융권', '제조업', '제조·화학', '호텔/레저', '기타 서비스업'
]);
const ALLOWED_PROCESS_STAGES = new Set([
  '서류전형', '코딩테스트', '과제테스트', '직무면접', '컬쳐핏면접', '임직원면접', '최종합격',
  '임원면접', '인적성 검사', '사전과제', 'AI역량검사', '실무면접'
]);
const ALLOWED_REASON_CODES = new Set([
  'EXPERIENCE_REQUIRED', 'PUBLISHER_ONLY', 'BACKEND_ONLY_TRACK2', 'NOT_IT_ROLE',
  'COMPANY_SCALE_MISMATCH', 'CLOSED', 'DUPLICATE_CONFIRMED', 'OTHER'
]);

function getKstIsoString(date = new Date()) {
  const kstDate = new Date(date.getTime() + (9 * 60 - (-date.getTimezoneOffset())) * 60000);
  const pad = n => String(n).padStart(2, '0');
  const yyyy = kstDate.getFullYear();
  const mm = pad(kstDate.getMonth() + 1);
  const dd = pad(kstDate.getDate());
  const hh = pad(kstDate.getHours());
  const mi = pad(kstDate.getMinutes());
  const ss = pad(kstDate.getSeconds());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+09:00`;
}

function loadConfig(configPath) {
  const p = configPath ? path.resolve(configPath) : CONFIG_PATH;
  try {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (e) {}
  return { reviewBatchSize: 12 };
}

function normalizeDetailUrl(item) {
  const site = item.site || (item.jobKey ? item.jobKey.split(':')[0] : '');
  const idMatch = (item.detailUrl || item.url || '').match(/rec_idx=(\d+)/i) || (item.jobKey ? item.jobKey.match(/saramin:(\d+)/i) : null);
  if ((site === 'saramin' || (item.url && item.url.includes('saramin'))) && idMatch) {
    return `https://www.saramin.co.kr/zf_user/jobs/relay/view-detail?rec_idx=${idMatch[1]}`;
  }
  return item.detailUrl || item.url;
}

/**
 * 다음 배치 꺼내기 (next)
 */
function getNextBatch(options = {}) {
  const { runId, site, size, runsDir, configPath } = options;
  if (!runId) throw new Error('runId는 필수 매개변수입니다.');

  const config = loadConfig(configPath);
  const batchSize = parseInt(size, 10) || config.reviewBatchSize || 12;

  const baseRunsDir = runsDir ? path.resolve(runsDir) : path.resolve(DATA_DIR, 'runs');
  const runDir = path.resolve(baseRunsDir, runId);
  const queuePath = path.resolve(runDir, 'review_queue.json');
  const resultsPath = path.resolve(runDir, 'results.jsonl');
  const batchesDir = path.resolve(runDir, 'batches');

  fs.mkdirSync(batchesDir, { recursive: true });

  if (!fs.existsSync(queuePath)) {
    return { batchId: null, batchPath: null, count: 0, items: [] };
  }

  let queue = [];
  try {
    queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  } catch (e) {
    queue = [];
  }

  // 완료된 jobKey 수집
  const completedKeys = new Set();
  if (fs.existsSync(resultsPath)) {
    const lines = fs.readFileSync(resultsPath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const r = JSON.parse(line);
        if (r.jobKey) completedKeys.add(r.jobKey);
      } catch (e) {}
    }
  }

  const now = Date.now();
  const availableItems = [];

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    if (completedKeys.has(item.jobKey)) continue;

    // lease 만료 검사 (30분)
    if (item.leasedUntil && new Date(item.leasedUntil).getTime() > now) {
      continue;
    }

    if (site && item.site !== site) {
      continue;
    }

    availableItems.push({ index: i, item });
    if (availableItems.length >= batchSize) {
      break;
    }
  }

  if (availableItems.length === 0) {
    return { batchId: null, batchPath: null, count: 0, items: [] };
  }

  // 기존 배치 파일 개수 파악
  const existingBatches = fs.readdirSync(batchesDir).filter(f => f.startsWith('batch_') && f.endsWith('.json'));
  let maxBatchNum = 0;
  for (const b of existingBatches) {
    const m = b.match(/batch_(\d+)\.json/);
    if (m) maxBatchNum = Math.max(maxBatchNum, parseInt(m[1], 10));
  }
  const nextBatchNum = maxBatchNum + 1;
  const batchId = `batch_${nextBatchNum}`;
  const batchFilePath = path.resolve(batchesDir, `${batchId}.json`);

  const leasedAt = getKstIsoString();
  const leasedUntil = getKstIsoString(new Date(now + LEASE_DURATION_MS));

  const batchItems = [];
  for (const { index, item } of availableItems) {
    item.detailUrl = normalizeDetailUrl(item);
    item.leasedAt = leasedAt;
    item.leasedUntil = leasedUntil;
    item.batchId = nextBatchNum;
    batchItems.push(item);
    queue[index] = item;
  }

  // batch_{k}.json 저장
  fs.writeFileSync(batchFilePath, JSON.stringify(batchItems, null, 2), 'utf8');

  // review_queue.json 원자적 갱신
  const tmpQueue = `${queuePath}.tmp.${Date.now()}`;
  fs.writeFileSync(tmpQueue, JSON.stringify(queue, null, 2), 'utf8');
  fs.renameSync(tmpQueue, queuePath);

  return {
    batchId,
    batchPath: batchFilePath,
    count: batchItems.length,
    items: batchItems
  };
}

/**
 * 심사 결과 스키마 검증
 */
function validateReviewItem(item, queueKeyMap, completedKeys) {
  const errors = [];

  if (!item || typeof item !== 'object') {
    return ['항목이 객체 형태가 아닙니다.'];
  }

  // 1. jobKey
  if (!item.jobKey) {
    errors.push('jobKey가 누락되었습니다.');
  } else {
    if (!queueKeyMap.has(item.jobKey)) {
      errors.push(`jobKey(${item.jobKey})가 review_queue에 존재하지 않습니다.`);
    }
    if (completedKeys.has(item.jobKey)) {
      errors.push(`jobKey(${item.jobKey})는 이미 제출되었습니다(ALREADY_SUBMITTED).`);
    }
  }

  // 2. verdict
  if (!['pass', 'reject'].includes(item.verdict)) {
    errors.push(`verdict는 'pass' 또는 'reject'여야 합니다. (입력값: ${item.verdict})`);
  }

  // 3. reject 검증
  if (item.verdict === 'reject') {
    if (!item.reasonCode) {
      errors.push('reject 시 reasonCode는 필수입니다.');
    } else if (!ALLOWED_REASON_CODES.has(item.reasonCode)) {
      errors.push(`유효하지 않은 reasonCode입니다: ${item.reasonCode}`);
    }
    if (item.reasonCode === 'OTHER' && (!item.reason || !String(item.reason).trim())) {
      errors.push("reasonCode가 'OTHER'일 때는 reason 사유 텍스트가 필수입니다.");
    }
  }

  // 4. pass 검증
  if (item.verdict === 'pass') {
    const job = item.job;
    if (!job || typeof job !== 'object') {
      errors.push("pass 시 'job' 상세 객체는 필수입니다.");
      return errors;
    }

    // 필수 필드
    const requiredJobFields = ['company', 'position', 'url', 'jobCategory', 'experienceLevel', 'summary'];
    for (const f of requiredJobFields) {
      if (!job[f] || !String(job[f]).trim()) {
        errors.push(`job.${f} 필드는 필수입니다.`);
      }
    }

    // jobCategory
    if (job.jobCategory && !ALLOWED_JOB_CATEGORIES.has(job.jobCategory)) {
      errors.push(`jobCategory 옵션이 유효하지 않습니다: ${job.jobCategory}`);
    }

    // experienceLevel
    if (job.experienceLevel && !ALLOWED_EXPERIENCE_LEVELS.has(job.experienceLevel)) {
      errors.push(`experienceLevel 옵션이 유효하지 않습니다: ${job.experienceLevel}`);
    }

    // employmentType
    if (job.employmentType && !ALLOWED_EMPLOYMENT_TYPES.has(job.employmentType)) {
      errors.push(`employmentType 옵션이 유효하지 않습니다: ${job.employmentType}`);
    }

    // companyScale
    if (job.companyScale && !ALLOWED_COMPANY_SCALES.has(job.companyScale)) {
      errors.push(`companyScale 옵션이 유효하지 않습니다: ${job.companyScale}`);
    }

    // industry
    if (job.industry && !ALLOWED_INDUSTRIES.has(job.industry)) {
      errors.push(`industry 옵션이 유효하지 않습니다: ${job.industry}`);
    }

    // documents
    if (job.documents !== undefined && !Array.isArray(job.documents)) {
      errors.push('documents는 배열 형태여야 합니다.');
    }

    // 1차~6차 전형
    for (let i = 1; i <= 6; i++) {
      const stageKey = `${i}차`;
      const stageVal = job[stageKey];
      if (stageVal && !ALLOWED_PROCESS_STAGES.has(stageVal)) {
        errors.push(`${stageKey} 단계 값이 유효하지 않습니다: ${stageVal}`);
      }
    }

    // 날짜 포맷 (YYYY-MM-DD 또는 생략)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (job.deadline && !dateRegex.test(job.deadline)) {
      errors.push(`deadline 날짜 형식이 잘못되었습니다 (YYYY-MM-DD): ${job.deadline}`);
    }
    if (job.postedDate && !dateRegex.test(job.postedDate)) {
      errors.push(`postedDate 날짜 형식이 잘못되었습니다 (YYYY-MM-DD): ${job.postedDate}`);
    }

    // 문자열 길이 (2000자 이하)
    for (const [k, v] of Object.entries(job)) {
      if (typeof v === 'string' && v.length > 2000) {
        errors.push(`job.${k} 문자열 길이가 2000자를 초과합니다 (${v.length}자).`);
      }
    }

    // summary 3줄 형식 검증
    if (job.summary) {
      const summaryText = String(job.summary);
      const hasFit = summaryText.includes('[지원 적합도]');
      const hasCore = summaryText.includes('[핵심 업무]');
      const hasAppeal = summaryText.includes('[어필 포인트]');
      if (!hasFit || !hasCore || !hasAppeal) {
        errors.push("summary는 '• [지원 적합도]', '• [핵심 업무]', '• [어필 포인트]' 세 요소를 모두 포함해야 합니다.");
      }
    }
  }

  return errors;
}

/**
 * 심사 결과 제출 (submit)
 */
function submitReview(options = {}) {
  const { runId, inputPath, runsDir, registryPath } = options;
  if (!runId || !inputPath) {
    throw new Error('runId와 inputPath는 필수 매개변수입니다.');
  }

  const baseRunsDir = runsDir ? path.resolve(runsDir) : path.resolve(DATA_DIR, 'runs');
  const runDir = path.resolve(baseRunsDir, runId);
  const queuePath = path.resolve(runDir, 'review_queue.json');
  const resultsPath = path.resolve(runDir, 'results.jsonl');

  if (!fs.existsSync(inputPath)) {
    throw new Error(`입력 파일을 찾을 수 없습니다: ${inputPath}`);
  }

  const inputRaw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const inputItems = Array.isArray(inputRaw) ? inputRaw : [inputRaw];

  const queueKeyMap = new Map();
  if (fs.existsSync(queuePath)) {
    try {
      const q = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
      for (const item of q) {
        if (item.jobKey) queueKeyMap.set(item.jobKey, item);
      }
    } catch (e) {}
  }

  const completedKeys = new Set();
  if (fs.existsSync(resultsPath)) {
    const lines = fs.readFileSync(resultsPath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const r = JSON.parse(line);
        if (r.jobKey) completedKeys.add(r.jobKey);
      } catch (e) {}
    }
  }

  const passedRecords = [];
  const failedItems = [];

  for (const item of inputItems) {
    const errors = validateReviewItem(item, queueKeyMap, completedKeys);
    if (errors.length > 0) {
      failedItems.push({ jobKey: item ? item.jobKey : null, errors });
    } else {
      const qItem = queueKeyMap.get(item.jobKey) || {};
      const fullRecord = {
        site: item.site || qItem.site || (item.jobKey.includes(':') ? item.jobKey.split(':')[0] : 'unknown'),
        track: item.track || qItem.track || 'default',
        ...item
      };
      passedRecords.push(fullRecord);
      completedKeys.add(item.jobKey); // 같은 파일 내 중복 제출 방지
    }
  }

  // 통과한 항목 results.jsonl 에 즉시 추가 & 레지스트리 갱신
  if (passedRecords.length > 0) {
    const linesToAppend = passedRecords.map(r => JSON.stringify(r)).join('\n') + '\n';
    fs.appendFileSync(resultsPath, linesToAppend, 'utf8');

    // 레지스트리 갱신
    const regData = registry.load(registryPath);
    for (const record of passedRecords) {
      const queueItem = queueKeyMap.get(record.jobKey) || {};
      const site = record.site || queueItem.site || (record.jobKey.includes(':') ? record.jobKey.split(':')[0] : 'unknown');
      const track = record.track || queueItem.track || 'default';

      if (record.verdict === 'pass') {
        const job = record.job || {};
        registry.upsert(record.jobKey, {
          verdict: 'passed',
          site,
          track,
          company: job.company || queueItem.company,
          companyKey: companyKey(job.company || queueItem.company),
          rawTitle: job.rawTitle || queueItem.title,
          titleKey: titleKey(job.position || queueItem.title),
          position: job.position,
          runId,
          updatedAt: getKstIsoString()
        }, registryPath);
      } else if (record.verdict === 'reject') {
        registry.upsert(record.jobKey, {
          verdict: 'rejected',
          site,
          track,
          company: queueItem.company || '',
          companyKey: companyKey(queueItem.company || ''),
          rawTitle: queueItem.title || '',
          titleKey: titleKey(queueItem.title || ''),
          position: queueItem.title || '',
          reasonCode: record.reasonCode,
          reason: record.reason || null,
          runId,
          updatedAt: getKstIsoString()
        }, registryPath);
      }
    }
    registry.save(registryPath);
  }

  return {
    successCount: passedRecords.length,
    failedItems
  };
}

/**
 * 큐 상태 현황 조회 (status)
 */
function getQueueStatus(options = {}) {
  const { runId, runsDir } = options;
  if (!runId) throw new Error('runId는 필수 매개변수입니다.');

  const baseRunsDir = runsDir ? path.resolve(runsDir) : path.resolve(DATA_DIR, 'runs');
  const runDir = path.resolve(baseRunsDir, runId);
  const queuePath = path.resolve(runDir, 'review_queue.json');
  const resultsPath = path.resolve(runDir, 'results.jsonl');

  let queue = [];
  if (fs.existsSync(queuePath)) {
    try {
      queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
    } catch (e) {}
  }

  const completedKeys = new Set();
  if (fs.existsSync(resultsPath)) {
    const lines = fs.readFileSync(resultsPath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const r = JSON.parse(line);
        if (r.jobKey) completedKeys.add(r.jobKey);
      } catch (e) {}
    }
  }

  const now = Date.now();
  let completed = 0;
  let leased = 0;
  let waiting = 0;

  for (const item of queue) {
    if (completedKeys.has(item.jobKey)) {
      completed++;
    } else if (item.leasedUntil && new Date(item.leasedUntil).getTime() > now) {
      leased++;
    } else {
      waiting++;
    }
  }

  return {
    runId,
    total: queue.length,
    waiting,
    leased,
    completed
  };
}

// CLI 지원
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  const opts = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--run') opts.runId = args[++i];
    else if (args[i] === '--site') opts.site = args[++i];
    else if (args[i] === '--size') opts.size = parseInt(args[++i], 10);
    else if (args[i] === '--input') opts.inputPath = args[++i];
  }

  if (command === 'next') {
    try {
      const res = getNextBatch(opts);
      console.error(`[reviewQueue] next: 배치 ${res.batchId || '없음'} (${res.count}건 할당)`);
      console.log(JSON.stringify(res, null, 2));
    } catch (err) {
      console.error('[reviewQueue] next 에러:', err.message);
      process.exit(1);
    }
  } else if (command === 'submit') {
    try {
      const res = submitReview(opts);
      console.error(`[reviewQueue] submit: ${res.successCount}건 기록 완료, ${res.failedItems.length}건 실패`);
      if (res.failedItems.length > 0) {
        console.error('--- 실패 항목 상세 ---');
        for (const f of res.failedItems) {
          console.error(`[${f.jobKey || '알수없음'}]: ${f.errors.join(' / ')}`);
        }
        process.exit(1);
      }
      console.log(JSON.stringify({ success: true, count: res.successCount }));
    } catch (err) {
      console.error('[reviewQueue] submit 에러:', err.message);
      process.exit(1);
    }
  } else if (command === 'status') {
    try {
      const res = getQueueStatus(opts);
      console.error(`[reviewQueue] status: 대기 ${res.waiting}건, 점유 ${res.leased}건, 완료 ${res.completed}건 (전체 ${res.total}건)`);
      console.log(JSON.stringify(res, null, 2));
    } catch (err) {
      console.error('[reviewQueue] status 에러:', err.message);
      process.exit(1);
    }
  } else {
    console.error('사용법: node tools/reviewQueue.js <next|submit|status> --run <runId> [...]');
    process.exit(1);
  }
}

module.exports = {
  getNextBatch,
  submitReview,
  getQueueStatus,
  validateReviewItem,
  normalizeDetailUrl
};
