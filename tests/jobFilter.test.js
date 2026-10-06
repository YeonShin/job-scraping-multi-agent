const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { classify } = require('../tools/jobFilter');
const registry = require('../tools/registry');

test('jobFilter: 5가지 판정 분기 및 마감 재오픈 판정 검증', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobfilter-test-'));
  const cachePath = path.join(tmpDir, 'notion_jobs.json');
  const registryPath = path.join(tmpDir, 'registry.json');
  const runsDir = path.join(tmpDir, 'runs');

  try {
    // 1. 노션 캐시 구성
    const mockNotion = [
      {
        pageId: 'page-1',
        jobKey: 'saramin:1001',
        url: 'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=1001',
        normalizedUrl: 'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=1001',
        company: '활성회사',
        companyKey: '활성회사',
        position: '웹 개발자',
        titleKey: '웹개발자',
        status: '미지원'
      },
      {
        pageId: 'page-2',
        jobKey: 'saramin:1002',
        url: 'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=1002',
        normalizedUrl: 'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=1002',
        company: '마감회사',
        companyKey: '마감회사',
        position: '프론트엔드 개발자',
        titleKey: '프론트엔드개발자',
        status: '마감'
      },
      {
        pageId: 'page-3',
        jobKey: 'jobkorea:2001',
        url: 'https://www.jobkorea.co.kr/Recruit/GI_Read/2001',
        normalizedUrl: 'https://www.jobkorea.co.kr/recruit/gi_read/2001',
        company: '네이버',
        companyKey: '네이버',
        position: '웹 프론트엔드 플랫폼 개발자',
        titleKey: '웹프론트엔드플랫폼개발자',
        status: '미지원'
      }
    ];
    fs.writeFileSync(cachePath, JSON.stringify(mockNotion, null, 2), 'utf8');

    // 2. 레지스트리 구성
    registry.resetInMemory();
    registry.upsert('saramin:9001', {
      verdict: 'rejected',
      company: '탈락회사',
      companyKey: '탈락회사',
      titleKey: '백엔드개발자'
    }, registryPath);
    registry.save(registryPath);

    // 3. 테스트 입력 items
    const items = [
      // 1) SKIP_REGISTRY
      { id: '9001', url: 'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=9001', title: '백엔드 개발자', company: '탈락회사' },
      // 2) SKIP_NOTION (활성 상태)
      { id: '1001', url: 'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=1001', title: '웹 개발자', company: '활성회사' },
      // 3) REOPEN_CANDIDATE (마감 상태 공고 재등장)
      { id: '1002', url: 'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=1002', title: '프론트엔드 개발자', company: '마감회사' },
      // 4) SKIP_DUP (URL은 다르나 companyKey & titleKey 완전 일치)
      { id: '3001', url: 'https://www.wanted.co.kr/wd/3001', title: '웹 개발자 채용', company: '(주)활성회사' },
      // 5) SUSPECT (네이버 회사 동일 + 제목 높은 유사도 0.85)
      { id: '2002', url: 'https://www.jobkorea.co.kr/Recruit/GI_Read/2002', title: '웹 프론트엔드 플랫폼 개발자 인턴', company: 'NAVER Corp.' },
      // 6) NEW (완전 신규 공고)
      { id: '5555', url: 'https://www.wanted.co.kr/wd/5555', title: 'React 프론트엔드 주니어', company: '스타트업XYZ' }
    ];

    const result = classify(items, {
      site: 'mixed',
      track: 'track2',
      runId: 'run-test-01',
      cachePath,
      registryPath,
      runsDir
    });

    assert.equal(result.counts.skipRegistry, 1, 'skipRegistry 1건');
    assert.equal(result.counts.skipNotion, 1, 'skipNotion 1건');
    assert.equal(result.counts.reopen, 1, 'reopen 1건');
    assert.equal(result.counts.skipDup, 1, 'skipDup 1건');
    assert.equal(result.counts.suspect, 1, 'suspect 1건');
    assert.equal(result.counts.new, 1, 'new 1건');

    // 큐 검증: reopen, suspect, new 가 적재되어 총 3건이어야 함
    const queueFile = path.join(runsDir, 'run-test-01', 'review_queue.json');
    assert.ok(fs.existsSync(queueFile));
    const queue = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
    assert.equal(queue.length, 3);
    assert.ok(queue.find(q => q.jobKey === 'saramin:1002'));
    assert.ok(queue.find(q => q.jobKey === 'jobkorea:2002')?.dupHint);
    assert.ok(queue.find(q => q.jobKey === 'wanted:5555'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    registry.resetInMemory();
  }
});

test('jobFilter: 같은 회사 다른 포지션은 SKIP이 아니라 SUSPECT 또는 NEW로 분류됨', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobfilter-diff-'));
  const cachePath = path.join(tmpDir, 'notion_jobs.json');
  const registryPath = path.join(tmpDir, 'registry.json');
  const runsDir = path.join(tmpDir, 'runs');

  try {
    const mockNotion = [
      {
        pageId: 'page-c1',
        jobKey: 'wanted:701',
        url: 'https://www.wanted.co.kr/wd/701',
        normalizedUrl: 'https://www.wanted.co.kr/wd/701',
        company: '카카오페이',
        companyKey: '카카오페이',
        position: '프론트엔드 개발자 (커머스)',
        titleKey: '커머스', // '프론트엔드개발자커머스'
        status: '미지원'
      }
    ];
    // 정확한 titleKey 반영: titleKey('[카카오페이] 프론트엔드 개발자 (커머스)') -> '프론트엔드개발자' (소괄호 안 커머스가 지워지므로 position 에 직접 기록)
    // 소괄호 안에 세부 도메인이 들어가면 titleKey 는 소괄호를 지우므로,
    // 소괄호 없이 "프론트엔드 개발자 커머스플랫폼" vs "결제플랫폼" 형태로 테스트
    mockNotion[0].position = '프론트엔드 개발자 커머스플랫폼';
    mockNotion[0].titleKey = '프론트엔드개발자커머스플랫폼';
    fs.writeFileSync(cachePath, JSON.stringify(mockNotion, null, 2), 'utf8');

    const items = [
      {
        id: '702',
        url: 'https://www.wanted.co.kr/wd/702',
        title: '프론트엔드 개발자 결제플랫폼',
        company: '카카오페이'
      }
    ];

    const result = classify(items, {
      site: 'wanted',
      track: 'track2',
      runId: 'run-diff-01',
      cachePath,
      registryPath,
      runsDir
    });

    // 커머스플랫폼 vs 결제플랫폼은 정확히 일치하지 않으므로 skipDup이 아님
    assert.equal(result.counts.skipDup, 0, '완전 일치 스킵이 아니어야 함');
    assert.ok(result.counts.suspect === 1 || result.counts.new === 1, 'SUSPECT 또는 NEW 로 분류되어야 함');
    assert.equal(result.queued.length, 1, '심사 큐에 적재되어야 함');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('jobFilter: 트랙1에서 큐에 넣은 공고를 트랙2에서 다시 넣지 않음 (중복 방지)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobfilter-track-'));
  const cachePath = path.join(tmpDir, 'notion_jobs.json');
  const registryPath = path.join(tmpDir, 'registry.json');
  const runsDir = path.join(tmpDir, 'runs');

  try {
    fs.writeFileSync(cachePath, '[]', 'utf8');

    const commonItem = {
      id: '8888',
      url: 'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=8888',
      title: '웹 풀스택 개발자',
      company: '우수기업'
    };

    // 1) 트랙1 수집
    const res1 = classify([commonItem], {
      site: 'saramin',
      track: 'track1',
      runId: 'run-track-01',
      cachePath,
      registryPath,
      runsDir
    });

    assert.equal(res1.counts.new, 1);
    assert.deepEqual(res1.queued, ['saramin:8888']);

    // 2) 트랙2 수집 (동일 공고 재등장)
    const res2 = classify([commonItem], {
      site: 'saramin',
      track: 'track2',
      runId: 'run-track-01',
      cachePath,
      registryPath,
      runsDir
    });

    // 큐에 이미 존재하는 titleKey & companyKey 로 인해 SKIP_DUP 또는 중복 큐 적재 방지
    assert.equal(res2.queued.length, 0, '트랙2에서 중복 큐 적재되지 않아야 함');

    const queueFile = path.join(runsDir, 'run-track-01', 'review_queue.json');
    const queue = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
    assert.equal(queue.length, 1, '최종 큐 크기는 1건 유지');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
