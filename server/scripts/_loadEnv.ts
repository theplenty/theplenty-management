// .env 로드 헬퍼 — server/scripts/ 위치에서 호출되더라도 프로젝트 루트의 .env를 정확히 찾음.
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, '../../.env') });
