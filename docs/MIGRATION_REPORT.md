# Firestore 마이그레이션 검증 리포트

**생성 시각**: 2026-05-12T08:41:16.838Z
**프로젝트**: `plenty-management`

## 결과 요약

| 컬렉션 | JSON 원본 | Firestore | 카운트 일치 | 샘플 doc 일치 |
|---|--:|--:|:-:|:-:|
| `users` | 6 | 7 | ❌ | ✅ |
| `mice_customers` | 232 | 232 | ✅ | ✅ |
| `wedding_customers` | 543 | 543 | ✅ | ✅ |
| `events` | 0 | 0 | ✅ | ➖ |
| `event_customers` | 0 | 0 | ✅ | ➖ |
| `event_food_items` | 0 | 0 | ✅ | ➖ |
| `invoices` | 0 | 0 | ✅ | ➖ |
| `event_files` | 0 | 0 | ✅ | ➖ |
| `cancellations` | 0 | 0 | ✅ | ➖ |
| `event_reviews` | 0 | 0 | ✅ | ➖ |
| `calendar_shares` | 3 | 3 | ✅ | ✅ |
| `sales_targets` | 0 | 0 | ✅ | ➖ |
| `change_logs` | 1342 | 1340 | ❌ | ✅ |

## 불일치 상세

### users

- **카운트 불일치**: JSON 6 ≠ Firestore 7

### change_logs

- **카운트 불일치**: JSON 1342 ≠ Firestore 1340


---

_이 리포트는 `server/scripts/verify-migration.ts` 가 자동 생성합니다._
