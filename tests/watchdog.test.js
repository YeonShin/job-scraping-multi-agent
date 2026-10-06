const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runWatchdog } = require('../tools/watchdog');

const TEST_RUNS_DIR = path.resolve(__dirname, 'temp_watchdog_test');

test('watchdog 단위 테스트', async (t) => {
  if (fs.existsSync(TEST_RUNS_DIR)) {
    fs.rmSync(TEST_RUNS_DIR, { recursive: true, force: true });
  }

  t.after(() => {
    if (fs.existsSync(TEST_RUNS_DIR)) {
      fs.rmSync(TEST_RUNS_DIR, { recursive: true, force: true });
    }
  });

  await t.test('1. 실행 기록(run)이 전혀 없으면 NO_RUNS_FOUND 에러 판정', async () => {
    fs.mkdirSync(TEST_RUNS_DIR, { recursive: true });
    const res = await runWatchdog({
      runsDir: TEST_RUNS_DIR,
      skipNotify: true
    });

    assert.equal(res.ok, false);
    assert.equal(res.reason, 'NO_RUNS_FOUND');
  });

  await t.test('2. summary.json 은 있지만 report_sent.json 이 없으면 미완료 판정', async () => {
    const runDir = path.join(TEST_RUNS_DIR, '20261005-0300');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'summary.json'), '{}', 'utf8');

    const res = await runWatchdog({
      runsDir: TEST_RUNS_DIR,
      skipNotify: true
    });

    assert.equal(res.ok, false);
    assert.equal(res.reason, 'RUN_INCOMPLETE');
    assert.equal(res.lastRun, '20261005-0300');
  });

  await t.test('3. summary.json 과 report_sent.json 이 모두 있으면 정상 완료 판정', async () => {
    const runDir = path.join(TEST_RUNS_DIR, '20261005-0300');
    fs.writeFileSync(path.join(runDir, 'report_sent.json'), '{}', 'utf8');

    const res = await runWatchdog({
      runsDir: TEST_RUNS_DIR,
      skipNotify: true
    });

    assert.equal(res.ok, true);
    assert.equal(res.completedRun, '20261005-0300');
  });

  await t.test('4. 특정 runId 지정 검사 지원', async () => {
    const runDir1 = path.join(TEST_RUNS_DIR, '20261005-0100');
    fs.mkdirSync(runDir1, { recursive: true });
    fs.writeFileSync(path.join(runDir1, 'summary.json'), '{}', 'utf8');
    // report_sent.json 없음

    const resNotFound = await runWatchdog({
      runsDir: TEST_RUNS_DIR,
      runId: 'non-existent-run',
      skipNotify: true
    });
    assert.equal(resNotFound.ok, false);
    assert.equal(resNotFound.reason, 'RUN_NOT_FOUND');

    const resIncomplete = await runWatchdog({
      runsDir: TEST_RUNS_DIR,
      runId: '20261005-0100',
      skipNotify: true
    });
    assert.equal(resIncomplete.ok, false);
    assert.equal(resIncomplete.reason, 'RUN_INCOMPLETE');
    assert.equal(resIncomplete.lastRun, '20261005-0100');
  });
});
