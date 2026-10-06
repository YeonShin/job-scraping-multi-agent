const fs = require('fs');
const path = require('path');

let aliasesCache = null;

function getCompanyAliases(customPath) {
  if (customPath) {
    try {
      if (fs.existsSync(customPath)) {
        return JSON.parse(fs.readFileSync(customPath, 'utf8'));
      }
    } catch (e) {
      return {};
    }
  }
  if (!aliasesCache) {
    const aliasPath = path.resolve(__dirname, '..', 'config', 'company-aliases.json');
    try {
      if (fs.existsSync(aliasPath)) {
        aliasesCache = JSON.parse(fs.readFileSync(aliasPath, 'utf8'));
      } else {
        aliasesCache = {};
      }
    } catch (e) {
      aliasesCache = {};
    }
  }
  return aliasesCache;
}

/**
 * 트래킹 파라미터만 제거하고 식별 파라미터는 보존하는 URL 정규화
 */
function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  try {
    const u = new URL(trimmed);
    const trackingRegex = /^(utm_|ref$|tracking_id$|_hs|fbclid|gclid)/i;
    for (const key of [...u.searchParams.keys()]) {
      if (trackingRegex.test(key)) {
        u.searchParams.delete(key);
      }
    }
    u.hash = '';
    // 프로토콜과 호스트는 new URL() 에 의해 이미 소문자화됨
    let normalized = u.toString();
    // 쿼리스트링이 없을 때 끝 슬래시 제거
    if (!u.search && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch (e) {
    // URL 형식이 아닌 경우 fallback
    return trimmed.replace(/[?&](utm_[^&=]+|ref|tracking_id)=[^&#]*/gi, '').replace(/#.*$/, '').replace(/\/$/, '');
  }
}

/**
 * 공고 URL에서 jobKey 추출 ({platform}:{id} 또는 url:{normalizedUrl})
 */
function extractJobKey(url, site) {
  if (!url || typeof url !== 'string') return '';
  const raw = url.trim();
  if (!raw) return '';

  // 1) 사람인: rec_idx=(\d+)
  const saraminMatch = raw.match(/[?&]rec_idx=(\d+)/i);
  if (saraminMatch) return `saramin:${saraminMatch[1]}`;

  // 2) 잡코리아: /GI_Read/(\d+)
  const jobkoreaMatch = raw.match(/\/GI_Read\/(\d+)/i);
  if (jobkoreaMatch) return `jobkorea:${jobkoreaMatch[1]}`;

  // 3) 원티드: /wd/(\d+)
  const wantedMatch = raw.match(/\/wd\/(\d+)/i);
  if (wantedMatch) return `wanted:${wantedMatch[1]}`;

  // 4) 그 외 플랫폼
  const normalized = normalizeUrl(raw);
  return normalized ? `url:${normalized}` : '';
}

/**
 * 회사명 정규화 (법인 형태 제거, 공백/특수문자 제거, 소문자화, 별칭 적용)
 */
function companyKey(name, customAliasPath) {
  if (!name || typeof name !== 'string') return '';
  let str = name.trim();
  if (!str) return '';

  // (주), ㈜, 주식회사, 유한회사, Inc., Corp., Co., Ltd. 제거
  str = str.replace(/\((주|유)\)|㈜|주식회사|유한회사/gi, ' ');
  str = str.replace(/\b(inc|corp|corporation|co|ltd|limited)\b\.?/gi, ' ');

  // 공백 및 특수문자 제거, 영문 소문자화
  let cleaned = str.replace(/[^a-zA-Z0-9가-힣]/g, '').toLowerCase();

  // 별칭표 매핑 (예: naver -> 네이버)
  const aliases = getCompanyAliases(customAliasPath);
  if (aliases && aliases[cleaned]) {
    cleaned = aliases[cleaned];
  }

  return cleaned;
}

/**
 * 공고 제목 정규화 (괄호, 연도, 상/하반기, 경력구분, 채용/모집/공고 등 제거)
 */
function titleKey(title) {
  if (!title || typeof title !== 'string') return '';
  let str = title.trim();
  if (!str) return '';

  // 대괄호, 소괄호 안 내용 (괄호 포함) 제거
  str = str.replace(/\[[^\]]*\]/g, ' ');
  str = str.replace(/\([^)]*\)/g, ' ');

  // 4자리 연도 제거
  str = str.replace(/\b(19|20)\d{2}\b년?/g, ' ');

  // 상반기 / 하반기
  str = str.replace(/(상반기|하반기)/g, ' ');

  // 신입 / 경력 / 경력무관
  str = str.replace(/(신입|경력무관|경력)/g, ' ');

  // 채용 / 모집 / 공고 / 정규직
  str = str.replace(/(채용|모집|공고|정규직)/g, ' ');

  // 공백, 특수문자 제거 및 소문자화
  return str.replace(/[^a-zA-Z0-9가-힣]/g, '').toLowerCase();
}

/**
 * titleKey를 2글자 단위(bigram)로 나눈 Jaccard 유사도 (0~1)
 */
function similarity(a, b) {
  const s1 = typeof a === 'string' ? a : '';
  const s2 = typeof b === 'string' ? b : '';

  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  // 길이가 1글자 이하인 경우
  if (s1.length < 2 || s2.length < 2) {
    return s1 === s2 ? 1.0 : 0.0;
  }

  const bigrams1 = new Set();
  for (let i = 0; i < s1.length - 1; i++) {
    bigrams1.add(s1.slice(i, i + 2));
  }

  const bigrams2 = new Set();
  for (let i = 0; i < s2.length - 1; i++) {
    bigrams2.add(s2.slice(i, i + 2));
  }

  let intersectionCount = 0;
  for (const bg of bigrams1) {
    if (bigrams2.has(bg)) intersectionCount++;
  }

  const unionSize = bigrams1.size + bigrams2.size - intersectionCount;
  if (unionSize === 0) return 0.0;

  return intersectionCount / unionSize;
}

module.exports = {
  normalizeUrl,
  extractJobKey,
  companyKey,
  titleKey,
  similarity,
  getCompanyAliases
};
