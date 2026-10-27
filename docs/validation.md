# 로컬 검증 기록

검증일: 2026-10-27. Windows / Node.js 24.14.1 / Python 3.13.5 / Next.js 16.4.3.

| 검사 | 결과 |
| --- | --- |
| 웹 단위 테스트 | 6개 통과: 세션·만료·변조, origin, 목록 계약, 파일명, 재생 위치, 운영 mock 거부 |
| 수집기 단위 테스트 | 12개 통과: KST 경계, 준비되지 않은 방송, 중복 방지, 업로드·게시 실패 복구, crash 후 HEAD 복구, 손상 목록 보존, 채널 변경, 잠금, 로컬 파일 변조 차단, 유튜브 조회 없는 업로드 복구 |
| Next.js 프로덕션 빌드 | TypeScript 포함 성공 |
| 실제 HTTP 요청 | 비로그인 API 401, 타 origin 로그인 403, 임의 ID 404, 목록 필드 제한, 서명 응답, MP3 206/Range, 다운로드 리다이렉트 성공 |
| Chrome 자동 브라우저 | 로그인·제목 검색·날짜 필터·재생·배속·강제 URL 갱신 시 위치 유지·재접속 이어 듣기·로그아웃 성공 |
| 반응형 화면 | Chrome 1440px/390px에서 가로 넘침 없음, 화면 캡처 시각 확인 |
| 샘플 수집 | dry-run 및 ffprobe → 로컬 mock object → 카탈로그 게시 성공, 재실행 중복 없음 |
| 실제 채널 조회 | 최신 3개 metadata dry-run 성공. 관측 채널 ID `UCGLaz30SXnxXhYR8wrTpbXg`. 당일 항목 `XdV49DdasiI`는 `post_live`라 waiting, 나머지 2개는 시간 범위 밖으로 제외 |
| Docker | 엔진 미실행으로 이미지 빌드/실행 미검증 |
| R2 / NAS / Vercel / iPhone | 실환경 접근 정보가 없어 미검증 |

브라우저 재현: `node scripts/smoke-web.mjs --browser` (설치된 Chrome 사용). `test-results/desktop.png`, `test-results/mobile.png`는 실행 시 생성되며 Git에서 제외됩니다. 실제 유튜브 방송 대신 자체 제작 12초 테스트 톤을 사용합니다. URL 갱신 검사는 API 응답의 만료 시각을 짧게 바꿔 실제 UI 갱신 경로를 통과시킨 검사입니다. R2 원격 URL 자체의 만료를 확인한 것은 아닙니다.

실제 채널 점검은 `MAX_CANDIDATES=3`, `--dry-run --date 2026-10-27`로 수행했습니다. 당일 관측 release_timestamp는 `1793043982`, timestamp는 `1793043656`이며 다운로드는 수행하지 않았습니다. 이 관측 ID는 채널에서 조회한 값이고 운영 설정으로 하드코딩하지 않습니다. 실제 방송 화면과 메타데이터 시각의 의미 비교, `was_live`로 전환된 뒤 MP3 수집은 추가 검증이 필요합니다.
