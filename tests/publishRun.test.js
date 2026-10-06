const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPublish } = require('../tools/publishRun');
const registry = require('../tools/registry');

const TEST_DIR = path.resolve(__dirname, 'scratch_test_publish_run');
const RUNS_DIR = path.resolve(TEST_DIR, 'runs');
const RETRY_PATH = path.resolve(TEST_DIR, 'retry.jsonl');
const CACHE_PATH = path.resolve(TEST_DIR, 'notion_jobs.json');
const REG_PATH = path.resolve(TEST_DIR, 'registry.json');

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

describe('publishRun 단위 테스트', () => {
  beforeEach(() => {
    cleanup();
    fs.mkdirSync(RUNS_DIR, { recursive: true });
    fs.writeFileSync(REG_PATH, JSON.stringify({}, null, 2), 'utf8');
    fs.writeFileSync(CACHE_PATH, JSON.stringify([], null, 2), 'utf8');
  });

  afterEach(() => {
    cleanup();
  });

  test('1. 교차 중복 1건만 등록되고 나머지는 rejected + DUPLICATE_CONFIRMED', async () => {
    const runId = 'run-cross-dup';
    const runDir = path.resolve(RUNS_DIR, runId);
    fs.mkdirSync(runDir, { recursive: true });

    // 같은 회사(토스뱅크), 같은 직무(Frontend Developer)가 사람인과 잡코리아에서 둘 다 pass 로 제출됨
    const results = [
      {
        jobKey: 'saramin:1001',
        site: 'saramin',
        track: 'track2',
        verdict: 'pass',
        job: { company: '토스뱅크', position: 'Frontend Developer', url: 'https://saramin.co.kr/view?rec_idx=1001' }
      },
      {
        jobKey: 'jobkorea:2001',
        site: 'jobkorea',
        track: 'track2',
        verdict: 'pass',
        job: { company: '토스뱅크', position: 'Frontend Developer', url: 'https://jobkorea.co.kr/GI_Read/2001' }
      }
    ];
    fs.writeFileSync(path.resolve(runDir, 'results.jsonl'), results.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');

    // publisher 모킹
    const publishedCalls = [];
    const mockPublisher = async (job) => {
      publishedCalls.push(job);
      return { pageId: 'page-' + publishedCalls.length };
    };

    const res = await runPublish({
      runId,
      runsDir: RUNS_DIR,
      retryPath: RETRY_PATH,
      cachePath: CACHE_PATH,
      registryPath: REG_PATH,
      customPublisher: mockPublisher,
      sleepMs: 0
    });

    // 교차 중복으로 1건만 등록되어야 함
    assert.equal(res.published, 1);
    assert.equal(res.skippedDup, 1);
    assert.equal(publishedCalls.length, 1);
    assert.equal(publishedCalls[0].url, 'https://saramin.co.kr/view?rec_idx=1001');

    // 레지스트리 확인
    const reg = registry.load(REG_PATH);
    assert.equal(reg['saramin:1001'].verdict, 'published');
    assert.equal(reg['jobkorea:2001'].verdict, 'rejected');
    assert.equal(reg['jobkorea:2001'].reasonCode, 'DUPLICATE_CONFIRMED');
  });

  test('2. 일부 실패 시 retry.jsonl 적재 및 exitCode 2 반환', async () => {
    const runId = 'run-partial-fail';
    const runDir = path.resolve(RUNS_DIR, runId);
    fs.mkdirSync(runDir, { recursive: true });

    const results = [
      {
        jobKey: 'saramin:1001',
        site: 'saramin',
        track: 'track1',
        verdict: 'pass',
        job: { company: '성공회사', position: '성공직무', url: 'https://saramin.co.kr/view?rec_idx=1001' }
      },
      {
        jobKey: 'saramin:1002',
        site: 'saramin',
        track: 'track1',
        verdict: 'pass',
        job: { company: '실패회사', position: '실패직무', url: 'https://saramin.co.kr/view?rec_idx=1002' }
      }
    ];
    fs.writeFileSync(path.resolve(runDir, 'results.jsonl'), results.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');

    // 1002 번 공고에서 API 에러 발생 모킹
    const mockPublisher = async (job) => {
      if (job.company === '실패회사') {
        throw new Error('Notion API 500 Internal Error');
      }
      return { pageId: 'page-ok' };
    };

    const res = await runPublish({
      runId,
      runsDir: RUNS_DIR,
      retryPath: RETRY_PATH,
      cachePath: CACHE_PATH,
      registryPath: REG_PATH,
      customPublisher: mockPublisher,
      sleepMs: 0
    });

    assert.equal(res.published, 1);
    assert.equal(res.failed, 1);
    assert.equal(res.exitCode, 2);

    // retry.jsonl 확인
    assert.ok(fs.existsSync(RETRY_PATH));
    const retryContent = fs.readFileSync(RETRY_PATH, 'utf8').trim().split('\n');
    assert.equal(retryContent.length, 1);
    const retryItem = JSON.parse(retryContent[0]);
    assert.equal(retryItem.jobKey, 'saramin:1002');
    assert.ok(retryItem.error.includes('Notion API 500'));

    // 레지스트리 확인
    const reg = registry.load(REG_PATH);
    assert.equal(reg['saramin:1001'].verdict, 'published');
    assert.equal(reg['saramin:1002'].verdict, 'failed');
  });

  test('3. 이전 run 의 passed 항목 회수 및 재시도 성공 시 retry.jsonl 제거', async () => {
    // 이전 실행: old-run
    const oldRunId = 'old-run';
    const oldRunDir = path.resolve(RUNS_DIR, oldRunId);
    fs.mkdirSync(oldRunDir, { recursive: true });

    // old-run results.jsonl 에 남아있는 passed 항목
    const oldResults = [
      {
        jobKey: 'saramin:5001',
        site: 'saramin',
        track: 'track1',
        verdict: 'pass',
        job: { company: '과거미발행회사', position: '과거직무', url: 'https://saramin.co.kr/view?rec_idx=5001' }
      }
    ];
    fs.writeFileSync(path.resolve(oldRunDir, 'results.jsonl'), oldResults.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');

    // 레지스트리에 passed 상태로 기록
    registry.upsert('saramin:5001', {
      verdict: 'passed',
      site: 'saramin',
      track: 'track1',
      runId: oldRunId
    }, REG_PATH);
    registry.save(REG_PATH);

    // retry.jsonl 에도 과거 실패했던 항목 1건 존재
    fs.writeFileSync(RETRY_PATH, JSON.stringify({
      jobKey: 'jobkorea:7001',
      site: 'jobkorea',
      track: 'track1',
      runId: oldRunId,
      job: { company: '재시도회사', position: '재시도직무', url: 'https://jobkorea.co.kr/GI_Read/7001' }
    }) + '\n', 'utf8');

    // 새 runId 실행
    const newRunId = 'new-run';
    const newRunDir = path.resolve(RUNS_DIR, newRunId);
    fs.mkdirSync(newRunDir, { recursive: true });
    fs.writeFileSync(path.resolve(newRunDir, 'results.jsonl'), '', 'utf8');

    const publishedKeys = [];
    const mockPublisher = async (job) => {
      publishedKeys.push(job.url);
      return { pageId: 'page-retry-ok' };
    };

    const res = await runPublish({
      runId: newRunId,
      runsDir: RUNS_DIR,
      retryPath: RETRY_PATH,
      cachePath: CACHE_PATH,
      registryPath: REG_PATH,
      customPublisher: mockPublisher,
      sleepMs: 0
    });

    // 이전 run의 passed (saramin:5001) + retry.jsonl (jobkorea:7001) 총 2건 모두 회수되어 등록 성공
    assert.equal(res.published, 2);
    assert.equal(res.failed, 0);
    assert.equal(res.exitCode, 0);

    // retry.jsonl 이 비어있어야 함
    const retryAfter = fs.readFileSync(RETRY_PATH, 'utf8').trim();
    assert.equal(retryAfter, '');

    // 레지스트리 확인
    const reg = registry.load(REG_PATH);
    assert.equal(reg['saramin:5001'].verdict, 'published');
    assert.equal(reg['jobkorea:7001'].verdict, 'published');
  });

  test('4. 재오픈(reopened) 판정 및 집계', async () => {
    const runId = 'run-reopen';
    const runDir = path.resolve(RUNS_DIR, runId);
    fs.mkdirSync(runDir, { recursive: true });

    // 노션 캐시에 이미 '마감' 상태인 공고가 존재
    fs.writeFileSync(CACHE_PATH, JSON.stringify([
      {
        jobKey: 'saramin:8888',
        company: '카카오페이',
        position: '웹 프론트엔드',
        normalizedUrl: 'https://saramin.co.kr/view?rec_idx=8888',
        companyKey: '카카오페이',
        titleKey: '웹프론트엔드',
        status: '마감'
      }
    ], null, 2), 'utf8');

    // 이번 실행에 동일한 공고가 다시 제출됨
    const results = [
      {
        jobKey: 'saramin:8888',
        site: 'saramin',
        track: 'track2',
        verdict: 'pass',
        job: { company: '카카오페이', position: '웹 프론트엔드', url: 'https://saramin.co.kr/view?rec_idx=8888' }
      }
    ];
    fs.writeFileSync(path.resolve(runDir, 'results.jsonl'), results.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');

    const mockPublisher = async (job) => {
      return { pageId: 'page-reopen' };
    };

    const res = await runPublish({
      runId,
      runsDir: RUNS_DIR,
      retryPath: RETRY_PATH,
      cachePath: CACHE_PATH,
      registryPath: REG_PATH,
      customPublisher: mockPublisher,
      sleepMs: 0
    });

    assert.equal(res.published, 1);
    assert.equal(res.reopened, 1); // 재오픈 카운트 확인
    assert.equal(res.summary.total.reopened, 1);
  });

  test('5. dry-run: 노션 API 호출 없이 미리보기 및 summary 생성', async () => {
    const runId = 'run-dry';
    const runDir = path.resolve(RUNS_DIR, runId);
    fs.mkdirSync(runDir, { recursive: true });

    const results = [
      {
        jobKey: 'saramin:9001',
        site: 'saramin',
        track: 'track1',
        verdict: 'pass',
        job: { company: '미리보기회사', position: '미리보기직무', url: 'https://saramin.co.kr/view?rec_idx=9001' }
      }
    ];
    fs.writeFileSync(path.resolve(runDir, 'results.jsonl'), results.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');

    let called = false;
    const mockPublisher = async () => {
      called = true;
    };

    const res = await runPublish({
      runId,
      dryRun: true,
      runsDir: RUNS_DIR,
      retryPath: RETRY_PATH,
      cachePath: CACHE_PATH,
      registryPath: REG_PATH,
      customPublisher: mockPublisher,
      sleepMs: 0
    });

    assert.equal(called, false); // dry-run 이므로 호출되지 않음
    assert.equal(res.dryRun, true);
    assert.equal(res.published, 1);
    assert.ok(res.summary);
  });
});
