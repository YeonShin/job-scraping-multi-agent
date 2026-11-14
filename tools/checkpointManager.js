const fs = require('fs');
const path = require('path');
const { log } = require('./logger');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const CHECKPOINTS_DIR = path.resolve(DATA_DIR, 'checkpoints');

/**
 * KST (+09:00) ISO 8601 문자열 반환
 */
function getKstIsoString() {
  const now = new Date();
  const kstDate = new Date(now.getTime() + (9 * 60 - (-now.getTimezoneOffset())) * 60000);
  const pad = n => String(n).padStart(2, '0');
  const yyyy = kstDate.getFullYear();
  const mm = pad(kstDate.getMonth() + 1);
  const dd = pad(kstDate.getDate());
  const hh = pad(kstDate.getHours());
  const mi = pad(kstDate.getMinutes());
  const ss = pad(kstDate.getSeconds());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+09:00`;
}

/**
 * site 및 track 키를 파싱하여 표준화된 { site, track, key } 객체 반환
 * @param {string} siteOrKey 예: 'saramin_track1', 'wanted_track2', 또는 site 단독 ('wanted')
 * @param {string} [maybeTrack] 예: 'track1', 'track2'
 */
function parseSiteAndTrack(siteOrKey, maybeTrack) {
  if (maybeTrack) {
    const site = String(siteOrKey).toLowerCase();
    const track = String(maybeTrack).toLowerCase();
    return { site, track, key: `${site}_${track}` };
  }

  const rawKey = String(siteOrKey || '').trim();
  if (rawKey === 'wanted') {
    return { site: 'wanted', track: 'track2', key: 'wanted_track2' };
  }
  if (rawKey === 'jobkorea') {
    return { site: 'jobkorea', track: 'track1', key: 'jobkorea_track1' };
  }
  if (rawKey === 'saramin') {
    return { site: 'saramin', track: 'track1', key: 'saramin_track1' };
  }

  const parts = rawKey.split('_');
  if (parts.length >= 2) {
    const site = parts[0].toLowerCase();
    const track = parts.slice(1).join('_').toLowerCase();
    return { site, track, key: rawKey };
  }

  return { site: rawKey, track: 'default', key: rawKey };
}

/**
 * 체크포인트 JSON 파일 절대 경로 반환
 */
function getCheckpointFilePath(siteOrKey, maybeTrack) {
  const { site, track } = parseSiteAndTrack(siteOrKey, maybeTrack);
  return path.resolve(CHECKPOINTS_DIR, site, `${track}.json`);
}

/**
 * 전체 사이트/트랙의 체크포인트를 취합 로드
 */
function loadAllCheckpoints() {
  const result = {};

  try {
    if (fs.existsSync(CHECKPOINTS_DIR)) {
      const sites = fs.readdirSync(CHECKPOINTS_DIR, { withFileTypes: true });
      for (const siteDirent of sites) {
        if (siteDirent.isDirectory()) {
          const site = siteDirent.name;
          const siteDir = path.resolve(CHECKPOINTS_DIR, site);
          const files = fs.readdirSync(siteDir).filter(f => f.endsWith('.json'));
          for (const file of files) {
            const track = path.basename(file, '.json');
            const filePath = path.resolve(siteDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
              const key = `${site}_${track}`;
              result[key] = data;
            } catch (err) {
              log(`[Checkpoint] ${filePath} 파싱 실패:`, err.message);
            }
          }
        }
      }
    }
  } catch (e) {
    log('[Checkpoint] 전체 로드 중 오류:', e.message);
  }

  return result;
}

/**
 * 특정 플랫폼/트랙의 체크포인트 반환
 * @param {string} siteOrKey 예: 'saramin_track1', 'wanted_track2' 또는 'saramin'
 * @param {string} [maybeTrack] 예: 'track1', 'track2'
 */
function getCheckpoint(siteOrKey, maybeTrack) {
  const { site, track } = parseSiteAndTrack(siteOrKey, maybeTrack);
  const targetFile = path.resolve(CHECKPOINTS_DIR, site, `${track}.json`);

  try {
    if (fs.existsSync(targetFile)) {
      return JSON.parse(fs.readFileSync(targetFile, 'utf8'));
    }
  } catch (e) {
    log(`[Checkpoint] [${site}/${track}] 로드 실패:`, e.message);
  }

  return null;
}

/**
 * 겹치거나 맞닿은 구간(ranges)들을 병합하고 최신(큰 ID) 순으로 정렬
 * @param {Array<{headJobId: string|null, headWindow?: string[], tailJobId: string|null, tailWindow?: string[], tailPageHint?: number|null}>} ranges
 * @param {number} [windowSize=3]
 */
function mergeRanges(ranges, windowSize = 3) {
  if (!Array.isArray(ranges) || ranges.length === 0) return [];

  const valid = ranges
    .filter(r => r && (r.headJobId || r.tailJobId || (Array.isArray(r.headWindow) && r.headWindow.length > 0) || (Array.isArray(r.tailWindow) && r.tailWindow.length > 0)))
    .map(r => ({
      headJobId: r.headJobId ? String(r.headJobId) : null,
      headWindow: Array.isArray(r.headWindow) ? r.headWindow.map(String) : [],
      tailJobId: r.tailJobId ? String(r.tailJobId) : null,
      tailWindow: Array.isArray(r.tailWindow) ? r.tailWindow.map(String) : [],
      tailPageHint: typeof r.tailPageHint === 'number' ? r.tailPageHint : null
    }));

  if (valid.length <= 1) return valid;

  // 내림차순 정렬 (headJobId가 큰 최신 구간 우선)
  const sorted = [...valid].sort((a, b) => {
    try {
      const aHead = BigInt(a.headJobId || a.tailJobId || '0');
      const bHead = BigInt(b.headJobId || b.tailJobId || '0');
      if (bHead > aHead) return 1;
      if (bHead < aHead) return -1;
      return 0;
    } catch (e) {
      return 0;
    }
  });

  const merged = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = sorted[i];

    let shouldMerge = false;

    // 1. 윈도우 교집합 검사 (역전 현상이 있는 플랫폼에서도 앵커가 겹치면 병합)
    const prevIds = new Set([
      ...(prev.headJobId ? [prev.headJobId] : []),
      ...(prev.tailJobId ? [prev.tailJobId] : []),
      ...prev.headWindow,
      ...prev.tailWindow
    ]);
    const currIds = [
      ...(curr.headJobId ? [curr.headJobId] : []),
      ...(curr.tailJobId ? [curr.tailJobId] : []),
      ...curr.headWindow,
      ...curr.tailWindow
    ];

    if (currIds.some(id => prevIds.has(id))) {
      shouldMerge = true;
    }

    // 2. 숫자 범위 겹침/인접 검사 (prev.tailJobId <= curr.headJobId)
    if (!shouldMerge && prev.tailJobId && curr.headJobId) {
      try {
        if (BigInt(prev.tailJobId) <= BigInt(curr.headJobId)) {
          shouldMerge = true;
        }
      } catch (e) {}
    }

    if (shouldMerge) {
      let useCurrTail = true;
      if (prev.tailJobId && curr.tailJobId) {
        try {
          if (BigInt(prev.tailJobId) < BigInt(curr.tailJobId)) {
            useCurrTail = false;
          }
        } catch (e) {}
      }

      const combinedHeadWin = Array.from(new Set([...prev.headWindow, ...curr.headWindow])).slice(0, windowSize);
      const combinedTailWin = useCurrTail
        ? Array.from(new Set([...prev.tailWindow, ...curr.tailWindow])).slice(-windowSize)
        : Array.from(new Set([...curr.tailWindow, ...prev.tailWindow])).slice(-windowSize);

      merged[merged.length - 1] = {
        headJobId: prev.headJobId || curr.headJobId,
        headWindow: combinedHeadWin,
        tailJobId: useCurrTail ? (curr.tailJobId || prev.tailJobId) : (prev.tailJobId || curr.tailJobId),
        tailWindow: combinedTailWin,
        tailPageHint: useCurrTail ? (curr.tailPageHint || prev.tailPageHint || null) : (prev.tailPageHint || curr.tailPageHint || null)
      };
    } else {
      merged.push(curr);
    }
  }

  return merged;
}

/**
 * 특정 플랫폼/트랙의 체크포인트 갱신 저장 (ranges 배열 기반)
 */
function saveCheckpoint(siteOrKey, trackOrData, maybeData) {
  let site, track, data;

  if (typeof trackOrData === 'string' && typeof maybeData === 'object') {
    const parsed = parseSiteAndTrack(siteOrKey, trackOrData);
    site = parsed.site;
    track = parsed.track;
    data = maybeData || {};
  } else {
    const parsed = parseSiteAndTrack(siteOrKey);
    site = parsed.site;
    track = parsed.track;
    data = (typeof trackOrData === 'object' ? trackOrData : {}) || {};
  }

  const siteDir = path.resolve(CHECKPOINTS_DIR, site);
  const targetFile = path.resolve(siteDir, `${track}.json`);

  try {
    if (!fs.existsSync(siteDir)) {
      fs.mkdirSync(siteDir, { recursive: true });
    }

    const prev = getCheckpoint(site, track) || {};
    const finalRanges = Array.isArray(data.ranges)
      ? mergeRanges(data.ranges)
      : (Array.isArray(prev.ranges) ? mergeRanges(prev.ranges) : []);

    const updated = {
      site,
      track,
      ranges: finalRanges,
      updatedAt: getKstIsoString()
    };

    const tempFile = `${targetFile}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(updated, null, 2), 'utf8');
    fs.renameSync(tempFile, targetFile);

    const top = finalRanges[0] || {};
    const bottom = finalRanges[finalRanges.length - 1] || {};
    log(`[Checkpoint] ✅ [${site}/${track}] 상태 갱신 완료 (Ranges: ${finalRanges.length}개, TopHead: ${top.headJobId || 'null'}, BottomTail: ${bottom.tailJobId || 'null'})`);
    return updated;
  } catch (e) {
    log(`[Checkpoint] [${site}/${track}] 상태 저장 실패:`, e.message);
    throw e;
  }
}

/**
 * ID가 체크포인트의 몇 번째 구간(rangeIndex)에 속하는지 또는 어떤 상태인지 상세 반환
 * @param {string|number} id 공고 ID
 * @param {Object|null} cp 체크포인트 객체 ({ ranges: [...] })
 * @returns {{ status: 'NEW'|'COVERED'|'OLD', rangeIndex: number }}
 */
function classifyIdWithRange(id, cp) {
  if (!id || !cp || !Array.isArray(cp.ranges) || cp.ranges.length === 0) {
    return { status: 'NEW', rangeIndex: -1 };
  }

  const strId = String(id).trim();
  const ranges = cp.ranges;

  // 1. 모든 구간에 대해 윈도우 Set 앵커 매칭 우선 확인 (ID 역전 플랫폼에서도 정확히 일치)
  for (let idx = 0; idx < ranges.length; idx++) {
    const r = ranges[idx];
    const headWin = Array.isArray(r.headWindow) ? r.headWindow.map(String) : [];
    const tailWin = Array.isArray(r.tailWindow) ? r.tailWindow.map(String) : [];
    if (
      headWin.includes(strId) ||
      tailWin.includes(strId) ||
      (r.headJobId && String(r.headJobId) === strId) ||
      (r.tailJobId && String(r.tailJobId) === strId)
    ) {
      return { status: 'COVERED', rangeIndex: idx };
    }
  }

  // 2. 숫자(BigInt) 비교
  try {
    const numId = BigInt(strId);

    for (let idx = 0; idx < ranges.length; idx++) {
      const r = ranges[idx];
      const numHead = r.headJobId ? BigInt(r.headJobId) : null;
      const numTail = r.tailJobId ? BigInt(r.tailJobId) : null;

      // 내림차순 정렬된 구간들 중 현재 구간의 head보다 크다면:
      // 첫 구간보다 위(최신)이거나 이전 구간과 현재 구간 사이의 미탐색 공백(Gap)이므로 NEW
      if (numHead !== null && numId > numHead) {
        return { status: 'NEW', rangeIndex: -1 };
      }

      if (numHead !== null && numTail !== null) {
        if (numId >= numTail && numId <= numHead) {
          return { status: 'COVERED', rangeIndex: idx };
        }
      } else if (numHead !== null && numTail === null) {
        if (numId <= numHead) {
          return { status: 'COVERED', rangeIndex: idx };
        }
      } else if (numHead === null && numTail !== null) {
        if (numId >= numTail) {
          return { status: 'COVERED', rangeIndex: idx };
        }
      }
    }

    // 모든 구간(최하단 구간의 tail)보다 작은 경우: 과거 미탐색 공고(OLD)
    return { status: 'OLD', rangeIndex: -1 };
  } catch (err) {
    return { status: 'NEW', rangeIndex: -1 };
  }
}

/**
 * ID를 체크포인트와 비교하여 NEW, COVERED, OLD로 분류
 * @param {string|number} id 공고 ID
 * @param {Object|null} cp 체크포인트 객체
 * @returns {'NEW'|'COVERED'|'OLD'}
 */
function classifyId(id, cp) {
  return classifyIdWithRange(id, cp).status;
}

/**
 * data/runs/{runId}/<track>/proposed_checkpoint.json 을 실제 체크포인트로 일괄 반영
 * @param {string} runId
 * @param {string} [runsDir]
 * @param {string} [checkpointsDir]
 */
function commitRun(runId, runsDir, checkpointsDir) {
  if (!runId) {
    throw new Error('runId가 지정되지 않았습니다.');
  }

  const baseRunsDir = runsDir ? path.resolve(runsDir) : path.resolve(DATA_DIR, 'runs');
  const baseCpDir = checkpointsDir ? path.resolve(checkpointsDir) : CHECKPOINTS_DIR;

  const runDir = path.resolve(baseRunsDir, runId);
  if (!fs.existsSync(runDir)) {
    throw new Error(`실행 디렉터리를 찾을 수 없습니다: ${runDir}`);
  }

  const publishResultPath = path.resolve(runDir, 'publish_result.json');
  if (!fs.existsSync(publishResultPath)) {
    throw new Error(`[Checkpoint] commit 실패: ${runId}에 publish_result.json이 없습니다.`);
  }

  const subDirs = fs.readdirSync(runDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const committed = [];
  const skipped = [];

  for (const dirName of subDirs) {
    const trackDir = path.resolve(runDir, dirName);
    const proposedPath = path.resolve(trackDir, 'proposed_checkpoint.json');
    const statePath = path.resolve(trackDir, 'state.json');

    if (!fs.existsSync(proposedPath)) {
      continue;
    }

    // 트랙 state의 stopReason 검사
    if (fs.existsSync(statePath)) {
      try {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        if (state.stopReason === 'FILTER_MISMATCH' || state.stopReason === 'CONTAINER_NOT_FOUND') {
          skipped.push({ dirName, reason: state.stopReason });
          continue;
        }
      } catch (err) {
        log(`[Checkpoint] state.json 읽기 실패 (${dirName}):`, err.message);
      }
    }

    try {
      const proposed = JSON.parse(fs.readFileSync(proposedPath, 'utf8'));
      const site = proposed.site;
      const track = proposed.track;

      if (!site || !track) {
        continue;
      }

      const siteDir = path.resolve(baseCpDir, site);
      fs.mkdirSync(siteDir, { recursive: true });
      const targetFile = path.resolve(siteDir, `${track}.json`);

      const prev = fs.existsSync(targetFile) ? JSON.parse(fs.readFileSync(targetFile, 'utf8')) : {};
      const finalRanges = Array.isArray(proposed.ranges)
        ? mergeRanges(proposed.ranges)
        : (Array.isArray(prev.ranges) ? mergeRanges(prev.ranges) : []);

      const updated = {
        site,
        track,
        ranges: finalRanges,
        updatedAt: getKstIsoString()
      };

      const tempFile = `${targetFile}.tmp.${Date.now()}`;
      fs.writeFileSync(tempFile, JSON.stringify(updated, null, 2), 'utf8');
      fs.renameSync(tempFile, targetFile);

      committed.push(`${site}_${track}`);
    } catch (err) {
      log(`[Checkpoint] proposed_checkpoint 반영 실패 (${dirName}):`, err.message);
      throw err;
    }
  }

  return { committed, skipped };
}

// CLI 실행 지원
if (require.main === module) {
  const args = process.argv.slice(2);
  const action = args[0];

  if (action === 'get') {
    const target = args[1] || 'saramin_track1';
    console.log(JSON.stringify(getCheckpoint(target), null, 2));
  } else if (action === 'set') {
    const target = args[1] || 'saramin_track1';
    const head = args[2];
    const tail = args[3];
    saveCheckpoint(target, {
      ranges: head || tail ? [{ headJobId: head || null, headWindow: head ? [head] : [], tailJobId: tail || null, tailWindow: tail ? [tail] : [], tailPageHint: null }] : []
    });
  } else if (action === 'commit') {
    let runId = null;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--run' && args[i + 1]) {
        runId = args[i + 1];
        break;
      }
    }

    if (!runId) {
      console.error('사용법: node tools/checkpointManager.js commit --run <runId>');
      process.exit(1);
    }

    try {
      const result = commitRun(runId);
      console.log(`[Checkpoint] commit 완료: 반영 ${result.committed.length}건 (${result.committed.join(', ') || '없음'}), 제외 ${result.skipped.length}건`);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  } else {
    console.log(JSON.stringify(loadAllCheckpoints(), null, 2));
  }
}

module.exports = {
  getCheckpoint,
  saveCheckpoint,
  classifyId,
  classifyIdWithRange,
  mergeRanges,
  commitRun,
  loadAllCheckpoints,
  getCheckpointFilePath,
  parseSiteAndTrack
};
