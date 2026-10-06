const fs = require('fs');
const path = require('path');

const DEFAULT_REGISTRY_PATH = path.resolve(__dirname, '..', 'data', 'registry.json');

let inMemoryRegistry = null;

function getRegistryPath(customPath) {
  return customPath ? path.resolve(customPath) : DEFAULT_REGISTRY_PATH;
}

function getKstIsoString() {
  const date = new Date();
  const s = new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString();
  return `${s.slice(0, 19)}+09:00`;
}

/**
 * 디스크에서 레지스트리를 로드하여 메모리에 적재
 */
function load(customPath) {
  const filePath = getRegistryPath(customPath);
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      inMemoryRegistry = JSON.parse(content);
    } else {
      inMemoryRegistry = {};
    }
  } catch (e) {
    inMemoryRegistry = {};
  }
  return inMemoryRegistry;
}

/**
 * 특정 jobKey 항목 조회
 */
function get(jobKey, customPath) {
  if (inMemoryRegistry === null) {
    load(customPath);
  }
  return inMemoryRegistry ? inMemoryRegistry[jobKey] : undefined;
}

/**
 * 특정 jobKey 항목 추가 또는 갱신
 */
function upsert(jobKey, entry, customPath) {
  if (inMemoryRegistry === null) {
    load(customPath);
  }
  if (!jobKey) return null;

  const current = inMemoryRegistry[jobKey] || {};
  const updated = {
    ...current,
    ...entry,
    jobKey,
    updatedAt: entry?.updatedAt || getKstIsoString()
  };

  inMemoryRegistry[jobKey] = updated;
  return updated;
}

/**
 * 디스크의 최신 상태와 병합 후 원자적(atomic)으로 저장
 */
function save(customPath) {
  const filePath = getRegistryPath(customPath);
  if (inMemoryRegistry === null) {
    inMemoryRegistry = {};
  }

  let diskRegistry = {};
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      diskRegistry = JSON.parse(content);
    }
  } catch (e) {
    diskRegistry = {};
  }

  // 키 단위 병합: updatedAt 기준 최신 항목 우선
  const allKeys = new Set([...Object.keys(diskRegistry), ...Object.keys(inMemoryRegistry)]);
  const merged = {};

  for (const k of allKeys) {
    const fromDisk = diskRegistry[k];
    const fromMem = inMemoryRegistry[k];

    if (fromDisk && fromMem) {
      const diskTime = fromDisk.updatedAt || '';
      const memTime = fromMem.updatedAt || '';
      if (memTime >= diskTime) {
        merged[k] = fromMem;
      } else {
        merged[k] = fromDisk;
      }
    } else if (fromMem) {
      merged[k] = fromMem;
    } else {
      merged[k] = fromDisk;
    }
  }

  inMemoryRegistry = merged;

  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);

  return inMemoryRegistry;
}

/**
 * 테스트 등에서 메모리 캐시 리셋용
 */
function resetInMemory() {
  inMemoryRegistry = null;
}

module.exports = {
  load,
  get,
  upsert,
  save,
  resetInMemory,
  getRegistryPath
};
