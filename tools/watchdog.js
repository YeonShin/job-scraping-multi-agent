const fs = require('fs');
const path = require('path');
const { sendDiscordErrorReport, kstIso } = require('./discordNotifier');
const { check: checkLock } = require('./runLock');
const { log, error: logError } = require('./logger');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const RUNS_DIR = path.resolve(DATA_DIR, 'runs');

/**
 * runId 디렉토리의 시작 시각 판정
 */
function getRunStartTime(runDirName, fullPath) {
  // 포맷: YYYYMMDD-HHmm 또는 single-YYYYMMDD-HHmm
  const match = runDirName.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
  if (match) {
    const [_, y, m, d, hh, mm] = match;
    // KST 시각 기준 -> UTC ms
    return new Date(Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), parseInt(hh, 10) - 9, parseInt(mm, 10), 0)).getTime();
  }

  try {
    const stat = fs.statSync(fullPath);
    return Math.min(stat.birthtimeMs || stat.mtimeMs, stat.mtimeMs);
  } catch (e) {
    return 0;
  }
}

/**
 * 최근 run 디렉터리 내 마지막 생성 파일 탐색
 */
function findLatestFile(dir) {
  let latestFile = null;
  let latestMtime = 0;

  function traverse(currentDir) {
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const ent of entries) {
        const full = path.join(currentDir, ent.name);
        if (ent.isDirectory()) {
          traverse(full);
        } else {
          const stat = fs.statSync(full);
          if (stat.mtimeMs > latestMtime) {
            latestMtime = stat.mtimeMs;
            latestFile = path.relative(dir, full);
          }
        }
      }
    } catch (e) {}
  }

  traverse(dir);
  return { latestFile, latestMtime };
}

/**
 * 워치독 검사 실행
 * - options.runId: 특정 run 검사
 * - options.thresholdTime: 특정 시각 이후의 run 검사 (선택 사항)
 * - 기본 동작: 가장 최근 run의 완료(summary.json + report_sent.json) 여부 검사
 */
async function runWatchdog(options = {}) {
  const customRunsDir = options.runsDir || RUNS_DIR;

  log(`[watchdog] 수집 실행 상태 무결성 검사 시작`);

  if (!fs.existsSync(customRunsDir)) {
    fs.mkdirSync(customRunsDir, { recursive: true });
  }

  const runDirs = fs.readdirSync(customRunsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => ({
      name: d.name,
      fullPath: path.join(customRunsDir, d.name),
      startTime: getRunStartTime(d.name, path.join(customRunsDir, d.name))
    }))
    .sort((a, b) => b.startTime - a.startTime);

  if (runDirs.length === 0) {
    logError('[watchdog] ❌ 실행 기록(run)을 찾을 수 없습니다.');
    return { ok: false, reason: 'NO_RUNS_FOUND' };
  }

  let targetRun = null;
  if (options.runId) {
    targetRun = runDirs.find(r => r.name === options.runId);
    if (!targetRun) {
      logError(`[watchdog] ❌ 지정된 실행(${options.runId})을 찾을 수 없습니다.`);
      return { ok: false, reason: 'RUN_NOT_FOUND', runId: options.runId };
    }
  } else if (options.thresholdTime) {
    const candidateRuns = runDirs.filter(r => r.startTime >= options.thresholdTime);
    for (const r of candidateRuns) {
      const summaryPath = path.join(r.fullPath, 'summary.json');
      const reportSentPath = path.join(r.fullPath, 'report_sent.json');
      if (fs.existsSync(summaryPath) && fs.existsSync(reportSentPath)) {
        log(`[watchdog] ✅ 기준 시각 이후 정상 완료된 실행을 확인했습니다: ${r.name}`);
        return { ok: true, completedRun: r.name };
      }
    }
    targetRun = candidateRuns[0] || runDirs[0];
  } else {
    // 가장 최근 run
    targetRun = runDirs[0];
  }

  const summaryPath = path.join(targetRun.fullPath, 'summary.json');
  const reportSentPath = path.join(targetRun.fullPath, 'report_sent.json');

  if (fs.existsSync(summaryPath) && fs.existsSync(reportSentPath)) {
    log(`[watchdog] ✅ 수집 실행이 정상 완료되었음을 확인했습니다: ${targetRun.name}`);
    return { ok: true, completedRun: targetRun.name };
  }

  // 완료되지 않은 경우 -> 에러 보고
  logError(`[watchdog] ❌ 최근 수집 실행이 완료되지 않았습니다 (완료 보고 누락): ${targetRun.name}`);

  const lock = checkLock();
  const { latestFile } = findLatestFile(targetRun.fullPath);
  const lastFileInfo = `${targetRun.name} / ${latestFile || '파일 없음'}`;

  const detailLines = [
    `• 대상 runId: \`${targetRun.name}\``,
    `• 실행 잠금(.lock): ${lock ? `활성 (\`${lock.runId}\`, ${lock.acquiredAt})` : '해제 상태 (유휴)'}`,
    `• 최근 변경 산출물: \`${lastFileInfo}\``,
    `• 검사 시각: \`${kstIso()}\``
  ];

  if (!options.skipNotify) {
    await sendDiscordErrorReport({
      stage: '워치독(Watchdog)',
      error: `수집 실행 미완료 (\`${targetRun.name}\` 완료 보고 누락)`,
      detail: detailLines.join('\n')
    });
  }

  return {
    ok: false,
    reason: 'RUN_INCOMPLETE',
    lastRun: targetRun.name,
    lock,
    lastFileInfo
  };
}

// CLI 지원
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--runsDir') options.runsDir = args[++i];
    else if (args[i] === '--run') options.runId = args[++i];
    else if (args[i] === '--skipNotify') options.skipNotify = true;
  }

  runWatchdog(options)
    .then(res => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.ok ? 0 : 1);
    })
    .catch(err => {
      logError('[watchdog] 실행 오류:', err);
      process.exit(1);
    });
}

module.exports = {
  runWatchdog,
  getRunStartTime
};
