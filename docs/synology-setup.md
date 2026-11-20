# Synology DS920+ 설치

DSM 버전과 Container Manager(구 DSM에서는 Docker 패키지) 설치 여부를 NAS에서 확인합니다. 아래 경로는 예시이며 실제 볼륨명과 `docker` 경로는 `command -v docker`로 확인하세요. 이 문서 작성 중 NAS 설정은 변경하지 않았습니다.

1. 저장소를 `/volume1/docker/church-audio`에 복사합니다. 전체 Git 저장소가 빌드 컨텍스트입니다.
2. `data`, `state`, `logs`를 만들고 컨테이너 UID 10001가 읽고 쓰도록 해당 디렉터리만 소유권/ACL을 부여합니다. Docker 실행 계정의 권한과 컨테이너 내부 파일 UID는 별개입니다. NAS 관리자 계정을 컨테이너 실행 사용자로 쓰지 않습니다.
3. `.env.example`을 `services/collector/.env`로 복사하고 NAS 전용 R2 쓰기 키와 버킷을 채웁니다. `chmod 600 services/collector/.env`를 적용합니다. 웹 인증 설정은 수집기에 사용되지 않습니다.
4. NAS 시간대는 Asia/Seoul, NTP 동기화를 설정합니다. 컨테이너 시간대도 Compose에서 고정합니다.

```sh
cd /volume1/docker/church-audio
mkdir -p data state logs
# NAS에서 실제 UID/ACL 정책 확인 후 필요한 디렉터리에만 적용
chown 10001:10001 data state logs
docker compose -f services/collector/compose.yaml build
docker compose -f services/collector/compose.yaml run --rm collector --dry-run --date 2026-10-27
```

dry-run 출력에서 실제 채널 ID, release_timestamp와 timestamp, live_status를 원본 방송 시각과 대조합니다. 최초 실행은 UC ID를 임의로 추정하지 않습니다. 실제 수집 실행 시 조회한 ID를 SQLite에 저장합니다. 채널이 바뀌면 수집을 멈춥니다. 자동으로 다른 채널을 승인하지 마세요.

```sh
# 실제 한 건/하루 수집: 선택 범위에 여러 개면 모두 수집
docker compose -f services/collector/compose.yaml run --rm collector --date 2026-10-27
# 실패 단계부터 재시도: next_retry_at 이후 실행
docker compose -f services/collector/compose.yaml run --rm collector --date 2026-10-27 --retry-pending
```

DSM 예약 요일과 두 번의 실행 시각은 [NAS 예배 수집 일정](nas-service.md)을 따릅니다. NAS 시간대는 한국 시간으로 설정합니다.

```sh
cd /volume1/docker/church-audio || exit 1
/usr/local/bin/docker compose -f services/collector/compose.yaml run --rm collector --retry-pending >> logs/collector.log 2>&1
```

`/usr/local/bin/docker`는 예시입니다. 실제 경로로 변경하세요. DSM의 제한된 PATH에 의존하지 않도록 절대 경로를 쓰세요. 잠금 충돌은 종료 코드 2, 실패는 1, 성공은 0입니다. DSM 작업 결과 알림에서 실패를 감시합니다. NAS 장기 중단 시 R2의 마지막 확인 시각이 오래된 것으로 표시됩니다.

볼륨에는 세 디렉터리만 연결합니다. privileged, Docker socket, NAS 루트 마운트는 사용하지 않습니다. compose는 일회성 실행이고 상시 서비스/HTTP 포트를 열지 않습니다. 로그는 호스트 리다이렉션으로 `logs/collector.log`에 저장하며 DSM에서 회전/보관을 설정합니다.

이미지 빌드에서 Python/Deno 버전 태그와 Python 해시 lock을 사용합니다. FFmpeg와 OS 보안 패치는 apt 저장소 상태에 따라 달라집니다. 완전한 byte 단위 이미지 재현이 필요하면 검증한 이미지 digest를 기록하고 사설 레지스트리에서 운영합니다. Docker 엔진 미실행 상태에서 개발했으므로 실제 NAS 이미지 빌드는 인수 테스트 대상입니다.

## 선택 사항: hoho_ytdl_bot의 MP3 재사용

두 서비스는 독립적입니다. 만나 수집기가 교회 채널과 날짜 조건에 맞는 방송을 발견했을 때, 봇이 **이미** 같은 영상 ID로 만든 MP3가 있으면 읽기 전용으로 복사해 사용할 수 있습니다. 봇에 다운로드를 요청하거나 텔레그램 메시지를 보내지는 않습니다. 일치하는 파일이 없거나 검증에 실패하면 만나 수집기가 직접 다운로드합니다. 봇 파일은 신뢰할 수 있는 개인 봇 출력이어야 합니다. 영상 ID가 파일의 실제 출처를 암호학적으로 증명하지는 않습니다.

재사용 조건은 영상 ID와 파일명 일치, 유일한 후보, 영상 길이 메타데이터 존재 및 ffprobe MP3 검증·재생시간 일치, `AUDIO_BITRATE=192K`입니다. 봇의 기본 192K 출력에만 맞춘 설정이며 실제 비트레이트를 별도로 측정하지 않습니다. 수집된 MP3는 기존 R2 업로드·목록 게시와 동일한 검증을 거칩니다. 봇 경로의 파일을 삭제하거나 변경하지 않습니다.

NAS에서 실제 봇의 다운로드 경로와 UID 10001의 읽기 권한을 확인한 후, 일회성 실행과 DSM 예약 작업 **모두** 다음과 같이 설정합니다. 경로는 예시이며 봇의 실제 볼륨 마운트와 일치해야 합니다.

```sh
cd /volume1/docker/church-audio
export BOT_AUDIO_HOST_DIR=/volume4/docker/hoho_ytdl_bot/data/telegram
/usr/local/bin/docker compose -f services/collector/compose.yaml -f services/collector/compose.bot-cache.yaml run --rm collector --dry-run
```

실제 다운로드·업로드에는 `--dry-run`을 제거합니다. Compose 명령의 `-f` 옵션을 모든 예약·재시도 작업에 동일하게 넣고, DSM 작업 스크립트에도 `BOT_AUDIO_HOST_DIR`을 설정하세요. 봇 출력 경로를 접근할 수 없거나 NAS에 이 저장소의 봇 캐시 설정을 아직 배포하지 않았다면 이 옵션 없이 기존 수집기를 사용합니다. NAS에서의 두 서비스 연동은 아직 검증하지 않았습니다.
