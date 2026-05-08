# GitHub 배포 가이드 — 처음 사용자용

이 문서는 Sarah가 [theplenty/theplenty-management](https://github.com/theplenty/theplenty-management) 저장소에 처음으로 프로젝트를 올릴 때 사용하는 단계별 안내서입니다. **고객 정보·API 키·예약 정보가 절대 새어나가지 않도록** 보호 장치를 먼저 설명한 뒤, 실행 명령어로 넘어갑니다.

---

## 목차

1. [Git이 무엇인지 30초 요약](#1-git이-무엇인지-30초-요약)
2. [⚠️ 시작 전 보안 점검 — 반드시 먼저](#2-️-시작-전-보안-점검--반드시-먼저)
3. [무엇을 올리고 무엇을 가리는가 (전체 매트릭스)](#3-무엇을-올리고-무엇을-가리는가-전체-매트릭스)
4. [사전 준비 — Git 설치 + GitHub 가입](#4-사전-준비--git-설치--github-가입)
5. [인증 설정 — Personal Access Token (PAT)](#5-인증-설정--personal-access-token-pat)
6. [첫 commit 전 최종 보안 체크리스트](#6-첫-commit-전-최종-보안-체크리스트)
7. [실제 명령어 — 하나씩 따라가기](#7-실제-명령어--하나씩-따라가기)
8. [사고 났을 때 — 실수로 민감 파일 올렸다면](#8-사고-났을-때--실수로-민감-파일-올렸다면)
9. [앞으로의 일상 사용 흐름](#9-앞으로의-일상-사용-흐름)
10. [용어 사전](#10-용어-사전)

---

## 1. Git이 무엇인지 30초 요약

- **Git**: 내 컴퓨터에서 변경 이력을 관리하는 도구. "어제 짠 코드로 되돌리기"를 가능하게 해줌.
- **GitHub**: Git 저장소를 인터넷에 백업·공유하는 서비스. 회사 서버처럼 생각하면 됨.
- **Repository (repo)**: 한 프로젝트의 코드와 변경 이력을 담은 단위. 우리 repo는 [theplenty/theplenty-management](https://github.com/theplenty/theplenty-management).
- **Commit**: "이 시점의 코드 모습을 영구 보관" 작업. 짧은 설명(메시지)을 붙임.
- **Push**: 내 컴퓨터에 있는 commit을 GitHub로 올리기.
- **Private repo**: 나와 초대한 사람만 볼 수 있는 저장소. 회사 코드는 반드시 private로!

---

## 2. ⚠️ 시작 전 보안 점검 — 반드시 먼저

### 2-1. OpenAI API 키 즉시 확인

현재 프로젝트의 `.env` 파일에 `sk-proj-...`로 시작하는 OpenAI API 키가 들어 있습니다. 이게 **실제 발급받아 사용 중인 키**라면 다음을 해주세요:

1. https://platform.openai.com/api-keys 접속
2. 해당 키 옆의 ⋯ 메뉴 → **Revoke key** 클릭
3. **Create new secret key** 로 새 키 발급
4. 새 키를 `.env` 파일에 붙여넣기

> 왜? Git 한 번이라도 잘못 올라가면 GitHub 공개 저장소를 스캔하는 봇이 1분 내 키를 가져가서 사용량을 폭탄처럼 청구합니다. 이번 가이드대로만 따라하면 안전하지만, **이미 어딘가 다른 곳에 노출됐을 가능성이 있다면 지금 회수가 안전합니다.**

> 안 쓰는 키라면 그냥 무시해도 됩니다 (어차피 .gitignore가 막아줌).

### 2-2. Firebase 서비스 계정 키 (`참고/` 폴더)

`.env`에 `GOOGLE_APPLICATION_CREDENTIALS=참고/...` 경로가 적혀 있습니다. `참고/` 폴더에 Firebase admin 키 파일을 둘 예정이라면 **이 폴더 전체가 .gitignore 처리되도록** 이미 설정해뒀습니다. 폴더 안에 들어가는 모든 파일은 자동으로 GitHub에 안 올라갑니다.

### 2-3. 고객·행사 데이터 (`server/data/`)

현재 다음이 들어 있습니다:
- `wedding_customers.json` — 543명 웨딩 고객 (2.7MB)
- `mice_customers.json` — MICE 고객 정보
- `events.json`, `event_reviews.json` — 행사·리뷰
- `users.json` — Sarah 본인 포함 사용자 6명
- `change_logs.json` — 변경 이력 (427KB)
- `uploads/` 폴더 — 첨부파일 (계약서, BEO 등)
- `backups/` 폴더 — 일자별 스냅샷

**전부 .gitignore로 차단했습니다.** 코드는 올라가고 데이터는 안 올라갑니다.

### 2-4. 루트의 엑셀 파일

`WEDDING_고객정보_2026-05-04_(2).xlsx` 가 프로젝트 루트에 있습니다. 543명 정보가 들어있어서 절대 올라가면 안됩니다. **`*.xlsx` 패턴을 .gitignore에 추가**해뒀습니다.

### 2-5. 코드에 박혀있는 개인 이메일

~~다음 파일에 개인 이메일이 fallback 값으로 적혀 있었습니다 — 이미 `admin@example.com` generic 값으로 교체됨.~~ (Public repo 대응 완료)
- [server/src/store/seed.ts:8](server/src/store/seed.ts#L8) — `process.env.SUPER_ADMIN_EMAIL || 'admin@example.com'`
- [client/src/pages/Login.tsx:10](client/src/pages/Login.tsx#L10) — 데모 계정 리스트
- [README.md:40](README.md#L40) — 데모 계정 표

**Private repo로 만들면** 회사 사람만 볼 수 있어서 큰 문제 없습니다. 하지만 만약 나중에 public으로 전환할 가능성이 있다면 이 값들을 generic하게 (`'admin@example.com'` 등) 바꿔주세요. 지금 시점에는 그냥 두고 진행해도 됩니다.

---

## 3. 무엇을 올리고 무엇을 가리는가 (전체 매트릭스)

| 항목 | GitHub에 올림? | 이유 |
|---|:-:|---|
| `client/src/`, `server/src/` (소스 코드) | ✅ | 코드는 협업·이력 관리 대상 |
| `package.json`, `tsconfig.json` 등 설정 | ✅ | 다른 환경에서 같은 빌드를 재현하는 데 필요 |
| `README.md`, `GITHUB_DEPLOY_GUIDE.md` | ✅ | 문서 |
| `.env.example` (값 빈 템플릿) | ✅ | 어떤 환경 변수가 필요한지 알려주는 템플릿 |
| `.gitignore` | ✅ | 어떤 파일을 가릴지의 규칙 자체 |
| **`.env`** (실제 값 들어 있음) | ❌ | **OpenAI 키, Firebase 키, super admin email — 절대 노출 금지** |
| **`server/data/*.json`** | ❌ | **고객·행사·사용자 정보 — 회사 자산** |
| **`server/data/uploads/`** | ❌ | **계약서·BEO·INVOICE 첨부파일** |
| **`server/data/backups/`** | ❌ | 일자별 데이터 스냅샷 |
| **`*.xlsx`, `*.csv`** | ❌ | 고객정보 엑셀 export |
| **`참고/`** | ❌ | Firebase admin credential 파일 보관 폴더 |
| `node_modules/` | ❌ | 용량 거대 + `npm install`로 재생성 가능 |
| `dist/`, `build/` | ❌ | 빌드 산출물. 소스에서 다시 만들면 됨 |
| `.vscode/`, `.idea/` | ❌ | 개인 PC IDE 설정 |
| `.claude/settings.local.json` | ❌ | 로컬 Claude Code 설정 (개인 PC 종속) |

이 모든 규칙은 이미 [`.gitignore`](.gitignore) 파일에 다 정의되어 있어서, **Git이 자동으로 위 ❌ 항목들을 무시합니다.**

---

## 4. 사전 준비 — Git 설치 + GitHub 가입

### 4-1. Git 설치 (Windows)

> 이미 깔려있다면 건너뛰세요. 확인은 PowerShell에서 `git --version` — 버전 번호가 나오면 OK.

🔗 **[Git for Windows 다운로드](https://git-scm.com/download/win)** ← 클릭

설치 옵션은 거의 다 기본값(Next 연타)으로 진행하면 됩니다. 단 다음 두 페이지만 권장 옵션 확인:

- **"Adjusting your PATH environment"** → `Git from the command line and also from 3rd-party software` (기본 선택) 선택
- **"Choosing the default behavior of `git pull`"** → `Default (fast-forward or merge)` (기본 선택)

설치 후 PowerShell을 **새로 열어서** 확인:
```powershell
git --version
# git version 2.45.x.windows.1  ← 이런 식으로 나오면 OK
```

### 4-2. GitHub 계정 가입 (없으면)

🔗 **[GitHub 가입 페이지](https://github.com/signup)** ← 클릭

이메일·비밀번호·사용자명만 입력하면 끝. 무료 계정으로도 private repo 무제한 만들 수 있습니다.

### 4-3. 우리 repo 확인

🔗 **[theplenty/theplenty-management](https://github.com/theplenty/theplenty-management)** ← 클릭

- 이 repo가 **Private**으로 설정되어 있는지 확인하세요. (페이지 상단에 자물쇠 🔒 아이콘 + "Private" 라벨이 있어야 함)
- Public이면 즉시 Settings → General → 맨 아래 "Change visibility" → Make private.
- 회사 사람을 초대하려면: Settings → Collaborators → Add people.

### 4-4. Git에 본인 정보 등록 (1회만)

PowerShell에서:
```powershell
git config --global user.name "Sarah Park"
git config --global user.email "your-github-email@example.com"
```

> 여기 적은 이메일은 commit에 작성자 정보로 박힙니다. GitHub 가입 이메일과 동일하게 하세요.

---

## 5. 인증 설정 — Personal Access Token (PAT)

GitHub는 더 이상 비밀번호로 push 받지 않습니다. 대신 **PAT (Personal Access Token)** 라는 일종의 "비밀번호 대체용 긴 문자열"을 발급받아 사용합니다.

### 5-1. PAT 발급

🔗 **[Personal Access Token 발급 페이지 (scope 미리 채움)](https://github.com/settings/tokens/new?scopes=repo&description=theplenty-management)** ← 클릭

이 링크는 다음을 자동 설정해줍니다:
- **Note (이름)**: `theplenty-management`
- **Scope**: `repo` (private repo 읽기·쓰기 권한)

남은 설정:
- **Expiration**: `90 days` 또는 `180 days` (보안상 무기한은 권장 안함, 만료되면 다시 발급)
- 페이지 맨 아래 **Generate token** 클릭

### 5-2. 토큰 보관

화면에 `ghp_xxxxxxxxxxxxxxxxxxxxxxxx...` 형태의 긴 문자열이 한 번만 표시됩니다. **이 페이지를 떠나면 다시 못 봐요.**

- 비밀번호 관리자(1Password, Bitwarden, 메모장 등)에 즉시 저장
- 또는 **메모 앱에 임시 저장** → push 후 사용
- 절대 코드 안에 붙여넣지 마세요

### 5-3. 토큰 사용 시점

다음 섹션 7-5의 `git push` 단계에서 자격 증명 창이 뜨면:
- Username: GitHub 사용자명
- Password: **PAT 문자열** (실제 GitHub 비밀번호 아님)

Windows는 한 번 입력하면 자격 증명 관리자가 기억해서 다음부터 자동입력해줍니다.

---

## 6. 첫 commit 전 최종 보안 체크리스트

명령어 실행 전 PowerShell에서 다음을 확인하세요. 한 줄씩 복사해서 붙여넣어 실행:

### 6-1. `.gitignore`가 잘 동작하는지 미리 시뮬레이션

```bash
git init
git status --ignored | head -50
```

- `Ignored files:` 섹션에 `.env`, `node_modules/`, `server/data/wedding_customers.json`, `WEDDING_고객정보_2026-05-04_(2).xlsx` 등이 보여야 정상.
- 혹시 `.env`가 `Untracked files:` 섹션에 있으면 즉시 멈추고 가이드 작성자에게 문의.

### 6-2. 자동 검출 명령어 — 위험 파일이 추적될 예정인지

```bash
git add --all --dry-run | grep -iE "\.env|wedding_customers|mice_customers|users\.json|uploads/|\.xlsx|adminsdk|참고/"
```

- 출력이 **아무것도 없어야** 정상.
- 한 줄이라도 나오면 그 파일이 .gitignore에 빠져있다는 뜻 — 추가 후 다시 시도.

### 6-3. 의심 파일을 한 번 더 명시적으로 확인

```bash
git check-ignore -v .env server/data/wedding_customers.json server/data/users.json "WEDDING_고객정보_2026-05-04_(2).xlsx"
```

각 줄에 `.gitignore:라인번호:패턴 파일경로` 형태로 출력되어야 정상. 그 파일이 무시되고 있다는 뜻.

---

## 7. 실제 명령어 — 하나씩 따라가기

PowerShell을 열고 프로젝트 폴더로 이동한 뒤 한 단계씩 진행하세요. **각 단계 끝에서 결과를 확인하고 다음 단계로 넘어가세요.**

```powershell
cd e:\HK_Sales통합관리
```

### 7-1. Git 저장소 초기화

```bash
git init
```

> `.git/` 이라는 숨김 폴더가 생깁니다. 이 폴더가 변경 이력을 모두 저장합니다.

### 7-2. 기본 브랜치 이름을 `main`으로

```bash
git branch -M main
```

> GitHub는 기본 브랜치를 `main`이라고 가정하므로 맞춰줍니다.

### 7-3. 어떤 파일이 추적될지 미리보기 (dry run)

```bash
git status
```

화면에 나오는 `Untracked files:` 목록을 끝까지 스크롤해서 살펴보세요.
- ✅ 보여야 하는 것: `client/src/`, `server/src/`, `package.json`, `README.md`, `.gitignore`, `.env.example`, `GITHUB_DEPLOY_GUIDE.md`
- ❌ 보이면 안 되는 것: `.env`, `server/data/wedding_customers.json`, `*.xlsx`, `node_modules/`

만약 ❌ 항목이 보이면 **6-2 명령어로 다시 점검** 후 .gitignore 보강.

### 7-4. 파일 staging + 첫 commit

```bash
git add .
git commit -m "Initial commit: HK_Sales통합관리 mock-first 단계까지 구현"
```

> 두 번째 줄은 커밋 메시지입니다. 한국어/영어 둘 다 가능. 따옴표 안에 자유롭게.

### 7-5. GitHub와 연결 (remote 추가)

```bash
git remote add origin https://github.com/theplenty/theplenty-management.git
```

> `origin`은 "원격 저장소의 별명"입니다. 관례적으로 origin이라 부릅니다.

### 7-6. 처음 push

```bash
git push -u origin main
```

이때 자격 증명 창이 뜹니다:
- Username: GitHub 사용자명
- Password: **5-2에서 받은 PAT 토큰** (ghp_xxx...)

성공하면 마지막 줄에 `branch 'main' set up to track 'origin/main'.` 같은 메시지가 보입니다.

### 7-7. 브라우저로 확인

🔗 **[https://github.com/theplenty/theplenty-management](https://github.com/theplenty/theplenty-management)** 새로고침

- `client/`, `server/` 폴더가 보이면 성공!
- `.env`, `server/data/wedding_customers.json` 등이 보이면 즉시 [8번 섹션](#8-사고-났을-때--실수로-민감-파일-올렸다면)으로!

---

## 8. 사고 났을 때 — 실수로 민감 파일 올렸다면

### 8-1. 아직 push 전이라면 (commit만 한 상태)

```bash
# 마지막 commit 취소 (파일은 그대로 둠)
git reset --soft HEAD~1

# .gitignore에 누락된 항목 추가 후 다시 add
git add .
git commit -m "Initial commit (sensitive files removed)"
```

### 8-2. 이미 push 한 상태라면

**즉시 다음 작업을 동시에 진행하세요:**

1. **노출된 키를 모두 회수 (rotate)**
   - OpenAI: https://platform.openai.com/api-keys → revoke
   - Firebase: https://console.firebase.google.com → Project settings → Service accounts → 키 삭제 후 재발급
   - GitHub PAT: https://github.com/settings/tokens → 의심 토큰 revoke

2. **GitHub에서 파일을 영구 삭제 (history까지)**
   - 가장 안전한 방법: 위 1번 회수 후, 새 GitHub repo를 만들고 거기에 다시 깨끗하게 push.
   - 또는 BFG Repo-Cleaner 같은 도구로 history scrubbing 가능 (복잡하므로 도움 요청).

3. **공개되었을 가능성 있는 고객 정보가 있다면**
   - 회사 정보보호 책임자에게 즉시 보고
   - GitHub repo를 즉시 private 또는 삭제 처리

> **history 한 번 올라간 데이터는 누군가 이미 fork·clone 받았을 수 있다**고 가정하고 대응합니다.

### 8-3. 예방의 정석

`.git/hooks/pre-commit` 훅에 자동 차단 스크립트를 둘 수 있지만, 일단은 **commit 전에 항상 6번 섹션 체크리스트 한 번씩 돌리기**가 가장 안전합니다.

---

## 9. 앞으로의 일상 사용 흐름

코드를 수정한 후 GitHub에 반영하는 일반적인 흐름:

```bash
# 1. 뭐가 바뀌었는지 확인
git status

# 2. 변경 내용 자세히 보기
git diff

# 3. 변경분을 staging
git add .

# 4. commit (메시지에 무엇을 왜 바꿨는지 짧게)
git commit -m "행사 등록 시 작성자/작성일자 자동 입력 추가"

# 5. GitHub로 올리기
git push
```

> 첫 push 이후로는 `git push` 하나면 됩니다 (`-u origin main` 안 붙여도 됨).

### 다른 PC에서 작업 시작할 때 (회사 PC ↔ 집 PC 등)

```bash
git clone https://github.com/theplenty/theplenty-management.git
cd theplenty-management
npm run install:all
# .env 파일은 GitHub에 없으니 .env.example을 복사해서 새로 만들어야 함
cp .env.example .env
# 실제 값 입력 후 저장
npm run dev
```

---

## 10. 용어 사전

| 용어 | 의미 |
|---|---|
| **clone** | GitHub에 있는 repo를 내 PC로 처음 받아오기 |
| **pull** | GitHub의 최신 변경분을 내 PC로 가져오기 |
| **push** | 내 PC의 commit을 GitHub로 올리기 |
| **branch** | 평행 작업선. 우리는 `main` 하나만 사용해도 충분 |
| **HEAD** | 현재 보고 있는 commit |
| **origin** | 원격 저장소(GitHub)의 별명 |
| **stage** / **index** | commit 직전 단계. `git add`로 stage |
| **PAT** | Personal Access Token. 비밀번호 대신 사용하는 긴 문자열 |
| **.gitignore** | "이 파일들은 추적하지 마" 라는 규칙 목록 |

---

## 빠른 참조 카드 (즐겨찾기 권장 링크)

- 우리 repo: https://github.com/theplenty/theplenty-management
- PAT 발급: https://github.com/settings/tokens/new?scopes=repo&description=theplenty-management
- Git 다운로드: https://git-scm.com/download/win
- OpenAI 키 관리: https://platform.openai.com/api-keys
- Firebase 콘솔: https://console.firebase.google.com

---

처음이라 막히는 부분이 있다면 그 단계의 PowerShell 화면을 그대로 알려주세요. 어디서 멈춰야 하는지 짚어드리겠습니다.
