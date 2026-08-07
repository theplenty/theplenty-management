import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// 서비스워커 등록 (A6 · PWA)
// 개발 중에는 등록하지 않는다 — HMR 과 섞이면 낡은 번들이 잡혀 디버깅이 어려워진다.
// 실패해도 앱 동작에는 영향이 없으므로 조용히 넘어간다.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* 설치 실패해도 일반 웹앱으로 정상 동작 */
    });
  });
}
