const https = require('https');
const fs = require('fs');
const path = require('path');
const { log, error } = require('./logger');

// .env 로드
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      process.env[key] = val;
    }
  });
}

function requestNotion(payload) {
  const apiKey = process.env.NOTION_API_KEY;
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.notion.com',
      path: '/v1/pages',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error(`Notion API [${res.statusCode}]: ${JSON.stringify(json)}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function normalizeDate(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const str = raw.trim();

  // YYYY-MM-DD 또는 YYYY.MM.DD 또는 YYYY/MM/DD
  const isoMatch = str.match(/(\d{4})[-\.\/](\d{1,2})[-\.\/](\d{1,2})/);
  if (isoMatch) {
    const y = isoMatch[1];
    const m = isoMatch[2].padStart(2, '0');
    const d = isoMatch[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // ~MM.DD 또는 MM/DD (현재 연도 적용)
  const mdMatch = str.match(/(\d{1,2})[\.\/](\d{1,2})/);
  if (mdMatch) {
    const nowKst = new Date(Date.now() + (9 * 60 * 60 * 1000));
    const currentYear = nowKst.getFullYear();
    const m = mdMatch[1].padStart(2, '0');
    const d = mdMatch[2].padStart(2, '0');
    return `${currentYear}-${m}-${d}`;
  }

  // D-Day 형식 (D-5, D-12 등)
  const ddayMatch = str.match(/D[-–](\d+)/i);
  if (ddayMatch) {
    const days = parseInt(ddayMatch[1], 10);
    const target = new Date(Date.now() + (days * 24 * 60 * 60 * 1000) + (9 * 60 * 60 * 1000));
    return target.toISOString().split('T')[0];
  }

  return null;
}

async function publishJob(job) {
  const dbId = process.env.NOTION_DATABASE_ID;
  if (!dbId) throw new Error('NOTION_DATABASE_ID가 설정되지 않았습니다.');

  const properties = {
    "기업명": {
      title: [{ text: { content: job.company || '기업명 미상' } }]
    },
    "채용직무": {
      rich_text: [{ text: { content: job.position || '' } }]
    },
    "채용링크": {
      url: job.url
    },
    "상태": {
      status: { name: "미지원" }
    },
    "AI 수집": {
      checkbox: true
    },
    "created_at": {
      date: { start: new Date(Date.now() + (9 * 60 * 60 * 1000)).toISOString().split('T')[0] }
    }
  };

  if (job.jobCategory) properties["직무분류"] = { select: { name: job.jobCategory } };
  if (job.experienceLevel) properties["경력조건"] = { select: { name: job.experienceLevel } };
  if (job.employmentType) properties["고용형태"] = { select: { name: job.employmentType } };
  if (job.industry) properties["산업군"] = { select: { name: job.industry } };
  if (job.industryDetail) properties["산업군 (상세)"] = { rich_text: [{ text: { content: job.industryDetail } }] };
  if (job.companyScale) properties["회사규모"] = { select: { name: job.companyScale } };
  if (job.location) properties["근무지"] = { rich_text: [{ text: { content: job.location } }] };

  // 마감일 정규화 및 등록
  const normalizedDeadline = normalizeDate(job.deadline);
  if (normalizedDeadline) {
    properties["마감일"] = { date: { start: normalizedDeadline } };
  }

  // 공고 등록일 정규화 및 등록
  const normalizedPostedDate = normalizeDate(job.postedDate);
  if (normalizedPostedDate) {
    properties["공고 등록일"] = { date: { start: normalizedPostedDate } };
  }
  if (job.documents && job.documents.length) {
    properties["제출 서류"] = {
      multi_select: job.documents.map(d => ({ name: d }))
    };
  }

  ['1차', '2차', '3차', '4차', '5차', '6차'].forEach(round => {
    if (job[round]) {
      properties[round] = { select: { name: job[round] } };
    }
  });

  const children = [];

  // AI 3줄 요약
  if (job.summary) {
    children.push({
      object: "block",
      type: "callout",
      callout: {
        rich_text: [{ text: { content: `💡 [AI 핵심 3줄 요약]\n${job.summary}` } }],
        icon: { emoji: "🚀" },
        color: "blue_background"
      }
    });
  }

  // 주요 업무
  if (job.mainTasks && job.mainTasks.length) {
    children.push({
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: [{ text: { content: "📌 주요 업무 (Responsibilities)" } }] }
    });
    job.mainTasks.forEach(task => {
      children.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [{ text: { content: task.slice(0, 2000) } }] }
      });
    });
    children.push({ object: "block", type: "divider", divider: {} });
  }

  // 지원 자격
  if (job.requirements && job.requirements.length) {
    children.push({
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: [{ text: { content: "✅ 지원 자격 (Qualifications)" } }] }
    });
    job.requirements.forEach(req => {
      children.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [{ text: { content: req.slice(0, 2000) } }] }
      });
    });
    children.push({ object: "block", type: "divider", divider: {} });
  }

  // 우대 사항
  if (job.preferredPoints && job.preferredPoints.length) {
    children.push({
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: [{ text: { content: "🌟 우대 사항 (Preferred Points)" } }] }
    });
    job.preferredPoints.forEach(p => {
      children.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [{ text: { content: p.slice(0, 2000) } }] }
      });
    });
    children.push({ object: "block", type: "divider", divider: {} });
  }

  // 복리후생
  if (job.benefits && job.benefits.length) {
    children.push({
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: [{ text: { content: "🎁 복리후생 & 개발 문화" } }] }
    });
    job.benefits.forEach(b => {
      children.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [{ text: { content: b.slice(0, 2000) } }] }
      });
    });
  }

  const payload = {
    parent: { database_id: dbId },
    icon: { type: "emoji", emoji: "🏢" },
    properties,
    children
  };

  const result = await requestNotion(payload);
  log(`[Notion Publish] ✅ [${job.company}] ${job.position} ➔ ${result.url}`);
  return result;
}

const { sendDiscordDailyReport, sendDiscordErrorReport } = require('./discordNotifier');

if (require.main === module) {
  const jsonPath = process.argv[2];
  if (jsonPath && fs.existsSync(jsonPath)) {
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const jobs = Array.isArray(raw) ? raw : [raw];
    
    (async () => {
      const published = [];
      const failed = [];
      for (let i = 0; i < jobs.length; i++) {
        const j = jobs[i];
        try {
          log(`[${i + 1}/${jobs.length}] 노션 등록 중: [${j.company}] ${j.position}`);
          await publishJob(j);
          published.push(j);
        } catch (e) {
          error(`[${i + 1}/${jobs.length}] 등록 실패: [${j.company}]`, e);
          failed.push({ company: j.company, position: j.position, error: e.message });
        }
      }
      log(`[CLI] 등록 완료: 총 ${published.length}건 성공 / ${failed.length}건 실패`);
      
      if (published.length > 0) {
        await sendDiscordDailyReport({
          totalScanned: jobs.length,
          newPublished: published.length,
          reopened: 0,
          skipped: 0,
          targetJobs: published
        });
      }

      if (failed.length > 0 && published.length === 0) {
        await sendDiscordErrorReport({
          stage: '노션 DB 일괄 발행 단계',
          error: `공고 ${failed.length}건 등록 전체 실패:\n` + failed.map(f => `• [${f.company}] ${f.error}`).join('\n'),
          detail: '노션 API 키 권한 또는 데이터베이스 ID(NOTION_DATABASE_ID) 유효성을 점검하세요.'
        });
      }
    })().then(() => process.exit(0)).catch(async (err) => {
      error('CLI 실행 에러:', err);
      await sendDiscordErrorReport({
        stage: '노션 퍼블리셔 CLI 실행',
        error: err,
        detail: '입력 JSON 파일 파싱 및 런타임 오류가 발생했습니다.'
      });
      process.exit(1);
    });
  } else {
    console.log('사용법: node tools/notionJobPublisher.js <path-to-job.json>');
  }
}

module.exports = { publishJob };
