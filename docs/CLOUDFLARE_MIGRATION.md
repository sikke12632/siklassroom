# Cloudflare 직접 배포 준비

현재 기능 브랜치는 사용자 소유 Cloudflare Worker와 D1으로 직접 배포할 수 있게 준비되어 있습니다. 기존 `chatgpt.site` 버전은 전환 검증이 끝날 때까지 삭제하지 않습니다.

## 현재 결정

- 사용자에게 보이는 Worker 이름은 `job-classroom`입니다.
- D1 바인딩 이름은 코드와 동일한 `DB`입니다.
- 데이터 손실을 피하기 위해 먼저 기존 사용자 소유 D1을 그대로 연결합니다.
- 기존 D1의 내부 리소스 이름에는 과거 `ogu-classroom-production`이 남아 있습니다. 이 이름은 서비스 화면이나 주소에 노출되지 않습니다.
- 내부 D1 이름까지 바꾸려면 로그인 후 `job-classroom-production`을 새로 만들고, 기존 D1을 내보내 새 D1으로 가져온 뒤 `wrangler.jsonc`의 ID를 교체합니다. 이 작업은 첫 직접 배포가 정상임을 확인한 후 진행합니다.

## 사용자에게 필요한 한 번의 작업

프로젝트 폴더에서 다음 명령을 실행하고 브라우저에서 실제 Cloudflare 계정으로 로그인합니다.

```bash
npm run cloudflare:login
```

로그인이 끝나면 다음 명령으로 계정이 연결됐는지 확인합니다.

```bash
npm run cloudflare:whoami
```

## 운영 전 필요한 값

`cloudflare-secrets.example.json`을 `cloudflare-secrets.json`으로 복사한 뒤 실제 값으로 바꿉니다. 실제 파일은 Git에서 제외됩니다.

- `RESEND_API_KEY`: 인증 메일 발송용
- `MAIL_FROM`: Resend에서 확인된 발신 주소
- `SYSTEM_ADMIN_USERNAME`, `SYSTEM_ADMIN_PASSWORD_HASH`, `SYSTEM_ADMIN_PATH`: 운영자 로그인과 숨겨진 관리자 경로용 Worker Secrets
- `NEIS_API_KEY`: 나이스 학교기본정보 동기화용

값이 준비되면 다음 명령으로 Cloudflare에 비밀값을 올립니다.

```bash
npx wrangler secret bulk cloudflare-secrets.json
```

## 전환 전에 실행할 순서

```bash
npm run db:migrations:list:remote
npx wrangler d1 export DB --remote --output=cloudflare-d1-backup.sql
npm run db:migrate:remote
npm run deploy
```

1. 적용 대기 중인 D1 마이그레이션을 확인합니다.
2. 원격 D1 전체 백업을 만듭니다.
3. 새 마이그레이션을 적용합니다.
4. `job-classroom` Worker를 배포합니다.
5. 발급된 `workers.dev` 주소에서 교사 로그인, 학급, 학생, 직업, 이메일 인증을 확인합니다.
6. 검증이 끝난 뒤에만 사용자 도메인을 연결하거나 기존 `chatgpt.site`를 중단합니다.

`cloudflare-d1-backup.sql`은 계정·학생 정보가 포함될 수 있으므로 Git에 올리지 않고 안전한 위치에 보관합니다.
