#!/usr/bin/env python3
"""Daily private database/media/reference backups and isolated restore, without a Docker socket.

The database dump and media inventory share one exported PostgreSQL snapshot.
Immutable media are copied after that snapshot; mutable GTFS/reference generations
are captured under their own locks. Complete bundles are checked before publication.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime,timedelta,timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import time
import uuid

from backup_archive import MAX_BYTES, PATH, checked_manifest, digest_file, extract_files, write_files

TABLES=['users','lines','route_variants','route_revisions','stops','route_stops','route_instructions','audit_events','media_assets','revision_media','gtfs_route_links','gtfs_sync','rate_limits','system_logs','streetview_cache']
NAME=re.compile(r'gtt-backup-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}')


def now():
    """Return an aware UTC clock; workers/tests can inject another clock."""
    return datetime.now(timezone.utc)


def stamp(value):
    """Serialize the aware worker clock for a persistent reservation/manifest."""
    return value.isoformat(timespec='seconds').replace('+00:00','Z')


def atomic_json(path,value):
    """Flush a private checkpoint/manifest before atomic replacement."""
    fd,temporary=tempfile.mkstemp(prefix='.checkpoint-',dir=path.parent)
    try:
        with os.fdopen(fd,'w') as stream:
            os.fchmod(stream.fileno(),0o600);json.dump(value,stream,separators=(',',':'));stream.write('\n');stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,path)
        descriptor=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(descriptor)
        finally:os.close(descriptor)
    finally:
        if os.path.exists(temporary):os.unlink(temporary)


def connect(database=None):
    """Use standard PG environment variables; passwords never enter command arguments/logs."""
    import psycopg2
    return psycopg2.connect(**({'dbname':database}if database else {}))


def pg(command):
    """Run one bounded client command with credentials inherited through the PG environment."""
    try:subprocess.run(command,check=True,timeout=3600,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError as error:raise RuntimeError(command[0]+' failed with exit '+str(error.returncode))from None


@contextmanager
def source_lock(directory,name,timeout=15):
    """Read-lock existing worker/import state without requiring write access to serverdata."""
    path=directory/name
    if not path.exists():yield;return
    with path.open('rb') as lock:
        start=time.monotonic()
        while True:
            try:fcntl.flock(lock,fcntl.LOCK_SH|fcntl.LOCK_NB);break
            except BlockingIOError:
                if time.monotonic()-start>=timeout:raise TimeoutError('Source generation is busy')
                time.sleep(.1)
        try:yield
        finally:fcntl.flock(lock,fcntl.LOCK_UN)


def copy_regular(source,target):
    """Capture regular source bytes into private staging, rejecting links/devices."""
    target.parent.mkdir(parents=True,exist_ok=True)
    with os.fdopen(os.open(source,os.O_RDONLY|os.O_NOFOLLOW),'rb') as incoming,target.open('xb') as outgoing:
        size=os.fstat(incoming.fileno())
        if not stat.S_ISREG(size.st_mode)or size.st_size>128*1024**2:raise ValueError('Invalid or oversized runtime file')
        total=0
        while chunk:=incoming.read(1024*1024):
            total+=len(chunk)
            if total>128*1024**2:raise ValueError('Runtime file grew beyond limit')
            outgoing.write(chunk)


def capture_runtime(source,staging):
    """Capture complete GTFS reservations and private reference generations without HTTP."""
    files=[]
    for folder,lockname in [('gtfs','download.lock'),('references','import.lock')]:
        root=source/folder
        if not root.exists():continue
        with source_lock(root,lockname):
            candidates=[root/name for name in ['state.json','current.json','gtt_gtfs.zip']]if folder=='gtfs'else list(root.rglob('*'))
            for path in candidates:
                relative=folder+'/'+path.relative_to(root).as_posix()
                if not path.is_file() or not PATH.fullmatch(relative):continue
                target=staging/relative;copy_regular(path,target);files.append((target,relative,None))
        if folder=='gtfs':
            state=json.loads((staging/'gtfs/state.json').read_bytes())if(staging/'gtfs/state.json').exists()else{}
            current=staging/'gtfs/current.json'
            if current.exists()and json.loads(current.read_bytes())['archiveSha256']!=state.get('sha256'):
                raise ValueError('GTFS bundle/reservation provenance mismatch')
            archive=staging/'gtfs/gtt_gtfs.zip'
            if archive.exists()and digest_file(archive)['sha256']!=state.get('sha256'):raise ValueError('Cached GTFS hash mismatch')
        elif(staging/'references/index.json').exists():
            from validate_private_references import validate
            validate(staging/'references')
    return files


def create_backup(source,directory,clock=now,limit=MAX_BYTES):
    """Create a checked private bundle using one DB snapshot and immutable committed media."""
    if directory.resolve()==source.resolve()or source.resolve()in directory.resolve().parents or directory.resolve()in source.resolve().parents:
        raise ValueError('Backups must use a separate directory')
    directory.mkdir(parents=True,exist_ok=True);directory.chmod(0o700)
    created=clock();name='gtt-backup-'+created.strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8]
    with tempfile.TemporaryDirectory(prefix='.partial-',dir=directory) as temporary:
        staging=Path(temporary)
        connection=connect()
        try:
            connection.set_session(isolation_level='REPEATABLE READ',readonly=True)
            with connection.cursor()as cursor:
                cursor.execute('SELECT pg_export_snapshot(),current_database()');snapshot,database=cursor.fetchone()
                # Fixed table names, never SQL supplied by the backup manifest.
                counts={}
                for table in TABLES:
                    cursor.execute('SELECT count(*) FROM '+table);counts[table]=cursor.fetchone()[0]
                cursor.execute('SELECT name,checksum FROM schema_migrations ORDER BY name');migrations=[list(row)for row in cursor.fetchall()]
                cursor.execute('SELECT id::text,kind,extension,bytes,sha256 FROM media_assets ORDER BY id');assets=cursor.fetchall()
                runtime=capture_runtime(source,staging/'runtime')
                pg(['pg_dump','--format=custom','--no-owner','--no-privileges','--snapshot='+snapshot,'--file='+str(staging/'database.dump')])
                media=[]
                for ident,kind,extension,size,checksum in assets:
                    relative='media/'+ident+'.'+extension;path=source/relative
                    if not PATH.fullmatch(relative)or path.stat().st_size!=size:raise ValueError('Committed media is missing or has changed size')
                    media.append((path,relative,checksum))
                    if kind=='photo':
                        thumb='media/'+ident+'.thumb.jpg';media.append((source/thumb,thumb,None))
                entries=write_files(staging/'files.tar',runtime+media,limit)
        finally:connection.close()
        shutil.rmtree(staging/'runtime',ignore_errors=True)
        for item in ['database.dump','files.tar']:
            (staging/item).chmod(0o600)
            with(staging/item).open('rb')as stream:os.fsync(stream.fileno())
        manifest={'format':'gtt-trainer-backup','schemaVersion':1,'createdAt':stamp(created),'sourceDatabase':database,
                  'counts':counts,'migrations':migrations,'entries':entries,
                  'artifacts':{item:digest_file(staging/item,limit)for item in ['database.dump','files.tar']}}
        atomic_json(staging/'manifest.json',manifest)
        checked_manifest(staging,limit);pg(['pg_restore','--list',str(staging/'database.dump')])
        os.replace(staging,directory/name)
        descriptor=os.open(directory,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(descriptor)
        finally:os.close(descriptor)
        return name


def prune(directory,keep,protected):
    """Remove only checked, exactly recognized old bundles; never arbitrary or partial directories."""
    candidates=sorted([p for p in directory.iterdir()if NAME.fullmatch(p.name)and p.is_dir()and not p.is_symlink()],reverse=True)
    retained={protected}
    for path in candidates:
        if len(retained)<keep:retained.add(path.name)
    for path in candidates:
        if path.name in retained:continue
        if {p.name for p in path.iterdir()}!={'manifest.json','database.dump','files.tar'}:continue
        checked_manifest(path)
        for name in ['database.dump','files.tar','manifest.json']:(path/name).unlink()
        path.rmdir()


class Worker:
    """Persistent single-worker schedule; crashes/failures preserve the last complete backup."""
    def __init__(self,source,directory,hours=24,keep=7,clock=now,creator=create_backup):
        if not 1<=float(hours)<=168 or not 2<=int(keep)<=365:raise ValueError('Invalid backup interval/retention')
        self.source=Path(source);self.directory=Path(directory);self.hours=float(hours);self.keep=int(keep);self.clock=clock;self.creator=creator
        if self.directory.resolve()==self.source.resolve()or self.source.resolve()in self.directory.resolve().parents or self.directory.resolve()in self.source.resolve().parents:
            raise ValueError('Backups must use a separate directory')
        self.directory.mkdir(parents=True,exist_ok=True);self.directory.chmod(0o700)

    def state(self):
        """Read a private operator checkpoint; no data or credentials are emitted."""
        path=self.directory/'state.json'
        return json.loads(path.read_bytes())if path.exists()else{}

    def tick(self,force=False):
        """Reserve one scheduled run before work; a manual once run creates another complete bundle."""
        with(self.directory/'backup.lock').open('a')as lock:
            os.chmod(self.directory/'backup.lock',0o600)
            try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError:return {'outcome':'busy'}
            state=self.state();current=self.clock()
            if not force and state.get('nextAttemptAt')and datetime.fromisoformat(state['nextAttemptAt'].replace('Z','+00:00'))>current:return {'outcome':'not_due'}
            state.update(lastAttemptAt=stamp(current),nextAttemptAt=stamp(current+timedelta(hours=1)),outcome='running')
            atomic_json(self.directory/'state.json',state)
            try:
                name=self.creator(self.source,self.directory,clock=self.clock)
                state.update(lastSuccessAt=stamp(self.clock()),latest=name,outcome='created',lastError=None,nextAttemptAt=stamp(current+timedelta(hours=self.hours)))
                atomic_json(self.directory/'state.json',state)
                try:prune(self.directory,self.keep,name)
                except Exception:state['retentionWarning']='cleanup_failed';atomic_json(self.directory/'state.json',state)
                return {'outcome':'created','name':name,'manifestSha256':digest_file(self.directory/name/'manifest.json')['sha256']}
            except Exception as error:
                state.update(outcome='failed',lastError=type(error).__name__)
                atomic_json(self.directory/'state.json',state)
                raise


def database_ready():
    """Wait for migrations and initial source adoption before the first unattended backup."""
    connection=None
    try:
        connection=connect()
        with connection.cursor()as cursor:
            cursor.execute("SELECT to_regclass('gtfs_sync'),to_regclass('media_assets')")
            if not all(cursor.fetchone()):return False
            cursor.execute('SELECT count(*) FROM gtfs_sync')
            return cursor.fetchone()[0]>0
    except Exception:return False
    finally:
        if connection is not None:connection.close()


def restore(bundle,database,destination,source,uid=33,gid=33):
    """Restore only into a new isolated database and empty private volume; never overwrite a live DB."""
    if not re.fullmatch(r'gtt_restore_[a-z0-9_]{1,40}',database):raise ValueError('Use a new isolated gtt_restore_ database name')
    destination=Path(destination)
    if destination.resolve()==Path(source).resolve()or Path(source).resolve()in destination.resolve().parents or Path(bundle).resolve()in destination.resolve().parents or destination.is_symlink()or(destination.exists()and any(destination.iterdir())):
        raise ValueError('Restore requires an empty isolated output directory')
    manifest=checked_manifest(bundle)
    if set(manifest['counts'])!=set(TABLES):raise ValueError('Unknown backup table inventory')
    pg(['pg_restore','--list',str(Path(bundle)/'database.dump')])
    from psycopg2 import sql
    connection=connect('postgres');connection.autocommit=True
    try:
        with connection.cursor()as cursor:
            cursor.execute('SELECT 1 FROM pg_database WHERE datname=%s',(database,))
            if cursor.fetchone():raise ValueError('Restore database already exists')
            cursor.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(database)))
    finally:connection.close()
    pg(['pg_restore','--no-owner','--no-privileges','--single-transaction','--exit-on-error','--dbname='+database,str(Path(bundle)/'database.dump')])
    connection=connect(database)
    try:
        with connection.cursor()as cursor:
            for table in TABLES:
                cursor.execute('SELECT count(*) FROM '+table)
                if cursor.fetchone()[0]!=manifest['counts'][table]:raise ValueError('Restored database count mismatch')
            cursor.execute('SELECT name,checksum FROM schema_migrations ORDER BY name')
            if [list(row)for row in cursor.fetchall()]!=manifest['migrations']:raise ValueError('Restored migration provenance mismatch')
    finally:connection.close()
    extract_files(bundle,destination,uid,gid)
    return {'database':database,'outcome':'restored','files':len(manifest['entries']),'counts':manifest['counts']}


def main():
    """Run the daemon, create/verify a backup, report health, or restore in isolation."""
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['serve','once','verify','restore','status'])
    parser.add_argument('--data-dir',type=Path,default=Path('/source/serverdata'))
    parser.add_argument('--backup-dir',type=Path,default=Path('/backups'))
    parser.add_argument('--bundle',type=Path)
    parser.add_argument('--database')
    parser.add_argument('--output-dir',type=Path)
    parser.add_argument('--check',action='store_true')
    args=parser.parse_args()
    try:
        if args.action=='verify':
            if not args.bundle:parser.error('--bundle is required')
            checked_manifest(args.bundle);pg(['pg_restore','--list',str(args.bundle/'database.dump')]);print(json.dumps({'outcome':'verified'}));return
        if args.action=='restore':
            if not args.bundle or not args.database or not args.output_dir:parser.error('--bundle, --database and --output-dir are required')
            print(json.dumps(restore(args.bundle,args.database,args.output_dir,args.data_dir)));return
        worker=Worker(args.data_dir,args.backup_dir,os.environ.get('BACKUP_INTERVAL_HOURS','24'),os.environ.get('BACKUP_KEEP','7'))
        if args.action=='status':
            state=worker.state();print(json.dumps(state))
            if args.check and(not state.get('lastSuccessAt')or now()-datetime.fromisoformat(state['lastSuccessAt'].replace('Z','+00:00'))>timedelta(hours=worker.hours*2)):raise SystemExit(1)
            return
        if args.action=='once':print(json.dumps(worker.tick(force=True)));return
        while True:
            try:
                result=worker.tick()if database_ready()else{'outcome':'waiting_for_database'}
                if result['outcome']!='not_due':print(json.dumps(result),flush=True)
            except Exception as error:print(json.dumps({'outcome':'failed','errorType':type(error).__name__}),flush=True)
            time.sleep(60)
    except Exception as error:
        print(json.dumps({'outcome':'failed','errorType':type(error).__name__}),flush=True)
        raise SystemExit(1)


if __name__=='__main__':main()
