"""Stream and verify private GTT backup files without trusting archive paths or permissions."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tarfile

MAX_BYTES=50*1024**3
PATH=re.compile(r'(?:media/[a-f0-9-]{36}(?:\.thumb)?\.(?:jpg|mp4|webm)|gtfs/(?:state\.json|current\.json|gtt_gtfs\.zip)|references/(?:index\.json|changes\.json|(?:parts|blocks)/[a-f0-9]{64}\.json))')


def digest_file(path, limit=MAX_BYTES):
    """Read a regular non-symlink file in bounded chunks and return its size and SHA-256."""
    digest=hashlib.sha256();total=0
    with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb') as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):raise ValueError('Backup input must be a regular file')
        while chunk:=stream.read(1024*1024):
            total+=len(chunk)
            if total>limit:raise ValueError('Backup file exceeds size limit')
            digest.update(chunk)
    return {'bytes':total,'sha256':digest.hexdigest()}


class HashReader:
    """Hash exactly the bytes tarfile consumes without buffering videos in memory."""
    def __init__(self, stream):self.stream=stream;self.digest=hashlib.sha256();self.bytes=0
    def read(self,size):
        data=self.stream.read(size);self.digest.update(data);self.bytes+=len(data);return data


def write_files(destination, files, limit=MAX_BYTES):
    """Archive explicit immutable files and compare committed media checksums while streaming.

    files contains source path, safe archive path, and optional expected content hash.
    Metadata is normalized; file changes during the read fail the whole backup.
    """
    entries=[];total=0;seen=set()
    with tarfile.open(destination,'w:') as archive:
        for source,name,expected in sorted(files,key=lambda item:item[1]):
            if not PATH.fullmatch(name) or name in seen:raise ValueError('Invalid or duplicate backup path')
            seen.add(name)
            with os.fdopen(os.open(source,os.O_RDONLY|os.O_NOFOLLOW),'rb') as stream:
                before=os.fstat(stream.fileno())
                if not stat.S_ISREG(before.st_mode):raise ValueError('Backup input must be regular')
                total+=before.st_size
                if total>limit:raise ValueError('Backup files exceed size limit')
                info=tarfile.TarInfo(name);info.size=before.st_size;info.mode=0o600
                reader=HashReader(stream);archive.addfile(info,reader)
                after=os.fstat(stream.fileno())
                if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns) or stream.read(1):
                    raise ValueError('Backup input changed while reading')
                checksum=reader.digest.hexdigest()
                if expected is not None and checksum!=expected:raise ValueError('Committed media checksum mismatch')
                entries.append({'path':name,'bytes':reader.bytes,'sha256':checksum})
    return entries


def checked_manifest(directory,limit=MAX_BYTES):
    """Validate complete bundle identities and every tar member before restore can create a database."""
    directory=Path(directory)
    if directory.is_symlink():raise ValueError('Backup directory must not be a symlink')
    with os.fdopen(os.open(directory/'manifest.json',os.O_RDONLY|os.O_NOFOLLOW),'rb')as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):raise ValueError('Invalid manifest file')
        raw=stream.read(32*1024**2+1)
    if len(raw)>32*1024**2:raise ValueError('Backup manifest exceeds size limit')
    manifest=json.loads(raw)
    if manifest.get('format')!='gtt-trainer-backup' or manifest.get('schemaVersion')!=1:
        raise ValueError('Unknown backup format')
    for name in ['database.dump','files.tar']:
        expected=manifest['artifacts'][name]
        if digest_file(directory/name,limit)!=expected:raise ValueError('Backup artifact checksum/size mismatch')
    entries=manifest['entries']
    if not isinstance(entries,list) or len(entries)>100000:raise ValueError('Too many backup entries')
    indexed={}
    for entry in entries:
        name=entry['path']
        if not isinstance(name,str) or not PATH.fullmatch(name) or name in indexed:
            raise ValueError('Invalid or duplicate manifest path')
        if type(entry['bytes'])is not int or entry['bytes']<0 or not re.fullmatch(r'[a-f0-9]{64}',entry['sha256']):
            raise ValueError('Invalid file metadata')
        indexed[name]=entry
    seen=set();total=0
    with tarfile.open(directory/'files.tar','r:') as archive:
        for member in archive:
            if not member.isfile() or member.name not in indexed or member.name in seen or member.linkname or member.sparse:
                raise ValueError('Unsafe or unexpected archive member')
            expected=indexed[member.name]
            if member.size!=expected['bytes']:raise ValueError('Archive member size mismatch')
            seen.add(member.name);total+=member.size
            if total>limit:raise ValueError('Archive expanded size exceeds limit')
            reader=archive.extractfile(member);digest=hashlib.sha256()
            while chunk:=reader.read(1024*1024):digest.update(chunk)
            if digest.hexdigest()!=expected['sha256']:raise ValueError('Archive member checksum mismatch')
    if seen!=set(indexed):raise ValueError('Archive members are missing')
    return manifest


def extract_files(directory,destination,uid=33,gid=33,limit=MAX_BYTES):
    """Extract checked regular members into an empty private directory using exclusive creation.

    Does not use extractall or archive ownership/modes. Callers must not point this
    at active serverdata; a nonempty or symlink destination is always rejected.
    """
    manifest=checked_manifest(directory,limit)
    destination=Path(destination)
    if destination.is_symlink() or (destination.exists() and any(destination.iterdir())):
        raise ValueError('Restore destination must be empty and not a symlink')
    destination.mkdir(parents=True,exist_ok=True)
    indexed={entry['path']:entry for entry in manifest['entries']}
    with tarfile.open(Path(directory)/'files.tar','r:') as archive:
        for member in archive:
            expected=indexed.get(member.name)
            if not member.isfile() or not PATH.fullmatch(member.name) or member.linkname or member.sparse or expected is None or member.size!=expected['bytes']:
                raise ValueError('Archive changed after verification')
            target=destination/member.name
            target.parent.mkdir(parents=True,exist_ok=True)
            with target.open('xb') as stream:
                reader=archive.extractfile(member);digest=hashlib.sha256()
                while chunk:=reader.read(1024*1024):stream.write(chunk);digest.update(chunk)
                stream.flush();os.fsync(stream.fileno())
            if digest.hexdigest()!=expected['sha256']:raise ValueError('Archive changed during restore')
            target.chmod(0o644)
    for path in [destination,*destination.rglob('*')]:
        if path.is_dir():path.chmod(0o755)
        if os.geteuid()==0:os.chown(path,uid,gid)
    return manifest
