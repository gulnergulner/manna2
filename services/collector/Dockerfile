FROM denoland/deno:bin-2.5.6 AS deno
FROM python:3.13.5-slim-bookworm
COPY --from=deno /deno /usr/local/bin/deno
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY services/collector/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --require-hashes -r requirements.txt
COPY schemas ./schemas
COPY services/collector ./services/collector
COPY apps/web/fixtures ./apps/web/fixtures
ENV TZ=Asia/Seoul DATA_DIR=/data STATE_DIR=/state LOG_DIR=/logs PYTHONUNBUFFERED=1
RUN useradd --uid 10001 --create-home collector && mkdir /data /state /logs && chown collector:collector /data /state /logs
USER collector
ENTRYPOINT ["python", "/app/services/collector/collector.py"]
