const fs = require('fs');
const path = require('path');
const checkpointManager = require('./checkpointManager');
const { classifyId, classifyIdWithRange, mergeRanges } = checkpointManager;
const jobFilter = require('./jobFilter');
const { log, error: logError } = require('./logger');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const CONFIG_PATH = path.resolve(__dirname, '..', 'config', 'pipeline.json');

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

function loadConfig(configPath) {
  const p = configPath ? path.resolve(configPath) : CONFIG_PATH;
  try {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (e) {
    // fallback
  }
  return {
    windowSize: 3,
    maxQueuedPerTrack: 300,
    maxPagesPerTrack: 150,
    maxPhase2Pages: 100,
    jumpEnabled: { saramin: true, jobkorea: false, wanted: false },
    expectedFilters: {}
  };
}

/**
 * 필터 일치 여부 검증
 */
function checkFilterMatch(site, track, appliedFilters, expectedFiltersConfig) {
  // 잡코리아는 UI 특성상 화면 필터 칩 검사를 건너뛰고 항상 통과
  if (site === 'jobkorea') {
    return true;
  }

  const key = `${site}_${track}`;
  const expected = expectedFiltersConfig && expectedFiltersConfig[key];
  if (!expected || !Array.isArray(expected) || expected.length === 0) {
    return true; // 기대값이 없으면 통과
  }

  const applied = Array.isArray(appliedFilters) ? appliedFilters : [];

  if (site === 'saramin' || site === 'wanted') {
    // URL 쿼리 파라미터 기반 검사
    const appliedDecoded = applied.map(f => {
      try {
        return decodeURIComponent(f);
      } catch (e) {
        return f;
      }
    });

    // 1) expected 의 모든 파라미터가 applied에 포함되어 있는지 확인
    for (const exp of expected) {
      const expDecoded = decodeURIComponent(exp);
      const matched = appliedDecoded.some(app => app === expDecoded || app.startsWith(expDecoded));
      if (!matched) {
        logError(`[scanController] 필터 누락 (${key}): ${expDecoded}`);
        return false;
      }
    }

    // 2) 사람인 track2, track3는 company_type 이 없어야 함
    if (site === 'saramin' && (track === 'track2' || track === 'track3')) {
      const hasCompanyType = appliedDecoded.some(app => app.startsWith('company_type='));
      if (hasCompanyType) {
        logError(`[scanController] 사람인 ${track}에 company_type 지정 불가`);
        return false;
      }
    }

    return true;
  }

  return true;
}

/**
 * 점프 직후 첫 항목이 현재 스킵 중이던 COVERED 구간의 tail을 지나쳤는지(Overshot) 판정
 */
function isOvershotRange(firstItemId, cp, existingRanges, activeRangeIndex) {
  if (!firstItemId) return false;
  const c = classifyId(firstItemId, cp);
  if (c === 'OLD') return true;
  if (c === 'COVERED') return false;

  // c === 'NEW' (다중 구간 사이의 Gap으로 떨어진 경우): activeRange의 tail보다 작으면 지나친 것
  if (activeRangeIndex >= 0 && existingRanges[activeRangeIndex] && existingRanges[activeRangeIndex].tailJobId) {
    try {
      return BigInt(String(firstItemId)) < BigInt(String(existingRanges[activeRangeIndex].tailJobId));
    } catch (e) {}
  }
  return false;
}

/**
 * 단일 step 처리 함수
 */
function step(options = {}) {
  const { runId, site, track, page: rawPage, inputPath, configPath, runsDir, checkpointsDir } = options;
  const page = parseInt(rawPage, 10) || 1;

  if (!runId || !site || !track) {
    throw new Error('runId, site, track 은 필수 매개변수입니다.');
  }

  const config = loadConfig(configPath);
  const windowSize = config.windowSize || 3;
  const maxQueuedPerTrack = config.maxQueuedPerTrack || 300;
  const maxPagesPerTrack = config.maxPagesPerTrack || 150;
  const maxPhase2Pages = config.maxPhase2Pages || 100;
  const jumpEnabled = (config.jumpEnabled && config.jumpEnabled[site] === true);

  const baseRunsDir = runsDir ? path.resolve(runsDir) : path.resolve(DATA_DIR, 'runs');
  const trackDir = path.resolve(baseRunsDir, runId, `${site}_${track}`);
  fs.mkdirSync(trackDir, { recursive: true });

  // 1. 입력 파일 로드
  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error(`입력 파일을 찾을 수 없습니다: ${inputPath}`);
  }
  const inputRaw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const appliedFilters = inputRaw.appliedFilters || [];
  const items = Array.isArray(inputRaw.items) ? inputRaw.items : [];
  const inputError = inputRaw.error || null;

  // page_{n}.json 영구 저장
  const pageRecord = {
    site,
    track,
    page,
    capturedAt: getKstIsoString(),
    appliedFilters,
    items,
    ...(inputError ? { error: inputError } : {})
  };
  fs.writeFileSync(path.resolve(trackDir, `page_${page}.json`), JSON.stringify(pageRecord, null, 2), 'utf8');

  // 2. 체크포인트 로드
  let cp = null;
  if (checkpointsDir) {
    const cpPath = path.resolve(checkpointsDir, site, `${track}.json`);
    if (fs.existsSync(cpPath)) {
      try {
        cp = JSON.parse(fs.readFileSync(cpPath, 'utf8'));
      } catch (e) {}
    }
  } else {
    cp = checkpointManager.getCheckpoint(site, track);
  }

  // 3. state.json 로드 또는 초기화
  const statePath = path.resolve(trackDir, 'state.json');
  let state = {
    site,
    track,
    runId,
    phase: 1,
    phase1Complete: false,
    sessionTop: [],
    seenIds: [],
    lastProcessedIds: [],
    sessionRanges: [],
    currentGapHead: [],
    currentGapLastIds: [],
    activeRangeIndex: -1,
    jumpedRanges: [],
    phase2PageCount: 0,
    hasJumped: false,
    isBacktracking: false,
    lastJumpTarget: null,
    warnings: [],
    stopReason: null,
    counters: {
      listed: 0,
      coveredSkipped: 0,
      dupSkipped: 0,
      suspected: 0,
      queued: 0,
      pages: 0
    }
  };

  if (fs.existsSync(statePath)) {
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      state.sessionRanges = state.sessionRanges || [];
      state.currentGapHead = state.currentGapHead || [];
      state.currentGapLastIds = state.currentGapLastIds || [];
      state.jumpedRanges = state.jumpedRanges || [];
      if (state.activeRangeIndex === undefined) state.activeRangeIndex = -1;
    } catch (e) {
      logError('[scanController] state.json 파싱 실패, 새로 초기화합니다.');
    }
  }

  // 4. 페이지 1 상위 windowSize 개 sessionTop 기록
  if (page === 1 && state.sessionTop.length === 0 && items.length > 0) {
    state.sessionTop = items.slice(0, windowSize).map(item => String(item.id));
  }

  // 5. ID 역전 검사 (state.warnings 누적)
  for (let i = 1; i < items.length; i++) {
    const prevId = String(items[i - 1].id || '');
    const currId = String(items[i].id || '');
    try {
      if (prevId && currId && BigInt(currId) > BigInt(prevId)) {
        state.warnings.push({
          type: 'ID_INVERSION',
          page,
          prevId,
          currId
        });
      }
    } catch (e) {}
  }

  // 6. 각 신규 ID 처리 및 분류
  const existingRanges = (cp && Array.isArray(cp.ranges)) ? cp.ranges : [];
  const newIdsInThisPage = [];
  let pageHasCovered = false;
  let pageAllCovered = (items.length > 0);
  let lastCoveredRangeIndex = -1;

  for (const item of items) {
    if (state.counters.queued >= maxQueuedPerTrack) {
      break;
    }

    const strId = String(item.id);
    if (state.seenIds.includes(strId)) {
      continue;
    }

    state.seenIds.push(strId);
    newIdsInThisPage.push(strId);
    state.counters.listed++;
    state.lastProcessedIds.push(strId);
    if (state.lastProcessedIds.length > windowSize * 2) {
      state.lastProcessedIds = state.lastProcessedIds.slice(-windowSize * 2);
    }

    const { status: c, rangeIndex } = classifyIdWithRange(strId, cp);

    if (c === 'COVERED') {
      pageHasCovered = true;
      lastCoveredRangeIndex = rangeIndex;
      state.activeRangeIndex = rangeIndex;
      state.counters.coveredSkipped++;

      // 직전까지 수집하던 미탐색 구간(currentGap)이 있었다면, 현재 COVERED 구간(existingRanges[rangeIndex])과 맞닿았으므로 구간 확정!
      if (state.currentGapHead.length > 0) {
        const hitRange = existingRanges[rangeIndex];
        state.sessionRanges.push({
          headJobId: state.currentGapHead[0],
          headWindow: state.currentGapHead.slice(0, windowSize),
          tailJobId: hitRange ? hitRange.tailJobId : state.currentGapLastIds[state.currentGapLastIds.length - 1],
          tailWindow: hitRange && hitRange.tailWindow && hitRange.tailWindow.length > 0
            ? hitRange.tailWindow
            : state.currentGapLastIds.slice(-windowSize),
          tailPageHint: hitRange && hitRange.tailPageHint ? hitRange.tailPageHint : page
        });
        state.currentGapHead = [];
        state.currentGapLastIds = [];
      }

      if (state.phase === 1) {
        state.phase1Complete = true;
        state.phase = 2;
      }
    } else {
      pageAllCovered = false;
      if (c === 'OLD') {
        if (state.phase === 2) {
          state.phase = 3;
        }
      } else if (c === 'NEW' && state.phase === 2) {
        // 다중 구간(ranges) 환경에서 위쪽 COVERED 구간을 통과한 뒤 두 구간 사이의 미탐색 공백(Gap)에 진입한 경우
        state.isBacktracking = false;
      }

      // 미탐색 구간(NEW 또는 OLD) 진행 상태 기록
      if (state.currentGapHead.length < windowSize) {
        state.currentGapHead.push(strId);
      }
      state.currentGapLastIds.push(strId);
      if (state.currentGapLastIds.length > windowSize * 2) {
        state.currentGapLastIds = state.currentGapLastIds.slice(-windowSize * 2);
      }

      // NEW 또는 OLD -> jobFilter.classify 실행
      const filterRes = jobFilter.classify([item], {
        site,
        track,
        runId,
        runsDir: baseRunsDir,
        configPath
      });
      const counts = filterRes.counts || {};
      state.counters.dupSkipped += (counts.skipRegistry || 0) + (counts.skipNotion || 0) + (counts.skipDup || 0);
      state.counters.suspected += (counts.suspect || 0);
      state.counters.queued += (counts.new || 0) + (counts.reopen || 0) + (counts.suspect || 0);

      if (state.counters.queued >= maxQueuedPerTrack) {
        break;
      }
    }
  }

  state.counters.pages++;
  if (state.phase === 2) {
    state.phase2PageCount++;
  }

  // 8. 필터 일치 검증
  const filterMatched = checkFilterMatch(site, track, appliedFilters, config.expectedFilters);

  // 9. 다음 행동 결정 (우선순위 1~8)
  let action = 'NEXT_PAGE';
  let nextPageNumber = page + 1;
  let stopReason = null;

  if (inputError === 'CONTAINER_NOT_FOUND') {
    action = 'STOP';
    stopReason = 'CONTAINER_NOT_FOUND';
  } else if (!filterMatched) {
    action = 'STOP';
    stopReason = 'FILTER_MISMATCH';
  } else if (items.length === 0 && page === 1) {
    action = 'STOP';
    stopReason = 'EMPTY_PAGE';
  } else if (newIdsInThisPage.length === 0 && page >= 2) {
    action = 'STOP';
    stopReason = 'LIST_END';
  } else if (state.counters.queued >= maxQueuedPerTrack) {
    action = 'STOP';
    stopReason = 'LIMIT_QUEUED';
  } else if (state.counters.pages >= maxPagesPerTrack || state.phase2PageCount >= maxPhase2Pages) {
    action = 'STOP';
    stopReason = 'LIMIT_PAGES';
    } else if (state.phase === 2 && pageAllCovered && jumpEnabled && lastCoveredRangeIndex >= 0 && !state.jumpedRanges.includes(lastCoveredRangeIndex)) {
    // 6) Phase 2 이고 페이지 전체가 COVERED 이며 jumpEnabled 이고 현재 COVERED 구간에서 아직 점프하지 않았으면
    const activeRange = existingRanges[lastCoveredRangeIndex];
    const newCount = state.seenIds.filter(id => classifyId(id, cp) === 'NEW').length;
    const pageSize = items.length > 0 ? items.length : 20;
    const tailHint = (activeRange && activeRange.tailPageHint) ? activeRange.tailPageHint : 1;
    const targetPage = tailHint + Math.ceil(newCount / pageSize);

    if (targetPage > page + 1) {
      state.hasJumped = true;
      state.jumpedRanges.push(lastCoveredRangeIndex);
      state.lastJumpTarget = targetPage;
      action = 'JUMP_PAGE';
      nextPageNumber = targetPage;
    } else {
      action = 'NEXT_PAGE';
      nextPageNumber = page + 1;
    }
  } else if (state.hasJumped && (state.isBacktracking || (items.length > 0 && isOvershotRange(items[0].id, cp, existingRanges, state.activeRangeIndex)))) {
    // 7) 점프 직후 페이지 첫 항목이 현재 COVERED 구간의 tail을 지나쳤다면(OLD 또는 다음 Gap) 되돌아가며, COVERED 가 포함된 페이지를 찾으면 거기서부터 NEXT_PAGE
    if (pageHasCovered) {
      // COVERED 가 포함된 페이지를 찾았으므로 백트래킹 종료하고 전진
      state.isBacktracking = false;
      action = 'NEXT_PAGE';
      nextPageNumber = page + 1;
    } else {
      state.isBacktracking = true;
      if (page > 1) {
        action = 'JUMP_PAGE';
        nextPageNumber = page - 1;
      } else {
        state.isBacktracking = false;
        action = 'NEXT_PAGE';
        nextPageNumber = page + 1;
      }
    }
  } else {
    // 8) 그 외
    action = 'NEXT_PAGE';
    nextPageNumber = page + 1;
  }

  // 10. STOP 시 proposed_checkpoint.json 작성
  if (action === 'STOP') {
    state.stopReason = stopReason;

    const isErrorStop = (
      stopReason === 'FILTER_MISMATCH' ||
      stopReason === 'CONTAINER_NOT_FOUND' ||
      stopReason === 'EMPTY_PAGE'
    );

    const candidateRanges = [...existingRanges];

    if (!isErrorStop) {
      // 1) 탐색 도중 COVERED 와 만나 확정된 구간들 반영
      for (const sr of state.sessionRanges) {
        candidateRanges.push(sr);
      }

      // 2) STOP 시점에 진행 중이던 미탐색 구간(currentGap) 반영
      if (state.currentGapHead.length > 0 && state.currentGapLastIds.length > 0) {
        const lastIds = state.currentGapLastIds.slice(-windowSize);
        candidateRanges.push({
          headJobId: state.currentGapHead[0],
          headWindow: state.currentGapHead.slice(0, windowSize),
          tailJobId: lastIds[lastIds.length - 1],
          tailWindow: lastIds,
          tailPageHint: page
        });
      }

      // 3) 만약 Phase 3 진입 또는 Phase 2 LIST_END 도달 시 최하단 구간의 tail 확장 반영
      if ((state.phase === 3 || (state.phase === 2 && stopReason === 'LIST_END')) && state.lastProcessedIds.length > 0) {
        const lastIds = state.lastProcessedIds.slice(-windowSize);
        const firstExisting = existingRanges[0] || {};
        const topHead = state.sessionTop.length > 0 ? state.sessionTop[0] : (firstExisting.headJobId || lastIds[0]);
        const topWin = state.sessionTop.length > 0 ? state.sessionTop.slice(0, windowSize) : (firstExisting.headWindow || lastIds);
        if (state.phase1Complete) {
          candidateRanges.push({
            headJobId: topHead,
            headWindow: topWin,
            tailJobId: lastIds[lastIds.length - 1],
            tailWindow: lastIds,
            tailPageHint: page
          });
        }
      }
    }

    const mergedRanges = mergeRanges(candidateRanges, windowSize);

    const proposed = {
      site,
      track,
      ranges: mergedRanges,
      updatedAt: getKstIsoString()
    };

    fs.writeFileSync(path.resolve(trackDir, 'proposed_checkpoint.json'), JSON.stringify(proposed, null, 2), 'utf8');
  }

  // state.json 저장
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');

  // 표준 출력 규격 생성
  const outputPayload = {
    action,
    page: action === 'STOP' ? null : nextPageNumber,
    reason: stopReason,
    phase: state.phase,
    counters: { ...state.counters }
  };

  return outputPayload;
}

// CLI 실행 지원
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command !== 'step') {
    console.error('사용법: node tools/scanController.js step --run <runId> --site <site> --track <track> --page <n> --input <snippet_output.json>');
    process.exit(1);
  }

  const opts = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--run') opts.runId = args[++i];
    else if (args[i] === '--site') opts.site = args[++i];
    else if (args[i] === '--track') opts.track = args[++i];
    else if (args[i] === '--page') opts.page = parseInt(args[++i], 10);
    else if (args[i] === '--input') opts.inputPath = args[++i];
    else if (args[i] === '--config') opts.configPath = args[++i];
  }

  try {
    const result = step(opts);
    // 사람이 읽는 로그는 stderr
    console.error(`[scanController] Step Result: action=${result.action}, page=${result.page}, reason=${result.reason}, phase=${result.phase}`);
    // 기계가 읽는 최종 출력은 stdout 한 줄
    console.log(JSON.stringify(result));
  } catch (err) {
    console.error(`[scanController] 에러:`, err.message);
    process.exit(1);
  }
}

module.exports = {
  step,
  checkFilterMatch
};
