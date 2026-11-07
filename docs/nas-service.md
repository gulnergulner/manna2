# 만나 NAS 실행 (실환경 미검증)

만나 웹, 자동 수집기와 음원 저장소를 NAS에 둡니다. 웹이 인증 후 로컬 MP3를 직접 스트리밍합니다. R2와 Vercel 설정은 필요하지 않습니다. 기존 hoho_ytdl_bot은 별도 서비스로 그대로 둡니다. 이 문서는 신규 설정이며 NAS에서 이미지 빌드, 프록시 및 실방송 통합은 아직 확인하지 않았습니다.

## 설치 준비

NAS에 저장소를 예를 들어 `/volume4/docker/manna2`에 복사합니다. 기존 봇 폴더에 덮어쓰지 않습니다. Container Manager / Docker Compose가 필요합니다.

```sh
cd /volume4/docker/manna2
mkdir -p library data state logs
sudo chown 10001:10001 library data state logs
sudo chmod 755 library
cp .env.nas.example .env.nas
chmod 600 .env.nas
```

`.env.nas`의 `AUTH_PASSWORD`는 16자 이상, `AUTH_SESSION_SECRET`은 32자 이상의 무작위 값으로 설정합니다. `PUBLIC_ORIGIN`은 웹에 실제로 접속할 HTTPS 출처(경로 및 마지막 슬래시 없이, 예: `https://manna.example.com`)와 정확히 일치해야 로그인됩니다. 실제 인증서와 외부 접속 방법이 준비되기 전에는 운영용으로 공개하지 마세요. HTTPS에서만 보안 세션 쿠키가 동작합니다. 기존 DSM/봇 도메인을 임의로 덮어쓰지 마세요.

```sh
sudo docker compose -f compose.nas.yaml up -d --build web
sudo docker compose -f compose.nas.yaml --profile collector run --rm collector --dry-run
```

웹은 NAS 호스트의 `127.0.0.1:3100`에만 바인딩됩니다. HTTPS 역방향 프록시 또는 사설망 접근 방법을 별도로 구성해야 하며 QuickConnect가 임의의 컨테이너 웹을 전달한다고 가정하지 않습니다. 공개 역방향 프록시를 사용할 경우 DSM과 다른 호스트명, 유효한 인증서, 속도 제한을 구성하고 적용 상태를 확인하세요. 현재 로그인 시도 제한은 단일 프로세스 메모리 기반이며 재시작 시 초기화됩니다. 브라우저의 아이폰 재생·Range 요청과 인증서/프록시 동작을 실제로 점검해야 합니다.

실제 수집은 dry-run으로 방송 시각 및 채널을 확인한 후 `--dry-run`을 제거합니다. DSM 작업 스케줄러에서 06:30 및 재시도 작업을 같은 명령으로 실행합니다. 경로는 실제 NAS에서 확인합니다.

```sh
cd /volume4/docker/manna2 || exit 1
/usr/local/bin/docker compose -f compose.nas.yaml --profile collector run --rm collector --retry-pending >> logs/collector.log 2>&1
```

NAS가 꺼지거나 인터넷이 끊기면 외부 재생도 중단됩니다. `library`, `data`, `state`를 백업하고 자동 삭제는 별도 구현과 사용자 동의 전까지 사용하지 않습니다. 첫 수집 전에는 목록이 아직 없어 웹에 오류가 표시될 수 있습니다.

## 봇이 변환한 파일 재사용 (선택)

기존 봇의 결과를 그대로 읽기만 합니다. 다음 환경변수를 설정하고 모든 수집 명령에 추가 Compose 파일을 적용하세요. 경로와 UID 10001의 읽기 권한을 먼저 확인합니다. 봇에 새 작업을 보내지는 않습니다.

```sh
export BOT_AUDIO_HOST_DIR=/volume4/docker/hoho_ytdl_bot/data/telegram
sudo --preserve-env=BOT_AUDIO_HOST_DIR docker compose -f compose.nas.yaml -f compose.nas.bot.yaml --profile collector run --rm collector --retry-pending
```

DSM에서 `sudo` 없이 Docker 접근이 가능하다면 `sudo --preserve-env=BOT_AUDIO_HOST_DIR`를 생략할 수 있습니다. NAS의 sudo 구현이 해당 옵션을 지원하지 않을 수 있으므로 확인하세요. 재사용 조건과 신뢰 경계는 [기존 NAS 안내](synology-setup.md#선택-사항-hoho_ytdl_bot의-mp3-재사용)를 참고하세요. dry-run은 메타데이터만 점검하고 봇 파일을 재사용하지 않습니다.

## Cloudflare Tunnel: nc.godagent.net

`nc.godagent.net`을 만나 전용 호스트명으로 사용하는 구성입니다. DNS 레코드 및 연결 서비스는 대시보드에서 확인한 후 설정하세요. NAS에서 터널이 Cloudflare에 나가는 연결을 사용하므로 이 구성 자체는 공유기 포트 포워딩이 필요하지 않습니다. 아래 설정과 실제 외부 재생은 아직 검증하지 않았습니다.

1. Cloudflare 대시보드 **Networking → Tunnels**에서 원격 관리 터널을 만들고 토큰을 확인합니다. 기존 터널을 재사용한다면 해당 터널의 설정과 다른 경로에 영향이 없는지 먼저 확인합니다. 터널 토큰은 비밀번호처럼 취급하며 채팅이나 Git에 넣지 마세요.
2. NAS의 `.env.nas`에서 `PUBLIC_ORIGIN=https://nc.godagent.net`으로 설정합니다.
3. NAS에서 다음 파일을 만들고 `TUNNEL_TOKEN` 값을 직접 입력합니다.

```sh
cd /volume4/docker/manna2
cp .env.tunnel.example .env.tunnel
chmod 600 .env.tunnel
vi .env.tunnel
```

4. Cloudflare 터널의 **Routes → Add route → Published application**에서 호스트명을 `nc.godagent.net`, 서비스 URL을 `http://web:3000`으로 등록합니다. 이 주소는 아래 Compose로 실행된 터널 컨테이너에서 만나 웹을 가리키는 Docker 내부 주소입니다. DSM 주소나 `localhost:3100`을 입력하지 않습니다. 기존 DNS 레코드가 있다면 자동 교체하지 말고 충돌을 확인하세요.
5. 터널과 웹을 함께 실행합니다.

```sh
sudo docker compose -f compose.nas.yaml -f compose.tunnel.yaml up -d --build web tunnel
sudo docker compose -f compose.nas.yaml -f compose.tunnel.yaml ps
```

외부 브라우저에서 `https://nc.godagent.net`의 인증 및 음원 Range 재생을 확인합니다. HTTPS와 세션 인증을 적용하고 `api` 및 음원 응답이 캐시되지 않게 합니다. 공개 인터넷 사용 시 Cloudflare Access 등 추가 접근 제어를 권장합니다. 터널 토큰은 컨테이너 환경변수로 주입되므로 Docker 관리자에게 노출됩니다. [Cloudflare Tunnel 공식 안내](https://developers.cloudflare.com/tunnel/get-started/).
