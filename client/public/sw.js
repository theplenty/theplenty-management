// 서비스워커 — 홈화면 설치(PWA)와 현장 오프라인 대비용. (로드맵 A6)
//
// 의도적으로 보수적으로 짰다. 사내 운영 도구라 **오래된 화면이 남는 사고**가
// 오프라인 지원보다 훨씬 위험하기 때문:
//   1) /api/*        — 아예 건드리지 않는다. 운영 데이터는 항상 서버에서.
//   2) 페이지 이동    — network-first. 배포하면 새로고침 한 번으로 최신이 뜬다.
//                      오프라인일 때만 마지막으로 받은 화면을 보여준다.
//   3) /assets/*     — 파일명에 해시가 박혀 있어 내용이 바뀌면 이름도 바뀐다.
//                      그래서 cache-first 로 둬도 낡은 파일이 남지 않는다.
//
// 캐시 이름을 올리면 이전 캐시는 activate 에서 전부 지운다.
const CACHE = 'plenty-v1';
const SHELL = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll([SHELL, '/icon.svg', '/icon-192.png', '/manifest.webmanifest']))
  );
  // 새 워커를 대기시키지 않는다 — 배포 후 다음 방문에 바로 적용.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 다른 출처(Firebase Auth·Storage 등)와 API 는 그대로 통과시킨다.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // 페이지 이동 — network-first
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(SHELL, copy));
          return res;
        })
        .catch(() => caches.match(SHELL).then((r) => r || Response.error()))
    );
    return;
  }

  // 해시가 박힌 정적 자산 — cache-first
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
      )
    );
  }
});
