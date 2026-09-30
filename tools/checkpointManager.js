const fs = require('fs');
const path = require('path');
const { log } = require('./logger');

const CHECKPOINT_DIR = path.resolve(__dirname, '..', 'data');
const CHECKPOINT_FILE = path.resolve(CHECKPOINT_DIR, 'checkpoint.json');

/**
 * 체크포인트 데이터 로드
 */
function loadAllCheckpoints() {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'));
    }
  } catch (e) {
    log('[Checkpoint] 파일 로드 실패, 빈 객체로 시작합니다:', e.message);
  }
  return {};
}

/**
 * 특정 플랫폼/트랙의 체크포인트 반환
 * @param {string} trackKey 예: 'saramin_track1', 'saramin_track2', 'wanted', 'jobkorea'
 */
function getCheckpoint(trackKey) {
  const all = loadAllCheckpoints();
  return all[trackKey] || null;
}

/**
 * 특정 플랫폼/트랙의 체크포인트 갱신 저장
 * @param {string} trackKey 
 * @param {Object} data { headJobId, headWindow, tailJobId, tailWindow }
 */
function saveCheckpoint(trackKey, { headJobId, headWindow = [], tailJobId, tailWindow = [] }) {
  try {
    if (!fs.existsSync(CHECKPOINT_DIR)) {
      fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
    }

    const all = loadAllCheckpoints();
    all[trackKey] = {
      headJobId: headJobId || all[trackKey]?.headJobId || null,
      headWindow: headWindow.length > 0 ? headWindow : (all[trackKey]?.headWindow || []),
      tailJobId: tailJobId || all[trackKey]?.tailJobId || null,
      tailWindow: tailWindow.length > 0 ? tailWindow : (all[trackKey]?.tailWindow || []),
      updatedAt: new Date(Date.now() + (9 * 60 * 60 * 1000)).toISOString()
    };

    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(all, null, 2), 'utf8');
    log(`[Checkpoint] ✅ [${trackKey}] 상태 갱신 완료 (Head: ${all[trackKey].headJobId}, Tail: ${all[trackKey].tailJobId})`);
    return all[trackKey];
  } catch (e) {
    log('[Checkpoint] 상태 저장 실패:', e.message);
  }
}

/**
 * 현재 공고 ID가 Head(검증 완료 구간의 시작 앵커)에 도달했는지 확인
 */
function isHeadHit(jobId, checkpoint) {
  if (!checkpoint || !jobId) return false;
  if (checkpoint.headJobId && String(checkpoint.headJobId) === String(jobId)) return true;
  if (Array.isArray(checkpoint.headWindow) && checkpoint.headWindow.map(String).includes(String(jobId))) return true;
  return false;
}

/**
 * 현재 공고 ID가 Tail(검증 완료 구간의 끝 앵커)에 도달했는지 확인
 */
function isTailHit(jobId, checkpoint) {
  if (!checkpoint || !jobId) return false;
  if (checkpoint.tailJobId && String(checkpoint.tailJobId) === String(jobId)) return true;
  if (Array.isArray(checkpoint.tailWindow) && checkpoint.tailWindow.map(String).includes(String(jobId))) return true;
  return false;
}

// CLI 테스트 지원
if (require.main === module) {
  const args = process.argv.slice(2);
  const action = args[0];
  const track = args[1];

  if (action === 'get') {
    console.log(JSON.stringify(getCheckpoint(track || 'saramin_track1'), null, 2));
  } else if (action === 'set') {
    const head = args[2];
    const tail = args[3];
    saveCheckpoint(track || 'test_track', { headJobId: head, tailJobId: tail });
  } else {
    console.log(JSON.stringify(loadAllCheckpoints(), null, 2));
  }
}

module.exports = {
  getCheckpoint,
  saveCheckpoint,
  isHeadHit,
  isTailHit,
  loadAllCheckpoints
};
