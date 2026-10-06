const fs = require('fs');
const path = require('path');
const registry = require('./registry');
const { companyKey, titleKey, normalizeUrl } = require('./jobKeys');
const { publishJob } = require('./notionJobPublisher');
const { fetchExistingJobs } = require('./notionJobFetcher');
const { log, error: logError } = require('./logger');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DEFAULT_RETRY_PATH = path.resolve(DATA_DIR, 'retry.jsonl');
const DEFAULT_CACHE_PATH = path.resolve(DATA_DIR, 'cache', 'notion_jobs.json');

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 1. 등록 대상 수집
 * (a) 이번 runId 의 results.jsonl 중 pass 항목
 * (b) data/retry.jsonl 의 재시도 대상 항목
 * (c) data/registry.json 에서 verdict 가 'passed' 인 이전 runId 항목 (해당 oldRunId 의 results.jsonl 에서 job 데이터 로드)
 */
function collectCandidates(runId, baseRunsDir, retryPath, registryPath) {
  const candidates = [];
  const seenJobKeys = new Set();

  // (a) 이번 runId 의 results.jsonl
  const currentResultsPath = path.resolve(baseRunsDir, runId, 'results.jsonl');
  if (fs.existsSync(currentResultsPath)) {
    const lines = fs.readFileSync(currentResultsPath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        if (item.verdict === 'pass' && item.job && item.jobKey) {
          if (!seenJobKeys.has(item.jobKey)) {
            seenJobKeys.add(item.jobKey);
            candidates.push({
              jobKey: item.jobKey,
              site: item.site || (item.jobKey.includes(':') ? item.jobKey.split(':')[0] : 'unknown'),
              track: item.track || 'default',
              job: item.job,
              origin: 'current',
              runId
            });
          }
        }
      } catch (e) {}
    }
  }

  // (b) data/retry.jsonl
  const actualRetryPath = retryPath ? path.resolve(retryPath) : DEFAULT_RETRY_PATH;
  if (fs.existsSync(actualRetryPath)) {
    const lines = fs.readFileSync(actualRetryPath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        if (item.jobKey && item.job) {
          if (!seenJobKeys.has(item.jobKey)) {
            seenJobKeys.add(item.jobKey);
            candidates.push({
              jobKey: item.jobKey,
              site: item.site || (item.jobKey.includes(':') ? item.jobKey.split(':')[0] : 'unknown'),
              track: item.track || 'default',
              job: item.job,
              origin: 'retry',
              runId: item.runId || runId
            });
          }
        }
      } catch (e) {}
    }
  }

  // (c) 레지스트리에서 verdict 가 passed 인 이전 runId 항목
  const regData = registry.load(registryPath);
  for (const [key, val] of Object.entries(regData)) {
    if (val.verdict === 'passed' && val.runId && val.runId !== runId) {
      if (!seenJobKeys.has(key)) {
        // 해당 이전 runId 의 results.jsonl 에서 job 데이터 로드
        const oldResultsPath = path.resolve(baseRunsDir, val.runId, 'results.jsonl');
        if (fs.existsSync(oldResultsPath)) {
          const lines = fs.readFileSync(oldResultsPath, 'utf8').split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              const item = JSON.parse(line);
              if (item.jobKey === key && item.job) {
                seenJobKeys.add(key);
                candidates.push({
                  jobKey: key,
                  site: val.site || item.site || key.split(':')[0],
                  track: val.track || item.track || 'default',
                  job: item.job,
                  origin: 'previous_passed',
                  runId: val.runId
                });
                break;
              }
            } catch (e) {}
          }
        }
      }
    }
  }

  return candidates;
}

/**
 * 2. 노션 캐시 로드 또는 최신 재조회
 */
async function getLatestNotionCache(cachePath, dryRun = false, customFetcher = null) {
  const actualCachePath = cachePath ? path.resolve(cachePath) : DEFAULT_CACHE_PATH;

  if (customFetcher) {
    return await customFetcher();
  }

  // 커스텀 cachePath 가 전달되었고 파일이 이미 존재하는 경우 (테스트 환경 격리)
  if (cachePath && fs.existsSync(actualCachePath)) {
    try {
      return JSON.parse(fs.readFileSync(actualCachePath, 'utf8'));
    } catch (e) {}
  }

  // dryRun 이거나 cache 파일이 이미 있는 경우
  if (dryRun && fs.existsSync(actualCachePath)) {
    try {
      return JSON.parse(fs.readFileSync(actualCachePath, 'utf8'));
    } catch (e) {}
  }

  try {
    log('[publishRun] 노션 캐시 최신 재조회 시작...');
    const jobs = await fetchExistingJobs();
    fs.mkdirSync(path.dirname(actualCachePath), { recursive: true });
    fs.writeFileSync(actualCachePath, JSON.stringify(jobs, null, 2), 'utf8');
    log(`[publishRun] 노션 캐시 최신 재조회 완료 (총 ${jobs.length}건)`);
    return jobs;
  } catch (err) {
    logError('[publishRun] 노션 캐시 실시간 재조회 실패, 기존 캐시 파일 로드 시도:', err.message);
    if (fs.existsSync(actualCachePath)) {
      try {
        return JSON.parse(fs.readFileSync(actualCachePath, 'utf8'));
      } catch (e) {}
    }
    return [];
  }
}

/**
 * 3. 교차 중복 제거 및 재오픈 판정
 */
function deduplicateAndFilter(candidates, notionCache, registryPath) {
  const toPublish = [];
  const duplicateRejects = [];
  const existingJobKeys = new Set();
  const existingCompanyTitleKeys = new Set();

  for (const c of candidates) {
    const job = c.job || {};
    const jKey = c.jobKey;
    const cKey = companyKey(job.company || '');
    const tKey = titleKey(job.position || job.rawTitle || '');
    const nUrl = normalizeUrl(job.url || '');
    const compTitleKey = (cKey && tKey) ? `${cKey}___${tKey}` : null;

    let isDuplicate = false;
    let dupReason = '';

    // (1) 이번 등록 후보군 내부 교차 중복 검사 (먼저 들어온 1건만 유지)
    if (existingJobKeys.has(jKey)) {
      isDuplicate = true;
      dupReason = '동일 jobKey 교차 중복';
    } else if (compTitleKey && existingCompanyTitleKeys.has(compTitleKey)) {
      isDuplicate = true;
      dupReason = '동일 실행 내 교차 중복 감지 (선제출 공고 우선 등록)';
    }

    if (isDuplicate) {
      duplicateRejects.push({
        candidate: c,
        reason: dupReason
      });
      continue;
    }

    // (2) 최신 노션 캐시 대조
    const matchNotion = notionCache.find(n => {
      if (jKey && n.jobKey && n.jobKey === jKey) return true;
      if (nUrl && n.normalizedUrl && n.normalizedUrl === nUrl) return true;
      if (cKey && tKey && (n.companyKey || companyKey(n.company)) === cKey && (n.titleKey || titleKey(n.position)) === tKey) return true;
      return false;
    });

    if (matchNotion) {
      if (matchNotion.status === '마감') {
        // 재오픈 판정!
        c.isReopen = true;
        toPublish.push(c);
        existingJobKeys.add(jKey);
        if (compTitleKey) existingCompanyTitleKeys.add(compTitleKey);
      } else {
        // 이미 등록된 유효 공고 -> 스킵
        duplicateRejects.push({
          candidate: c,
          reason: '노션 DB 기존 등록 공고 중복'
        });
      }
    } else {
      // 신규 등록 대상
      toPublish.push(c);
      existingJobKeys.add(jKey);
      if (compTitleKey) existingCompanyTitleKeys.add(compTitleKey);
    }
  }

  // 탈락 처리된 교차 중복 항목들 레지스트리 갱신
  if (duplicateRejects.length > 0) {
    const regData = registry.load(registryPath);
    for (const { candidate, reason } of duplicateRejects) {
      registry.upsert(candidate.jobKey, {
        verdict: 'rejected',
        site: candidate.site,
        track: candidate.track,
        company: candidate.job.company,
        companyKey: companyKey(candidate.job.company),
        rawTitle: candidate.job.rawTitle || candidate.job.position,
        titleKey: titleKey(candidate.job.position || candidate.job.rawTitle),
        position: candidate.job.position,
        reasonCode: 'DUPLICATE_CONFIRMED',
        reason,
        runId: candidate.runId,
        updatedAt: getKstIsoString()
      }, registryPath);
    }
    registry.save(registryPath);
  }

  return { toPublish, duplicateRejects };
}

/**
 * 4. summary.json 집계 및 생성
 */
function generateSummary(runId, baseRunsDir, publishStats, trackPublishCounts) {
  const runDir = path.resolve(baseRunsDir, runId);
  const resultsPath = path.resolve(runDir, 'results.jsonl');

  // review_queue.json 참조 맵 (site/track 보강용)
  const queuePath = path.resolve(runDir, 'review_queue.json');
  const queueMap = {};
  if (fs.existsSync(queuePath)) {
    try {
      const qList = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
      for (const q of qList) {
        if (q.jobKey) queueMap[q.jobKey] = q;
      }
    } catch (e) {}
  }

  // results.jsonl 분석
  const trackResults = {};
  if (fs.existsSync(resultsPath)) {
    const lines = fs.readFileSync(resultsPath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        const qItem = queueMap[item.jobKey] || {};
        const site = item.site || qItem.site || (item.jobKey && item.jobKey.includes(':') ? item.jobKey.split(':')[0] : 'unknown');
        const track = item.track || qItem.track || 'default';
        const tKey = `${site}_${track}`;
        if (!trackResults[tKey]) {
          trackResults[tKey] = {
            reviewed: 0,
            passed: 0,
            rejected: 0,
            reasons: {}
          };
        }
        trackResults[tKey].reviewed++;
        if (item.verdict === 'pass') {
          trackResults[tKey].passed++;
        } else if (item.verdict === 'reject') {
          trackResults[tKey].rejected++;
          const code = item.reasonCode || 'OTHER';
          trackResults[tKey].reasons[code] = (trackResults[tKey].reasons[code] || 0) + 1;
        }
      } catch (e) {}
    }
  }

  // 트랙별 디렉터리 확인
  const subDirs = fs.existsSync(runDir) ? fs.readdirSync(runDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.includes('_'))
    .map(d => d.name) : [];

  const tracks = {};
  const total = {
    listed: 0,
    coveredSkipped: 0,
    dupSkipped: 0,
    suspected: 0,
    queued: 0,
    reviewed: 0,
    passed: 0,
    rejected: 0,
    published: 0,
    reopened: 0,
    failed: 0
  };

  const allTrackNames = new Set([
    ...subDirs,
    ...Object.keys(trackResults),
    ...Object.keys(trackPublishCounts)
  ]);

  for (const tName of allTrackNames) {
    const trackDir = path.resolve(runDir, tName);
    const statePath = path.resolve(trackDir, 'state.json');

    let counters = { listed: 0, coveredSkipped: 0, dupSkipped: 0, suspected: 0, queued: 0 };
    let stopReason = null;

    if (fs.existsSync(statePath)) {
      try {
        const st = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        if (st.counters) counters = st.counters;
        stopReason = st.stopReason || null;
      } catch (e) {}
    }

    const res = trackResults[tName] || { reviewed: 0, passed: 0, rejected: 0, reasons: {} };

    // 탈락 사유 상위 3개 정렬
    const rejectTopReasons = Object.entries(res.reasons)
      .map(([reasonCode, count]) => ({ reasonCode, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    const pub = trackPublishCounts[tName] || { published: 0, reopened: 0, failed: 0 };

    tracks[tName] = {
      listed: counters.listed || 0,
      coveredSkipped: counters.coveredSkipped || 0,
      dupSkipped: counters.dupSkipped || 0,
      suspected: counters.suspected || 0,
      queued: counters.queued || 0,
      reviewed: res.reviewed,
      passed: res.passed,
      rejected: res.rejected,
      rejectTopReasons,
      published: pub.published,
      reopened: pub.reopened,
      failed: pub.failed,
      stopReason
    };

    total.listed += (counters.listed || 0);
    total.coveredSkipped += (counters.coveredSkipped || 0);
    total.dupSkipped += (counters.dupSkipped || 0);
    total.suspected += (counters.suspected || 0);
    total.queued += (counters.queued || 0);
    total.reviewed += res.reviewed;
    total.passed += res.passed;
    total.rejected += res.rejected;
    total.published += pub.published;
    total.reopened += pub.reopened;
    total.failed += pub.failed;
  }

  // summary 객체
  return {
    runId,
    tracks,
    total
  };
}

/**
 * publishRun 메인 함수
 */
async function runPublish(options = {}) {
  const { runId, dryRun = false, runsDir, retryPath, cachePath, registryPath, customPublisher, customFetcher, sleepMs = 350 } = options;
  if (!runId) throw new Error('runId는 필수 매개변수입니다.');

  const baseRunsDir = runsDir ? path.resolve(runsDir) : path.resolve(DATA_DIR, 'runs');
  const runDir = path.resolve(baseRunsDir, runId);
  fs.mkdirSync(runDir, { recursive: true });

  const publisherFn = customPublisher || publishJob;
  const actualRetryPath = retryPath ? path.resolve(retryPath) : DEFAULT_RETRY_PATH;

  log(`[publishRun] 실행 시작 (runId: ${runId}, dryRun: ${dryRun})`);

  // 1. 등록 대상 수집
  const candidates = collectCandidates(runId, baseRunsDir, retryPath, registryPath);
  log(`[publishRun] 등록 후보 수집 완료: 총 ${candidates.length}건`);

  // 2. 노션 캐시 재조회
  const notionCache = await getLatestNotionCache(cachePath, dryRun, customFetcher);

  // 3. 교차 중복 제거 및 재오픈 판정
  const { toPublish, duplicateRejects } = deduplicateAndFilter(candidates, notionCache, registryPath);
  log(`[publishRun] 중복 제거 완료: 등록 대상 ${toPublish.length}건, 제외 ${duplicateRejects.length}건`);

  const trackPublishCounts = {};
  const initTrackCount = (key) => {
    if (!trackPublishCounts[key]) {
      trackPublishCounts[key] = { published: 0, reopened: 0, failed: 0 };
    }
  };

  // dryRun 처리
  if (dryRun) {
    log(`[publishRun] [DRY-RUN] 노션 API를 호출하지 않고 결과 미리보기를 생성합니다.`);
    for (const item of toPublish) {
      const tKey = `${item.site}_${item.track}`;
      initTrackCount(tKey);
      trackPublishCounts[tKey].published++;
      if (item.isReopen) trackPublishCounts[tKey].reopened++;
    }

    const summary = generateSummary(runId, baseRunsDir, { published: toPublish.length, reopened: 0, failed: 0 }, trackPublishCounts);
    console.log('\n--- [DRY-RUN] 등록 예정 목록 (' + toPublish.length + '건) ---');
    for (const item of toPublish) {
      console.log(`• [${item.site}_${item.track}] ${item.job.company} - ${item.job.position} (${item.jobKey})${item.isReopen ? ' [재오픈]' : ''}`);
    }
    console.log('\n--- [DRY-RUN] summary.json 미리보기 ---');
    console.log(JSON.stringify(summary, null, 2));

    return {
      runId,
      published: toPublish.length,
      reopened: toPublish.filter(t => t.isReopen).length,
      failed: 0,
      skippedDup: duplicateRejects.length,
      dryRun: true,
      summary
    };
  }

  // 4. 노션 DB 순차 등록 (350ms 대기)
  let publishedCount = 0;
  let reopenedCount = 0;
  let failedCount = 0;
  const successfulKeys = new Set();
  const failedItems = [];

  for (let i = 0; i < toPublish.length; i++) {
    const item = toPublish[i];
    const tKey = `${item.site}_${item.track}`;
    initTrackCount(tKey);

    try {
      log(`[publishRun] [${i + 1}/${toPublish.length}] 노션 발행 시도: ${item.job.company} - ${item.job.position} (${item.jobKey})`);
      const pubRes = await publisherFn(item.job);
      publishedCount++;
      trackPublishCounts[tKey].published++;
      if (item.isReopen) {
        reopenedCount++;
        trackPublishCounts[tKey].reopened++;
      }
      successfulKeys.add(item.jobKey);

      // 레지스트리 published 갱신
      registry.upsert(item.jobKey, {
        verdict: 'published',
        site: item.site,
        track: item.track,
        company: item.job.company,
        companyKey: companyKey(item.job.company),
        rawTitle: item.job.rawTitle || item.job.position,
        titleKey: titleKey(item.job.position || item.job.rawTitle),
        position: item.job.position,
        notionPageId: pubRes ? pubRes.pageId : null,
        runId,
        updatedAt: getKstIsoString()
      }, registryPath);
    } catch (err) {
      logError(`[publishRun] ❌ 등록 실패 (${item.jobKey}):`, err.message);
      failedCount++;
      trackPublishCounts[tKey].failed++;

      // 레지스트리 failed 갱신
      registry.upsert(item.jobKey, {
        verdict: 'failed',
        site: item.site,
        track: item.track,
        company: item.job.company,
        companyKey: companyKey(item.job.company),
        rawTitle: item.job.rawTitle || item.job.position,
        titleKey: titleKey(item.job.position || item.job.rawTitle),
        position: item.job.position,
        reason: err.message,
        runId,
        updatedAt: getKstIsoString()
      }, registryPath);

      failedItems.push({
        jobKey: item.jobKey,
        site: item.site,
        track: item.track,
        runId,
        job: item.job,
        error: err.message,
        failedAt: getKstIsoString()
      });
    }

    // 호출 간 레이트 리밋 준수 대기
    if (i < toPublish.length - 1 && sleepMs > 0) {
      await sleep(sleepMs);
    }
  }

  // 레지스트리 영구 저장
  registry.save(registryPath);

  // retry.jsonl 갱신 (성공한 키는 제거, 신규 실패건 추가)
  let retryEntries = [];
  if (fs.existsSync(actualRetryPath)) {
    try {
      const lines = fs.readFileSync(actualRetryPath, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        const parsed = JSON.parse(line);
        if (parsed.jobKey && !successfulKeys.has(parsed.jobKey)) {
          retryEntries.push(parsed);
        }
      }
    } catch (e) {}
  }

  for (const f of failedItems) {
    retryEntries.push(f);
  }

  fs.mkdirSync(path.dirname(actualRetryPath), { recursive: true });
  const retryContent = retryEntries.map(e => JSON.stringify(e)).join('\n') + (retryEntries.length > 0 ? '\n' : '');
  fs.writeFileSync(actualRetryPath, retryContent, 'utf8');

  // 5. 산출물 파일 저장 (publish_result.json, summary.json)
  const publishResult = {
    runId,
    published: publishedCount,
    reopened: reopenedCount,
    failed: failedCount,
    skippedDup: duplicateRejects.length,
    publishedAt: getKstIsoString()
  };
  fs.writeFileSync(path.resolve(runDir, 'publish_result.json'), JSON.stringify(publishResult, null, 2), 'utf8');

  const summary = generateSummary(runId, baseRunsDir, publishResult, trackPublishCounts);
  fs.writeFileSync(path.resolve(runDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  log(`[publishRun] 완료: 성공 ${publishedCount}건 (재오픈 ${reopenedCount}건), 실패 ${failedCount}건, 중복제외 ${duplicateRejects.length}건`);

  return {
    ...publishResult,
    summary,
    exitCode: failedCount === 0 ? 0 : 2
  };
}

// CLI 지원
if (require.main === module) {
  const args = process.argv.slice(2);
  const opts = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--run') opts.runId = args[++i];
    else if (args[i] === '--dry-run') opts.dryRun = true;
    else if (args[i] === '--runsDir') opts.runsDir = args[++i];
    else if (args[i] === '--retry') opts.retryPath = args[++i];
    else if (args[i] === '--cache') opts.cachePath = args[++i];
    else if (args[i] === '--registry') opts.registryPath = args[++i];
  }

  if (!opts.runId) {
    console.error('사용법: node tools/publishRun.js --run <runId> [--dry-run]');
    process.exit(1);
  }

  runPublish(opts)
    .then(res => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.exitCode !== undefined ? res.exitCode : 0);
    })
    .catch(err => {
      logError('[publishRun] 치명적 실행 오류:', err);
      process.exit(1);
    });
}

module.exports = {
  runPublish,
  collectCandidates,
  deduplicateAndFilter,
  generateSummary
};
