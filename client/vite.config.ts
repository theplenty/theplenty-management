import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // .env는 프로젝트 루트(상위 폴더)에 있음. Vite root는 기본적으로 vite.config.ts 위치(client/)이므로
  // envDir를 상위로 지정해서 VITE_* 변수들이 빌드에 정확히 inline 되도록.
  envDir: '..',
  server: {
    port: 5173,
    // /api 요청은 Express(3001)로 프록시 — 프론트에서 fetch('/api/...')로 호출
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
