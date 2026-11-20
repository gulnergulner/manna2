# 새가나안교회 만나 — 교회 예배 음성 보관함

월–금 새벽예배와 저녁 영성집회, 주일 오전 예배의 방송을 NAS에 MP3로 저장하고 웹 보관함에서 예배 종류별로 들을 수 있습니다. 웹은 **Synology / Next.js**, 수집기는 **Synology / Python + yt-dlp + FFmpeg + Deno**입니다. 기존 R2/Vercel 모드도 코드에 남아 있습니다. 음원은 설교 구간이 아닌 전체 예배입니다.

NAS 운영은 [NAS 서비스 실행 안내](docs/nas-service.md)를 참고하세요. 새 NAS 구성은 실환경 검증 전입니다.

## 로컬 웹 실행

Node.js 24와 npm을 사용합니다.

```powershell
npm ci
Copy-Item .env.example apps/web/.env.local
```

웹을 열면 로그인 없이 플레이어와 날짜별 말씀을 볼 수 있습니다. 비밀값을 Git에 추가하지 마세요. `MOCK_MODE=true`는 개발 서버에서만 사용할 수 있습니다. R2 연결 오류를 샘플 데이터로 대체하지 않습니다.

```powershell
npm run dev
```

로컬 브라우저 검증은 `node scripts/smoke-web.mjs --browser`를 사용합니다. 샘플 음원은 직접 생성한 12초의 낮은 테스트 톤이며 실제 예배가 아닙니다. 가상 목록 날짜는 2026-10-27/26입니다. 오늘 날짜와 다르면 오늘 음원 없음으로 표시합니다.

운영 실행: `MOCK_MODE=false`와 R2 환경변수를 설정한 후 `npm run build`, `npm start`. 실제 R2 목록이 필요합니다. 루트 `.env`는 Next.js가 읽지 않으므로 웹 환경변수는 반드시 `apps/web/.env.local` 또는 Vercel 프로젝트에 설정합니다.

## 수집기 실행

Python 3.13, FFmpeg/ffprobe, Deno가 필요합니다. Docker 운영은 [Synology 설치 안내](docs/synology-setup.md)를 따릅니다.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --require-hashes -r services/collector/requirements.txt
# 오프라인 샘플: 실제 유튜브·R2 접근 없음. state/mock, data/mock에 분리.
.\.venv\Scripts\python.exe services/collector/collector.py --mock --date 2026-10-27 --dry-run
.\.venv\Scripts\python.exe services/collector/collector.py --mock --date 2026-10-27
```

수집기 로컬 실행은 OS 환경변수를 읽습니다. `.env` 자동 로드는 하지 않습니다. Docker Compose의 `env_file`이 NAS 설정 파일을 주입합니다. 실제 메타데이터 점검은 `--mock`을 빼고 `--dry-run --date YYYY-MM-DD`로 실행합니다. 채널 ID와 release/timestamp를 출력하지만 다운로드 URL과 원본 오류 본문은 출력하지 않습니다. mock ID는 실제 채널 식별값이 아닙니다.

## 검증 명령

```powershell
npm test
npm run typecheck
npm run build
node scripts/smoke-web.mjs
# Chrome 설치 시 실제 브라우저 재생·갱신·모바일 검사
node scripts/smoke-web.mjs --browser
.\.venv\Scripts\python.exe -m unittest discover -s services/collector -p "test_*.py" -v
```

HTTP smoke는 별도 포트 3198에서 샘플 개발 서버를 시작한 뒤 종료합니다. 실제 운영 모드의 R2 연동은 별도 확인이 필요합니다.

## 개인 텔레그램 MP3 봇

개인용 텔레그램 봇은 별도의 [hoho_ytdl_bot 저장소](https://github.com/gulnergulner/hoho_ytdl_bot)에서 관리합니다. 만나 수집기가 교회 방송으로 선택한 영상에 한해 봇이 이미 변환한 MP3를 선택적으로 재사용할 수 있습니다. 봇에 작업을 요청하는 연동은 아직 없으며 설정 방법은 [Synology 안내](docs/synology-setup.md#선택-사항-hoho_ytdl_bot의-mp3-재사용)를 참고하세요.

## 구현 상태

- 완료: 한국어 모바일 UI, 공개 목록·상태·서명 API, 날짜/제목 검색, MP3 재생·탐색·기기 저장·다운로드, 기기 내 이어 듣기, 만료 URL 갱신 시 위치 보존.
- 완료: JSON Schema 계약, KST 날짜 범위, 채널 ID 기록·변경 감지, SQLite 작업 상태, 단일 실행 잠금, 결정적 object key, SHA-256·HEAD 검증, 업로드/게시 복구, 기존 목록 보존, 삭제 없는 보관 보고.
- 완료: 해시 고정 Python 의존성, npm lockfile, Dockerfile·Compose, NAS/R2/Vercel 운영 안내와 핵심 테스트.
- 미구현(2차): PWA 오프라인 저장, 개인 계정·기기간 동기화, 설교 구간 추출, 자동 삭제 실행. `RETENTION_ENABLED=true`여도 현재 버전은 파일을 삭제하지 않습니다.
- 미검증: 실제 채널 메타데이터의 시각 의미, NAS/DSM 설치와 권한, 실제 한 건 다운로드·R2 게시, Docker 이미지 빌드/실행, Vercel 배포, iPhone의 seek·잠금 화면·한글 다운로드. 샘플 성공은 실환경 성공을 의미하지 않습니다.

## 운영 문서

- [Synology 설치·스케줄](docs/synology-setup.md)
- [R2 버킷·CORS·자격 증명](docs/r2-setup.md)
- [Vercel 배포·인증](docs/vercel-deploy.md)
- [복구·업데이트·검증 체크리스트](docs/operations.md)
- [로컬 검증 기록](docs/validation.md)

단일 NAS writer만 카탈로그를 수정합니다. 웹은 읽기 전용입니다. 수집 날짜 경계는 한국 시간 00:00 포함 ~ 06:30 제외이며 재시도 시에도 바뀌지 않습니다. NAS 외부 포트 개방은 필요 없습니다.
