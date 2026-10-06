const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const registry = require('../tools/registry');

test('registry: CRUD 및 원자적 저장 기본 동작', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-test-'));
  const testRegPath = path.join(tmpDir, 'registry.json');

  try {
    registry.resetInMemory();
    const data = registry.load(testRegPath);
    assert.deepEqual(data, {});

    registry.upsert('saramin:123', {
      verdict: 'published',
      company: '테스트사',
      position: '개발자'
    }, testRegPath);

    assert.equal(registry.get('saramin:123', testRegPath).company, '테스트사');
    assert.ok(registry.get('saramin:123', testRegPath).updatedAt);

    registry.save(testRegPath);
    assert.equal(fs.existsSync(testRegPath), true);

    const saved = JSON.parse(fs.readFileSync(testRegPath, 'utf8'));
    assert.equal(saved['saramin:123'].position, '개발자');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    registry.resetInMemory();
  }
});

test('registry: 두 인스턴스가 번갈아 upsert/save 해도 updatedAt 기준 키 유실 없이 병합됨', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-concurrent-'));
  const testRegPath = path.join(tmpDir, 'registry.json');

  try {
    // 인스턴스 A 동작
    registry.resetInMemory();
    registry.load(testRegPath);
    registry.upsert('job:A', { verdict: 'published', updatedAt: '2026-10-05T10:00:00+09:00' }, testRegPath);
    registry.save(testRegPath);

    // 인스턴스 B 가 로드
    registry.resetInMemory();
    registry.load(testRegPath);

    // 인스턴스 A 가 새로운 키 job:A2 추가 및 저장
    registry.resetInMemory();
    registry.load(testRegPath);
    registry.upsert('job:A2', { verdict: 'rejected', updatedAt: '2026-10-05T10:05:00+09:00' }, testRegPath);
    registry.save(testRegPath);

    // 인스턴스 B 가 기존 상태에서 job:B 추가하고 저장 -> A2 가 유실되지 않고 병합되어야 함
    registry.resetInMemory();
    // B 의 메모리 상태 시뮬레이션: A 는 알고 있으나 A2 는 모르는 상태에서 B 추가
    registry.upsert('job:A', { verdict: 'published', updatedAt: '2026-10-05T10:00:00+09:00' }, testRegPath);
    registry.upsert('job:B', { verdict: 'published', updatedAt: '2026-10-05T10:06:00+09:00' }, testRegPath);
    registry.save(testRegPath);

    const finalData = JSON.parse(fs.readFileSync(testRegPath, 'utf8'));
    assert.ok(finalData['job:A'], 'job:A 존재');
    assert.ok(finalData['job:A2'], '인스턴스 A가 쓴 job:A2가 유실되지 않음');
    assert.ok(finalData['job:B'], '인스턴스 B가 쓴 job:B 존재');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    registry.resetInMemory();
  }
});
