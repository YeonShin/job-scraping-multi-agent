(() => {
  const container = document.querySelector('ul[data-cy="job-list"]');
  if (!container) {
    return { error: 'CONTAINER_NOT_FOUND' };
  }

  // appliedFilters: location.search의 필터 파라미터 배열
  const search = window.location.search || '';
  const appliedFilters = search.replace(/^\?/, '').split('&').filter(Boolean);

  const items = [];
  const seenIds = new Set();

  const links = container.querySelectorAll('a[href*="/wd/"]');
  for (const link of links) {
    const href = link.getAttribute('href') || link.href || '';
    const match = href.match(/\/wd\/(\d+)/);
    if (!match) continue;
    const id = match[1];
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const card = link.closest('li') || link.parentElement;

    // 제목: card 내 strong 태그 또는 aria-label, textContent
    let title = '';
    const strongEl = card ? card.querySelector('strong') : null;
    if (strongEl) {
      title = (strongEl.textContent || '').trim();
    } else {
      title = (link.getAttribute('aria-label') || link.textContent || '').trim();
    }

    // 회사명: card 내 span 태그들 중 회사명 찾기 (또는 strong 다음의 span)
    let company = '';
    if (card) {
      const spans = card.querySelectorAll('span');
      if (spans.length > 0) {
        // 첫 번째 span이 보통 회사명
        company = (spans[0].textContent || '').trim();
      }
    }

    // 경력: 원티드 목록 카드는 years=0 필터 기반이므로 '신입'으로 기본 처리
    const career = '신입';

    const url = `https://www.wanted.co.kr/wd/${id}`;

    items.push({
      id,
      url,
      title,
      company,
      career
    });
  }

  return {
    appliedFilters,
    items
  };
})();
