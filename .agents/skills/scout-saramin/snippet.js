(() => {
  const container = document.querySelector('.common_recruilt_list, .common_recruit_list');
  if (!container) {
    return { error: 'CONTAINER_NOT_FOUND' };
  }

  // appliedFilters: location.search의 필터 파라미터 배열
  const search = window.location.search || '';
  const appliedFilters = search.replace(/^\?/, '').split('&').filter(Boolean);

  const items = [];
  const seenIds = new Set();

  // 일반 공고 카드 탐색 (.list_item 또는 a[href*="rec_idx="]를 포함하는 부모)
  const links = container.querySelectorAll('a[href*="rec_idx="]');
  for (const link of links) {
    const href = link.getAttribute('href') || link.href || '';
    const match = href.match(/rec_idx=(\d+)/);
    if (!match) continue;
    const id = match[1];
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    // 카드 컨테이너 찾기
    const card = link.closest('.list_item') || link.closest('.item_recycle') || link.closest('div[class*="item"]') || link.parentElement;

    // 제목
    let title = '';
    const titleEl = card ? (card.querySelector('.job_tit a') || card.querySelector('.job_tit')) : null;
    if (titleEl) {
      title = (titleEl.textContent || '').trim();
    } else {
      title = (link.textContent || '').trim();
    }

    // 회사명
    let company = '';
    const compEl = card ? (card.querySelector('.company_nm a') || card.querySelector('.company_nm')) : null;
    if (compEl) {
      company = (compEl.textContent || '').trim();
    }

    // 경력
    let career = '';
    const careerEl = card ? card.querySelector('.recruit_info .career, span.career, .career') : null;
    if (careerEl) {
      career = (careerEl.textContent || '').trim();
    }

    const url = `https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=${id}`;

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
