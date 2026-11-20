from datetime import date, datetime
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from filelock import Timeout
from collector import Collector, KST, LocalStore, State, select, single_run, validate_catalog, safe_error, main

DAY = date(2026, 10, 27)
def info(video='test-video', hour=5, minute=0, status='was_live'):
    return {'id': video, 'title': '테스트 새벽예배', 'release_timestamp': datetime(2026, 10, 27, hour, minute, tzinfo=KST).timestamp(), 'live_status': status}

class SelectionTest(unittest.TestCase):
    def test_kst_boundaries_including_previous_utc_day(self):
        self.assertEqual(select(info(hour=0), DAY), 'selected')
        self.assertEqual(select(info(hour=5), DAY), 'selected')
        self.assertEqual(select(info(hour=6, minute=29), DAY), 'selected')
        self.assertEqual(select(info(hour=6, minute=30), DAY), 'outside')
        self.assertEqual(select(info(hour=8), DAY), 'outside')
        self.assertEqual(select(info(), date(2026, 10, 28)), 'outside')
    def test_not_ready_and_uncertain_timestamps(self):
        for status in ['is_live', 'is_upcoming', 'post_live', 'not_live', None]:
            self.assertEqual(select(info(status=status), DAY), 'waiting')
        self.assertEqual(select({'upload_date': '20261027'}, DAY), 'review')
        data = info(); data['timestamp'] = data['release_timestamp']; del data['release_timestamp']
        self.assertEqual(select(data, DAY), 'selected')
    def test_secrets_never_in_errors(self):
        self.assertEqual(safe_error(RuntimeError('https://secret?token=private')), 'operation_failed')
    def test_post_live_requires_known_duration(self):
        data = info(status='post_live')
        for duration in [None, False, 0, float('nan'), float('inf')]:
            self.assertEqual(select(dict(data, duration=duration), DAY), 'waiting')
        self.assertEqual(select(dict(data, duration=2616), DAY), 'selected')

class RecoveryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.state = State(self.root / 'state')
        self.store = LocalStore(self.root / 'r2')
        def download(meta, dest):
            dest.write_bytes(b'fake-mp3-for-state-test')
        self.download = Mock(side_effect=download)
        self.collector = Collector(self.state, self.store, self.root / 'data', self.download, lambda p: (1200, p.stat().st_size))
    def tearDown(self):
        self.state.db.close()
        self.temp.cleanup()
    def test_idempotent_and_preserves_existing(self):
        self.collector.process(info('one'))
        self.collector.process(info('two'))
        self.collector.process(info('one'))
        self.assertEqual(self.download.call_count, 2)
        self.assertEqual(len(self.store.get_json('metadata/catalog.json')['items']), 2)
    def test_post_live_publishes_only_when_duration_matches(self):
        self.collector.process(dict(info('complete', status='post_live'), duration=1210))
        with self.assertRaisesRegex(ValueError, 'incomplete_audio'):
            self.collector.process(dict(info('short', status='post_live'), duration=1400))
        self.assertEqual(self.state.row('short')['last_error'], 'incomplete_audio')
        self.assertEqual(self.state.row('short')['failed_stage'], 'downloading')
        self.assertTrue(self.state.row('short')['next_retry_at'])
        self.assertEqual([item['id'] for item in self.store.get_json('metadata/catalog.json')['items']], ['complete'])
        self.collector.process(dict(info('short', status='post_live'), duration=1210))
        self.assertEqual(self.state.row('short')['state'], 'published')
    def test_upload_failure_resumes_without_download(self):
        upload = self.store.upload
        self.store.upload = Mock(side_effect=RuntimeError('network'))
        with self.assertRaises(RuntimeError): self.collector.process(info())
        self.assertEqual(self.state.row('test-video')['state'], 'converted')
        self.assertEqual(self.state.row('test-video')['failed_stage'], 'upload')
        self.assertTrue(self.state.row('test-video')['next_retry_at'])
        self.store.upload = upload
        self.collector.process(info())
        self.assertEqual(self.download.call_count, 1)
        self.assertEqual(self.state.row('test-video')['state'], 'published')
    def test_local_modification_cannot_be_uploaded_with_old_checksum(self):
        upload = self.store.upload
        self.store.upload = Mock(side_effect=RuntimeError('network'))
        with self.assertRaises(RuntimeError): self.collector.process(info())
        (self.root / 'data/test-video.mp3').write_bytes(b'x' * len(b'fake-mp3-for-state-test'))
        self.store.upload = Mock(side_effect=upload)
        with self.assertRaises(ValueError): self.collector.process(info())
        self.store.upload.assert_not_called()
    def test_upload_only_needs_no_youtube_metadata(self):
        self.state.channel('UC' + 'a' * 22)
        upload = self.store.upload
        self.store.upload = Mock(side_effect=RuntimeError('network'))
        with self.assertRaises(RuntimeError): self.collector.process(info())
        self.store.upload = upload
        self.state.db.execute("UPDATE jobs SET next_retry_at=NULL")
        self.state.db.commit()
        with patch.dict('os.environ', {'STATE_DIR': str(self.root / 'state'), 'DATA_DIR': str(self.root / 'data'), 'LOG_DIR': str(self.root / 'logs')}), patch('collector.R2Store', return_value=self.store), patch('collector.metadata', side_effect=AssertionError('must not query YouTube')):
            self.assertEqual(main(['--upload-only', '--date', '2026-10-27']), 0)
        self.assertEqual(self.state.row('test-video')['state'], 'published')
        self.assertEqual(self.download.call_count, 1)
    def test_catalog_failure_and_put_success_before_crash(self):
        self.collector.process(info('previous'))
        original = self.store.put_json
        def put_and_crash(key, value):
            original(key, value)
            raise RuntimeError('process died after remote success')
        self.store.put_json = Mock(side_effect=put_and_crash)
        with self.assertRaises(RuntimeError): self.collector.process(info('next'))
        self.assertEqual(self.state.row('next')['state'], 'uploaded')
        self.store.put_json = original
        self.store.upload = Mock(side_effect=AssertionError('should HEAD instead'))
        self.collector.process(info('next'))
        self.assertEqual(self.download.call_count, 2)
        self.assertEqual({i['id'] for i in self.store.get_json('metadata/catalog.json')['items']}, {'previous', 'next'})
    def test_corrupt_catalog_not_overwritten(self):
        self.store.put_json('metadata/catalog.json', {'broken': True})
        with self.assertRaises(Exception): self.collector.process(info())
        self.assertEqual(self.store.get_json('metadata/catalog.json'), {'broken': True})
        self.assertEqual(self.state.row('test-video')['failed_stage'], 'catalog')
    def test_download_crash_after_rename_recovers(self):
        self.collector.data.mkdir(exist_ok=True)
        (self.collector.data / 'test-video.mp3').write_bytes(b'already converted')
        self.collector.process(info())
        self.download.assert_not_called()
    def test_remote_upload_success_before_state_crash(self):
        upload = self.store.upload
        def upload_crash(*args):
            upload(*args)
            raise RuntimeError('crash')
        self.store.upload = Mock(side_effect=upload_crash)
        with self.assertRaises(RuntimeError): self.collector.process(info())
        self.store.upload = Mock(side_effect=AssertionError('duplicate upload'))
        self.collector.process(info())
        self.assertEqual(self.download.call_count, 1)
    def test_channel_change_and_lock(self):
        self.state.channel('UC' + 'a' * 22)
        with self.assertRaises(ValueError): self.state.channel('UC' + 'b' * 22)
        with single_run(self.root / 'lock'):
            with self.assertRaises(Timeout):
                with single_run(self.root / 'lock'): pass

class BotCacheTest(unittest.TestCase):
    def test_matching_output_is_copied_and_duration_is_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = root / 'cache'
            cache.mkdir()
            source = cache / '예배 [abcdefghijk].mp3'
            source.write_bytes(b'audio')
            data = root / 'data'
            data.mkdir()
            collector = Collector(None, None, data, prober=lambda p: (120, p.stat().st_size))
            with patch.dict('os.environ', {'BOT_AUDIO_DIR': str(cache), 'AUDIO_BITRATE': '192K'}):
                dest = data / 'abcdefghijk.mp3'
                self.assertTrue(collector.reuse_bot_audio({'id': 'abcdefghijk', 'duration': 120}, dest))
                self.assertEqual(dest.read_bytes(), b'audio')
                dest.unlink()
                self.assertFalse(collector.reuse_bot_audio({'id': 'abcdefghijk', 'duration': 300}, dest))
                self.assertFalse(dest.exists())
                self.assertFalse(collector.reuse_bot_audio({'id': 'abcdefghijk'}, dest))
                self.assertTrue(source.exists())

    def test_ambiguous_files_and_symlinks_are_not_reused(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = root / 'cache'
            cache.mkdir()
            (cache / 'abcdefghijk.mp3').write_bytes(b'audio')
            (cache / '제목 [abcdefghijk].mp3').write_bytes(b'audio')
            collector = Collector(None, None, root / 'data', prober=lambda p: (120, p.stat().st_size))
            with patch.dict('os.environ', {'BOT_AUDIO_DIR': str(cache), 'AUDIO_BITRATE': '192K'}):
                self.assertFalse(collector.reuse_bot_audio({'id': 'abcdefghijk', 'duration': 120}, root / 'data/out.mp3'))
                (cache / '제목 [abcdefghijk].mp3').unlink()
                (cache / 'abcdefghijk.mp3').unlink()
                (cache / 'abcdefghijk.mp3').symlink_to(root / 'data/outside.mp3')
                self.assertFalse(collector.reuse_bot_audio({'id': 'abcdefghijk', 'duration': 120}, root / 'data/out.mp3'))


if __name__ == '__main__': unittest.main()
