const fs = require('fs');
const path = require('path');
const { log, error: logError } = require('./logger');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const RUNS_DIR = path.resolve(DATA_DIR, 'runs');
const LOCK_FILE = path.resolve(RUNS_DIR, '.lock');
const LOCK_TIMEOUT_MS = 6 * 60 * 60 * 1000; // 6시간

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

/**
 * 잠금 획득
 */
function acquire(runId, customLockPath = null) {
  const lockPath = customLockPath || LOCK_FILE;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  if (fs.existsSync(lockPath)) {
    let existing = null;
    try {
      existing = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    } catch (e) {
      // JSON 깨짐 -> 회수 가능
    }

    if (existing && existing.acquiredAt) {
      const lockTime = new Date(existing.acquiredAt).getTime();
      const now = Date.now();
      const elapsed = now - lockTime;

      if (!isNaN(lockTime) && elapsed < LOCK_TIMEOUT_MS) {
        const remainingMin = Math.round((LOCK_TIMEOUT_MS - elapsed) / 60000);
        logError(`[runLock] 실행 중인 세션이 있습니다: ${existing.runId} (획득: ${existing.acquiredAt}, 만료까지 ${remainingMin}분 남음). 새 실행 거부.`);
        return { success: false, existing };
      }

      log(`[runLock] 오래된 잠금 발견 (${existing.runId}, ${existing.acquiredAt}, 경과: ${Math.round(elapsed / 3600000)}시간). 잠금을 회수하고 새로 획득합니다.`);
    }
  }

  const lockData = {
    runId,
    pid: process.pid,
    acquiredAt: getKstIsoString()
  };

  fs.writeFileSync(lockPath, JSON.stringify(lockData, null, 2), 'utf8');
  log(`[runLock] 잠금 획득 완료: ${runId} (PID: ${process.pid})`);
  return { success: true, lockData };
}

/**
 * 잠금 해제
 */
function release(runId = null, customLockPath = null) {
  const lockPath = customLockPath || LOCK_FILE;

  if (!fs.existsSync(lockPath)) {
    log('[runLock] 해제할 잠금 파일이 존재하지 않습니다.');
    return { success: true, message: 'NO_LOCK_FILE' };
  }

  if (runId) {
    try {
      const existing = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      if (existing.runId && existing.runId !== runId) {
        log(`[runLock] 경고: 현재 잠금 보유 runId(${existing.runId})와 해제 요청 runId(${runId})가 일치하지 않습니다.`);
      }
    } catch (e) {}
  }

  try {
    fs.unlinkSync(lockPath);
    log(`[runLock] 잠금 해제 완료: ${runId || 'current'}`);
    return { success: true };
  } catch (err) {
    logError('[runLock] 잠금 파일 삭제 실패:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 잠금 상태 확인
 */
function check(customLockPath = null) {
  const lockPath = customLockPath || LOCK_FILE;
  if (!fs.existsSync(lockPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (e) {
    return null;
  }
}

// CLI 지원
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  let runId = null;
  let customLockPath = null;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--run') runId = args[++i];
    else if (args[i] === '--lock') customLockPath = args[++i];
  }

  if (command === 'acquire') {
    if (!runId) {
      console.error('사용법: node tools/runLock.js acquire --run <runId>');
      process.exit(1);
    }
    const res = acquire(runId, customLockPath);
    if (!res.success) process.exit(1);
    console.log(JSON.stringify(res, null, 2));
    process.exit(0);
  } else if (command === 'release') {
    const res = release(runId, customLockPath);
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.success ? 0 : 1);
  } else if (command === 'check' || command === 'status') {
    const lock = check(customLockPath);
    console.log(JSON.stringify({ locked: !!lock, lock }, null, 2));
    process.exit(0);
  } else {
    console.error('사용법: node tools/runLock.js <acquire|release|status> [--run <runId>]');
    process.exit(1);
  }
}

module.exports = {
  acquire,
  release,
  check,
  LOCK_FILE,
  LOCK_TIMEOUT_MS
};
