const fs = require('fs');
const path = require('path');

/**
 * 프로젝트 루트 .env 를 파싱해 process.env 에 주입한다.
 * - 이미 설정된 환경변수는 덮어쓰지 않는다.
 * - 값 앞뒤 따옴표("..." 또는 '...')를 제거한다.
 * - 빈 줄, # 주석, '=' 없는 줄은 무시한다.
 */
function parseEnv(content) {
  const result = {};
  String(content).split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    if (!key) return;
    let val = trimmed.slice(idx + 1).trim();
    if (val.length >= 2) {
      const first = val[0];
      const last = val[val.length - 1];
      if ((first === '"' || first === "'") && first === last) {
        val = val.slice(1, -1);
      }
    }
    result[key] = val;
  });
  return result;
}

function loadEnv(envPath = path.resolve(__dirname, '..', '.env')) {
  if (!fs.existsSync(envPath)) return {};
  const parsed = parseEnv(fs.readFileSync(envPath, 'utf8'));
  for (const [key, val] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = val;
  }
  return parsed;
}

loadEnv();

module.exports = { loadEnv, parseEnv };
