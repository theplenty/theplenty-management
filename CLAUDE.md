# CLAUDE.md — 프로젝트 운영 규칙

이 파일은 Claude Code 및 모든 AI 에이전트가 본 프로젝트에서 작업할 때 **반드시 따라야 하는 규칙**을 정의합니다. 매 세션마다 자동으로 컨텍스트에 로드됩니다.

---

## 🚨 최상위 규칙: 이 repository는 PUBLIC GitHub repo

**[theplenty/theplenty-management](https://github.com/theplenty/theplenty-management)** 는 누구나 볼 수 있는 공개 저장소입니다. 따라서 **모든 commit은 전 세계에 즉시 노출**됩니다. 이 사실을 절대 잊지 마세요.

### 절대 commit 금지 — 즉시 차단해야 할 항목

다음 중 하나라도 staged 되었다면 **commit을 막고 사용자에게 즉시 알려야 합니다**:

| 패턴 | 이유 |
|---|---|
| `.env`, `.env.local`, `.env.*` | OpenAI/Anthropic/Firebase API 키 포함 |
| `server/data/*.json` | 고객 1,600+명, 행사, 사용자 정보 |
| `server/data/*.bak.*`, `server/data/*.prev` | 데이터 백업본 |
| `server/data/backups/`, `server/data/uploads/` | 스냅샷 + 첨부파일 (계약서, INVOICE) |
| `*.xlsx`, `*.csv` | 고객정보 엑셀 export |
| `참고/`, `*-firebase-adminsdk-*.json` | Firebase 서비스 계정 키 |
| `node_modules/`, `dist/`, `build/` | 용량/재생성 가능 |
| `.claude/settings.local.json` | 로컬 PC 설정 |

이 모든 항목은 [.gitignore](.gitignore)에 등록되어 있습니다. **`.gitignore`를 절대 함부로 수정/삭제하지 마세요.** 변경이 필요하면 사용자 확인 필수.

### 코드에 박혀있으면 안 되는 정보

다음을 새 코드에 절대 hardcode 금지:

- 실제 사용자 이메일 (`sarah.p.babyy@gmail.com` 등 개인 정보)
- API 키, 토큰, 비밀번호 (어떤 형태든)
- Firebase project ID, API key (이미 `.env`에 있어도 코드 안에 중복 입력 금지)
- 회사 내부 URL, 내부 IP 주소

코드에 placeholder가 필요하면 항상 generic 값(`admin@example.com`, `your-api-key-here`)을 쓰고, 실제 값은 `.env`에서 주입.

---

## Git 작업 시 절차

### 1. commit 전 항상 dry-run 검증

사용자가 `git add`/`git commit`을 요청하면, 명령 실행 전 다음을 자동으로 수행:

```bash
# (1) staged 예정 파일 점검
git add --all --dry-run | grep -iE "\.env|wedding_customers|mice_customers|users\.json|uploads/|\.xlsx|adminsdk|참고/"
# 결과가 비어 있어야 정상. 한 줄이라도 출력되면 commit 차단하고 사용자에게 보고.

# (2) 무시 규칙이 작동하는지 확인
git status --ignored
# Ignored files: 섹션에 .env, server/data/*.json 등이 있어야 정상.
```

위 검증에서 의심 파일이 보이면 **commit 진행 전 반드시 사용자에게 명시적 확인**을 받습니다.

### 2. commit message 규칙

- 한국어 또는 영어 가능
- "왜 바꿨는지"를 짧게 (1-2 줄)
- 민감 정보(이메일, 토큰, 사용자 이름) 포함 금지

좋은 예: `행사 등록 시 작성자 자동 입력 추가 (작성일자/이름)`
나쁜 예: `sarah.p.babyy@gmail.com이 요청한 변경` ← 이메일 노출

### 3. push 전 1회 더 점검

`git push` 전:
```bash
git log --stat -1
```
방금 commit이 어떤 파일을 포함했는지 출력 — 위험 파일이 보이면 push 중단.

---

## 토큰/자격 증명 규칙

- **AI 에이전트는 PAT, API 키, 비밀번호를 직접 받아서 사용하지 않습니다.**
- 사용자가 채팅에 토큰을 붙여넣었다면:
  1. 즉시 그 토큰을 폐기하고 새로 발급하라고 안내
  2. 새 토큰은 사용자가 Windows 자격 증명 창 또는 OS keychain에 직접 입력하도록 유도
  3. 새 토큰을 코드/파일/메모리에 저장하지 말 것
- `git push` 시 인증은 OS 자격 증명 관리자가 처리. AI는 토큰을 보지 않습니다.

---

## 데이터 작업 시 규칙

`server/data/*.json` 파일은 **고객 자산**입니다:

- **읽기**: OK (디버깅, 검증용)
- **쓰기**: 사용자가 명시적으로 요청한 경우만. atomic write (`.tmp` → rename) 패턴 유지.
- **백업**: 큰 변경 전 `.bak.<timestamp>` 생성 권장
- **로그 출력**: 고객 이름/전화번호/이메일을 console.log에 출력하지 말 것 (개발 중에도)
- **외부 전송**: 어떤 이유로든 `server/data/*` 내용을 외부 서비스(API, webhook, 스크립트)로 전송 금지

---

## 새로운 파일을 만들 때

새 파일이 다음에 해당하면 추가로 검토:

- **루트 디렉토리에 `*.xlsx`, `*.csv`, `*.zip` 생성** → 고객 정보 export일 가능성. 이미 `.gitignore`에 패턴 있음. 사용자에게 확인.
- **`.tmp/`, `tmp/`, `temp/` 폴더 생성** → 자동 ignore됨. 그 안에 민감 데이터 두는 것 OK.
- **`참고/` 폴더 생성** → Firebase 키 보관용. ignore됨. 그 외 용도로 쓰지 말 것.
- **새 환경 변수 추가** → `.env.example`에도 동기화 (값은 비워둠).

---

## 사용자 정보 (auto-memory와 별개로 여기에 명시)

- 사용자 이름: Sarah (박미현). **commit/push 메시지/코드 어디든 이름·이메일 출력 금지.**
- 회사: 플렌티컨벤션
- 협업자: 외부 개발자 1명 (GitHub collaborator로 추가 예정)
- 운영 단계: mock-first → Firebase 마이그레이션 예정 (`plenty-sales` 프로젝트)

---

## 사고 발생 시 대응

민감 데이터/키가 commit·push 되었다면:

1. **즉시 모든 노출 키 회수 (rotate)**:
   - OpenAI: https://platform.openai.com/api-keys
   - Firebase: 콘솔 → Service Accounts → 키 재발급
   - GitHub PAT: https://github.com/settings/tokens
2. 노출 범위 평가 후 사용자에게 보고
3. history 영구 삭제는 BFG Repo-Cleaner 또는 새 repo 재생성으로
4. **Public repo이므로 한 번 push 된 데이터는 봇이 이미 긁어갔다고 가정.** 회사 정보보호 책임자에게 보고 권장.

---

## 관련 문서

- [GITHUB_DEPLOY_GUIDE.md](GITHUB_DEPLOY_GUIDE.md) — 사용자용 GitHub 배포 단계별 가이드
- [.gitignore](.gitignore) — 자동 보호 규칙
- [.env.example](.env.example) — 환경변수 템플릿
- [README.md](README.md) — 프로젝트 개요
