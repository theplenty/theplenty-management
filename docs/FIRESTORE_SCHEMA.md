# Firestore 스키마 — Plenty Convention 운영관리

## 설계 원칙

1. **현재 JSON 스키마와 1:1 대응** — 마이그레이션 단순화 우선. 추후 최적화는 별도 단계.
2. **Doc ID = 기존 JSON의 `id` 필드** — 마이그레이션 멱등성 + 기존 클라이언트 코드 호환.
3. **모든 접근은 Admin SDK** — 클라이언트는 Firestore에 직접 접근 안 함. (firestore.rules 모두 deny)
4. **Timestamp 필드는 ISO 문자열 유지** (예: `created_at`, `start_datetime`) — 기존 코드 호환. Firestore Timestamp 타입은 사용 안 함.

---

## 컬렉션 매핑 (13개)

| 현재 JSON 파일 | Firestore 컬렉션 | Doc ID | 비고 |
|---|---|---|---|
| `users.json` | `users` | `user.id` | 6명 데모 계정 |
| `mice_customers.json` | `mice_customers` | `customer.id` | 임베디드 `inquiries[]`, `inquiries[].contacts[]` 그대로 |
| `wedding_customers.json` | `wedding_customers` | `customer.id` | 임베디드 `event_inquiries[]` 그대로. 543명 |
| `events.json` | `events` | `event.id` | |
| `event_customers.json` | `event_customers` | `link.id` | event_id로 인덱스 |
| `event_food_items.json` | `event_food_items` | `item.id` | event_id로 인덱스 |
| `invoices.json` | `invoices` | `invoice.id` | event_id로 인덱스 (1:1) |
| `event_files.json` | `event_files` | `file.id` | event_id로 인덱스 |
| `cancellations.json` | `cancellations` | `cancel.id` | event_id로 인덱스 (1:1) |
| `event_reviews.json` | `event_reviews` | `review.id` | event_id로 인덱스 (1:1) |
| `calendar_shares.json` | `calendar_shares` | `share.id` | token으로 조회 |
| `change_logs.json` | `change_logs` | `log.id` | 시간순 정렬용. 향후 entity_type별 서브컬렉션 분리 검토 |
| `sales_targets.json` | `sales_targets` | `target.id` | year+month로 조회 |

---

## 인덱스 설계

Firestore는 단일 필드는 자동 인덱스. 복합 쿼리는 명시 필요.

| 컬렉션 | 인덱스 | 사용처 |
|---|---|---|
| `event_customers` | `event_id` ASC | 행사별 업체 연결 조회 |
| `event_food_items` | `event_id` ASC, `service_time` ASC | 행사별 식음 메뉴 |
| `event_files` | `event_id` ASC, `uploaded_at` DESC | 행사별 첨부파일 |
| `invoices` | `event_id` ASC | 1:1 조회 |
| `cancellations` | `event_id` ASC | 1:1 조회 |
| `event_reviews` | `event_id` ASC | 1:1 조회 |
| `calendar_shares` | `token` ASC | 토큰으로 조회 |
| `change_logs` | `entity_type` ASC, `entity_id` ASC, `at` DESC | 엔티티별 변경 이력 |
| `sales_targets` | `year` ASC, `month` ASC | 월별 조회 |

위는 단일 필드 + 복합 인덱스 모두 단순한 형태라, Firestore가 첫 쿼리 실패 시 자동으로 콘솔에 인덱스 생성 링크를 던져줍니다. 일단 명시 인덱스 없이 시작 → 실제 쿼리 패턴 보고 추가.

---

## 트랜잭션 / 배치 정책

마이그레이션:
- 컬렉션당 500 doc씩 batch write (Firestore 한도)
- 실패 시 재시도 (3회)

런타임:
- 단일 doc CRUD: Admin SDK 기본 동작
- 행사 등록 (events + food_items + customer_links + invoice 동시): batch 1개로 묶음
- 변경 로그 기록: 별도 batch로 추가 (실패해도 메인 트랜잭션 영향 없음)

---

## 마이그레이션 순서 (의존성)

1. `users` (다른 컬렉션이 user_id 참조)
2. `mice_customers`, `wedding_customers` (events가 link로 참조)
3. `events`
4. `event_customers`, `event_food_items`, `invoices`, `cancellations`, `event_reviews`, `event_files`
5. `calendar_shares`, `sales_targets`, `change_logs`

`change_logs`는 마이그레이션 시점의 스냅샷으로 최후 처리.

---

## 데이터 변환 규칙

| 원본 (JSON) | Firestore | 비고 |
|---|---|---|
| `null` | `null` 그대로 | Firestore null OK |
| `undefined` 필드 | 필드 자체 생략 | Firestore가 미정의 필드 무시 |
| `[]` 빈 배열 | `[]` 그대로 | |
| `{}` 빈 객체 | `{}` 그대로 | |
| ISO datetime 문자열 | 문자열 그대로 | Firestore Timestamp 사용 안 함 (호환성) |
| 한국어 문자열 | UTF-8 그대로 | Firestore가 자동 처리 |
