// 로컬 개발 전용 진입점.
// Cloud Functions 배포 환경에서는 index.ts의 `api` export만 사용됨.
// tsx watch src/server.ts → 로컬 Express 서버 listen.

import './index.js';
import { app } from './index.js';

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://localhost:${PORT}`);
});
