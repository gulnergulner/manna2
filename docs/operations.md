# 운영·복구

## 상태와 작업

`discovered → waiting/downloading → converted → uploaded → published` 상태를 NAS의 `state/collector.sqlite3`에 기록합니다. 실패한 작업은 성공한 마지막 단계와 `failed_stage`, 정제된 `last_error`, `attempts`, `next_retry_at`을 유지합니다. 재시도 간격은 10분부터 늘어나 최대 120분입니다. 단일 실행당 유튜브·R2 네트워크 재시도도 유한합니다. 토큰과 원본 오류 본문은 기록하지 않습니다.

`--date YYYY-MM-DD`로 과거 날짜를 지정합니다. `--retry-pending`은 최근 목록 밖의 미완료 작업도 다시 확인하되 지정 날짜의 선택 범위를 유지합니다. 다른 날짜의 실패는 해당 날짜로 실행해야 합니다. `was_live`와 유튜브가 재생 길이를 제공하는 `post_live` 방송을 수집합니다. `post_live`는 MP3 길이 차이가 10초와 원본 길이의 2% 중 큰 값 이내일 때 게시합니다. 다운로드나 길이 검증에 실패하면 재시도 간격을 적용합니다. 방송 시각은 release_timestamp를 우선하고 없으면 timestamp를 사용합니다. 두 시각의 실제 의미는 최초 dry-run에서 해당 채널 방송과 대조해야 합니다. 시각이 없는 항목은 waiting/review 상태로 남고 제목 날짜나 upload_date로 추측하지 않습니다.

데이터 복구 순서:

1. 업로드 실패: 로컬 MP3와 SQLite payload가 있으면 업로드부터 재개합니다. `--upload-only --date YYYY-MM-DD`는 유튜브 조회 없이 converted/uploaded 작업만 처리합니다. backoff 시각은 동일하게 적용됩니다.
2. 업로드는 됐지만 프로세스 종료: 결정적 key에 HEAD 크기·checksum을 확인하고 업로드를 생략합니다.
3. 목록 게시 실패/성공 직후 종료: 기존 목록을 읽고 동일 ID를 upsert합니다. 이전 항목을 유지하며 중복을 만들지 않습니다.
4. 손상된 catalog: 빈 목록으로 바꾸지 않습니다. NAS 로그/작업 상태를 확인하고 검증된 백업에서 카탈로그를 복원한 후 재시도합니다.
5. 변환 후 로컬 확정 직후 종료: ffprobe로 기존 최종 파일을 검증해서 이어 갑니다. 손상된 파일은 `.invalid`로 보관하고 다시 다운로드합니다.

SQLite 상태와 로컬 MP3는 함께 백업합니다. mock state는 `state/mock`으로 격리합니다. 실제 채널 ID 변경 감지 시 관리자가 대상 URL과 실제 채널을 확인해야 합니다. SQLite를 지워서 오류를 무시하지 마세요.

목록 writer는 이 NAS 한 개뿐입니다. 파일 잠금은 동일 state 볼륨에서 동작합니다. 다른 NAS/다른 state 볼륨으로 동시 실행하면 보호되지 않습니다. 다중 writer를 도입하려면 분산 잠금/조건부 쓰기/DB 설계가 먼저 필요합니다.

## 보관과 업데이트

자동 삭제는 구현하지 않았으며 기본 비활성입니다. `RETENTION_ENABLED`는 향후 정책용으로만 예약되어 있습니다. 90일 삭제는 사용자 동의와 별도 구현/검증 후 활성화해야 합니다. NAS 장기 보관을 권장합니다. 삭제 없는 후보 보고:

```sh
docker compose -f services/collector/compose.yaml run --rm collector --retention-report
```

보고는 `RETENTION_DAYS` 이전 목록과 NAS 파일 존재 여부만 출력합니다. 실제 삭제를 추가할 때는 NAS 원본 검증 → 목록에서 unavailable 게시 → R2 삭제 및 재시도 순서로 구현합니다.

yt-dlp는 매일 실행 시 업데이트하지 않습니다. 별도 개발 환경에서 아래 명령으로 lockfile을 갱신하고 테스트 및 이미지 빌드 후 새 이미지 태그로 전환합니다. 이전 이미지와 상태 백업을 보관합니다.

```sh
python -m pip install pip-tools
pip-compile --upgrade --generate-hashes --strip-extras --output-file services/collector/requirements.txt services/collector/requirements.in
docker compose -f services/collector/compose.yaml build --pull
```

런타임 지원은 [yt-dlp EJS](https://github.com/yt-dlp/yt-dlp/wiki/EJS)와 [공식 옵션](https://github.com/yt-dlp/yt-dlp)을 확인합니다. Deno와 Python 이미지 태그도 검증 후 명시적으로 변경합니다. 쿠키는 기본 필수가 아닙니다. 인증 차단은 `authentication_required`, 형식 없음은 `format_unavailable`로 보고되며 우회 성공을 보장하지 않습니다.

## 실환경 인수 체크리스트

- [ ] DSM 버전, Container Manager, docker 절대 경로와 볼륨 권한 확인
- [ ] 실제 채널 ID 및 KST 00:00~06:30 경계를 dry-run으로 검증
- [ ] 한 건 다운로드 → ffprobe → SHA-256 → R2 HEAD → 목록 게시 성공
- [ ] NAS를 끈 상태에서 웹 재생·다운로드 확인
- [ ] PC와 iPhone에서 Range seek, 배속, 이어 듣기, 한글 다운로드 확인
- [ ] 재생 URL 만료/갱신 후 위치 보존 확인
- [ ] 새로운 게시 후 재배포 없이 목록 갱신 확인
- [ ] 브라우저 번들/응답/로그에 R2 키가 없는지 확인
- [ ] 비로그인 API 접근 401, 임의 ID/object key 접근 차단 확인
- [ ] 공동 비밀번호 공유 대상 확정, WAF와 Preview 보호 설정
- [ ] NAS 외부 포트 개방 없음 확인

현재 실제 NAS/R2/Vercel/iPhone 인수 항목은 모두 미검증입니다. 로컬 자동 테스트 결과와 혼동하지 마세요.
