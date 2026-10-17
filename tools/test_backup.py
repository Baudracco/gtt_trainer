"""Failure, integrity, traversal and persistent scheduling tests with synthetic bytes only."""
from datetime import datetime,timedelta,timezone
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest

import backup
from backup_archive import checked_manifest,digest_file,extract_files,write_files

MEDIA='media/11111111-1111-4111-8111-111111111111.jpg'


def bundle(directory,unsafe=None):
    directory.mkdir(parents=True,exist_ok=True)
    (directory/'database.dump').write_bytes(b'PGDMP synthetic unit data, not a real database')
    with tempfile.TemporaryDirectory()as source:
        path=Path(source)/'image';path.write_bytes(b'synthetic immutable media')
        entries=write_files(directory/'files.tar',[(path,MEDIA,hashlib.sha256(path.read_bytes()).hexdigest())])
    if unsafe:
        with tarfile.open(directory/'files.tar','w:')as archive:
            info=tarfile.TarInfo(unsafe)
            if unsafe==MEDIA:info.type=tarfile.SYMTYPE;info.linkname='/outside'
            else:info.size=4
            archive.addfile(info,io.BytesIO(b'evil')if info.isfile()else None)
    manifest={'format':'gtt-trainer-backup','schemaVersion':1,'entries':entries,
              'artifacts':{p:digest_file(directory/p)for p in ['database.dump','files.tar']}}
    backup.atomic_json(directory/'manifest.json',manifest)
    return directory


class BackupTests(unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
    def tearDown(self):self.temp.cleanup()

    def test_checked_round_trip_never_overwrites_an_existing_destination(self):
        source=bundle(self.root/'bundle');destination=self.root/'restore'
        extract_files(source,destination,os.getuid(),os.getgid())
        self.assertEqual((destination/MEDIA).read_bytes(),b'synthetic immutable media')
        with self.assertRaisesRegex(ValueError,'empty'):extract_files(source,destination)
        self.assertEqual((destination/MEDIA).read_bytes(),b'synthetic immutable media')

    def test_corruption_and_unsafe_members_are_rejected_before_restore(self):
        path=bundle(self.root/'corrupt');(path/'database.dump').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'checksum'):checked_manifest(path)
        for i,name in enumerate(['../outside','/absolute',MEDIA]):
            path=bundle(self.root/str(i),name)
            with self.assertRaises(ValueError):checked_manifest(path)
        self.assertFalse((self.root/'outside').exists())

    def test_source_symlinks_hash_changes_and_size_limits_are_rejected(self):
        source=self.root/'source';source.write_bytes(b'data')
        with self.assertRaisesRegex(ValueError,'checksum'):write_files(self.root/'files.tar',[(source,MEDIA,'0'*64)])
        with self.assertRaisesRegex(ValueError,'size'):write_files(self.root/'files.tar',[(source,MEDIA,None)],limit=3)
        link=self.root/'link';link.symlink_to(source)
        with self.assertRaises(OSError):write_files(self.root/'files.tar',[(link,MEDIA,None)])

    def test_persistent_schedule_reserves_before_work_and_failure_keeps_last_good(self):
        current=[datetime(2026,1,1,tzinfo=timezone.utc)];calls=[]
        def creator(source,directory,clock):
            state=json.loads((directory/'state.json').read_bytes())
            self.assertEqual(state['outcome'],'running');calls.append(1)
            if len(calls)==2:raise RuntimeError('private database detail must not reach state')
            name='gtt-backup-'+clock().strftime('%Y%m%dT%H%M%SZ')+'-'+f'{len(calls):08x}'
            bundle(directory/name);return name
        def worker():return backup.Worker(self.root/'data',self.root/'backups',clock=lambda:current[0],creator=creator)
        first=worker().tick();self.assertEqual(first['outcome'],'created')
        current[0]+=timedelta(hours=23,minutes=59)
        self.assertEqual(worker().tick()['outcome'],'not_due');self.assertEqual(len(calls),1)
        current[0]+=timedelta(minutes=1)
        with self.assertRaises(RuntimeError):worker().tick()
        state=worker().state();self.assertEqual(state['latest'],first['name']);self.assertTrue((self.root/'backups'/first['name']).exists())
        self.assertNotIn('private database detail',(self.root/'backups/state.json').read_text())
        self.assertEqual(worker().tick()['outcome'],'not_due')
        current[0]+=timedelta(hours=1);self.assertEqual(worker().tick()['outcome'],'created')

    def test_lock_and_retention_preserve_unrelated_and_partial_directories(self):
        directory=self.root/'backups';worker=backup.Worker(self.root/'data',directory)
        with(directory/'backup.lock').open('a')as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            self.assertEqual(worker.tick()['outcome'],'busy')
        names=['gtt-backup-2026010'+str(i)+'T000000Z-00000001'for i in range(1,4)]
        for name in names:bundle(directory/name)
        (directory/'unrelated').mkdir();(directory/'.partial-test').mkdir()
        backup.prune(directory,2,names[-1])
        self.assertFalse((directory/names[0]).exists());self.assertTrue((directory/names[-1]).exists())
        self.assertTrue((directory/'unrelated').exists());self.assertTrue((directory/'.partial-test').exists())

    def test_restore_cannot_target_live_names_or_nonempty_files(self):
        for database in ['gtt_trainer','postgres','gtt_restore_x;DROP DATABASE postgres']:
            with self.assertRaisesRegex(ValueError,'isolated'):backup.restore(self.root/'missing',database,self.root/'out',self.root/'live')
        existing=self.root/'existing';existing.mkdir();(existing/'keep').write_text('retain')
        with self.assertRaisesRegex(ValueError,'empty'):backup.restore(self.root/'missing','gtt_restore_test',existing,self.root/'live')
        self.assertEqual((existing/'keep').read_text(),'retain')

    def test_runtime_capture_preserves_reservation_and_private_generation(self):
        fixture=json.loads((Path(__file__).resolve().parents[1]/'web/e2e/fixtures/depot.json').read_text())
        source=self.root/'data';(source/'gtfs').mkdir(parents=True)
        reserved=b'{"lastAttemptAt":"2026-01-01T00:00:00Z","nextAttemptAt":"2026-01-02T00:00:00Z"}'
        (source/'gtfs/state.json').write_bytes(reserved)
        private=source/'references';private.mkdir()
        (private/'index.json').write_text(json.dumps(fixture['index']))
        for kind,data,digest in [('parts',fixture['movements'],fixture['index']['parts'][0]['sha256']),('blocks',fixture['blocks'],fixture['index']['blocksSha256'])]:
            (private/kind).mkdir();(private/kind/(digest+'.json')).write_bytes((json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n').encode())
        files=backup.capture_runtime(source,self.root/'staging')
        self.assertEqual((self.root/'staging/gtfs/state.json').read_bytes(),reserved)
        self.assertEqual(len(files),4)


if __name__=='__main__':unittest.main()
