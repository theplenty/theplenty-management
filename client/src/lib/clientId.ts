// 클라이언트 측 임시 id 생성 — 폼 내부에서 새 row를 식별할 때 사용.
// 서버 저장 후에는 실제 nanoid로 대체된다.
export function nanoid(): string {
  return 'tmp_' + Math.random().toString(36).slice(2, 10);
}
