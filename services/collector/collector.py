"""Single-writer dawn service collector. No server ports, secrets, or signed URLs in logs."""
from __future__ import annotations
import argparse
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from zoneinfo import ZoneInfo

from filelock import FileLock, Timeout
from jsonschema import Draft7Validator, FormatChecker
from jsonschema.exceptions import ValidationError

ROOT = Path(__file__).resolve().parents[2]
KST = ZoneInfo('Asia/Seoul')
SCHEMA = json.loads((ROOT / 'schemas/catalog.schema.json').read_text(encoding='utf-8'))
VALIDATOR = Draft7Validator(SCHEMA, format_checker=FormatChecker())
ID = re.compile(r'^[A-Za-z0-9_-]{1,64}$')

def now():
    return datetime.now(KST).isoformat()

def expected_duration(info):
    duration = info.get('duration')
    if isinstance(duration, (int, float)) and not isinstance(duration, bool) and 0 < duration < float('inf'):
        return duration
    return None

def verify_duration(info, actual):
    expected = expected_duration(info)
    if expected is None:
        if info.get('live_status') == 'post_live':
            raise ValueError('incomplete_audio')
    elif not 0 < actual < float('inf') or abs(actual - expected) > max(10, expected * .02):
        raise ValueError('incomplete_audio')

def validate_catalog(value):
    VALIDATOR.validate(value)
    ids = [i['id'] for i in value['items']]
    if len(set(ids)) != len(ids):
        raise ValueError('duplicate_catalog_id')
    for i in value['items']:
        expected = f"audio/{i['serviceDate'][:4]}/{i['serviceDate'][5:7]}/{i['id']}.mp3"
        if i['objectKey'] != expected or i['sourceUrl'] != f"https://www.youtube.com/watch?v={i['id']}":
            raise ValueError('inconsistent_catalog')
    return value

def select(info, day, start='00:00', end='06:30'):
    """release_timestamp is preferred; upload dates and title dates are never inferred."""
    stamp = info.get('release_timestamp')
    if stamp is None:
        stamp = info.get('timestamp')
    if not isinstance(stamp, (int, float)) or isinstance(stamp, bool):
        return 'review'
    try:
        instant = datetime.fromtimestamp(stamp, KST)
    except (ValueError, OverflowError, OSError):
        return 'review'
    lo = datetime.combine(day, time.fromisoformat(start), KST)
    hi = datetime.combine(day, time.fromisoformat(end), KST)
    if not lo <= instant < hi:
        return 'outside'
    status = info.get('live_status')
    if status == 'was_live' or (status == 'post_live' and expected_duration(info) is not None):
        return 'selected'
    return 'waiting'

def safe_error(error):
    # Never retain raw exception bodies, CLI stderr, URL query strings, or credentials.
    if isinstance(error, ValidationError):
        return 'invalid_catalog'
    text = str(error).lower()
    if text in ['authentication_required', 'format_unavailable', 'source_unavailable', 'network_error', 'operation_failed', 'invalid_mp3', 'incomplete_audio', 'remote_verification_failed', 'local_checksum_mismatch', 'channel_id_changed', 'channel_id_missing_or_invalid', 'invalid_window', 'invalid_candidate_limit', 'missing_r2_configuration', 'duplicate_catalog_id', 'inconsistent_catalog']:
        return text
    for needles, code in [(['sign in', 'login', 'cookies', 'bot'], 'authentication_required'),
                           (['requested format', 'no formats'], 'format_unavailable'),
                           (['private video', 'unavailable', 'removed'], 'source_unavailable'),
                           (['timed out', 'timeout', 'connection'], 'network_error')]:
        if any(n in text for n in needles):
            return code
    return 'operation_failed'

def run(command, timeout=7200):
    result = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout)
    if result.returncode:
        raise RuntimeError(safe_error(result.stderr))
    return result.stdout

class State:
    def __init__(self, directory):
        directory.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(directory / 'collector.sqlite3')
        self.db.execute('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, state TEXT, info TEXT, payload TEXT, attempts INTEGER DEFAULT 0, failed_stage TEXT, last_error TEXT, next_retry_at TEXT)')
        self.db.execute('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
        self.db.row_factory = sqlite3.Row
        self.db.commit()

    def discover(self, info, state='discovered'):
        self.db.execute('INSERT INTO jobs(id,state,info) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET info=excluded.info', (info['id'], state, json.dumps(info)))
        self.db.commit()

    def row(self, video):
        row = self.db.execute('SELECT * FROM jobs WHERE id=?', (video,)).fetchone()
        return dict(row) if row else None

    def stage(self, video, stage, payload=None):
        self.db.execute('UPDATE jobs SET state=?,payload=COALESCE(?,payload),failed_stage=NULL,last_error=NULL,next_retry_at=NULL WHERE id=?', (stage, json.dumps(payload) if payload else None, video))
        self.db.commit()

    def fail(self, video, stage, error):
        attempts = self.row(video)['attempts'] + 1
        retry = datetime.now(KST) + timedelta(minutes=min(120, 5 * 2 ** min(attempts, 5)))
        self.db.execute('UPDATE jobs SET attempts=?,failed_stage=?,last_error=?,next_retry_at=? WHERE id=?', (attempts, stage, safe_error(error), retry.isoformat(), video))
        self.db.commit()

    def channel(self, channel_id):
        if not channel_id or not re.fullmatch(r'UC[A-Za-z0-9_-]{22}', channel_id):
            raise ValueError('channel_id_missing_or_invalid')
        row = self.db.execute("SELECT value FROM settings WHERE key='channel_id'").fetchone()
        if row and row[0] != channel_id:
            raise ValueError('channel_id_changed')
        self.db.execute("INSERT OR IGNORE INTO settings VALUES('channel_id',?)", (channel_id,))
        self.db.commit()

class LocalStore:
    """Explicit offline development adapter; never used as a fallback for R2 errors."""
    def __init__(self, root):
        self.root = root

    def get_json(self, key):
        p = self.root / key
        return json.loads(p.read_text(encoding='utf-8')) if p.exists() else None

    def put_json(self, key, value):
        p = self.root / key
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix('.tmp')
        tmp.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
        tmp.replace(p)

    def verified(self, key, size, checksum):
        p = self.root / key
        return p.exists() and p.stat().st_size == size and sha256(p) == checksum

    def upload(self, path, key, checksum):
        p = self.root / key
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix('.uploading')
        try:
            shutil.copyfile(path, tmp)
            tmp.replace(p)
        finally:
            tmp.unlink(missing_ok=True)

class R2Store:
    def __init__(self):
        import boto3
        from botocore.config import Config
        required = ['R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']
        if not all(os.getenv(k) for k in required):
            raise ValueError('missing_r2_configuration')
        self.bucket = os.environ['R2_BUCKET_NAME']
        self.client = boto3.client('s3', endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com", region_name='auto', aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'], aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'], config=Config(retries={'max_attempts': 3, 'mode': 'standard'}, connect_timeout=15, read_timeout=60))

    def missing(self, error):
        from botocore.exceptions import ClientError
        return isinstance(error, ClientError) and error.response.get('Error', {}).get('Code') in ['404', 'NoSuchKey', 'NotFound']

    def get_json(self, key):
        try:
            r = self.client.get_object(Bucket=self.bucket, Key=key)
            return json.loads(r['Body'].read())
        except Exception as e:
            if self.missing(e):
                return None
            raise

    def put_json(self, key, value):
        self.client.put_object(Bucket=self.bucket, Key=key, Body=json.dumps(value, ensure_ascii=False).encode(), ContentType='application/json', CacheControl='no-cache')

    def verified(self, key, size, checksum):
        try:
            r = self.client.head_object(Bucket=self.bucket, Key=key)
            return r['ContentLength'] == size and r.get('Metadata', {}).get('sha256') == checksum and r.get('ContentType') == 'audio/mpeg'
        except Exception as e:
            if self.missing(e):
                return False
            raise

    def upload(self, path, key, checksum):
        self.client.upload_file(str(path), self.bucket, key, ExtraArgs={'ContentType': 'audio/mpeg', 'Metadata': {'sha256': checksum}})

def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()

def probe(path):
    raw = json.loads(run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_name:format=duration,size', '-of', 'json', str(path)], timeout=60))
    duration = float(raw['format']['duration'])
    size = int(raw['format']['size'])
    if not any(s.get('codec_name') == 'mp3' for s in raw['streams']) or duration <= 0 or size <= 0 or size != path.stat().st_size:
        raise ValueError('invalid_mp3')
    return duration, size

class Collector:
    def __init__(self, state, store, data, downloader=None, prober=probe):
        self.state, self.store, self.data = state, store, data
        self.downloader = downloader or self.download
        self.prober = prober
        data.mkdir(parents=True, exist_ok=True)

    def reuse_bot_audio(self, info, final):
        """Copy an explicitly configured bot output; validate before publication."""
        directory = os.getenv('BOT_AUDIO_DIR', '')
        duration = expected_duration(info)
        if (not directory or os.getenv('AUDIO_BITRATE', '192K').upper() != '192K'
                or duration is None):
            return False
        directory = Path(directory)
        if not directory.is_dir():
            return False
        video = info['id']
        try:
            candidates = [p for p in directory.iterdir()
                          if (p.name == f'{video}.mp3' or p.name.endswith(f' [{video}].mp3'))
                          and not p.is_symlink() and p.is_file()]
        except OSError:
            return False
        if len(candidates) != 1:
            return False
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=self.data, prefix='.bot-audio-', suffix='.mp3', delete=False) as target:
                temporary = Path(target.name)
                with candidates[0].open('rb') as source:
                    shutil.copyfileobj(source, target)
            actual, _ = self.prober(temporary)
            verify_duration(info, actual)
            temporary.replace(final)
            return True
        except (OSError, ValueError, RuntimeError, KeyError, subprocess.SubprocessError):
            return False
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def download(self, info, final):
        if self.reuse_bot_audio(info, final):
            return
        # yt-dlp chooses an audio-only track, then FFmpeg converts it. Fragment loss is fatal.
        is_post_live = info.get('live_status') == 'post_live'
        work = self.data / 'tmp' / info['id']
        if is_post_live:
            work /= 'post_live'
        work.mkdir(parents=True, exist_ok=True)
        # A replay still in processing may serve a different set of fragments on retry.
        fresh_download = ['--force-overwrites'] if is_post_live else []
        run(['yt-dlp', *fresh_download, '--no-playlist', '--js-runtimes', 'deno', '--abort-on-unavailable-fragments', '--retries', '3', '--fragment-retries', '3', '--socket-timeout', '30', '--retry-sleep', 'http:exp=1:20', '-f', 'bestaudio', '-x', '--audio-format', 'mp3', '--audio-quality', os.getenv('AUDIO_BITRATE', '192K'), '--no-progress', '--no-warnings', '-o', str(work / 'source.%(ext)s'), f"https://www.youtube.com/watch?v={info['id']}"])
        candidate = work / 'source.mp3'
        duration, _ = self.prober(candidate)
        verify_duration(info, duration)
        candidate.replace(final)

    def process(self, info):
        video = info['id']
        if not ID.fullmatch(video):
            raise ValueError('invalid_video_id')
        self.state.discover(info)
        row = self.state.row(video)
        if row['state'] == 'published':
            return
        stage = row['state']
        try:
            payload = json.loads(row['payload']) if row['payload'] else None
            if not payload:
                stage = 'downloading'
                self.state.stage(video, stage)
                final = self.data / f'{video}.mp3'
                # A crash after atomic local rename is recovered without another download.
                if final.exists():
                    try:
                        duration, _ = self.prober(final)
                        if info.get('live_status') == 'post_live':
                            verify_duration(info, duration)
                    except Exception:
                        final.replace(final.with_suffix('.invalid'))
                if not final.exists():
                    self.downloader(info, final)
                duration, size = self.prober(final)
                if info.get('live_status') == 'post_live':
                    verify_duration(info, duration)
                started = datetime.fromtimestamp(info.get('release_timestamp') or info['timestamp'], KST)
                payload = {'item': {'id': video, 'title': info.get('title') or video, 'sourceUrl': f'https://www.youtube.com/watch?v={video}', 'broadcastStartedAt': started.isoformat(), 'serviceDate': started.date().isoformat(), 'durationSeconds': duration, 'sizeBytes': size, 'bitrateKbps': int(os.getenv('AUDIO_BITRATE', '192K').upper().removesuffix('K')), 'objectKey': f'audio/{started:%Y/%m}/{video}.mp3', 'publishedAt': now(), 'audioScope': 'full_service', 'availability': 'available'}, 'sha256': sha256(final)}
                self.state.stage(video, 'converted', payload)
            item = payload['item']
            validate_catalog({'schemaVersion': 1, 'updatedAt': now(), 'items': [item]})
            stage = 'upload'
            if not self.store.verified(item['objectKey'], item['sizeBytes'], payload['sha256']):
                local = self.data / f'{video}.mp3'
                if not local.exists() or local.stat().st_size != item['sizeBytes'] or sha256(local) != payload['sha256']:
                    raise ValueError('local_checksum_mismatch')
                self.store.upload(local, item['objectKey'], payload['sha256'])
                if not self.store.verified(item['objectKey'], item['sizeBytes'], payload['sha256']):
                    raise ValueError('remote_verification_failed')
            self.state.stage(video, 'uploaded', payload)
            stage = 'catalog'
            existing = self.store.get_json('metadata/catalog.json')
            if existing is None:
                existing = {'schemaVersion': 1, 'updatedAt': now(), 'items': []}
            validate_catalog(existing)  # Fail closed: never erase a corrupt catalog.
            previous = next((i for i in existing['items'] if i['id'] == video), None)
            if previous:
                item['publishedAt'] = previous['publishedAt']
            else:
                item['publishedAt'] = now()
            existing['items'] = [i for i in existing['items'] if i['id'] != video] + [item]
            existing['items'].sort(key=lambda i: i['broadcastStartedAt'], reverse=True)
            existing['updatedAt'] = now()
            validate_catalog(existing)
            self.store.put_json('metadata/catalog.json', existing)
            self.state.stage(video, 'published', payload)
            print(json.dumps({'id': video, 'state': 'published'}))
        except Exception as e:
            self.state.fail(video, stage, e)
            print(json.dumps({'id': video, 'state': 'failed', 'stage': stage, 'code': safe_error(e)}), file=sys.stderr)
            raise

def metadata(channel, count):
    listing = json.loads(run(['yt-dlp', '--flat-playlist', '--playlist-end', str(count), '--dump-single-json', '--skip-download', '--retries', '3', '--socket-timeout', '30', '--js-runtimes', 'deno', channel], timeout=300))
    channel_id = listing.get('channel_id')
    entries = []
    for entry in listing.get('entries', []):
        video = entry.get('id', '')
        if not ID.fullmatch(video):
            continue
        try:
            info = json.loads(run(['yt-dlp', '--dump-single-json', '--skip-download', '--no-playlist', '--retries', '3', '--socket-timeout', '30', '--js-runtimes', 'deno', f'https://www.youtube.com/watch?v={video}'], timeout=180))
        except Exception as e:
            entries.append({'id': video, 'discovery_error': safe_error(e)})
            continue
        if not channel_id:
            channel_id = info.get('channel_id')
        if info.get('channel_id') != channel_id:
            raise ValueError('channel_id_changed')
        # Keep only public fields needed for selection/recovery, not signed format URLs.
        entries.append({k: info.get(k) for k in ['id', 'title', 'channel_id', 'live_status', 'release_timestamp', 'timestamp', 'duration']})
    return channel_id, entries

@contextmanager
def single_run(directory):
    directory.mkdir(parents=True, exist_ok=True)
    with FileLock(str(directory / 'collector.lock'), timeout=0):
        yield

def main(argv=None):
    parser = argparse.ArgumentParser(description='새벽예배 MP3 수집기 (단일 writer)')
    parser.add_argument('--date', type=date.fromisoformat, default=datetime.now(KST).date())
    parser.add_argument('--dry-run', action='store_true', help='메타데이터만 점검, 상태/게시 변경 없음')
    parser.add_argument('--retry-pending', action='store_true', help='대기·실패 상태 재확인 (backoff 시각 준수)')
    parser.add_argument('--upload-only', action='store_true', help='로컬 변환 완료 작업만 업로드/게시 재개, 유튜브 조회 없음')
    parser.add_argument('--retention-report', action='store_true', help='삭제 없이 보관 기간 초과 목록 출력')
    parser.add_argument('--mock', action='store_true', help='오프라인 샘플, 로컬 object 저장소 사용')
    args = parser.parse_args(argv)
    state_dir = Path(os.getenv('STATE_DIR', './state'))
    data_dir = Path(os.getenv('DATA_DIR', './data'))
    if args.mock:
        state_dir = state_dir / 'mock'
        data_dir = data_dir / 'mock'
    log_dir = Path(os.getenv('LOG_DIR', './logs'))
    log_dir.mkdir(parents=True, exist_ok=True)
    channel = os.getenv('CHANNEL_URL', 'https://www.youtube.com/@새가나안교회/streams')
    state = None
    try:
        with single_run(state_dir):
            state = State(state_dir)
            store = LocalStore(data_dir / 'mock-r2') if args.mock else (None if args.dry_run else (LocalStore(Path(os.environ['NAS_LIBRARY_DIR'])) if os.getenv('STORAGE_MODE') == 'nas' else R2Store()))
            if args.retention_report:
                existing = validate_catalog(store.get_json('metadata/catalog.json'))
                cutoff = args.date - timedelta(days=int(os.getenv('RETENTION_DAYS', '90')))
                print(json.dumps({'deletionEnabled': False, 'candidates': [{'id': i['id'], 'localExists': (data_dir / f"{i['id']}.mp3").exists()} for i in existing['items'] if date.fromisoformat(i['serviceDate']) < cutoff]}))
                return 0
            start, end = os.getenv('WINDOW_START', '00:00'), os.getenv('WINDOW_END', '06:30')
            if time.fromisoformat(start) >= time.fromisoformat(end):
                raise ValueError('invalid_window')
            if args.upload_only:
                entries = [json.loads(r['info']) for r in state.db.execute("SELECT * FROM jobs WHERE state IN ('converted','uploaded')")]
                stored_channel = state.db.execute("SELECT value FROM settings WHERE key='channel_id'").fetchone()
                channel_id = stored_channel[0] if stored_channel else None
                if not entries:
                    print('{"state":"no_pending_uploads"}')
                    return 0
            elif args.mock:
                entries = [{'id': 'sample-20261027', 'title': '[샘플] 새벽예배 테스트 음원', 'channel_id': 'UC' + 'a' * 22, 'release_timestamp': datetime.combine(args.date, time(5), KST).timestamp(), 'live_status': 'was_live', 'duration': 12}]
                channel_id = entries[0]['channel_id']
            else:
                count = int(os.getenv('MAX_CANDIDATES', '20'))
                if not 1 <= count <= 200:
                    raise ValueError('invalid_candidate_limit')
                try:
                    channel_id, entries = metadata(channel, count)
                except Exception:
                    if not args.dry_run:
                        old = store.get_json('metadata/collector-status.json') or {}
                        store.put_json('metadata/collector-status.json', {'serviceDate': args.date.isoformat(), 'state': 'failed', 'lastCheckedAt': now(), 'lastPublishedAt': old.get('lastPublishedAt')})
                    raise
            # Dry-run also verifies stored identity without registering/changing it.
            if not args.dry_run:
                state.channel(channel_id)
            else:
                stored = state.db.execute("SELECT value FROM settings WHERE key='channel_id'").fetchone()
                if not channel_id or (stored and stored[0] != channel_id):
                    raise ValueError('channel_id_changed_or_missing')
            if args.retry_pending and not args.mock and not args.upload_only:
                known = {i['id'] for i in entries}
                for row in state.db.execute("SELECT * FROM jobs WHERE state!='published'"):
                    if row['id'] not in known and (not row['next_retry_at'] or row['next_retry_at'] <= now()):
                        info = json.loads(row['info'])
                        retry_post_live = (
                            row['state'] == 'downloading' and info.get('live_status') == 'post_live'
                        )
                        if retry_post_live and select(info, args.date, start, end) == 'outside':
                            continue
                        if row['state'] in ['discovered', 'waiting'] or retry_post_live:
                            try:
                                fresh = json.loads(run(['yt-dlp', '--dump-single-json', '--skip-download', '--js-runtimes', 'deno', f"https://www.youtube.com/watch?v={row['id']}"], timeout=180))
                            except Exception as error:
                                entries.append({'id': row['id'], 'discovery_error': safe_error(error)})
                                continue
                            if retry_post_live and fresh.get('channel_id') != channel_id:
                                raise ValueError('channel_id_changed')
                            info = {k: fresh.get(k) for k in info}
                        entries.append(info)
            def sample_download(info, final):
                shutil.copyfile(ROOT / 'apps/web/fixtures/sample.mp3', final)
            collector = Collector(state, store, data_dir, sample_download if args.mock else None)
            failed, waiting, published = False, False, False
            for info in entries:
                if not ID.fullmatch(str(info.get('id', ''))):
                    continue
                if info.get('discovery_error'):
                    failed = True
                    if not args.dry_run:
                        row = state.row(info['id'])
                        if not row or row['state'] != 'published':
                            if not row:
                                state.discover(info)
                            state.fail(info['id'], 'metadata', RuntimeError(info['discovery_error']))
                    print(json.dumps({'id': info['id'], 'selection': 'metadata_failed', 'code': info['discovery_error']}))
                    continue
                choice = select(info, args.date, start, end)
                print(json.dumps({'id': info['id'], 'selection': choice, 'release_timestamp': info.get('release_timestamp'), 'timestamp': info.get('timestamp'), 'live_status': info.get('live_status'), 'channel_id': channel_id}))
                if args.dry_run:
                    continue
                if choice in ['waiting', 'review']:
                    state.discover(info, 'waiting')
                    waiting = True
                if choice != 'selected':
                    continue
                row = state.row(info['id'])
                if row and row['next_retry_at'] and row['next_retry_at'] > now():
                    failed = True
                    continue
                try:
                    collector.process(info)
                    published = True
                except Exception:
                    failed = True
            if not args.dry_run:
                old = store.get_json('metadata/collector-status.json') or {}
                remote_catalog = store.get_json('metadata/catalog.json')
                if remote_catalog is not None:
                    try:
                        validate_catalog(remote_catalog)
                    except Exception:
                        failed = True
                        remote_catalog = None
                last_published = max((i['publishedAt'] for i in (remote_catalog or {}).get('items', [])), default=old.get('lastPublishedAt'))
                status = {'serviceDate': args.date.isoformat(), 'state': 'failed' if failed else 'waiting' if waiting else 'ready' if published else 'empty', 'lastCheckedAt': now(), 'lastPublishedAt': last_published}
                store.put_json('metadata/collector-status.json', status)
            return 1 if failed else 0
    except Timeout:
        print('{"code":"already_running"}', file=sys.stderr)
        return 2
    except Exception as e:
        print(json.dumps({'code': safe_error(e)}), file=sys.stderr)
        return 1
    finally:
        if state is not None:
            state.db.close()

if __name__ == '__main__':
    sys.exit(main())
