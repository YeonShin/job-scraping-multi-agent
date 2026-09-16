const https = require('https');
const { log, error: logError } = require('./logger');

/**
 * 디스코드 웹훅으로 JSON 페이로드 전송
 */
function postWebhook(payload) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl || !webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
    log('[Discord] 웹훅 URL이 설정되지 않아 알림 전송을 건너뜁니다.');
    return Promise.resolve();
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
        log(`[Discord] 웹훅 전송 결과 코드: ${res.statusCode}`);
        resolve();
      });

      req.on('error', (err) => {
        logError('[Discord] 웹훅 전송 실패:', err);
        resolve();
      });

      req.write(payload);
      req.end();
    } catch (e) {
      logError('[Discord] 웹훅 파싱 실패:', e);
      resolve();
    }
  });
}

/**
 * 정상 완료 시 일일 요약 리포트 전송
 */
async function sendDiscordDailyReport({ totalScanned, newPublished, reopened, skipped, targetJobs = [] }) {
  const fields = [
    {
      name: '📊 수집 통계',
      value: `• 총 탐색 공고: **${totalScanned}건**\n• 신규 노션 등록: **${newPublished}건** 🏢\n• 마감 후 재오픈: **${reopened}건** 🔄\n• 기존 활성 스킵: **${skipped}건** ⚡`,
      inline: false
    }
  ];

  if (!targetJobs || targetJobs.length === 0) {
    fields.push({
      name: '✨ 오늘 발굴된 신규 공고',
      value: '신규 등록된 공고가 없습니다.',
      inline: false
    });
  } else {
    // 발굴된 공고 전체를 리스트화 (마감일 정보 포함)
    const lines = targetJobs.map((j, i) => {
      const deadlineStr = j.deadline ? ` \`~${j.deadline.replace(/^\d{4}[-\.\/]/, '')}\`` : '';
      return `${i + 1}. **[${j.company}]** [${j.position}](${j.url})${deadlineStr}`;
    });

    // Discord 필드당 최대 1024자 제한 방어를 위한 청킹 로직
    const chunks = [];
    let currentChunk = [];
    let currentLength = 0;

    for (let line of lines) {
      if (currentLength + line.length + 1 > 900) {
        chunks.push(currentChunk);
        currentChunk = [line];
        currentLength = line.length;
      } else {
        currentChunk.push(line);
        currentLength += line.length + 1;
      }
    }
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    if (chunks.length === 1) {
      fields.push({
        name: `✨ 오늘 발굴 및 등록된 신규 공고 (전체 ${targetJobs.length}건)`,
        value: chunks[0].join('\n'),
        inline: false
      });
    } else {
      let startIndex = 1;
      chunks.forEach((chunk, idx) => {
        const endIndex = startIndex + chunk.length - 1;
        fields.push({
          name: `✨ 오늘 등록된 신규 공고 (전체 ${targetJobs.length}건 중 ${startIndex}~${endIndex})`,
          value: chunk.join('\n'),
          inline: false
        });
        startIndex = endIndex + 1;
      });
    }
  }

  const payload = JSON.stringify({
    username: '채용공고 스크랩 에이전트 🏢',
    avatar_url: 'https://cdn-icons-png.flaticon.com/512/3850/3850285.png',
    embeds: [
      {
        title: '🌅 오늘의 웹개발/IT 채용공고 수집 완료 리포트',
        color: newPublished > 0 ? 5793266 : 10066329, // 초록색 또는 회색
        description: `오늘 공고 탐색 및 노션 저장이 정상 완료되었습니다.\n(타깃: **신입 / 경력무관** 프론트엔드·풀스택·SW개발)`,
        fields: fields,
        footer: {
          text: 'Antigravity Multi-Agent System | 노션 채용 관리 DB 연동'
        },
        timestamp: new Date().toISOString()
      }
    ]
  });

  return postWebhook(payload);
}

/**
 * 에러 발생 시 디스코드 장애 알림 전송
 * @param {Object} params
 * @param {string} params.stage - 실패가 발생한 단계 (예: '사람인 듀얼 트랙 탐색', '노션 DB 페이지 발행')
 * @param {string|Error} params.error - 에러 객체 또는 에러 메시지
 * @param {string} [params.detail] - 추가 상세 맥락 또는 권장 조치사항
 */
async function sendDiscordErrorReport({ stage = '채용공고 수집/심사 파이프라인', error, detail = '' }) {
  const errorMessage = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ''}` : String(error || '알 수 없는 에러 발생');
  
  // 디스코드 Embed 글자 수 제한 고려 (최대 1000자 자르기)
  const trimmedError = errorMessage.length > 900 ? errorMessage.slice(0, 900) + '... (이하 생략)' : errorMessage;

  const payload = JSON.stringify({
    username: '채용공고 스크랩 에이전트 🏢',
    avatar_url: 'https://cdn-icons-png.flaticon.com/512/3850/3850285.png',
    embeds: [
      {
        title: '🚨 채용공고 수집 파이프라인 에러 발생',
        color: 15158332, // 빨간색 (#E74C3C)
        description: `스케줄러 또는 에이전트 작업 중 오류가 발생하여 공고 수집/심사가 일부 또는 전체 중단되었습니다.`,
        fields: [
          {
            name: '📍 발생 단계',
            value: `\`${stage}\``,
            inline: true
          },
          {
            name: '⏰ 발생 시각 (KST)',
            value: new Date(Date.now() + (9 * 60 * 60 * 1000)).toISOString().replace('T', ' ').slice(0, 19),
            inline: true
          },
          {
            name: '❌ 에러 내용',
            value: `\`\`\`text\n${trimmedError}\n\`\`\``,
            inline: false
          },
          ...(detail ? [{
            name: '💡 권장 조치 및 참고사항',
            value: detail,
            inline: false
          }] : [])
        ],
        footer: {
          text: 'Antigravity Multi-Agent System | Alert Guardrail'
        },
        timestamp: new Date().toISOString()
      }
    ]
  });

  return postWebhook(payload);
}

// CLI 실행 지원
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args[0] === '--error') {
    const stage = args[1] || '수집 파이프라인';
    const err = args[2] || '테스트 에러가 발생했습니다.';
    const detail = args[3] || '';
    sendDiscordErrorReport({ stage, error: err, detail }).then(() => process.exit(0));
  } else {
    const totalScanned = parseInt(args[0] || '0', 10);
    const newPublished = parseInt(args[1] || '0', 10);
    sendDiscordDailyReport({
      totalScanned,
      newPublished,
      reopened: 0,
      skipped: Math.max(0, totalScanned - newPublished),
      targetJobs: []
    }).then(() => process.exit(0));
  }
}

module.exports = { sendDiscordDailyReport, sendDiscordErrorReport };
