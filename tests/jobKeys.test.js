const test = require('node:test');
const assert = require('node:assert/strict');
const { extractJobKey, normalizeUrl, companyKey, titleKey, similarity } = require('../tools/jobKeys');

test('extractJobKey: 사람인 3가지 URL 형태가 모두 같은 jobKey 반환', () => {
  const url1 = 'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=51234567';
  const url2 = 'https://www.saramin.co.kr/zf_user/jobs/relay/view-detail?rec_idx=51234567';
  const url3 = 'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=51234567&utm_source=naver&utm_medium=cpc&ref=banner';
  const url4 = 'https://m.saramin.co.kr/job-search/detail?rec_idx=51234567';

  assert.equal(extractJobKey(url1), 'saramin:51234567');
  assert.equal(extractJobKey(url2), 'saramin:51234567');
  assert.equal(extractJobKey(url3), 'saramin:51234567');
  assert.equal(extractJobKey(url4), 'saramin:51234567');
});

test('extractJobKey: 잡코리아 GI_Read 대소문자 및 쿼리스트링 차이 흡수', () => {
  const url1 = 'https://www.jobkorea.co.kr/Recruit/GI_Read/45678901';
  const url2 = 'https://www.jobkorea.co.kr/recruit/gi_read/45678901?Oem_Code=C1';

  assert.equal(extractJobKey(url1), 'jobkorea:45678901');
  assert.equal(extractJobKey(url2), 'jobkorea:45678901');
});

test('extractJobKey: 원티드 /wd/ 뒤 쿼리 차이 흡수', () => {
  const url1 = 'https://www.wanted.co.kr/wd/204891';
  const url2 = 'https://www.wanted.co.kr/wd/204891?utm_campaign=google_jobs';

  assert.equal(extractJobKey(url1), 'wanted:204891');
  assert.equal(extractJobKey(url2), 'wanted:204891');
});

test('extractJobKey: 기타 플랫폼은 url:{정규화URL} 생성', () => {
  const url = 'https://careers.example.com/jobs/dev?utm_source=sns#content';
  assert.equal(extractJobKey(url), 'url:https://careers.example.com/jobs/dev');
});

test('normalizeUrl: 트래킹 파라미터, 해시, 끝 슬래시 제거 및 식별 파라미터 보존', () => {
  const raw = 'https://Example.COM/jobs?id=99&utm_source=test&ref=xyz#apply/';
  const normalized = normalizeUrl(raw);
  assert.equal(normalized, 'https://example.com/jobs?id=99');
});

test('companyKey: (주), ㈜, 주식회사, Inc., Corp. 및 별칭 적용', () => {
  assert.equal(companyKey('(주)네이버'), '네이버');
  assert.equal(companyKey('네이버 주식회사'), '네이버');
  assert.equal(companyKey('NAVER Corp.'), '네이버');
  assert.equal(companyKey('(주) 카카오 Corp.'), '카카오');
  assert.equal(companyKey('주식회사 토스뱅크'), '토스뱅크');
  assert.equal(companyKey('Woowa Brothers Inc.'), '우아한형제들');
});

test('titleKey: 괄호, 연도, 상/하반기, 신입/경력, 채용/공고 등 제거', () => {
  const raw = '[네이버] 2026 하반기 신입 프론트엔드 개발자 채용 (정규직)';
  assert.equal(titleKey(raw), '프론트엔드개발자');

  const raw2 = '2025년 상반기 SW개발자 모집공고 [웹/풀스택] (신입/경력무관)';
  assert.equal(titleKey(raw2), 'sw개발자');
});

test('similarity: bigram Jaccard 유사도 계산', () => {
  assert.equal(similarity('프론트엔드개발자', '프론트엔드개발자'), 1.0);
  assert.equal(similarity('프론트엔드개발자', '백엔드개발자') > 0.3, true);
  assert.equal(similarity('프론트엔드개발자', '데이터엔지니어') < 0.2, true);
  assert.equal(similarity('', ''), 1.0);
});
