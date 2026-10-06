const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { acquire, release, check } = require('../tools/runLock');

const TEST_RUNS_DIR = path.resolve(__dirname, 'temp_runlock_test');
const TEST_LOCK_FILE = path.join(TEST_RUNS_DIR, '.lock');

test('runLock 단위 테스트', async (t) => {
  // 사전 정리
  if (fs.existsSync(TEST_RUNS_DIR)) {
    fs.rmSync(TEST_RUNS_DIR, { recursive: true, force: true });
  }

  t.after(() => {
    if (fs.existsSync(TEST_RUNS_DIR)) {
      fs.rmSync(TEST_RUNS_DIR, { recursive: true, force: true });
    }
  });

  await t.test('1. 최초 acquire 성공 및 .lock 파일 생성', () => {
    const res = acquire('test-run-1', TEST_LOCK_FILE);
    assert.equal(res.success, true);
    assert.equal(res.lockData.runId, 'test-run-1');
    assert.equal(fs.existsSync(TEST_LOCK_FILE), true);

    const lock = check(TEST_LOCK_FILE);
    assert.equal(lock.runId, 'test-run-1');
  });

  await t.test('2. 유효한 잠금이 있을 때 중복 acquire 거부', () => {
    const res = acquire('test-run-2', TEST_LOCK_FILE);
    assert.equal(res.success, false);
    assert.equal(res.existing.runId, 'test-run-1');
  });

  await t.test('3. release 호출 시 정상 해제', () => {
    const res = release('test-run-1', TEST_LOCK_FILE);
    assert.equal(res.success, true);
    assert.equal(fs.existsSync(TEST_LOCK_FILE), false);

    const lock = check(TEST_LOCK_FILE);
    assert.equal(lock, null);
  });

  await t.test('4. 6시간 초과된 오래된 잠금은 자동 회수하여 새 잠금 획득', () => {
    fs.mkdirSync(TEST_RUNS_DIR, { recursive: true });
    // 7시간 전 시각 생성
    const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(TEST_LOCK_FILE, JSON.stringify({
      runId: 'stale-run',
      pid: 1234,
      acquiredAt: sevenHoursAgo
    }), 'utf8');

    const res = acquire('new-run', TEST_LOCK_FILE);
    assert.equal(res.success, true);
    assert.equal(res.lockData.runId, 'new-run');

    const lock = check(TEST_LOCK_FILE);
    assert.equal(lock.runId, 'new-run');
  });
});
