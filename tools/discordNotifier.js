const https = require('https');
const fs = require('fs');
const path = require('path');
require('./loadEnv');
const { log, error: logError } = require('./logger');

const USERNAME = '채용공고 스크랩 에이전트 🏢';
const AVATAR_URL = 'https://cdn-icons-png.flaticon.com/512/3850/3850285.png';
const EMBED_CHAR_LIMIT = 6000;
const EMBED_FIELD_LIMIT = 25;
const FIELD_VALUE_LIMIT = 1024;

// ---------------------------------------------------------------------------
// KST 포맷 ('+09:00' 오프셋을 직접 구성)
// ---------------------------------------------------------------------------
function kstParts(date = new Date()) {
  const s = new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString(); // 'YYYY-MM-DDTHH:mm:ss.sssZ' (시프트된 벽시계 값)
  return { ymd: s.slice(0, 10), hms: s.slice(11, 19) };
}

/** 'YYYY-MM-DDTHH:mm:ss+09:00' */
function kstIso(date = new Date()) {
  const { ymd, hms } = kstParts(date);
  return `${ymd}T${hms}+09:00`;
}

/** 'YYYY-MM-DD HH:mm:ss' */
function kstDisplay(date = new Date()) {
  const { ymd, hms } = kstParts(date);
  return `${ymd} ${hms}`;
}

// ---------------------------------------------------------------------------
// 웹훅 전송
// ---------------------------------------------------------------------------
/**
 * 디스코드 웹훅으로 JSON 페이로드 전송
 * @returns {Promise<boolean>} 2xx 이면 true, 그 외(설정 누락 포함) false
 */
function postWebhook(payload) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl || !webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
    logError('[Discord] 웹훅 URL(DISCORD_WEBHOOK_URL)이 설정되지 않아 알림을 전송하지 못했습니다.');
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    try {
      const url = new URL(webhookUrl);
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            log(`[Discord] 웹훅 전송 성공 (코드 ${res.statusCode})`);
            resolve(true);
          } else {
            logError(`[Discord] 웹훅 전송 실패 (코드 ${res.statusCode}): ${body}`);
            resolve(false);
          }
        });
      });

      req.on('error', (err) => {
        logError('[Discord] 웹훅 전송 실패:', err);
        resolve(false);
      });

      req.write(payload);
      req.end();
    } catch (e) {
      logError('[Discord] 웹훅 파싱 실패:', e);
      resolve(false);
    }
  });
}

async function postAll(payloads) {
  let ok = true;
  for (const p of payloads) {
    const r = await postWebhook(JSON.stringify(p));
    if (!r) ok = false;
  }
  return ok;
}

// ---------------------------------------------------------------------------
// 공고 목록 청킹 (기존 로직 재사용)
// ---------------------------------------------------------------------------
function chunkJobLines(targetJobs) {
  const lines = targetJobs.map((j, i) => {
    const deadlineStr = j.deadline ? ` \`~${String(j.deadline).replace(/^\d{4}[-\.\/]/, '')}\`` : '';
    return `${i + 1}. **[${j.company}]** [${j.position}](${j.url})${deadlineStr}`;
  });

  // Discord 필드당 최대 1024자 제한 방어를 위한 청킹 로직
  const chunks = [];
  let currentChunk = [];
  let currentLength = 0;

  for (const line of lines) {
    if (currentLength + line.length + 1 > 900) {
      chunks.push(currentChunk);
      currentChunk = [line];
      currentLength = line.length;
    } else {
      currentChunk.push(line);
      currentLength += line.length + 1;
    }
  }
  if (currentChunk.length > 0) chunks.push(currentChunk);
  return chunks;
}

function jobListFields(targetJobs, label = '✨ 오늘 등록된 신규 공고') {
  if (!targetJobs || targetJobs.length === 0) {
    return [{ name: label, value: '신규 등록된 공고가 없습니다.', inline: false }];
  }
  const chunks = chunkJobLines(targetJobs);
  if (chunks.length === 1) {
    return [{ name: `${label} (전체 ${targetJobs.length}건)`, value: chunks[0].join('\n'), inline: false }];
  }
  const fields = [];
  let startIndex = 1;
  chunks.forEach((chunk) => {
    const endIndex = startIndex + chunk.length - 1;
    fields.push({
      name: `${label} (전체 ${targetJobs.length}건 중 ${startIndex}~${endIndex})`,
      value: chunk.join('\n'),
      inline: false
    });
    startIndex = endIndex + 1;
  });
  return fields;
}

// ---------------------------------------------------------------------------
// 임베드 분할 (필드 25개 / 전체 6000자)
// ---------------------------------------------------------------------------
function embedLength(embed) {
  let n = (embed.title || '').length + (embed.description || '').length + ((embed.footer && embed.footer.text) || '').length;
  for (const f of embed.fields || []) n += f.name.length + f.value.length;
  return n;
}

function packEmbeds({ title, description, color, footerText, fields }) {
  const embeds = [];
  const make = (idx) => ({
    title: idx === 0 ? title : `${title} (계속)`,
    color,
    description: idx === 0 ? description : '',
    fields: [],
    footer: { text: footerText },
    timestamp: kstIso()
  });

  let cur = make(0);
  for (const f of fields) {
    const field = { ...f, value: f.value.slice(0, FIELD_VALUE_LIMIT) };
    const tentative = { ...cur, fields: [...cur.fields, field] };
    if (cur.fields.length > 0 && (tentative.fields.length > EMBED_FIELD_LIMIT || embedLength(tentative) > EMBED_CHAR_LIMIT)) {
      embeds.push(cur);
      cur = make(embeds.length);
    }
    cur.fields.push(field);
  }
  embeds.push(cur);

  // 각 메시지에 embed 1개씩 담아 순서대로 전송 (메시지 단위로 6000자/25필드 제한 보장)
  return embeds.map(embed => ({ username: USERNAME, avatar_url: AVATAR_URL, embeds: [embed] }));
}

// ---------------------------------------------------------------------------
// 기존 API: 일일 요약 리포트 (하위 호환)
// ---------------------------------------------------------------------------
async function sendDiscordDailyReport({ totalScanned, newPublished, reopened, skipped, targetJobs = [] }) {
  const fields = [
    {
      name: '📊 수집 통계',
      value: `• 총 탐색 공고: **${totalScanned}건**\n• 신규 노션 등록: **${newPublished}건** 🏢\n• 마감 후 재오픈: **${reopened}건** 🔄\n• 기존 활성 스킵: **${skipped}건** ⚡`,
      inline: false
    },
    ...jobListFields(targetJobs, '✨ 오늘 발굴 및 등록된 신규 공고')
  ];

  const payloads = packEmbeds({
    title: '🌅 오늘의 웹개발/IT 채용공고 수집 완료 리포트',
    description: '오늘 공고 탐색 및 노션 저장이 정상 완료되었습니다.\n(타깃: **신입 / 경력무관** 프론트엔드·풀스택·SW개발)',
    color: newPublished > 0 ? 5793266 : 10066329,
    footerText: 'Antigravity Multi-Agent System | 노션 채용 관리 DB 연동',
    fields
  });
  return postAll(payloads);
}

// ---------------------------------------------------------------------------
// 기존 API: 에러 알림
// ---------------------------------------------------------------------------
async function sendDiscordErrorReport({ stage = '채용공고 수집/심사 파이프라인', error, detail = '' }) {
  const errorMessage = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ''}` : String(error || '알 수 없는 에러 발생');
  const trimmedError = errorMessage.length > 900 ? errorMessage.slice(0, 900) + '... (이하 생략)' : errorMessage;

  const payload = JSON.stringify({
    username: USERNAME,
    avatar_url: AVATAR_URL,
    embeds: [
      {
        title: '🚨 채용공고 수집 파이프라인 에러 발생',
        color: 15158332,
        description: '수집 파이프라인 또는 에이전트 작업 중 오류가 발생하여 공고 수집/심사가 일부 또는 전체 중단되었습니다.',
        fields: [
          { name: '📍 발생 단계', value: `\`${stage}\``.slice(0, FIELD_VALUE_LIMIT), inline: true },
          { name: '⏰ 발생 시각 (KST)', value: kstDisplay(), inline: true },
          { name: '❌ 에러 내용', value: `\`\`\`text\n${trimmedError}\n\`\`\``, inline: false },
          ...(detail ? [{ name: '💡 권장 조치 및 참고사항', value: String(detail).slice(0, FIELD_VALUE_LIMIT), inline: false }] : [])
        ],
        footer: { text: 'Antigravity Multi-Agent System | Alert Guardrail' },
        timestamp: kstIso()
      }
    ]
  });

  return postWebhook(payload);
}

// ---------------------------------------------------------------------------
// --report <summary.json>
// ---------------------------------------------------------------------------
function readJsonIfExists(p) {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    logError(`[Discord] ${p} 읽기 실패:`, e);
  }
  return null;
}

function readJsonlIfExists(p) {
  try {
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
  } catch (e) {
    logError(`[Discord] ${p} 읽기 실패:`, e);
    return [];
  }
}

/**
 * summary.json 과 같은 디렉터리의 publish_result.json / results.jsonl 로 등록 공고 목록(마감일 포함)을 구성
 */
function loadPublishedJobs(summaryPath, summary) {
  if (Array.isArray(summary.publishedJobs)) return summary.publishedJobs;
  const dir = path.dirname(path.resolve(summaryPath));
  const pr = readJsonIfExists(path.join(dir, 'publish_result.json'));
  if (!pr || !Array.isArray(pr.published)) return [];
  const deadlines = {};
  for (const r of readJsonlIfExists(path.join(dir, 'results.jsonl'))) {
    if (r.job && r.jobKey && r.job.deadline) deadlines[r.jobKey] = r.job.deadline;
  }
  return pr.published.map(p => ({
    company: p.company,
    position: p.position,
    url: p.notionUrl || p.url,
    deadline: p.deadline || deadlines[p.jobKey] || ''
  }));
}

function trackValue(t) {
  const top = (t.rejectTopReasons || []).slice(0, 3).map(r => `${r.reasonCode} ${r.count}`).join(', ');
  const n = (v) => (v === undefined || v === null ? 0 : v);
  return [
    `• 목록 확인 **${n(t.listed)}** / 구간 스킵 **${n(t.coveredSkipped)}** / 중복 스킵 **${n(t.dupSkipped)}**`,
    `• 심사 **${n(t.reviewed)}** / 합격 **${n(t.passed)}** / 탈락 **${n(t.rejected)}**${top ? ` (${top})` : ''}`,
    `• 등록 **${n(t.published)}** / 재오픈 **${n(t.reopened)}** / 실패 **${n(t.failed)}**`,
    `• 종료 사유: \`${t.stopReason || '-'}\``
  ].join('\n');
}

function buildReportPayloads(summary, publishedJobs = []) {
  const total = summary.total || {};
  const published = total.published || 0;
  const failed = total.failed || 0;
  const fields = [];

  fields.push({ name: '📊 전체 합계', value: trackValue({ ...total, stopReason: '-' }).replace(/\n• 종료 사유: `-`$/, ''), inline: false });
  for (const [name, t] of Object.entries(summary.tracks || {})) {
    fields.push({ name: `🔎 ${name}`, value: trackValue(t), inline: false });
  }
  fields.push(...jobListFields(publishedJobs));

  const color = failed > 0 && published === 0 ? 15158332 : published > 0 ? 5793266 : 10066329;
  return packEmbeds({
    title: '🌅 채용공고 수집 완료 리포트',
    description: `실행 ID: \`${summary.runId || '-'}\` | 신규 등록 **${published}건**${published === 0 ? ' (등록 0건)' : ''}`,
    color,
    footerText: 'Antigravity Multi-Agent System | 노션 채용 관리 DB 연동',
    fields
  });
}

async function sendDiscordSummaryReport(summaryPath) {
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const jobs = loadPublishedJobs(summaryPath, summary);
  const ok = await postAll(buildReportPayloads(summary, jobs));
  if (ok) {
    try {
      const dir = path.dirname(path.resolve(summaryPath));
      const reportSentPath = path.join(dir, 'report_sent.json');
      fs.writeFileSync(reportSentPath, JSON.stringify({
        runId: summary.runId || path.basename(dir),
        sentAt: kstIso(),
        summaryPath: path.resolve(summaryPath)
      }, null, 2), 'utf8');
    } catch (e) {
      logError('[Discord] report_sent.json 저장 실패:', e);
    }
  }
  return ok;
}

// ---------------------------------------------------------------------------
// --single <publish_result.json>
// ---------------------------------------------------------------------------
function buildSinglePayload(result) {
  const pub = (result.published || [])[0];
  const fail = (result.failed || [])[0];
  const fields = [];
  if (pub) {
    fields.push({ name: '🏢 기업 / 직무', value: `**${pub.company}** — ${pub.position}`.slice(0, FIELD_VALUE_LIMIT), inline: false });
    fields.push({ name: '🔗 노션 페이지', value: pub.notionUrl || '-', inline: false });
    if (pub.url) fields.push({ name: '📎 원본 공고', value: pub.url, inline: false });
  }
  if (fail) {
    fields.push({ name: '⚠️ 등록 실패', value: `**${fail.company}** — ${String(fail.error).slice(0, 800)}`, inline: false });
  }
  return {
    username: USERNAME,
    avatar_url: AVATAR_URL,
    embeds: [{
      title: pub ? '단일 공고 등록 완료' : '단일 공고 등록 실패',
      color: pub ? 5793266 : 15158332,
      fields,
      footer: { text: 'Antigravity Multi-Agent System | 단일 공고 등록' },
      timestamp: kstIso()
    }]
  };
}

async function sendDiscordSingleReport(resultPath) {
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  return postWebhook(JSON.stringify(buildSinglePayload(result)));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);

  (async () => {
    if (args[0] === '--error') {
      const stage = args[1] || '수집 파이프라인';
      const err = args[2] || '테스트 에러가 발생했습니다.';
      const detail = args[3] || '';
      return sendDiscordErrorReport({ stage, error: err, detail });
    }
    if (args[0] === '--report') {
      if (!args[1] || !fs.existsSync(args[1])) throw new Error('사용법: --report <summary.json>');
      return sendDiscordSummaryReport(args[1]);
    }
    if (args[0] === '--single') {
      if (!args[1] || !fs.existsSync(args[1])) throw new Error('사용법: --single <publish_result.json>');
      return sendDiscordSingleReport(args[1]);
    }
    const totalScanned = parseInt(args[0] || '0', 10);
    const newPublished = parseInt(args[1] || '0', 10);
    return sendDiscordDailyReport({
      totalScanned,
      newPublished,
      reopened: 0,
      skipped: Math.max(0, totalScanned - newPublished),
      targetJobs: []
    });
  })()
    .then(ok => process.exit(ok ? 0 : 1))
    .catch(e => {
      logError('[Discord] CLI 실행 실패:', e);
      process.exit(1);
    });
}

module.exports = {
  sendDiscordDailyReport,
  sendDiscordErrorReport,
  sendDiscordSummaryReport,
  sendDiscordSingleReport,
  buildReportPayloads,
  buildSinglePayload,
  postWebhook,
  kstIso,
  kstDisplay
};
