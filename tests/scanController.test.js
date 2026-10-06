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

describe('scanController 단위 테스트', () => {
  beforeEach(() => {
    cleanup();
    fs.mkdirSync(RUNS_DIR, { recursive: true });
    fs.mkdirSync(CP_DIR, { recursive: true });
    createConfig();
  });

  afterEach(() => {
    cleanup();
  });

  test('1. 첫 실행(체크포인트 없음)이 상한(LIMIT_QUEUED)에서 멈춤 -> head=sessionTop, tail=마지막 처리분', () => {
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

    // proposed_checkpoint 확인
    const proposedPath = path.resolve(RUNS_DIR, runId, 'saramin_track1', 'proposed_checkpoint.json');
    assert.ok(fs.existsSync(proposedPath));
    const proposed = JSON.parse(fs.readFileSync(proposedPath, 'utf8'));

    assert.equal(proposed.headJobId, '100');
    assert.deepEqual(proposed.headWindow, ['100', '90', '80']);
    assert.equal(proposed.tailJobId, '80'); // 3개 처리 후 중단되었으므로 80이 마지막
  });

  test('2. 정상 실행: 신규 -> head 도달 -> Phase 2 스킵 -> tail 통과 -> Phase 3 수집 -> LIST_END', () => {
    const runId = 'test-run-2';
    const inputDir = path.resolve(TEST_DIR, 'inputs');

    // 기존 체크포인트 생성
    const cpSiteDir = path.resolve(CP_DIR, 'saramin');
    fs.mkdirSync(cpSiteDir, { recursive: true });
    fs.writeFileSync(path.resolve(cpSiteDir, 'track1.json'), JSON.stringify({
      site: 'saramin',
      track: 'track1',
      headJobId: '100',
      headWindow: ['100', '95', '90'],
      tailJobId: '50',
      tailWindow: ['50', '45', '40'],
      tailPageHint: 2
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
    assert.equal(res1.counters.queued, 2); // 120, 110

    // Page 2: 95, 90, 50 (모두 COVERED)
    const page2Path = writePageInput(inputDir, 'page2.json', {
      appliedFilters: ["exp_cd=1", "cat_mcls=2", "company_type=scale001,scale002,scale003", "sort=RD"],
      items: [
        { id: '95', url: 'https://saramin.co.kr/view?rec_idx=95', title: '개발자95', company: '회사D', career: '신입' },
        { id: '90', url: 'https://saramin.co.kr/view?rec_idx=90', title: '개발자90', company: '회사E', career: '신입' },
        { id: '50', url: 'https://saramin.co.kr/view?rec_idx=50', title: '개발자50', company: '회사F', career: '신입' }
      ]
    });

    const res2 = step({
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
    assert.equal(res3.counters.queued, 4); // 120, 110, 30, 20

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

    // proposed_checkpoint 확인
    const proposedPath = path.resolve(RUNS_DIR, runId, 'saramin_track1', 'proposed_checkpoint.json');
    const proposed = JSON.parse(fs.readFileSync(proposedPath, 'utf8'));

    assert.equal(proposed.headJobId, '120');
    assert.deepEqual(proposed.headWindow, ['120', '110', '100']);
    assert.equal(proposed.tailJobId, '20');
    assert.deepEqual(proposed.tailWindow, ['40', '30', '20']);
  });

  test('3. headWindow 3개가 모두 삭제됨 -> 숫자 비교로 Phase 2 전환', () => {
    const runId = 'test-run-3';
    const inputDir = path.resolve(TEST_DIR, 'inputs');

    const cpSiteDir = path.resolve(CP_DIR, 'saramin');
    fs.mkdirSync(cpSiteDir, { recursive: true });
    fs.writeFileSync(path.resolve(cpSiteDir, 'track1.json'), JSON.stringify({
      site: 'saramin',
      track: 'track1',
      headJobId: '100',
      headWindow: ['100', '95', '90'],
      tailJobId: '50',
      tailWindow: ['50', '45', '40']
    }, null, 2), 'utf8');

    // 100, 95, 90은 사라졌고, 110(NEW), 85(숫자 비교 상 50 <= 85 <= 100 이므로 COVERED)
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
    assert.equal(res.counters.coveredSkipped, 1); // 85
  });

  test('4. tailWindow 3개가 모두 마감되어 사라짐 -> 숫자 비교로 Phase 3 전환', () => {
    const runId = 'test-run-4';
    const inputDir = path.resolve(TEST_DIR, 'inputs');

    const cpSiteDir = path.resolve(CP_DIR, 'saramin');
    fs.mkdirSync(cpSiteDir, { recursive: true });
    fs.writeFileSync(path.resolve(cpSiteDir, 'track1.json'), JSON.stringify({
      site: 'saramin',
      track: 'track1',
      headJobId: '100',
      headWindow: ['100', '95', '90'],
      tailJobId: '50',
      tailWindow: ['50', '45', '40']
    }, null, 2), 'utf8');

    // Page 1: 95 도달 -> Phase 2
    const p1 = writePageInput(inputDir, 'p1.json', {
      appliedFilters: ["exp_cd=1", "cat_mcls=2", "company_type=scale001,scale002,scale003", "sort=RD"],
      items: [{ id: '95', url: 'https://saramin.co.kr/view?rec_idx=95', title: '개발자95', company: '회사A', career: '신입' }]
    });
    step({ runId, site: 'saramin', track: 'track1', page: 1, inputPath: p1, configPath: CONFIG_PATH, runsDir: RUNS_DIR, checkpointsDir: CP_DIR });

    // Page 2: 50, 45, 40 은 사라졌고, 35 가 등장 (35 < tail(50) -> 숫자 비교 상 OLD)
    const p2 = writePageInput(inputDir, 'p2.json', {
      appliedFilters: ["exp_cd=1", "cat_mcls=2", "company_type=scale001,scale002,scale003", "sort=RD"],
      items: [{ id: '35', url: 'https://saramin.co.kr/view?rec_idx=35', title: '개발자35', company: '회사B', career: '신입' }]
    });
    const res2 = step({ runId, site: 'saramin', track: 'track1', page: 2, inputPath: p2, configPath: CONFIG_PATH, runsDir: RUNS_DIR, checkpointsDir: CP_DIR });

    assert.equal(res2.phase, 3);
    assert.equal(res2.counters.queued, 1); // 35 수집
  });

  test('5. 끌어올리기: tail 보다 작은 오래된 id 가 1페이지 상단에 등장 -> OLD 로 수집 대상, 구간 판정은 깨지지 않음', () => {
    const runId = 'test-run-5';
    const inputDir = path.resolve(TEST_DIR, 'inputs');

    const cpSiteDir = path.resolve(CP_DIR, 'saramin');
    fs.mkdirSync(cpSiteDir, { recursive: true });
    fs.writeFileSync(path.resolve(cpSiteDir, 'track1.json'), JSON.stringify({
      site: 'saramin',
      track: 'track1',
      headJobId: '100',
      headWindow: ['100', '95', '90'],
      tailJobId: '50',
      tailWindow: ['50', '45', '40']
    }, null, 2), 'utf8');

    // 1페이지에 신규 110, 끌올된 30(OLD), 105(NEW)
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

    // COVERED를 만나지 않았으므로 Phase 1 유지
    assert.equal(res.phase, 1);
    // 110, 30, 105 모두 심사 큐 적재 대상
    assert.equal(res.counters.queued, 3);
  });

  test('6. Phase 1 도중 LIMIT_QUEUED -> head 기존 유지', () => {
    createConfig({ maxQueuedPerTrack: 2 });
    const runId = 'test-run-6';
    const inputDir = path.resolve(TEST_DIR, 'inputs');

    const cpSiteDir = path.resolve(CP_DIR, 'saramin');
    fs.mkdirSync(cpSiteDir, { recursive: true });
    fs.writeFileSync(path.resolve(cpSiteDir, 'track1.json'), JSON.stringify({
      site: 'saramin',
      track: 'track1',
      headJobId: '100',
      headWindow: ['100', '95', '90'],
      tailJobId: '50',
      tailWindow: ['50', '45', '40']
    }, null, 2), 'utf8');

    // 1페이지: 130, 125, 120 (모두 NEW). maxQueuedPerTrack 2 도달 시 STOP
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

    // proposed_checkpoint 확인: phase1Complete=false 이므로 기존 head 100 유지!
    const proposedPath = path.resolve(RUNS_DIR, runId, 'saramin_track1', 'proposed_checkpoint.json');
    const proposed = JSON.parse(fs.readFileSync(proposedPath, 'utf8'));

    assert.equal(proposed.headJobId, '100');
    assert.deepEqual(proposed.headWindow, ['100', '95', '90']);
  });

  test('7. 점프가 tail 을 지나침 -> 되돌아오기', () => {
    const runId = 'test-run-7';
    const inputDir = path.resolve(TEST_DIR, 'inputs');

    const cpSiteDir = path.resolve(CP_DIR, 'saramin');
    fs.mkdirSync(cpSiteDir, { recursive: true });
    fs.writeFileSync(path.resolve(cpSiteDir, 'track1.json'), JSON.stringify({
      site: 'saramin',
      track: 'track1',
      headJobId: '100',
      headWindow: ['100', '95', '90'],
      tailJobId: '50',
      tailWindow: ['50', '45', '40'],
      tailPageHint: 5
    }, null, 2), 'utf8');

    // 1페이지: 신규 105, 그리고 95(COVERED) 도달 -> Phase 2 전환
    const p1 = writePageInput(inputDir, 'p1.json', {
      appliedFilters: ["exp_cd=1", "cat_mcls=2", "company_type=scale001,scale002,scale003", "sort=RD"],
      items: [
        { id: '105', url: 'https://saramin.co.kr/view?rec_idx=105', title: '개발자105', company: '회사A', career: '신입' },
        { id: '95', url: 'https://saramin.co.kr/view?rec_idx=95', title: '개발자95', company: '회사B', career: '신입' }
      ]
    });
    step({ runId, site: 'saramin', track: 'track1', page: 1, inputPath: p1, configPath: CONFIG_PATH, runsDir: RUNS_DIR, checkpointsDir: CP_DIR });

    // 2페이지: 전체가 COVERED (90, 85). jumpEnabled 이므로 tailPageHint(5) 로 JUMP_PAGE 6 발생
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

    // 점프한 6페이지: 첫 항목부터 35(OLD) -> tail을 지나침 -> JUMP_PAGE (현재-1 = 5) 로 되돌아가기
    const p6 = writePageInput(inputDir, 'p6.json', {
      appliedFilters: ["exp_cd=1", "cat_mcls=2", "company_type=scale001,scale002,scale003", "sort=RD"],
      items: [
        { id: '35', url: 'https://saramin.co.kr/view?rec_idx=35', title: '개발자35', company: '회사E', career: '신입' }
      ]
    });
    const resBack = step({ runId, site: 'saramin', track: 'track1', page: 6, inputPath: p6, configPath: CONFIG_PATH, runsDir: RUNS_DIR, checkpointsDir: CP_DIR });
    assert.equal(resBack.action, 'JUMP_PAGE');
    assert.equal(resBack.page, 5);

    // 되돌아간 5페이지: COVERED(50) 포함되어 있음 -> 거기서부터 NEXT_PAGE(6) 로 전진
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
      headJobId: '100',
      headWindow: ['100', '95', '90'],
      tailJobId: '50',
      tailWindow: ['50', '45', '40']
    }, null, 2), 'utf8');

    // 필터 불일치: sort=RD 및 cat_mcls 누락
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

    assert.equal(proposed.headJobId, '100');
    assert.equal(proposed.tailJobId, '50');
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

    // publish_result.json 생성
    fs.writeFileSync(path.resolve(runDir, 'publish_result.json'), JSON.stringify({ published: 5 }), 'utf8');

    // 정상 트랙 (saramin_track1)
    const t1Dir = path.resolve(runDir, 'saramin_track1');
    fs.mkdirSync(t1Dir, { recursive: true });
    fs.writeFileSync(path.resolve(t1Dir, 'state.json'), JSON.stringify({ stopReason: 'LIST_END' }), 'utf8');
    fs.writeFileSync(path.resolve(t1Dir, 'proposed_checkpoint.json'), JSON.stringify({
      site: 'saramin',
      track: 'track1',
      headJobId: '200',
      headWindow: ['200', '190'],
      tailJobId: '10',
      tailWindow: ['20', '10']
    }), 'utf8');

    // 필터 불일치 트랙 (jobkorea_track1)
    const t2Dir = path.resolve(runDir, 'jobkorea_track1');
    fs.mkdirSync(t2Dir, { recursive: true });
    fs.writeFileSync(path.resolve(t2Dir, 'state.json'), JSON.stringify({ stopReason: 'FILTER_MISMATCH' }), 'utf8');
    fs.writeFileSync(path.resolve(t2Dir, 'proposed_checkpoint.json'), JSON.stringify({
      site: 'jobkorea',
      track: 'track1',
      headJobId: '999',
      tailJobId: '888'
    }), 'utf8');

    const result = checkpointManager.commitRun(runId, RUNS_DIR, CP_DIR);

    assert.deepEqual(result.committed, ['saramin_track1']);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].reason, 'FILTER_MISMATCH');

    // 실제 체크포인트 파일 확인
    const actualCpPath = path.resolve(CP_DIR, 'saramin', 'track1.json');
    assert.ok(fs.existsSync(actualCpPath));
    const actualCp = JSON.parse(fs.readFileSync(actualCpPath, 'utf8'));
    assert.equal(actualCp.headJobId, '200');
    assert.equal(actualCp.tailJobId, '10');

    // 잡코리아는 반영되지 않았음 확인
    const jkCpPath = path.resolve(CP_DIR, 'jobkorea', 'track1.json');
    assert.ok(!fs.existsSync(jkCpPath));
  });
});

