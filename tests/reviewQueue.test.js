const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { getNextBatch, submitReview, getQueueStatus } = require('../tools/reviewQueue');
const registry = require('../tools/registry');

const TEST_DIR = path.resolve(__dirname, 'scratch_test_review_queue');
const RUNS_DIR = path.resolve(TEST_DIR, 'runs');
const REG_PATH = path.resolve(TEST_DIR, 'registry.json');
const CONFIG_PATH = path.resolve(TEST_DIR, 'pipeline.json');

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

describe('reviewQueue 단위 테스트', () => {
  beforeEach(() => {
    cleanup();
    fs.mkdirSync(RUNS_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ reviewBatchSize: 2 }, null, 2), 'utf8');
    fs.writeFileSync(REG_PATH, JSON.stringify({}, null, 2), 'utf8');
  });

  afterEach(() => {
    cleanup();
  });

  test('1. next: 배치 할당, 30분 lease 설정, 사람인 detailUrl 보정', () => {
    const runId = 'test-run-next';
    const runDir = path.resolve(RUNS_DIR, runId);
    fs.mkdirSync(runDir, { recursive: true });

    // review_queue.json 생성
    const queue = [
      {
        jobKey: 'saramin:1001',
        site: 'saramin',
        track: 'track1',
        url: 'https://saramin.co.kr/view?rec_idx=1001',
        title: '프론트엔드 개발자',
        company: '테스트회사'
      },
      {
        jobKey: 'wanted:2001',
        site: 'wanted',
        track: 'track2',
        url: 'https://wanted.co.kr/wd/2001',
        title: '웹 개발자',
        company: '원티드회사'
      },
      {
        jobKey: 'jobkorea:3001',
        site: 'jobkorea',
        track: 'track1',
        url: 'https://jobkorea.co.kr/GI_Read/3001',
        title: 'SW 개발자',
        company: '잡코리아회사'
      }
    ];
    fs.writeFileSync(path.resolve(runDir, 'review_queue.json'), JSON.stringify(queue, null, 2), 'utf8');

    // next 1회 호출 (batchSize = 2)
    const batch1 = getNextBatch({ runId, runsDir: RUNS_DIR, configPath: CONFIG_PATH });
    assert.equal(batch1.count, 2);
    assert.equal(batch1.batchId, 'batch_1');
    assert.ok(fs.existsSync(batch1.batchPath));

    // 사람인 detailUrl 검증
    assert.ok(batch1.items[0].detailUrl.includes('view-detail?rec_idx=1001'));
    assert.ok(batch1.items[0].leasedAt);
    assert.ok(batch1.items[0].leasedUntil);

    // review_queue.json 이 갱신되었는지 확인
    const updatedQ = JSON.parse(fs.readFileSync(path.resolve(runDir, 'review_queue.json'), 'utf8'));
    assert.equal(updatedQ[0].batchId, 1);
    assert.ok(updatedQ[0].leasedUntil);

    // 곧바로 next 다시 호출 -> 남은 1건(jobkorea)만 반환
    const batch2 = getNextBatch({ runId, runsDir: RUNS_DIR, configPath: CONFIG_PATH });
    assert.equal(batch2.count, 1);
    assert.equal(batch2.batchId, 'batch_2');
    assert.equal(batch2.items[0].jobKey, 'jobkorea:3001');

    // 또 호출 -> 남은 건 0개
    const batch3 = getNextBatch({ runId, runsDir: RUNS_DIR, configPath: CONFIG_PATH });
    assert.equal(batch3.count, 0);
  });

  test('2. next: lease 30분 만료 시 재배정 가능', () => {
    const runId = 'test-run-lease-expire';
    const runDir = path.resolve(RUNS_DIR, runId);
    fs.mkdirSync(runDir, { recursive: true });

    // 이미 1시간 전 만료된 lease 상태의 항목
    const pastDate = new Date(Date.now() - 3600 * 1000).toISOString();
    const queue = [
      {
        jobKey: 'saramin:1001',
        site: 'saramin',
        track: 'track1',
        url: 'https://saramin.co.kr/view?rec_idx=1001',
        title: '개발자',
        company: '회사A',
        leasedUntil: pastDate
      }
    ];
    fs.writeFileSync(path.resolve(runDir, 'review_queue.json'), JSON.stringify(queue, null, 2), 'utf8');

    const batch = getNextBatch({ runId, runsDir: RUNS_DIR, configPath: CONFIG_PATH });
    assert.equal(batch.count, 1);
    assert.equal(batch.items[0].jobKey, 'saramin:1001');
  });

  test('3. submit: 스키마 위반 항목별 상세 오류 검증', () => {
    const runId = 'test-run-submit-errors';
    const runDir = path.resolve(RUNS_DIR, runId);
    fs.mkdirSync(runDir, { recursive: true });

    const queue = [
      { jobKey: 'saramin:1001', site: 'saramin', track: 'track1', title: '개발자' }
    ];
    fs.writeFileSync(path.resolve(runDir, 'review_queue.json'), JSON.stringify(queue, null, 2), 'utf8');

    // 케이스 A: 큐에 없는 jobKey
    const inputA = path.resolve(TEST_DIR, 'input_a.json');
    fs.writeFileSync(inputA, JSON.stringify({
      jobKey: 'saramin:9999',
      verdict: 'reject',
      reasonCode: 'CLOSED'
    }), 'utf8');
    const resA = submitReview({ runId, inputPath: inputA, runsDir: RUNS_DIR, registryPath: REG_PATH });
    assert.equal(resA.failedItems.length, 1);
    assert.ok(resA.failedItems[0].errors.some(e => e.includes('존재하지 않습니다')));

    // 케이스 B: reject 인데 reasonCode 누락
    const inputB = path.resolve(TEST_DIR, 'input_b.json');
    fs.writeFileSync(inputB, JSON.stringify({
      jobKey: 'saramin:1001',
      verdict: 'reject'
    }), 'utf8');
    const resB = submitReview({ runId, inputPath: inputB, runsDir: RUNS_DIR, registryPath: REG_PATH });
    assert.equal(resB.failedItems.length, 1);
    assert.ok(resB.failedItems[0].errors.some(e => e.includes('reasonCode는 필수')));

    // 케이스 C: pass 인데 summary 3줄 형식 위반 및 필수 필드 누락
    const inputC = path.resolve(TEST_DIR, 'input_c.json');
    fs.writeFileSync(inputC, JSON.stringify({
      jobKey: 'saramin:1001',
      verdict: 'pass',
      job: {
        company: '테스트',
        position: 'FE개발',
        url: 'https://...',
        jobCategory: '프론트엔드',
        experienceLevel: '신입',
        summary: '단순 요약 1줄입니다.' // 3줄 형식 누락
      }
    }), 'utf8');
    const resC = submitReview({ runId, inputPath: inputC, runsDir: RUNS_DIR, registryPath: REG_PATH });
    assert.equal(resC.failedItems.length, 1);
    assert.ok(resC.failedItems[0].errors.some(e => e.includes('세 요소를 모두 포함')));
  });

  test('4. submit: 정상 제출 시 results.jsonl 및 레지스트리 실시간 반영', () => {
    const runId = 'test-run-submit-success';
    const runDir = path.resolve(RUNS_DIR, runId);
    fs.mkdirSync(runDir, { recursive: true });

    const queue = [
      { jobKey: 'saramin:1001', site: 'saramin', track: 'track2', title: '프론트엔드 개발자', company: '토스뱅크' },
      { jobKey: 'saramin:1002', site: 'saramin', track: 'track2', title: '백엔드 개발자', company: '카카오' }
    ];
    fs.writeFileSync(path.resolve(runDir, 'review_queue.json'), JSON.stringify(queue, null, 2), 'utf8');

    // 1건 pass 제출
    const input1 = path.resolve(TEST_DIR, 'input_pass.json');
    fs.writeFileSync(input1, JSON.stringify({
      jobKey: 'saramin:1001',
      verdict: 'pass',
      job: {
        company: '토스뱅크',
        position: 'Frontend Developer',
        rawTitle: '프론트엔드 개발자',
        url: 'https://saramin.co.kr/view?rec_idx=1001',
        jobCategory: '프론트엔드',
        experienceLevel: '신입',
        employmentType: '정규직',
        summary: '• [지원 적합도]: 최고\n• [핵심 업무]: 코어 웹뷰\n• [어필 포인트]: TS 역량'
      }
    }), 'utf8');

    const res1 = submitReview({ runId, inputPath: input1, runsDir: RUNS_DIR, registryPath: REG_PATH });
    assert.equal(res1.successCount, 1);
    assert.equal(res1.failedItems.length, 0);

    // results.jsonl 확인
    const results = fs.readFileSync(path.resolve(runDir, 'results.jsonl'), 'utf8').trim().split('\n');
    assert.equal(results.length, 1);
    const parsedRes = JSON.parse(results[0]);
    assert.equal(parsedRes.jobKey, 'saramin:1001');

    // 레지스트리 확인: passed 로 기록되어 있어야 함
    const reg = registry.load(REG_PATH);
    assert.ok(reg['saramin:1001']);
    assert.equal(reg['saramin:1001'].verdict, 'passed');

    // 1건 reject 제출
    const input2 = path.resolve(TEST_DIR, 'input_reject.json');
    fs.writeFileSync(input2, JSON.stringify({
      jobKey: 'saramin:1002',
      verdict: 'reject',
      reasonCode: 'BACKEND_ONLY_TRACK2',
      reason: '순수 백엔드'
    }), 'utf8');

    const res2 = submitReview({ runId, inputPath: input2, runsDir: RUNS_DIR, registryPath: REG_PATH });
    assert.equal(res2.successCount, 1);

    const reg2 = registry.load(REG_PATH);
    assert.equal(reg2['saramin:1002'].verdict, 'rejected');
    assert.equal(reg2['saramin:1002'].reasonCode, 'BACKEND_ONLY_TRACK2');

    // 이중 제출 거부 (saramin:1001 다시 제출 시)
    const resDup = submitReview({ runId, inputPath: input1, runsDir: RUNS_DIR, registryPath: REG_PATH });
    assert.equal(resDup.failedItems.length, 1);
    assert.ok(resDup.failedItems[0].errors.some(e => e.includes('ALREADY_SUBMITTED')));
  });

  test('5. status: 대기/점유/완료 통계 정확성', () => {
    const runId = 'test-run-status';
    const runDir = path.resolve(RUNS_DIR, runId);
    fs.mkdirSync(runDir, { recursive: true });

    const futureDate = new Date(Date.now() + 1800 * 1000).toISOString();
    const queue = [
      { jobKey: 'k1', leasedUntil: null },
      { jobKey: 'k2', leasedUntil: futureDate },
      { jobKey: 'k3', leasedUntil: futureDate }
    ];
    fs.writeFileSync(path.resolve(runDir, 'review_queue.json'), JSON.stringify(queue, null, 2), 'utf8');

    // k3 만 results.jsonl 에 완료됨
    fs.writeFileSync(path.resolve(runDir, 'results.jsonl'), JSON.stringify({ jobKey: 'k3', verdict: 'pass' }) + '\n', 'utf8');

    const status = getQueueStatus({ runId, runsDir: RUNS_DIR });
    assert.equal(status.total, 3);
    assert.equal(status.waiting, 1);  // k1
    assert.equal(status.leased, 1);   // k2
    assert.equal(status.completed, 1);// k3
  });
});
