# Vercel 배포

Vercel 프로젝트에서 이 저장소를 연결하고 Framework Preset을 Next.js, **Root Directory를 `apps/web`**, Node.js를 24.x로 설정합니다. workspace 루트의 lockfile을 사용하고 Root Directory 밖의 소스 포함 옵션을 켭니다. 공유 Schema와 fixture가 저장소 루트에 있습니다. Build Command는 `npm run build`, Install Command는 기본 monorepo 감지를 사용합니다. Next.js 설정은 루트까지 output tracing을 지정합니다.

환경변수는 Production/Preview 각각 설정합니다.

- `MOCK_MODE=false` (운영 mock은 코드에서 거부)
- `AUTH_PASSWORD`: 충분히 긴 무작위 비밀번호, 최소 16자
- `AUTH_SESSION_SECRET`: 최소 32자 무작위 비밀값 (예: `openssl rand -hex 32`로 생성)
- R2 환경변수 4개: 버킷 읽기 전용 별도 키
- `SIGNED_URL_TTL_SECONDS=14400`, `CATALOG_CACHE_TTL_SECONDS=30`

비밀번호를 채팅이나 Git에 저장하지 않습니다. 서버 검증 후 24시간짜리 HMAC 세션 쿠키를 사용합니다. 운영 쿠키는 HttpOnly, Secure, SameSite=Strict입니다. 로그아웃은 현재 기기의 쿠키를 삭제합니다. 전체 세션을 무효화하려면 `AUTH_SESSION_SECRET`을 교체합니다. 비밀번호만 바꾸면 발급된 세션은 만료 전까지 남습니다. 공동 비밀번호는 개인 계정/관리자 권한 모델을 대체하지 않습니다. 상세 오류는 NAS의 SQLite와 정제된 로그에서 운영자가 확인합니다.

로그인 요청은 동일 origin 검증과 인스턴스별 15분/10회 제한을 사용합니다. Vercel 다중 인스턴스 간 공유 제한이 아니므로 운영에서는 WAF에서 `/api/auth` POST에 별도의 IP rate limit을 설정합니다. Preview 배포에도 Deployment Protection을 적용하고, 공유 대상이 정해지기 전 공개 홍보/인덱싱하지 않습니다. 화면과 모든 목록·서명·상태 API는 서버 인증을 거칩니다.

외부 설치·배포는 이 구현 작업에서 수행하지 않았습니다. Vercel 설정과 버킷 CORS를 채운 뒤 배포합니다. Vercel 함수에서 수집·변환을 하지 않고 MP3를 프록시하지도 않습니다. [Vercel Node.js 버전](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), [Next.js 설치 요구사항](https://nextjs.org/docs/app/getting-started/installation)을 참고합니다.
