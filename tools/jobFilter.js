const fs = require('fs');
const path = require('path');
const { extractJobKey, normalizeUrl, companyKey, titleKey, similarity } = require('./jobKeys');
const registry = require('./registry');
const { log, error: logError } = require('./logger');

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '..', 'config', 'pipeline.json');
const DEFAULT_NOTION_CACHE_PATH = path.resolve(__dirname, '..', 'data', 'cache', 'notion_jobs.json');

function loadConfig(configPath) {
  const p = configPath ? path.resolve(configPath) : DEFAULT_CONFIG_PATH;
  try {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (e) {
    // ignore
  }
  return { suspectSimilarity: 0.7 };
}

function loadNotionCache(cachePath) {
  const p = cachePath ? path.resolve(cachePath) : DEFAULT_NOTION_CACHE_PATH;
  try {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (e) {
    // ignore
  }
  return [];
}

function getDetailUrl(site, url, id) {
  if (site === 'saramin' || url.includes('saramin.co.kr')) {
    const m = url.match(/[?&]rec_idx=(\d+)/i) || (id ? [null, id] : null);
    if (m) {
      return `https://www.saramin.co.kr/zf_user/jobs/relay/view-detail?rec_idx=${m[1]}`;
    }
  }
  if (site === 'jobkorea' || url.includes('jobkorea.co.kr')) {
    const m = url.match(/\/GI_Read\/(\d+)/i) || (id ? [null, id] : null);
    if (m) {
      return `https://www.jobkorea.co.kr/Recruit/GI_Read/${m[1]}`;
    }
  }
  if (site === 'wanted' || url.includes('wanted.co.kr')) {
    const m = url.match(/\/wd\/(\d+)/i) || (id ? [null, id] : null);
    if (m) {
      return `https://www.wanted.co.kr/wd/${m[1]}`;
    }
  }
  return url;
}

/**
 * review_queue.json 원자적 저장 및 기존 큐와 jobKey 중복 방지 병합
 */
function appendToReviewQueue(queuePath, newEntries) {
  let existingQueue = [];
  try {
    if (fs.existsSync(queuePath)) {
      existingQueue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
    }
  } catch (e) {
    existingQueue = [];
  }

  const existingKeys = new Set(existingQueue.map(item => item.jobKey));
  const actuallyAddedKeys = [];

  for (const entry of newEntries) {
    if (!existingKeys.has(entry.jobKey)) {
      existingQueue.push(entry);
      existingKeys.add(entry.jobKey);
      actuallyAddedKeys.push(entry.jobKey);
    }
  }

  const dir = path.dirname(queuePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpPath = `${queuePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmpPath, JSON.stringify(existingQueue, null, 2), 'utf8');
  fs.renameSync(tmpPath, queuePath);

  return actuallyAddedKeys;
}

/**
 * 목록 항목들을 심사 전 단계에서 분류
 * @param {Array} items - [{ id, url, title, company, career }]
 * @param {Object} options - { site, track, runId, configPath, cachePath, registryPath, runsDir }
 */
function classify(items, options = {}) {
  const { site, track, runId, configPath, cachePath, registryPath, runsDir } = options;
  const config = loadConfig(configPath);
  const suspectThreshold = typeof config.suspectSimilarity === 'number' ? config.suspectSimilarity : 0.7;

  const regData = registry.load(registryPath);
  const notionJobs = loadNotionCache(cachePath);

  const baseRunsDir = runsDir ? path.resolve(runsDir) : path.resolve(__dirname, '..', 'data', 'runs');
  const queuePath = runId ? path.join(baseRunsDir, runId, 'review_queue.json') : null;

  let currentQueue = [];
  if (queuePath && fs.existsSync(queuePath)) {
    try {
      currentQueue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
    } catch (e) {
      currentQueue = [];
    }
  }

  const counts = {
    skipRegistry: 0,
    skipNotion: 0,
    skipDup: 0,
    reopen: 0,
    suspect: 0,
    new: 0
  };

  const queueCandidates = [];

  for (const item of items) {
    const jobKey = extractJobKey(item.url, site) || (site && item.id ? `${site}:${item.id}` : '');
    const normUrl = normalizeUrl(item.url);
    const compKey = companyKey(item.company);
    const tKey = titleKey(item.title);

    let verdict = null;
    let dupHint = null;

    // 1) 레지스트리 대조
    if (jobKey && regData[jobKey]) {
      verdict = 'SKIP_REGISTRY';
      counts.skipRegistry++;
    }

    // 2) 노션 캐시 대조 (jobKey 또는 normalizedUrl)
    if (!verdict) {
      const matchNotion = notionJobs.find(n => {
        if (jobKey && n.jobKey && n.jobKey === jobKey) return true;
        if (normUrl && n.normalizedUrl && n.normalizedUrl === normUrl) return true;
        return false;
      });

      if (matchNotion) {
        if (matchNotion.status === '마감') {
          verdict = 'REOPEN_CANDIDATE';
          counts.reopen++;
        } else {
          verdict = 'SKIP_NOTION';
          counts.skipNotion++;
        }
      }
    }

    // 3) companyKey 동일 & titleKey 완전 일치 대조
    if (!verdict && compKey && tKey) {
      // (a) 노션 캐시
      const exactNotion = notionJobs.find(n => (n.companyKey || companyKey(n.company)) === compKey && (n.titleKey || titleKey(n.position)) === tKey);
      if (exactNotion) {
        if (exactNotion.status === '마감') {
          verdict = 'REOPEN_CANDIDATE';
          counts.reopen++;
        } else {
          verdict = 'SKIP_DUP';
          counts.skipDup++;
        }
      }

      // (b) 레지스트리
      if (!verdict) {
        const exactReg = Object.values(regData).find(r => (r.companyKey || companyKey(r.company)) === compKey && (r.titleKey || titleKey(r.rawTitle || r.position)) === tKey);
        if (exactReg) {
          verdict = 'SKIP_DUP';
          counts.skipDup++;
        }
      }

      // (c) 이번 runId review_queue
      if (!verdict) {
        const exactQueue = currentQueue.find(q => companyKey(q.company) === compKey && titleKey(q.title) === tKey);
        if (exactQueue) {
          verdict = 'SKIP_DUP';
          counts.skipDup++;
        }
      }
    }

    // 4) companyKey 동일 & similarity >= suspectSimilarity
    if (!verdict && compKey && tKey) {
      let maxSim = 0;
      let matchedTarget = null;

      // 노션 캐시 유사도 비교
      for (const n of notionJobs) {
        if ((n.companyKey || companyKey(n.company)) === compKey) {
          const targetTitle = n.titleKey || titleKey(n.position);
          const sim = similarity(tKey, targetTitle);
          if (sim > maxSim) {
            maxSim = sim;
            matchedTarget = { key: n.jobKey, title: n.position || targetTitle };
          }
        }
      }

      // 레지스트리 유사도 비교
      for (const r of Object.values(regData)) {
        if ((r.companyKey || companyKey(r.company)) === compKey) {
          const targetTitle = r.titleKey || titleKey(r.rawTitle || r.position);
          const sim = similarity(tKey, targetTitle);
          if (sim > maxSim) {
            maxSim = sim;
            matchedTarget = { key: r.jobKey, title: r.rawTitle || r.position || targetTitle };
          }
        }
      }

      // 현재 큐 유사도 비교
      for (const q of currentQueue) {
        if (companyKey(q.company) === compKey) {
          const targetTitle = titleKey(q.title);
          const sim = similarity(tKey, targetTitle);
          if (sim > maxSim) {
            maxSim = sim;
            matchedTarget = { key: q.jobKey, title: q.title };
          }
        }
      }

      if (maxSim >= suspectThreshold && matchedTarget) {
        verdict = 'SUSPECT';
        dupHint = {
          matchedKey: matchedTarget.key || null,
          matchedTitle: matchedTarget.title || '',
          reason: `companyKey 동일 + titleKey 유사도 ${maxSim.toFixed(2)}`
        };
        counts.suspect++;
      }
    }

    // 5) 그 외: NEW
    if (!verdict) {
      verdict = 'NEW';
      counts.new++;
    }

    // 큐 적재 대상: NEW, REOPEN_CANDIDATE, SUSPECT
    if (['NEW', 'REOPEN_CANDIDATE', 'SUSPECT'].includes(verdict)) {
      const queueEntry = {
        jobKey,
        site: site || (jobKey.includes(':') ? jobKey.split(':')[0] : 'unknown'),
        track: track || null,
        detailUrl: getDetailUrl(site, item.url, item.id),
        title: item.title,
        company: item.company,
        career: item.career || ''
      };
      if (dupHint) {
        queueEntry.dupHint = dupHint;
      }
      queueCandidates.push(queueEntry);
    }
  }

  let queued = [];
  if (queuePath && queueCandidates.length > 0) {
    queued = appendToReviewQueue(queuePath, queueCandidates);
  } else {
    queued = queueCandidates.map(c => c.jobKey);
  }

  return { counts, queued };
}

// ---------------------------------------------------------------------------
// CLI: node tools/jobFilter.js --run <runId> --site <site> --track <track> --input <page_n.json>
// ---------------------------------------------------------------------------
function parseCliArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--run') opts.runId = argv[++i];
    else if (argv[i] === '--site') opts.site = argv[++i];
    else if (argv[i] === '--track') opts.track = argv[++i];
    else if (argv[i] === '--input') opts.input = argv[++i];
    else if (argv[i] === '--config') opts.configPath = argv[++i];
    else if (argv[i] === '--cache') opts.cachePath = argv[++i];
    else if (argv[i] === '--registry') opts.registryPath = argv[++i];
  }
  return opts;
}

if (require.main === module) {
  const opts = parseCliArgs(process.argv.slice(2));
  if (!opts.input || !fs.existsSync(opts.input)) {
    console.error('사용법: node tools/jobFilter.js --run <runId> --site <site> --track <track> --input <page_n.json>');
    process.exit(1);
  }

  try {
    const raw = JSON.parse(fs.readFileSync(opts.input, 'utf8'));
    const items = Array.isArray(raw) ? raw : (raw.items || []);
    const result = classify(items, opts);
    console.log(JSON.stringify(result, null, 2));
    log(`[jobFilter] 처리 완료: New ${result.counts.new}, Reopen ${result.counts.reopen}, Suspect ${result.counts.suspect}, Skip(Reg/Notion/Dup) ${result.counts.skipRegistry}/${result.counts.skipNotion}/${result.counts.skipDup}`);
  } catch (err) {
    logError('[jobFilter] 실행 에러:', err);
    process.exit(1);
  }
}

module.exports = {
  classify,
  getDetailUrl,
  appendToReviewQueue
};
