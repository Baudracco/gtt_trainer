"""Deterministic sync tests: no request to GTT is made by the test suite."""
import csv
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from urllib.error import HTTPError
import zipfile

import sync_gtfs as sync


def archive(changed=False, timetable='08:00:00'):
    files = {
        'routes.txt': [['route_id','route_short_name','route_long_name','route_type'], ['T','T','Synthetic','3']],
        'trips.txt': [['trip_id','route_id','shape_id','direction_id','trip_headsign'], ['A','T','S','1','End']],
        'shapes.txt': [['shape_id','shape_pt_sequence','shape_pt_lon','shape_pt_lat'], ['S','1','7.6','45'], ['S','2','7.61','45.001' if changed else '45']],
        'stops.txt': [['stop_id','stop_code','stop_name','stop_lon','stop_lat'], ['X','10','X','7.6','45']],
        'stop_times.txt': [['trip_id','stop_sequence','stop_id','arrival_time'], ['A','1','X',timetable]],
    }
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as z:
        for name, rows in files.items():
            text = io.StringIO(); csv.writer(text).writerows(rows)
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0)); z.writestr(info, text.getvalue())
    return stream.getvalue()


class Opener:
    def __init__(self, payload=None, error=None): self.payload=payload; self.error=error; self.calls=[]
    def open(self, request, timeout):
        self.calls.append(request)
        if self.error: raise self.error
        response = io.BytesIO(self.payload)
        response.headers = {'ETag': '"test-tag"', 'Last-Modified': 'Thu, 15 Oct 2026 12:00:00 GMT'}
        return response


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.path=Path(self.temp.name)
        self.now=datetime(2026,10,16,6,tzinfo=timezone.utc); self.opener=Opener(archive())
    def tearDown(self): self.temp.cleanup()
    def downloader(self, **kwargs):
        return sync.Downloader(self.path, lines=['T'], opener=self.opener, clock=lambda:self.now, **kwargs)

    def test_minimum_cooldown_is_enforced(self):
        for hours in [0, 23.99, -1, float('nan')]:
            with self.assertRaises(ValueError): self.downloader(cooldown_hours=hours)

    def test_hash_and_cooldown_survive_restart_at_exact_24h_boundary(self):
        self.assertEqual(self.downloader().run()['outcome'],'changed')
        self.assertEqual(self.downloader().bundle()['archiveSha256'],hashlib.sha256(archive()).hexdigest())
        self.now+=timedelta(hours=24,seconds=-1)
        self.assertEqual(self.downloader().run()['outcome'],'cooldown'); self.assertEqual(len(self.opener.calls),1)
        self.now+=timedelta(seconds=1)
        self.assertEqual(self.downloader().run()['outcome'],'unchanged'); self.assertEqual(len(self.opener.calls),2)
        self.assertEqual(self.opener.calls[1].get_header('If-none-match'),'"test-tag"')

    def test_failed_attempt_is_also_throttled_and_preserves_bundle(self):
        downloader=self.downloader(); downloader.run(); previous=downloader.bundle()
        self.now+=timedelta(hours=24); self.opener.error=TimeoutError('synthetic timeout')
        with self.assertRaises(TimeoutError): downloader.run()
        self.assertEqual(self.downloader().run()['outcome'],'cooldown'); self.assertEqual(len(self.opener.calls),2)
        self.assertEqual(downloader.bundle(),previous)

    def test_invalid_zip_never_replaces_last_good_generation(self):
        downloader=self.downloader(); downloader.run(); previous=downloader.bundle()
        self.now+=timedelta(hours=24); self.opener.payload=b'not a zip'
        with self.assertRaises(zipfile.BadZipFile): downloader.run()
        self.assertEqual(downloader.bundle(),previous)
        self.assertEqual((self.path/'gtt_gtfs.zip').read_bytes(),archive())

    def test_timetable_only_zip_change_does_not_change_route_fingerprint(self):
        downloader=self.downloader(); downloader.run()
        self.now+=timedelta(hours=24); self.opener.payload=archive(timetable='09:00:00')
        self.assertEqual(downloader.run()['outcome'],'changed')
        changes=downloader.bundle()['changes']
        self.assertEqual(changes['unchanged'],1);self.assertEqual(changes['changed'],[])

    def test_geometry_change_keeps_source_identity_and_creates_change_candidate(self):
        downloader=self.downloader(); downloader.run(); old=downloader.bundle()['variants'][0]
        self.now+=timedelta(hours=24); self.opener.payload=archive(changed=True); downloader.run()
        new=downloader.bundle()['variants'][0]
        self.assertEqual(old['key'],new['key']);self.assertNotEqual(old['contentHash'],new['contentHash'])
        self.assertEqual(downloader.bundle()['changes']['changed'],[old['key']])

    def test_http_304_retains_checksum_and_never_reconverts(self):
        downloader=self.downloader(); downloader.run(); previous=downloader.bundle()
        self.now+=timedelta(hours=24); self.opener.error=HTTPError(sync.URL,304,'Not Modified',{},None)
        self.assertEqual(downloader.run()['outcome'],'not_modified'); self.assertEqual(downloader.bundle(),previous)
        self.assertEqual(sync.read_json(self.path/'state.json')['sha256'],previous['archiveSha256'])

    def test_attempt_is_reserved_before_open_even_if_process_dies(self):
        class Crash(Opener):
            def open(self,request,timeout):
                self.observed=sync.read_json(self.state/'state.json')
                raise KeyboardInterrupt()
        opener=Crash();opener.state=self.path
        downloader=sync.Downloader(self.path,opener=opener,clock=lambda:self.now)
        with self.assertRaises(KeyboardInterrupt): downloader.run()
        self.assertEqual(opener.observed['lastAttemptAt'],sync.stamp(self.now))
        self.assertEqual(self.downloader().run()['outcome'],'cooldown');self.assertEqual(self.opener.calls,[])

    def test_duplicate_and_oversized_archive_members_are_rejected(self):
        stream=io.BytesIO()
        with zipfile.ZipFile(stream,'w') as z:
            for name in sync.REQUIRED: z.writestr(name,'header\n')
            z.writestr('routes.txt','duplicate')
        path=self.path/'bad.zip';path.write_bytes(stream.getvalue())
        with self.assertRaises(ValueError):sync.validate_archive(path)

    def test_rejected_pattern_is_not_reported_as_missing(self):
        old={'variants':[{'key':'A','contentHash':'hash'}]}
        current={'variants':[],'rejected':[{'key':'A','reason':'Too far from shape'}]}
        self.assertEqual(sync.compare(old,current)['missing'],[])

    def test_seed_adopts_previous_download_and_respects_its_cooldown(self):
        root=Path(__file__).resolve().parents[1]
        status=sync.read_json(root/'data/gtt-sync-status.json')
        self.now=sync.parse_stamp(status['lastAttemptAt'])+timedelta(hours=12)
        downloader=self.downloader();downloader.seed(root/'data/gtt-gerbido-drafts.json',status)
        self.assertEqual(len(downloader.bundle()['variants']),139)
        self.assertEqual(downloader.run()['outcome'],'cooldown');self.assertEqual(self.opener.calls,[])


    def test_same_feed_packaged_scope_upgrade_keeps_download_reservation(self):
        root=Path(__file__).resolve().parents[1]
        status=sync.read_json(root/'data/gtt-sync-status.json')
        self.now=sync.parse_stamp(status['lastAttemptAt'])+timedelta(hours=12)
        self.downloader().seed(root/'data/gtt-gerbido-drafts.json',status)
        before=sync.read_json(self.path/'state.json')
        urban=sync.Downloader(self.path,agencies=['U'],route_types=['0','3'],opener=self.opener,clock=lambda:self.now)
        urban.seed(root/'data/gtt-urban-drafts.json',status)
        self.assertEqual(len(urban.bundle()['variants']),602)
        self.assertEqual(sync.read_json(self.path/'state.json'),before)
        self.assertEqual(urban.run()['outcome'],'cooldown')
        self.assertEqual(self.opener.calls,[])

    def test_packaged_seed_cannot_replace_a_newer_download(self):
        root=Path(__file__).resolve().parents[1]
        self.downloader().run()
        previous=self.downloader().bundle()
        self.downloader().seed(root/'data/gtt-urban-drafts.json',sync.read_json(root/'data/gtt-sync-status.json'))
        self.assertEqual(self.downloader().bundle(),previous)

if __name__=='__main__':unittest.main()
