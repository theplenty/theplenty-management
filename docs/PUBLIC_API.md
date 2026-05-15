# 플렌티컨벤션 공개 API (v1)

플렌티컨벤션 운영관리 시스템의 행사 캘린더를 외부 시스템(랜딩페이지, 파트너 서비스 등)에서 조회할 수 있는 JSON API입니다.

**대화형 문서 (in-app):** [https://plenty-management.web.app/api-docs](https://plenty-management.web.app/api-docs)

---

## 1. 개요

- **Base URL (Production):** `https://plenty-management.web.app`
- **API 버전:** `v1` (경로에 포함됨 — `/api/public/v1/...`)
- **응답 포맷:** JSON (UTF-8)
- **인증:** API 키 (관리자 발급)
- **CORS:** 허용 (모든 origin)

API 키 발급은 플렌티컨벤션 관리자에게 요청하세요. 발급 시 **권한(scope)** 이 지정되며, 키 단위로 노출 가능한 데이터 범위가 달라집니다.

---

## 2. 인증

모든 요청은 다음 두 가지 헤더 방식 중 하나로 인증합니다.

### 방식 A — `X-API-Key` (권장)

```
X-API-Key: pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 방식 B — `Authorization: Bearer`

```
Authorization: Bearer pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

토큰은 `pk_` 접두사 + 32자리 hex 형식입니다.

### 인증 실패 응답

| HTTP | `error` | 의미 |
|------|---------|------|
| 401 | `missing_api_key` | 헤더에 API 키가 없음 |
| 401 | `invalid_api_key` | 존재하지 않는 토큰 |
| 403 | `api_key_disabled` | 관리자가 비활성화한 키 |

---

## 3. 권한 (Scope)

키 발급 시 다음 4가지 권한 중 하나를 지정합니다.

| scope | 설명 | 노출 필드 |
|-------|------|-----------|
| `all` | 모든 행사 + 전체 디테일 | id, event_type, status, 시작/종료 시각, 행사명, 홀, 좌석 수, 담당자 |
| `summary` | 모든 행사 (디테일 가려진 요약) | id, event_type, status, 시작/종료 시각, 홀 (행사명/고객 미노출) |
| `wedding` | WEDDING 타입만 + 전체 디테일 | `all`과 동일 (event_type === `WEDDING` 필터) |
| `mice` | MICE 타입만 + 전체 디테일 | `all`과 동일 (event_type === `MICE` 필터) |

**공통 제외 규칙:** 모든 scope에서 취소된 행사(`LOS`, `상담취소`, `미팅취소`)는 응답에서 자동 제외됩니다.

---

## 4. 엔드포인트

### 4.1 `GET /api/public/v1/calendar/events`

지정한 기간의 행사 목록을 조회합니다.

**쿼리 파라미터 (모두 선택)**

| 이름 | 형식 | 기본값 | 설명 |
|------|------|--------|------|
| `from` | `YYYY-MM-DD` | 이번 달 1일 | 시작일 (포함) |
| `to` | `YYYY-MM-DD` | 시작일 + 1년 | 종료일 (포함) |

**요청 예시**

```bash
curl -H "X-API-Key: pk_abc..." \
  "https://plenty-management.web.app/api/public/v1/calendar/events?from=2026-05-01&to=2026-05-31"
```

**응답 예시 — `scope: all`**

```json
{
  "scope": "all",
  "range": { "from": "2026-05-01", "to": "2026-05-31" },
  "count": 2,
  "events": [
    {
      "id": "ev_abc123",
      "event_type": "WEDDING",
      "status": "DEF",
      "start_datetime": "2026-05-10T11:00",
      "end_datetime": "2026-05-10T15:00",
      "event_name": "김OO ♥ 박OO 결혼식",
      "halls": ["Hall A+B"],
      "usage_type": "AH",
      "seats": 200,
      "assigned_manager_name": "Sarah"
    },
    {
      "id": "ev_def456",
      "event_type": "MICE",
      "status": "INQ",
      "start_datetime": "2026-05-22T09:00",
      "end_datetime": "2026-05-22T18:00",
      "event_name": "OO그룹 워크숍",
      "halls": ["Leaf Room"],
      "usage_type": "AD",
      "seats": 50,
      "assigned_manager_name": null
    }
  ]
}
```

**응답 예시 — `scope: summary`**

```json
{
  "scope": "summary",
  "range": { "from": "2026-05-01", "to": "2026-05-31" },
  "count": 2,
  "events": [
    {
      "id": "ev_abc123",
      "event_type": "WEDDING",
      "status": "DEF",
      "start_datetime": "2026-05-10T11:00",
      "end_datetime": "2026-05-10T15:00",
      "halls": ["Hall A+B"]
    },
    {
      "id": "ev_def456",
      "event_type": "MICE",
      "status": "INQ",
      "start_datetime": "2026-05-22T09:00",
      "end_datetime": "2026-05-22T18:00",
      "halls": ["Leaf Room"]
    }
  ]
}
```

### 4.2 `GET /api/public/v1/me`

본인 키의 권한 정보를 확인합니다 (introspection). 외부 시스템에서 자기 키가 어떤 scope/active 상태인지 확인할 때 사용.

**요청 예시**

```bash
curl -H "X-API-Key: pk_abc..." \
  "https://plenty-management.web.app/api/public/v1/me"
```

**응답 예시**

```json
{
  "label": "플렌티 랜딩페이지",
  "scope": "summary",
  "active": true,
  "created_at": "2026-05-14T10:30:00.000Z"
}
```

---

## 5. 응답 필드 참조

### `event_type`

| 값 | 의미 |
|----|------|
| `WEDDING` | 웨딩 |
| `MICE` | MICE (기업/단체 행사) |

### `status`

| 값 | 의미 | 응답 포함 여부 |
|----|------|----------------|
| `INQ` | 문의/견적 단계 | ✅ |
| `DEF` | 확정 | ✅ |
| `미팅` | 미팅 일정 | ✅ |
| `시식` | 시식 일정 | ✅ |
| `LOS` | 로스트 (취소) | ❌ 제외됨 |
| `상담취소` | 상담 취소 | ❌ 제외됨 |
| `미팅취소` | 미팅 취소 | ❌ 제외됨 |

### `start_datetime` / `end_datetime`

ISO 8601 로컬 형식 (`YYYY-MM-DDTHH:mm`). 타임존은 **KST (Asia/Seoul)** 가정.

### `halls`

문자열 배열. 한 행사가 여러 홀을 동시에 사용할 수 있음. 예: `["Hall A", "Hall B"]`.

### `usage_type` (scope=all/wedding/mice)

| 값 | 의미 |
|----|------|
| `AH` | All Hall (홀 + 식음) |
| `AD` | All Day (대관만) |
| `H`  | Half (반나절) |
| ...  | 기타 회사 내부 코드 |

---

## 6. 보안 권장사항

1. **토큰은 발급 직후 한 번만** 평문으로 표시됩니다. 안전한 곳(비밀 관리자, env 파일)에 보관하세요.
2. 토큰을 **브라우저/모바일 앱 클라이언트에 직접 노출하지 마세요.** 반드시 본인 서버를 통해 프록시하여 호출하세요.
3. 토큰이 유출된 경우 즉시 관리자에게 알려 **해당 키를 삭제하고 새로 발급**받으세요.
4. **최소 권한 원칙** — 행사 디테일이 필요 없는 위젯/랜딩페이지 용도라면 `summary` 가 가장 안전합니다.
5. 키별 **최근 사용일시(last_used_at)** 는 관리자 페이지에서 확인 가능합니다. 사용되지 않는 키는 즉시 비활성화하세요.

---

## 7. 운영 안내

- **레이트 리밋:** 현재 별도 제한 없음. 과도한 호출 감지 시 키를 일시 비활성화할 수 있습니다.
- **가용성:** Firebase Hosting + Cloud Functions (asia-northeast3). 일시적 장애 가능성 있음.
- **버전 정책:** 경로에 `/v1/` 포함. 호환성 깨지는 변경은 `v2` 로 분리하여 추가 후 충분한 공지 기간을 둡니다.
- **변경 알림:** 키 발급 시 등록한 담당자에게 주요 변경 사항을 안내합니다.

---

## 8. 변경 이력

| 버전 | 날짜 | 변경 사항 |
|------|------|-----------|
| v1.0 | 2026-05-15 | 최초 공개. 캘린더 행사 목록 + 키 introspection 엔드포인트. |

---

## 9. 문의

키 발급 요청, 권한 변경, 장애 보고 등은 플렌티컨벤션 관리자에게 연락하세요.
