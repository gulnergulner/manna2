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

DSM 작업 스케줄러 → 예약된 작업 → 사용자 정의 스크립트에서 Docker 실행 권한을 가진 계정을 선택하고 매일 **06:30**에 실행합니다. 예약 시간대는 NAS 설정을 따릅니다. 추가로 07:00, 07:30, 08:00, 08:30 같은 스크립트를 실행하는 재시도 작업을 만듭니다.

```sh
cd /volume1/docker/church-audio || exit 1
/usr/local/bin/docker compose -f services/collector/compose.yaml run --rm collector --retry-pending >> logs/collector.log 2>&1
```

`/usr/local/bin/docker`는 예시입니다. 실제 경로로 변경하세요. DSM의 제한된 PATH에 의존하지 않도록 절대 경로를 쓰세요. 잠금 충돌은 종료 코드 2, 실패는 1, 성공은 0입니다. DSM 작업 결과 알림에서 실패를 감시합니다. NAS 장기 중단 시 R2의 마지막 확인 시각이 오래된 것으로 표시됩니다.

볼륨에는 세 디렉터리만 연결합니다. privileged, Docker socket, NAS 루트 마운트는 사용하지 않습니다. compose는 일회성 실행이고 상시 서비스/HTTP 포트를 열지 않습니다. 로그는 호스트 리다이렉션으로 `logs/collector.log`에 저장하며 DSM에서 회전/보관을 설정합니다.

이미지 빌드에서 Python/Deno 버전 태그와 Python 해시 lock을 사용합니다. FFmpeg와 OS 보안 패치는 apt 저장소 상태에 따라 달라집니다. 완전한 byte 단위 이미지 재현이 필요하면 검증한 이미지 digest를 기록하고 사설 레지스트리에서 운영합니다. Docker 엔진 미실행 상태에서 개발했으므로 실제 NAS 이미지 빌드는 인수 테스트 대상입니다.
