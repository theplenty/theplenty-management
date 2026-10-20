// S1 스모크 — 구매 시스템 원가 API 를 키 있는/없는 상태로 불러 응답 코드·건수만 확인한다.
// 키는 실행하는 셸의 환경변수 STORAGE_READ_KEY 로만 받는다 — 파일에 적지 않는다. 응답 본문·키는 출력하지 않는다.
// 사용(PowerShell, 대표님 터미널):
//   cd server
//   $env:STORAGE_READ_KEY = (npx firebase functions:secrets:access STORAGE_READ_KEY --project plenty-management)
//   npx tsx scripts/_smoke-storage-api.ts
//   Remove-Item Env:STORAGE_READ_KEY
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, '../.env'), quiet: true } as Parameters<typeof config>[0]);

const { getStorageMenus, getStorageMenuCost, getStorageCogs, storageKeyConfigured } = await import('../src/lib/storageCost.js');

let fail = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!ok) fail++;
};

console.log('키 설정됨:', storageKeyConfigured() ? '예' : '아니오 (셸 환경변수 STORAGE_READ_KEY 필요 — 파일 머리 주석 참고)');

// 1) 키 없음 → no_key (호출 자체를 안 한다)
{
  const saved = process.env.STORAGE_READ_KEY;
  delete process.env.STORAGE_READ_KEY;
  const r = await getStorageMenus({ force: true });
  check('키 없음(모듈)', !r.ok && r.reason === 'no_key', `reason=${r.ok ? 'ok?' : r.reason}`);
  // 진짜 서버가 키 없는 요청을 401 로 막는지 — 헤더 없이 직접 한 번
  const raw = await fetch('https://plenty-storage.web.app/api/public/menus').catch(() => null);
  check('키 없음(서버 401)', raw?.status === 401, `status=${raw?.status ?? 'network'}`);
  await raw?.arrayBuffer().catch(() => undefined); // 본문을 비워 소켓을 닫는다 (출력 안 함)
  if (saved) process.env.STORAGE_READ_KEY = saved;
}

if (!storageKeyConfigured()) {
  console.log('\n키가 없어 나머지 검사는 건너뜀.');
  process.exit(fail ? 1 : 0);
}

// 2) /menus 200
{
  const r = await getStorageMenus({ force: true });
  check('/menus 200', r.ok, r.ok ? `메뉴 ${r.data.menus.length}개` : `status=${r.status} ${r.reason}`);
  const r2 = await getStorageMenus();
  check('/menus 캐시', r2.ok && r2.cached, r2.ok ? `cached=${r2.cached}` : r2.reason);
}

// 3) /menu-cost?month=2026-09 200 (98메뉴 · 완전 96 예상)
{
  const r = await getStorageMenuCost('2026-09', { force: true });
  if (r.ok) {
    const n = r.data.menus.length;
    const complete = r.data.menus.filter((m) => m.완전).length;
    check('/menu-cost 2026-09 200', true, `메뉴 ${n} · 완전 ${complete} · 소급=${r.data.소급} · 단가기준=${r.data.단가기준}`);
  } else check('/menu-cost 2026-09 200', false, `status=${r.status} ${r.reason}`);
  const r2 = await getStorageMenuCost('2026-09');
  check('/menu-cost 캐시', r2.ok && r2.cached, r2.ok ? `cached=${r2.cached}` : r2.reason);
}

// 4) 열린 달 → 404 (캐시 안 됨)
{
  const r = await getStorageMenuCost('2026-10', { force: true });
  check('/menu-cost 2026-10 404', !r.ok && r.status === 404, `status=${r.status} ${r.ok ? '' : r.reason}`);
  const r2 = await getStorageMenuCost('2026-10');
  check('404 미캐시(재호출)', !r2.ok || !r2.cached, r2.ok ? `cached=${r2.cached}` : `status=${r2.status}`);
}

// 5) cogs
{
  const r = await getStorageCogs('2026-09', { force: true });
  check('/cogs 2026-09', r.ok || r.status === 404, r.ok ? `부서 ${r.data.depts.length}` : `status=${r.status} ${r.reason}`);
  const bad = await getStorageCogs('2026-9');
  check('month 형식 검사', !bad.ok && bad.status === 400, `status=${bad.status}`);
}

console.log(fail ? `\n실패 ${fail}건` : '\n모두 통과');
process.exit(fail ? 1 : 0);
