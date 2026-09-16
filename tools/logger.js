function log(...args) {
  const now = new Date();
  const kstTime = new Date(now.getTime() + (9 * 60 * 60 * 1000)).toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${kstTime}]`, ...args);
}

function error(...args) {
  const now = new Date();
  const kstTime = new Date(now.getTime() + (9 * 60 * 60 * 1000)).toISOString().replace('T', ' ').slice(0, 19);
  console.error(`[${kstTime}] ❌ [ERROR]`, ...args);
}

module.exports = { log, error };
