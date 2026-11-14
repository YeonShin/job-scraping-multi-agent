const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { step } = require('../tools/scanController');
const checkpointManager = require('../tools/checkpointManager');

const TEST_DIR = path.resolve(__dirname, 'scratch_test_scan_controller');
const RUNS_DIR = path.resolve(TEST_DIR, 'runs');
const CP_DIR = path.resolve(TEST_DIR, 'checkpoints');
const CONFIG_PATH = path.resolve(TEST_DIR, 'pipeline.json');

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

function createConfig(overrides = {}) {
  const cfg = {
    windowSize: 3,
    maxQueuedPerTrack: 300,
    maxPagesPerTrack: 150,
    maxPhase2Pages: 100,
    jumpEnabled: { saramin: true, jobkorea: false, wanted: false },
    expectedFilters: {
      saramin_track1: ["exp_cd=1", "cat_mcls=2", "company_type=scale001,scale002,scale003", "sort=RD"],
      saramin_track2: ["cat_kewd=92,87", "exp_cd=1", "sort=RD"],
      jobkorea_track1: ["신입", "대기업", "중견기업"],
      wanted_track2: ["job_sort=job.latest_order", "years=0"]
    },
    ...overrides
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  return CONFIG_PATH;
}

function writePageInput(dir, filename, data) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.resolve(dir, filename);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  return p;
}

describe('scanController 단위 테스트 (ranges 전용 스키마)', () => {
  beforeEach(() => {
    cleanup();
    fs.mkdirSync(RUNS_DIR, { recursive: true });
    fs.mkdirSync(CP_DIR, { recursive: true });
    createConfig();
  });

  afterEach(() => {
    cleanup();
  });

  test('1. 첫 실행(체크포인트 없음)이 상한(LIMIT_QUEUED)에서 멈춤 -> ranges[0] 에 sessionTop ~ 마지막 처리분 기록', () => {
    createConfig({ maxQueuedPerTrack: 3 });
    const runId = 'test-run-1';
    const inputDir = path.resolve(TEST_DIR, 'inputs');

    const items = [
      { id: '100', url: 'https://saramin.co.kr/view?rec_idx=100', title: '개발자1', company: '회사1', career: '신입' },
      { id: '90', url: 'https://saramin.co.kr/view?rec_idx=90', title: '개발자2', company: '회사2', career: '신입' },
      { id: '80', url: 'https://saramin.co.kr/view?rec_idx=80', title: '개발자3', company: '회사3', career: '신입' },
      { id: '70', url: 'https://saramin.co.kr/view?rec_idx=70', title: '개발자4', company: '회사4', career: '신입' }
    ];

    const inputPath = writePageInput(inputDir, 'page1.json', {
      appliedFilters: ["exp_cd=1", "cat_mcls=2", "company_type=scale001,scale002,scale003", "sort=RD"],
      items
    });

    const res = step({
      runId,
      site: 'saramin',
      track: 'track1',
      page: 1,
      inputPath,
      configPath: CONFIG_PATH,
      runsDir: RUNS_DIR,
      checkpointsDir: CP_DIR
    });

    assert.equal(res.action, 'STOP');
    assert.equal(res.reason, 'LIMIT_QUEUED');

    const proposedPath = path.resolve(RUNS_DIR, runId, 'saramin_track1', 'proposed_checkpoint.json');
    assert.ok(fs.existsSync(proposedPath));
    const proposed = JSON.parse(fs.readFileSync(proposedPath, 'utf8'));

    assert.equal(proposed.ranges.length, 1);
    assert.equal(proposed.ranges[0].headJobId, '100');
    assert.deepEqual(proposed.ranges[0].headWindow, ['100', '90', '80']);
    assert.equal(proposed.ranges[0].tailJobId, '80');
  });

  test('2. 정상 실행: 신규 -> head 도달 -> Phase 2 스킵 -> tail 통과 -> Phase 3 수집 -> LIST_END', () => {
    const runId = 'test-run-2';
    const inputDir = path.resolve(TEST_DIR, 'inputs');

    const cpSiteDir = path.resolve(CP_DIR, 'saramin');
    fs.mkdirSync(cpSiteDir, { recursive: true });
    fs.writeFileSync(path.resolve(cpSiteDir, 'track1.json'), JSON.stringify({
      site: 'saramin',
      track: 'track1',
      ranges: [
        {
          headJobId: '100',
          headWindow: ['100', '95', '90'],
          tailJobId: '50',
          tailWindow: ['50', '45', '40'],
          tailPageHint: 2
        }
      ]
    }, null, 2), 'utf8');

    // Page 1: 신규 120, 110 -> 100(head 도달) -> Phase 2 전환
    const page1Path = writePageInput(inputDir, 'page1.json', {
      appliedFilters: ["exp_cd=1", "cat_mcls=2", "company_type=scale001,scale002,scale003", "sort=RD"],
      items: [
        { id: '120', url: 'https://saramin.co.kr/view?rec_idx=120', title: '개발자120', company: '회사A', career: '신입' },
        { id: '110', url: 'https://saramin.co.kr/view?rec_idx=110', title: '개발자110', company: '회사B', career: '신입' },
        { id: '100', url: 'https://saramin.co.kr/view?rec_idx=100', title: '개발자100', company: '회사C', career: '신입' }
      ]
    });

    const res1 = step({
      runId,
      site: 'saramin',
      track: 'track1',
      page: 1,
      inputPath: page1Path,
      configPath: CONFIG_PATH,
      runsDir: RUNS_DIR,
      checkpointsDir: CP_DIR
    });

    assert.equal(res1.phase, 2);
    assert.equal(res1.counters.queued, 2);

    // Page 2: 95, 90, 50 (모두 COVERED)
    const page2Path = writePageInput(inputDir, 'page2.json', {
      appliedFilters: ["exp_cd=1", "cat_mcls=2", "company_type=scale001,scale002,scale003", "sort=RD"],
      items: [
        { id: '95', url: 'https://saramin.co.kr/view?rec_idx=95', title: '개발자95', company: '회사D', career: '신입' },
        { id: '90', url: 'https://saramin.co.kr/view?rec_idx=90', title: '개발자90', company: '회사E', career: '신입' },
        { id: '50', url: 'https://saramin.co.kr/view?rec_idx=50', title: '개발자50', company: '회사F', career: '신입' }
      ]
    });

    step({
      runId,
      site: 'saramin',
      track: 'track1',
      page: 2,
      inputPath: page2Path,
      configPath: CONFIG_PATH,
      runsDir: RUNS_DIR,
      checkpointsDir: CP_DIR
    });

    // Page 3: 40(COVERED), 30(OLD -> Phase 3 전환), 20(OLD)
    const page3Path = writePageInput(inputDir, 'page3.json', {
      appliedFilters: ["exp_cd=1", "cat_mcls=2", "company_type=scale001,scale002,scale003", "sort=RD"],
      items: [
        { id: '40', url: 'https://saramin.co.kr/view?rec_idx=40', title: '개발자40', company: '회사G', career: '신입' },
        { id: '30', url: 'https://saramin.co.kr/view?rec_idx=30', title: '개발자30', company: '회사H', career: '신입' },
        { id: '20', url: 'https://saramin.co.kr/view?rec_idx=20', title: '개발자20', company: '회사I', career: '신입' }
      ]
    });

    const res3 = step({
      runId,
      site: 'saramin',
      track: 'track1',
      page: 3,
      inputPath: page3Path,
      configPath: CONFIG_PATH,
      runsDir: RUNS_DIR,
      checkpointsDir: CP_DIR
    });

    assert.equal(res3.phase, 3);
    assert.equal(res3.counters.queued, 4);

    // Page 4: 빈 목록 (새 id 0개 -> LIST_END)
    const page4Path = writePageInput(inputDir, 'page4.json', {
      appliedFilters: ["exp_cd=1", "cat_mcls=2", "company_type=scale001,scale002,scale003", "sort=RD"],
      items: []
    });

    const res4 = step({
      runId,
      site: 'saramin',
      track: 'track1',
      page: 4,
      inputPath: page4Path,
      configPath: CONFIG_PATH,
      runsDir: RUNS_DIR,
      checkpointsDir: CP_DIR
    });

    assert.equal(res4.action, 'STOP');
    assert.equal(res4.reason, 'LIST_END');

    const proposedPath = path.resolve(RUNS_DIR, runId, 'saramin_track1', 'proposed_checkpoint.json');
    const proposed = JSON.parse(fs.readFileSync(proposedPath, 'utf8'));

    assert.equal(proposed.ranges.length, 1);
    assert.equal(proposed.ranges[0].headJobId, '120');
    assert.deepEqual(proposed.ranges[0].headWindow, ['120', '110', '100']);
    assert.equal(proposed.ranges[0].tailJobId, '20');
    assert.deepEqual(proposed.ranges[0].tailWindow, ['40', '30', '20']);
  });

  test('3. headWindow 3개가 모두 삭제됨 -> 숫자 비교로 Phase 2 전환', () => {
    const runId = 'test-run-3';
    const inputDir = path.resolve(TEST_DIR, 'inputs');

    const cpSiteDir = path.resolve(CP_DIR, 'saramin');
    fs.mkdirSync(cpSiteDir, { recursive: true });
    fs.writeFileSync(path.resolve(cpSiteDir, 'track1.json'), JSON.stringify({
      site: 'saramin',
      track: 'track1',
      ranges: [
        {
          headJobId: '100',
          headWindow: ['100', '95', '90'],
          tailJobId: '50',
          tailWindow: ['50', '45', '40']
        }
      ]
    }, null, 2), 'utf8');

    const page1Path = writePageInput(inputDir, 'page1.json', {
      appliedFilters: ["exp_cd=1", "cat_mcls=2", "company_type=scale001,scale002,scale003", "sort=RD"],
      items: [
        { id: '110', url: 'https://saramin.co.kr/view?rec_idx=110', title: '개발자110', company: '회사A', career: '신입' },
        { id: '85', url: 'https://saramin.co.kr/view?rec_idx=85', title: '개발자85', company: '회사B', career: '신입' }
      ]
    });

    const res = step({
      runId,
      site: 'saramin',
      track: 'track1',
      page: 1,
      inputPath: page1Path,
      configPath: CONFIG_PATH,
      runsDir: RUNS_DIR,
      checkpointsDir: CP_DIR
    });

    assert.equal(res.phase, 2);
    assert.equal(res.counters.coveredSkipped, 1);
  });

  test('4. tailWindow 3개가 모두 마감되어 사라짐 -> 숫자 비교로 Phase 3 전환', () => {
    const runId = 'test-run-4';
    const inputDir = path.resolve(TEST_DIR, 'inputs');

    const cpSiteDir = path.resolve(CP_DIR, 'saramin');
    fs.mkdirSync(cpSiteDir, { recursive: true });
    fs.writeFileSync(path.resolve(cpSiteDir, 'track1.json'), JSON.stringify({
      site: 'saramin',
      track: 'track1',
      ranges: [
        {
          headJobId: '100',
          headWindow: ['100', '95', '90'],
          tailJobId: '50',
          tailWindow: ['50', '45', '40']
        }
      ]
    }, null, 2), 'utf8');

    const p1 = writePageInput(inputDir, 'p1.json', {
      appliedFilters: ["exp_cd=1", "cat_mcls=2", "company_type=scale001,scale002,scale003", "sort=RD"],
      items: [{ id: '95', url: 'https://saramin.co.kr/view?rec_idx=95', title: '개발자95', company: '회사A', career: '신입' }]
    });
    step({ runId, site: 'saramin', track: 'track1', page: 1, inputPath: p1, configPath: CONFIG_PATH, runsDir: RUNS_DIR, checkpointsDir: CP_DIR });

    const p2 = writePageInput(inputDir, 'p2.json', {
      appliedFilters: ["exp_cd=1", "cat_mcls=2", "company_type=scale001,scale002,scale003", "sort=RD"],
      items: [{ id: '35', url: 'https://saramin.co.kr/view?rec_idx=35', title: '개발자35', company: '회사B', career: '신입' }]
    });
    const res2 = step({ runId, site: 'saramin', track: 'track1', page: 2, inputPath: p2, configPath: CONFIG_PATH, runsDir: RUNS_DIR, checkpointsDir: CP_DIR });

    assert.equal(res2.phase, 3);
    assert.equal(res2.counters.queued, 1);
  });

  test('5. 끌어올리기: tail 보다 작은 오래된 id 가 1페이지 상단에 등장 -> OLD 로 수집 대상, 구간 판정은 깨지지 않음', () => {
    const runId = 'test-run-5';
    const inputDir = path.resolve(TEST_DIR, 'inputs');

    const cpSiteDir = path.resolve(CP_DIR, 'saramin');
    fs.mkdirSync(cpSiteDir, { recursive: true });
    fs.writeFileSync(path.resolve(cpSiteDir, 'track1.json'), JSON.stringify({
      site: 'saramin',
      track: 'track1',
      ranges: [
        {
          headJobId: '100',
          headWindow: ['100', '95', '90'],
          tailJobId: '50',
          tailWindow: ['50', '45', '40']
        }
      ]
    }, null, 2), 'utf8');

    const p1 = writePageInput(inputDir, 'p1.json', {
      appliedFilters: ["exp_cd=1", "cat_mcls=2", "company_type=scale001,scale002,scale003", "sort=RD"],
      items: [
        { id: '110', url: 'https://saramin.co.kr/view?rec_idx=110', title: '개발자110', company: '회사A', career: '신입' },
        { id: '30', url: 'https://saramin.co.kr/view?rec_idx=30', title: '끌올30', company: '회사B', career: '신입' },
        { id: '105', url: 'https://saramin.co.kr/view?rec_idx=105', title: '개발자105', company: '회사C', career: '신입' }
      ]
    });

    const res = step({
      runId,
      site: 'saramin',
      track: 'track1',
      page: 1,
      inputPath: p1,
      configPath: CONFIG_PATH,
      runsDir: RUNS_DIR,
      checkpointsDir: CP_DIR
    });

    assert.equal(res.phase, 1);
    assert.equal(res.counters.queued, 3);
  });

  test('6. Phase 1 도중 LIMIT_QUEUED -> 다중 구간(ranges)으로 신규 상단 구간과 기존 구간이 모두 보존됨', () => {
    createConfig({ maxQueuedPerTrack: 2 });
    const runId = 'test-run-6';
    const inputDir = path.resolve(TEST_DIR, 'inputs');

    const cpSiteDir = path.resolve(CP_DIR, 'saramin');
    fs.mkdirSync(cpSiteDir, { recursive: true });
    fs.writeFileSync(path.resolve(cpSiteDir, 'track1.json'), JSON.stringify({
      site: 'saramin',
      track: 'track1',
      ranges: [
        {
          headJobId: '100',
          headWindow: ['100', '95', '90'],
          tailJobId: '50',
          tailWindow: ['50', '45', '40']
        }
      ]
    }, null, 2), 'utf8');

    const p1 = writePageInput(inputDir, 'p1.json', {
      appliedFilters: ["exp_cd=1", "cat_mcls=2", "company_type=scale001,scale002,scale003", "sort=RD"],
      items: [
        { id: '130', url: 'https://saramin.co.kr/view?rec_idx=130', title: '개발자130', company: '회사A', career: '신입' },
        { id: '125', url: 'https://saramin.co.kr/view?rec_idx=125', title: '개발자125', company: '회사B', career: '신입' },
        { id: '120', url: 'https://saramin.co.kr/view?rec_idx=120', title: '개발자120', company: '회사C', career: '신입' }
      ]
    });

    const res = step({
      runId,
      site: 'saramin',
      track: 'track1',
      page: 1,
      inputPath: p1,
      configPath: CONFIG_PATH,
      runsDir: RUNS_DIR,
      checkpointsDir: CP_DIR
    });

    assert.equal(res.action, 'STOP');
    assert.equal(res.reason, 'LIMIT_QUEUED');

    const proposedPath = path.resolve(RUNS_DIR, runId, 'saramin_track1', 'proposed_checkpoint.json');
    const proposed = JSON.parse(fs.readFileSync(proposedPath, 'utf8'));

    assert.equal(proposed.ranges.length, 2);
    assert.equal(proposed.ranges[0].headJobId, '130');
    assert.equal(proposed.ranges[0].tailJobId, '125');
    assert.equal(proposed.ranges[1].headJobId, '100');
    assert.equal(proposed.ranges[1].tailJobId, '50');

    assert.equal(checkpointManager.classifyId('125', proposed), 'COVERED');
    assert.equal(checkpointManager.classifyId('115', proposed), 'NEW');
    assert.equal(checkpointManager.classifyId('95', proposed), 'COVERED');
    assert.equal(checkpointManager.classifyId('30', proposed), 'OLD');
  });

  test('7. 점프가 tail 을 지나침 -> 되돌아오기', () => {
    const runId = 'test-run-7';
    const inputDir = path.resolve(TEST_DIR, 'inputs');

    const cpSiteDir = path.resolve(CP_DIR, 'saramin');
    fs.mkdirSync(cpSiteDir, { recursive: true });
    fs.writeFileSync(path.resolve(cpSiteDir, 'track1.json'), JSON.stringify({
      site: 'saramin',
      track: 'track1',
      ranges: [
        {
          headJobId: '100',
          headWindow: ['100', '95', '90'],
          tailJobId: '50',
          tailWindow: ['50', '45', '40'],
          tailPageHint: 5
        }
      ]
    }, null, 2), 'utf8');

    const p1 = writePageInput(inputDir, 'p1.json', {
      appliedFilters: ["exp_cd=1", "cat_mcls=2", "company_type=scale001,scale002,scale003", "sort=RD"],
      items: [
        { id: '105', url: 'https://saramin.co.kr/view?rec_idx=105', title: '개발자105', company: '회사A', career: '신입' },
        { id: '95', url: 'https://saramin.co.kr/view?rec_idx=95', title: '개발자95', company: '회사B', career: '신입' }
      ]
    });
    step({ runId, site: 'saramin', track: 'track1', page: 1, inputPath: p1, configPath: CONFIG_PATH, runsDir: RUNS_DIR, checkpointsDir: CP_DIR });

    const p2 = writePageInput(inputDir, 'p2.json', {
      appliedFilters: ["exp_cd=1", "cat_mcls=2", "company_type=scale001,scale002,scale003", "sort=RD"],
      items: [
        { id: '90', url: 'https://saramin.co.kr/view?rec_idx=90', title: '개발자90', company: '회사C', career: '신입' },
        { id: '85', url: 'https://saramin.co.kr/view?rec_idx=85', title: '개발자85', company: '회사D', career: '신입' }
      ]
    });
    const resJump = step({ runId, site: 'saramin', track: 'track1', page: 2, inputPath: p2, configPath: CONFIG_PATH, runsDir: RUNS_DIR, checkpointsDir: CP_DIR });
    assert.equal(resJump.action, 'JUMP_PAGE');
    assert.equal(resJump.page, 6);

    const p6 = writePageInput(inputDir, 'p6.json', {
      appliedFilters: ["exp_cd=1", "cat_mcls=2", "company_type=scale001,scale002,scale003", "sort=RD"],
      items: [
        { id: '35', url: 'https://saramin.co.kr/view?rec_idx=35', title: '개발자35', company: '회사E', career: '신입' }
      ]
    });
    const resBack = step({ runId, site: 'saramin', track: 'track1', page: 6, inputPath: p6, configPath: CONFIG_PATH, runsDir: RUNS_DIR, checkpointsDir: CP_DIR });
    assert.equal(resBack.action, 'JUMP_PAGE');
    assert.equal(resBack.page, 5);

    const p5 = writePageInput(inputDir, 'p5.json', {
      appliedFilters: ["exp_cd=1", "cat_mcls=2", "company_type=scale001,scale002,scale003", "sort=RD"],
      items: [
        { id: '50', url: 'https://saramin.co.kr/view?rec_idx=50', title: '개발자50', company: '회사F', career: '신입' },
        { id: '45', url: 'https://saramin.co.kr/view?rec_idx=45', title: '개발자45', company: '회사G', career: '신입' }
      ]
    });
    const resForward = step({ runId, site: 'saramin', track: 'track1', page: 5, inputPath: p5, configPath: CONFIG_PATH, runsDir: RUNS_DIR, checkpointsDir: CP_DIR });
    assert.equal(resForward.action, 'NEXT_PAGE');
    assert.equal(resForward.page, 6);
  });

  test('8. 필터 불일치 -> STOP FILTER_MISMATCH, proposed_checkpoint 는 기존 값 유지', () => {
    const runId = 'test-run-8';
    const inputDir = path.resolve(TEST_DIR, 'inputs');

    const cpSiteDir = path.resolve(CP_DIR, 'saramin');
    fs.mkdirSync(cpSiteDir, { recursive: true });
    fs.writeFileSync(path.resolve(cpSiteDir, 'track1.json'), JSON.stringify({
      site: 'saramin',
      track: 'track1',
      ranges: [
        {
          headJobId: '100',
          headWindow: ['100', '95', '90'],
          tailJobId: '50',
          tailWindow: ['50', '45', '40']
        }
      ]
    }, null, 2), 'utf8');

    const p1 = writePageInput(inputDir, 'p1.json', {
      appliedFilters: ["exp_cd=1"],
      items: [
        { id: '120', url: 'https://saramin.co.kr/view?rec_idx=120', title: '개발자120', company: '회사A', career: '신입' }
      ]
    });

    const res = step({
      runId,
      site: 'saramin',
      track: 'track1',
      page: 1,
      inputPath: p1,
      configPath: CONFIG_PATH,
      runsDir: RUNS_DIR,
      checkpointsDir: CP_DIR
    });

    assert.equal(res.action, 'STOP');
    assert.equal(res.reason, 'FILTER_MISMATCH');

    const proposedPath = path.resolve(RUNS_DIR, runId, 'saramin_track1', 'proposed_checkpoint.json');
    const proposed = JSON.parse(fs.readFileSync(proposedPath, 'utf8'));

    assert.equal(proposed.ranges.length, 1);
    assert.equal(proposed.ranges[0].headJobId, '100');
    assert.equal(proposed.ranges[0].tailJobId, '50');
  });

  test('9. commitRun: publish_result.json 이 없으면 에러 발생', () => {
    const runId = 'test-run-commit-fail';
    const runDir = path.resolve(RUNS_DIR, runId);
    fs.mkdirSync(runDir, { recursive: true });

    assert.throws(() => {
      checkpointManager.commitRun(runId, RUNS_DIR, CP_DIR);
    }, /publish_result\.json/);
  });

  test('10. commitRun: 정상 반영 및 FILTER_MISMATCH 트랙 제외', () => {
    const runId = 'test-run-commit-success';
    const runDir = path.resolve(RUNS_DIR, runId);
    fs.mkdirSync(runDir, { recursive: true });

    fs.writeFileSync(path.resolve(runDir, 'publish_result.json'), JSON.stringify({ published: 5 }), 'utf8');

    const t1Dir = path.resolve(runDir, 'saramin_track1');
    fs.mkdirSync(t1Dir, { recursive: true });
    fs.writeFileSync(path.resolve(t1Dir, 'state.json'), JSON.stringify({ stopReason: 'LIST_END' }), 'utf8');
    fs.writeFileSync(path.resolve(t1Dir, 'proposed_checkpoint.json'), JSON.stringify({
      site: 'saramin',
      track: 'track1',
      ranges: [
        {
          headJobId: '200',
          headWindow: ['200', '190'],
          tailJobId: '10',
          tailWindow: ['20', '10']
        }
      ]
    }), 'utf8');

    const t2Dir = path.resolve(runDir, 'jobkorea_track1');
    fs.mkdirSync(t2Dir, { recursive: true });
    fs.writeFileSync(path.resolve(t2Dir, 'state.json'), JSON.stringify({ stopReason: 'FILTER_MISMATCH' }), 'utf8');
    fs.writeFileSync(path.resolve(t2Dir, 'proposed_checkpoint.json'), JSON.stringify({
      site: 'jobkorea',
      track: 'track1',
      ranges: [
        {
          headJobId: '999',
          tailJobId: '888'
        }
      ]
    }), 'utf8');

    const result = checkpointManager.commitRun(runId, RUNS_DIR, CP_DIR);

    assert.deepEqual(result.committed, ['saramin_track1']);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].reason, 'FILTER_MISMATCH');

    const actualCpPath = path.resolve(CP_DIR, 'saramin', 'track1.json');
    assert.ok(fs.existsSync(actualCpPath));
    const actualCp = JSON.parse(fs.readFileSync(actualCpPath, 'utf8'));
    assert.equal(actualCp.ranges.length, 1);
    assert.equal(actualCp.ranges[0].headJobId, '200');
    assert.equal(actualCp.ranges[0].tailJobId, '10');

    const jkCpPath = path.resolve(CP_DIR, 'jobkorea', 'track1.json');
    assert.ok(!fs.existsSync(jkCpPath));
  });

  test('11. 다중 구간(Multi-Range) 점프 및 구간 자동 병합(Merge) 시뮬레이션', () => {
    const runId = 'test-run-multi-merge';
    const inputDir = path.resolve(TEST_DIR, 'inputs');

    const cpSiteDir = path.resolve(CP_DIR, 'saramin');
    fs.mkdirSync(cpSiteDir, { recursive: true });
    fs.writeFileSync(path.resolve(cpSiteDir, 'track1.json'), JSON.stringify({
      site: 'saramin',
      track: 'track1',
      ranges: [
        {
          headJobId: '1200',
          headWindow: ['1200', '1199', '1198'],
          tailJobId: '1101',
          tailWindow: ['1103', '1102', '1101'],
          tailPageHint: 5
        },
        {
          headJobId: '1000',
          headWindow: ['1000', '999', '998'],
          tailJobId: '901',
          tailWindow: ['903', '902', '901'],
          tailPageHint: 15
        }
      ]
    }, null, 2), 'utf8');

    // 1페이지: 1200, 1199 (첫 번째 구간 COVERED) -> 즉시 pageHint(5)로 점프!
    const p1 = writePageInput(inputDir, 'p1.json', {
      appliedFilters: ["exp_cd=1", "cat_mcls=2", "company_type=scale001,scale002,scale003", "sort=RD"],
      items: [
        { id: '1200', url: 'https://saramin.co.kr/view?rec_idx=1200', title: '개발자1200', company: '회사A', career: '신입' },
        { id: '1199', url: 'https://saramin.co.kr/view?rec_idx=1199', title: '개발자1199', company: '회사B', career: '신입' }
      ]
    });
    const res1 = step({ runId, site: 'saramin', track: 'track1', page: 1, inputPath: p1, configPath: CONFIG_PATH, runsDir: RUNS_DIR, checkpointsDir: CP_DIR });
    assert.equal(res1.action, 'JUMP_PAGE');
    assert.equal(res1.page, 5);

    // 5페이지: 1101(첫 구간 끝 COVERED), 1100(중간 Gap NEW), 1050(중간 Gap NEW)
    const p5 = writePageInput(inputDir, 'p5.json', {
      appliedFilters: ["exp_cd=1", "cat_mcls=2", "company_type=scale001,scale002,scale003", "sort=RD"],
      items: [
        { id: '1101', url: 'https://saramin.co.kr/view?rec_idx=1101', title: '개발자1101', company: '회사C', career: '신입' },
        { id: '1100', url: 'https://saramin.co.kr/view?rec_idx=1100', title: '개발자1100', company: '회사D', career: '신입' },
        { id: '1050', url: 'https://saramin.co.kr/view?rec_idx=1050', title: '개발자1050', company: '회사E', career: '신입' }
      ]
    });
    const res5 = step({ runId, site: 'saramin', track: 'track1', page: 5, inputPath: p5, configPath: CONFIG_PATH, runsDir: RUNS_DIR, checkpointsDir: CP_DIR });
    assert.equal(res5.action, 'NEXT_PAGE');
    assert.equal(res5.counters.queued, 2);

    // 6페이지: 1001(중간 Gap NEW), 1000(두 번째 구간 Head COVERED!) -> 두 구간이 하나로 연결됨
    const p6 = writePageInput(inputDir, 'p6.json', {
      appliedFilters: ["exp_cd=1", "cat_mcls=2", "company_type=scale001,scale002,scale003", "sort=RD"],
      items: [
        { id: '1001', url: 'https://saramin.co.kr/view?rec_idx=1001', title: '개발자1001', company: '회사F', career: '신입' },
        { id: '1000', url: 'https://saramin.co.kr/view?rec_idx=1000', title: '개발자1000', company: '회사G', career: '신입' }
      ]
    });
    const res6 = step({ runId, site: 'saramin', track: 'track1', page: 6, inputPath: p6, configPath: CONFIG_PATH, runsDir: RUNS_DIR, checkpointsDir: CP_DIR });
    assert.equal(res6.counters.queued, 3);

    // 7페이지: 빈 페이지(LIST_END)로 종료
    const p7 = writePageInput(inputDir, 'p7.json', {
      appliedFilters: ["exp_cd=1", "cat_mcls=2", "company_type=scale001,scale002,scale003", "sort=RD"],
      items: []
    });
    const res7 = step({ runId, site: 'saramin', track: 'track1', page: 7, inputPath: p7, configPath: CONFIG_PATH, runsDir: RUNS_DIR, checkpointsDir: CP_DIR });
    assert.equal(res7.action, 'STOP');
    assert.equal(res7.reason, 'LIST_END');

    const proposedPath = path.resolve(RUNS_DIR, runId, 'saramin_track1', 'proposed_checkpoint.json');
    const proposed = JSON.parse(fs.readFileSync(proposedPath, 'utf8'));

    assert.equal(proposed.ranges.length, 1);
    assert.equal(proposed.ranges[0].headJobId, '1200');
    assert.equal(proposed.ranges[0].tailJobId, '901');
  });
});
