const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPayload, buildChildren, splitChildren, normalizeDate, truncate, publishJob, setRequester
} = require('../tools/notionJobPublisher');

const longText = 'x'.repeat(2500);

function fakeJob(overrides = {}) {
  return {
    jobKey: 'saramin:1',
    company: 'C'.repeat(2500),
    position: 'P'.repeat(2500),
    url: 'https://example.com/1',
    industryDetail: 'D'.repeat(2500),
    location: 'L'.repeat(2500),
    summary: `💡 ${longText}\n💡 둘째 줄`,
    mainTasks: Array.from({ length: 130 }, (_, i) => `task ${i}`),
    requirements: ['req'],
    ...overrides
  };
}

test('truncate: 2000자로 자른다', () => {
  assert.equal(truncate(longText).length, 2000);
  assert.equal(truncate(null), '');
});

test('buildPayload: 모든 rich_text/title 이 2000자 이하', () => {
  const { payload } = buildPayload(fakeJob(), 'db');
  const p = payload.properties;
  assert.equal(p['기업명'].title[0].text.content.length, 2000);
  assert.equal(p['채용직무'].rich_text[0].text.content.length, 2000);
  assert.equal(p['산업군 (상세)'].rich_text[0].text.content.length, 2000);
  assert.equal(p['근무지'].rich_text[0].text.content.length, 2000);
  assert.equal(p['공고키'].rich_text[0].text.content, 'saramin:1');
  const callout = payload.children[0];
  assert.equal(callout.callout.rich_text[0].text.content.length, 2000);
});

test('콜아웃 아이콘은 💡 이고 본문의 💡 접두는 제거된다', () => {
  const callout = buildChildren(fakeJob({ summary: '💡 첫째\n💡 둘째' }))[0];
  assert.equal(callout.callout.icon.emoji, '💡');
  const text = callout.callout.rich_text[0].text.content;
  assert.ok(!text.includes('💡'));
  assert.ok(text.includes('첫째') && text.includes('둘째'));
});

test('jobKey 가 없으면 공고키 속성을 생략한다', () => {
  const { payload } = buildPayload(fakeJob({ jobKey: undefined }), 'db');
  assert.equal(payload.properties['공고키'], undefined);
});

test('블록 130개 초과: 생성은 100개, 나머지는 100개 단위 청크', () => {
  const job = fakeJob();
  const total = buildChildren(job).length;
  assert.ok(total > 130);
  const { payload, restChunks } = buildPayload(job, 'db');
  assert.equal(payload.children.length, 100);
  assert.ok(restChunks.every(c => c.length <= 100));
  assert.equal(payload.children.length + restChunks.reduce((a, c) => a + c.length, 0), total);
  assert.deepEqual(splitChildren(Array(250).fill(0)).map(c => c.length), [100, 100, 50]);
});

test('publishJob: POST 1회 + PATCH 나머지, pageId/notionUrl 반환 (API 모킹)', async () => {
  process.env.NOTION_DATABASE_ID = 'db';
  const calls = [];
  setRequester(async (method, apiPath, body) => {
    calls.push({ method, apiPath, body });
    return { id: 'page-1', url: 'https://notion.so/page-1' };
  });
  try {
    const r = await publishJob(fakeJob());
    assert.equal(r.pageId, 'page-1');
    assert.equal(r.notionUrl, 'https://notion.so/page-1');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].apiPath, '/v1/pages');
    assert.ok(calls.length >= 2);
    for (const c of calls.slice(1)) {
      assert.equal(c.method, 'PATCH');
      assert.equal(c.apiPath, '/v1/blocks/page-1/children');
      assert.ok(c.body.children.length <= 100);
    }
  } finally {
    setRequester(null);
  }
});

test('normalizeDate: MM.DD 는 오늘(KST)보다 과거면 다음 연도', () => {
  const now = Date.parse('2026-10-05T03:00:00Z'); // KST 2026-10-05 12:00
  assert.equal(normalizeDate('~10.20', { now }), '2026-10-20');
  assert.equal(normalizeDate('10.05', { now }), '2026-10-05'); // 오늘은 과거가 아님
  assert.equal(normalizeDate('03.01', { now }), '2027-03-01');
  assert.equal(normalizeDate('03.01', { now, rollForward: false }), '2026-03-01');
  assert.equal(normalizeDate('2026.12.31', { now }), '2026-12-31');
  assert.equal(normalizeDate('D-5', { now }), '2026-10-10');
  assert.equal(normalizeDate('상시채용', { now }), null);
});

test('normalizeDate: KST 날짜 경계 (UTC 15시 이후는 다음 날)', () => {
  const now = Date.parse('2026-12-31T16:00:00Z'); // KST 2027-01-01 01:00
  assert.equal(normalizeDate('12.31', { now }), '2027-12-31');
  assert.equal(normalizeDate('01.01', { now }), '2027-01-01');
});
