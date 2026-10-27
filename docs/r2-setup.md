# Cloudflare R2 설정

R2 **Standard 비공개 버킷**을 만듭니다. Public development URL과 공개 custom domain은 켜지 않습니다. NAS 전용 object read/write 키, Vercel 전용 object read 키를 버킷 범위로 각각 발급합니다. 키는 각 환경변수에만 넣습니다. 브라우저용 `NEXT_PUBLIC_` 변수에 넣으면 안 됩니다.

필수 값: `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. S3 endpoint는 `https://<account-id>.r2.cloudflarestorage.com`, region은 `auto`입니다. MP3는 `audio/YYYY/MM/{videoId}.mp3`, 목록은 `metadata/catalog.json`, 상태는 `metadata/collector-status.json`에 저장합니다.

운영 도메인이 정해진 뒤 버킷 CORS를 다음과 같이 설정합니다. 예시 도메인은 실제 Vercel 도메인으로 교체합니다. 불필요한 개발 origin은 운영 버킷에서 제거합니다.

```json
[
  {
    "AllowedOrigins": ["https://your-project.vercel.app", "http://127.0.0.1:3000"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range", "Content-Type"],
    "ExposeHeaders": ["Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Content-Disposition"],
    "MaxAgeSeconds": 3600
  }
]
```

CORS는 인증이 아닙니다. 웹은 인증된 세션을 확인하고 검증된 목록의 ID에 대해서만 서명 URL을 발급합니다. URL 소지자는 만료까지 접근할 수 있습니다. 기본 TTL은 4시간, 설정 범위는 60~86400초입니다. 서명 URL은 S3 API 도메인으로 사용하며 custom domain URL로 바꾸지 않습니다. [공식 서명 URL 문서](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

최초 게시 전 웹 목록 요청은 오류를 표시합니다. 빈 목록을 만들려면 다음 계약으로 `metadata/catalog.json`을 수동 생성할 수 있지만 기존 카탈로그를 덮어쓰지 마세요.

```json
{"schemaVersion":1,"updatedAt":"2026-10-27T00:00:00+09:00","items":[]}
```

수집기는 업로드 뒤 크기, Content-Type, sha256 object metadata를 HEAD로 확인한 후 목록을 게시합니다. multipart ETag를 파일 해시로 사용하지 않습니다. 카탈로그 캐시는 기본 30초이므로 게시 후 웹 재배포가 필요 없습니다.

운영 도메인의 실제 브라우저 네트워크에서 Range GET의 206, Content-Range와 CORS 헤더를 확인하고 iPhone에서도 seek와 한글 attachment 파일명을 확인해야 합니다. 코드 검증만으로 이를 완료했다고 판단하지 않습니다. 비용은 배포 시 [R2 공식 요금](https://developers.cloudflare.com/r2/pricing/)을 다시 확인합니다.
