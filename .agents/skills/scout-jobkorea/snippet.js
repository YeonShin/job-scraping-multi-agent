(() => {
  const container = document.querySelector('#dev-gi-list');
  if (!container) {
    return { error: 'CONTAINER_NOT_FOUND' };
  }

  const items = [];
  const seenIds = new Set();

  const links = container.querySelectorAll('a[href*="GI_Read/"]');
  for (const link of links) {
    const href = link.getAttribute('href') || link.href || '';
    const match = href.match(/GI_Read\/(\d+)/i);
    if (!match) continue;
    const id = match[1];
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const card = link.closest('li.list-post') || link.closest('li') || link.closest('tr') || link.parentElement;

    let title = '';
    const titleEl = card ? card.querySelector('.post-list-info a.title, a.title, a.link span, .tit a') : null;
    if (titleEl) {
      title = (titleEl.textContent || '').trim();
    } else {
      title = (link.textContent || '').trim();
    }

    let company = '';
    const compEl = card ? card.querySelector('.post-list-corp a.name, a.name, .post-list-corp, .corp-name') : null;
    if (compEl) {
      company = (compEl.textContent || '').trim();
    }

    let career = '';
    const careerEl = card ? card.querySelector('p.option span.exp, .option .exp, .exp, span.career') : null;
    if (careerEl) {
      career = (careerEl.textContent || '').trim();
    }

    const url = `https://www.jobkorea.co.kr/Recruit/GI_Read/${id}`;

    items.push({
      id,
      url,
      title,
      company,
      career
    });
  }

  return {
    items
  };
})();
