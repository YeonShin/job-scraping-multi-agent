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

  // '_' 구분자 분리 (예: saramin_track1 -> site: saramin, track: track1)
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
 * 특정 플랫폼/트랙의 체크포인트 갱신 저장
 * @param {string} siteOrKey 예: 'saramin_track1' 또는 'saramin'
 * @param {string|Object} trackOrData track 이름 또는 데이터 객체
 * @param {Object} [maybeData] track 이름이 2번째 인자로 왔을 때 데이터 객체
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

  const { headJobId, headWindow = [], tailJobId, tailWindow = [], tailPageHint = null } = data;
  const siteDir = path.resolve(CHECKPOINTS_DIR, site);
  const targetFile = path.resolve(siteDir, `${track}.json`);

  try {
    if (!fs.existsSync(siteDir)) {
      fs.mkdirSync(siteDir, { recursive: true });
    }

    const prev = getCheckpoint(site, track) || {};
    const updated = {
      site,
      track,
      headJobId: headJobId !== undefined ? headJobId : (prev.headJobId || null),
      headWindow: Array.isArray(headWindow) && headWindow.length > 0 ? headWindow : (prev.headWindow || []),
      tailJobId: tailJobId !== undefined ? tailJobId : (prev.tailJobId || null),
      tailWindow: Array.isArray(tailWindow) && tailWindow.length > 0 ? tailWindow : (prev.tailWindow || []),
      tailPageHint: tailPageHint !== undefined ? tailPageHint : (prev.tailPageHint || null),
      updatedAt: getKstIsoString()
    };

    const tempFile = `${targetFile}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(updated, null, 2), 'utf8');
    fs.renameSync(tempFile, targetFile);

    log(`[Checkpoint] ✅ [${site}/${track}] 상태 갱신 완료 (Head: ${updated.headJobId}, Tail: ${updated.tailJobId})`);
    return updated;
  } catch (e) {
    log(`[Checkpoint] [${site}/${track}] 상태 저장 실패:`, e.message);
    throw e;
  }
}

/**
 * ID를 체크포인트와 비교하여 NEW, COVERED, OLD로 분류
 * - 윈도우(headWindow, tailWindow)에 있으면 COVERED
 * - 숫자 비교: id > head -> NEW | tail <= id <= head -> COVERED | id < tail -> OLD
 * - 체크포인트가 없거나 head/tail이 없으면 항상 NEW
 * @param {string|number} id 공고 ID
 * @param {Object|null} cp 체크포인트 객체
 * @returns {'NEW'|'COVERED'|'OLD'}
 */
function classifyId(id, cp) {
  if (!id) return 'NEW';
  const strId = String(id).trim();

  if (!cp) return 'NEW';

  const headWindow = Array.isArray(cp.headWindow) ? cp.headWindow.map(String) : [];
  const tailWindow = Array.isArray(cp.tailWindow) ? cp.tailWindow.map(String) : [];

  // 1. 윈도우 Set 앵커 매칭 (역전된 플랫폼에서도 정확히 일치)
  if (headWindow.includes(strId) || tailWindow.includes(strId)) {
    return 'COVERED';
  }
  if (cp.headJobId && String(cp.headJobId) === strId) {
    return 'COVERED';
  }
  if (cp.tailJobId && String(cp.tailJobId) === strId) {
    return 'COVERED';
  }

  // 2. 체크포인트 기준값이 없으면 항상 NEW
  if (!cp.headJobId && !cp.tailJobId && headWindow.length === 0 && tailWindow.length === 0) {
    return 'NEW';
  }

  // 3. 숫자 비교
  try {
    const numId = BigInt(strId);
    const numHead = cp.headJobId ? BigInt(cp.headJobId) : null;
    const numTail = cp.tailJobId ? BigInt(cp.tailJobId) : null;

    if (numHead !== null && numId > numHead) {
      return 'NEW';
    }

    if (numHead !== null && numTail !== null) {
      if (numId >= numTail && numId <= numHead) {
        return 'COVERED';
      }
      if (numId < numTail) {
        return 'OLD';
      }
    } else if (numHead !== null && numTail === null) {
      // head만 있는 경우
      return numId <= numHead ? 'COVERED' : 'NEW';
    } else if (numHead === null && numTail !== null) {
      // tail만 있는 경우
      return numId >= numTail ? 'COVERED' : 'OLD';
    }
  } catch (err) {
    // 숫자로 변환할 수 없는 경우 fallback
    return 'NEW';
  }

  return 'NEW';
}

/**
 * 현재 공고 ID가 Head에 도달했는지 확인
 */
function isHeadHit(jobId, checkpoint) {
  if (!checkpoint || !jobId) return false;
  if (checkpoint.headJobId && String(checkpoint.headJobId) === String(jobId)) return true;
  if (Array.isArray(checkpoint.headWindow) && checkpoint.headWindow.map(String).includes(String(jobId))) return true;
  return false;
}

/**
 * 현재 공고 ID가 Tail에 도달했는지 확인
 */
function isTailHit(jobId, checkpoint) {
  if (!checkpoint || !jobId) return false;
  if (checkpoint.tailJobId && String(checkpoint.tailJobId) === String(jobId)) return true;
  if (Array.isArray(checkpoint.tailWindow) && checkpoint.tailWindow.map(String).includes(String(jobId))) return true;
  return false;
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

      // 실제 체크포인트에 저장
      const siteDir = path.resolve(baseCpDir, site);
      fs.mkdirSync(siteDir, { recursive: true });
      const targetFile = path.resolve(siteDir, `${track}.json`);

      const prev = fs.existsSync(targetFile) ? JSON.parse(fs.readFileSync(targetFile, 'utf8')) : {};
      const updated = {
        site,
        track,
        headJobId: proposed.headJobId !== undefined ? proposed.headJobId : (prev.headJobId || null),
        headWindow: Array.isArray(proposed.headWindow) && proposed.headWindow.length > 0 ? proposed.headWindow : (prev.headWindow || []),
        tailJobId: proposed.tailJobId !== undefined ? proposed.tailJobId : (prev.tailJobId || null),
        tailWindow: Array.isArray(proposed.tailWindow) && proposed.tailWindow.length > 0 ? proposed.tailWindow : (prev.tailWindow || []),
        tailPageHint: proposed.tailPageHint !== undefined ? proposed.tailPageHint : (prev.tailPageHint || null),
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
    saveCheckpoint(target, { headJobId: head, tailJobId: tail });
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
  commitRun,
  isHeadHit,
  isTailHit,
  loadAllCheckpoints,
  getCheckpointFilePath,
  parseSiteAndTrack
};
