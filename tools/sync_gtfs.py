#!/usr/bin/env python3
"""Persistently throttle GTT downloads, compare ZIP SHA-256, stage fixed-route updates.

One download attempt per cooldown (at least 24h), including failures. No retry/force
switch bypasses the persisted reservation. The previous validated bundle survives
network/conversion failures. Only the official HTTPS GTT endpoint is supported.
"""
import argparse
import csv
from datetime import datetime, timedelta, timezone
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener
import zipfile

from import_routes import gtfs

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://www.gtt.to.it/open_data/gtt_gtfs.zip'
MAX_DOWNLOAD = 100 * 1024 * 1024
REQUIRED = {'routes.txt', 'trips.txt', 'shapes.txt', 'stops.txt', 'stop_times.txt'}


def utcnow():
    return datetime.now(timezone.utc)


def stamp(value):
    return value.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def parse_stamp(value):
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None: raise ValueError('Sync timestamps require a timezone')
    return parsed


def read_json(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            os.fchmod(stream.fileno(), 0o644)
            json.dump(value, stream, ensure_ascii=False, separators=(',', ':'))
            stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)


def content_hash(document):
    # Download date is provenance, not a route change. Identity canonicalization in
    # PostGIS may replace stop UUIDs; names/coordinates/order remain significant.
    document = json.loads(json.dumps(document))
    document['source'].pop('retrievedAt', None)
    for stop in document['stops']: stop.pop('id', None)
    return hashlib.sha256(json.dumps(document, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def validate_archive(path):
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > 200 or len({e.filename for e in entries}) != len(entries):
            raise ValueError('Duplicate/excessive archive members')
        if sum(e.file_size for e in entries) > 250 * 1024 * 1024 or not REQUIRED <= set(archive.namelist()):
            raise ValueError('Invalid or oversized GTFS archive')
        if archive.testzip() is not None: raise ValueError('GTFS ZIP CRC failed')


def make_bundle(path, sha256, downloaded_at, lines, agencies=None, route_types=None):
    validate_archive(path)
    source = {'name': 'GTT S.p.A. – Gruppo Torinese Trasporti', 'url': URL,
              'license': 'GTT GTFS non-commercial use; attribution required. https://www.gtt.to.it/gtt_gtfs_license.html',
              'retrievedAt': downloaded_at[:10]}
    docs, rejected = gtfs(path, source, set(lines), {'0': 'none', '1': 'none'}, with_identity=True,
                          agencies=agencies, route_types=route_types)
    if not docs: raise ValueError('No valid selected variants; retaining previous bundle')
    variants = []
    for doc in docs:
        identity = doc.pop('_gtfs')
        variants.append({**identity, 'contentHash': content_hash(doc), 'document': doc})
    with zipfile.ZipFile(path) as archive:
        feed_info = list(csv.DictReader(io.TextIOWrapper(archive.open('feed_info.txt'), encoding='utf-8-sig'))) if 'feed_info.txt' in archive.namelist() else []
    return {'schemaVersion': 1, 'provider': 'gtt', 'archiveSha256': sha256,
            'downloadedAt': downloaded_at, 'sourceUrl': URL, 'lines': lines,
            'agencies': sorted(agencies or []), 'routeTypes': sorted(route_types if route_types is not None else ['3']),
            'feedInfo': feed_info, 'variants': variants, 'rejected': rejected}


def compare(previous, current):
    old = {v['key']: v['contentHash'] for v in (previous or {}).get('variants', [])}
    new = {v['key']: v['contentHash'] for v in current['variants']}
    rejected = {v['key'] for v in current['rejected']}
    return {'added': sorted(new.keys() - old.keys()),
            'changed': sorted(k for k in new.keys() & old.keys() if new[k] != old[k]),
            'unchanged': len([k for k in new.keys() & old.keys() if new[k] == old[k]]),
            'missing': sorted(old.keys() - new.keys() - rejected),
            'rejected': current['rejected']}


class OfficialRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        url = urlparse(newurl)
        if url.scheme != 'https' or url.hostname not in {'www.gtt.to.it', 'gtt.to.it'}:
            raise ValueError('Refusing redirect outside official GTT HTTPS hosts')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class Downloader:
    def __init__(self, directory, cooldown_hours=24, lines=None, opener=None, clock=utcnow, agencies=None, route_types=None):
        if not 24 <= float(cooldown_hours) <= 8760:
            raise ValueError('cooldownHours must be between 24 and 8760; minimum 24 hours')
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.cooldown = timedelta(hours=float(cooldown_hours))
        self.lines = sorted(lines or [])
        self.agencies = sorted(agencies or [])
        self.route_types = sorted(route_types if route_types is not None else ['3'])
        self.opener = opener or build_opener(OfficialRedirects())
        self.clock = clock

    def bundle(self):
        return read_json(self.directory / 'current.json')

    def same_selection(self, bundle):
        return bool(bundle) and bundle.get('lines') == self.lines and bundle.get('agencies', []) == self.agencies and bundle.get('routeTypes', ['3']) == self.route_types

    def convert(self, path, sha256, downloaded_at):
        return make_bundle(path, sha256, downloaded_at, self.lines, self.agencies, self.route_types)

    def seed(self, documents, status):
        """Adopt packaged source bytes without HTTP, including a same-feed scope upgrade.

        A new package may expand selection on the identical archived feed. Existing
        download reservations are preserved and a newer downloaded feed is never
        replaced by the packaged snapshot.
        """
        with (self.directory / 'download.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            state = read_json(self.directory / 'state.json')
            previous = self.bundle()
            manifest = read_json(documents.with_suffix('.manifest.json'))
            selection = manifest.get('selection', {'lines': self.lines, 'agencies': self.agencies, 'routeTypes': self.route_types})
            if selection != {'lines': self.lines, 'agencies': self.agencies, 'routeTypes': self.route_types}: return
            if state and (state.get('sha256') != manifest['sha256'] or self.same_selection(previous)): return
            docs = read_json(documents)
            variants = [{**identity, 'document': doc, 'contentHash': content_hash(doc)} for identity, doc in zip(manifest['variants'], docs, strict=True)]
            if manifest['sha256'] != status['sha256']: raise ValueError('Seed provenance mismatch')
            bundle = {'schemaVersion': 1, 'provider': 'gtt', 'archiveSha256': manifest['sha256'],
                      'downloadedAt': status['lastDownloadAt'], 'sourceUrl': URL, 'lines': self.lines,
                      'agencies': self.agencies, 'routeTypes': self.route_types,
                      'feedInfo': manifest.get('feedInfo', []), 'variants': variants, 'rejected': manifest['skipped']}
            if previous: bundle['changes'] = compare(previous, bundle)
            atomic_json(self.directory / 'current.json', bundle)
            if state is None:
                atomic_json(self.directory / 'state.json', {**status, 'nextAttemptAt': stamp(parse_stamp(status['lastAttemptAt']) + self.cooldown)})

    def run(self):
        with (self.directory / 'download.lock').open('a') as lock:
            try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError: return {'outcome': 'busy'}
            state_path = self.directory / 'state.json'
            state = read_json(state_path, {'schemaVersion': 1})
            now = self.clock()
            previous = self.bundle()
            local_archive = self.directory / 'gtt_gtfs.zip'
            if previous and not self.same_selection(previous) and local_archive.exists():
                # Selection changes can reuse already downloaded bytes during cooldown.
                bundle = self.convert(local_archive, previous['archiveSha256'], previous['downloadedAt'])
                bundle['changes'] = compare(previous, bundle)
                atomic_json(self.directory / 'current.json', bundle)
                previous = bundle
            due = parse_stamp(state['lastAttemptAt']) + self.cooldown if state.get('lastAttemptAt') else now
            if now < due: return {'outcome': 'cooldown', 'nextAttemptAt': stamp(due), 'sha256': state.get('sha256')}
            # The reservation survives a crash, HTTP failure and process restart.
            state.update(lastAttemptAt=stamp(now), nextAttemptAt=stamp(now + self.cooldown), outcome='attempting', error=None)
            atomic_json(state_path, state)
            headers = {'User-Agent': 'GTT-Trainer/0.3 (+educational fixed-route study)', 'Accept': 'application/zip'}
            if self.same_selection(previous):
                if state.get('etag'): headers['If-None-Match'] = state['etag']
                if state.get('lastModified'): headers['If-Modified-Since'] = state['lastModified']
            temporary = None
            try:
                try: response = self.opener.open(Request(URL, headers=headers), timeout=60)
                except HTTPError as error:
                    if error.code != 304 or previous is None: raise
                    state.update(outcome='not_modified', lastCheckedAt=stamp(now))
                    atomic_json(state_path, state)
                    return {**state, 'nextAttemptAt': stamp(now + self.cooldown)}
                fd, temporary = tempfile.mkstemp(prefix='download-', suffix='.zip', dir=self.directory)
                sha = hashlib.sha256(); total = 0
                with response, os.fdopen(fd, 'wb') as stream:
                    while chunk := response.read(65536):
                        total += len(chunk)
                        if total > MAX_DOWNLOAD: raise ValueError('GTFS download exceeds 100 MiB')
                        sha.update(chunk); stream.write(chunk)
                    stream.flush(); os.fsync(stream.fileno())
                    etag, last_modified = response.headers.get('ETag'), response.headers.get('Last-Modified')
                digest = sha.hexdigest()
                if digest != state.get('sha256') or not self.same_selection(previous):
                    bundle = self.convert(Path(temporary), digest, stamp(now))
                    bundle['changes'] = compare(previous, bundle)
                    # Keep the current bundle intact until the complete conversion succeeds.
                    atomic_json(self.directory / 'current.json', bundle)
                    state['outcome'] = 'changed'
                else: state['outcome'] = 'unchanged'
                os.replace(temporary, self.directory / 'gtt_gtfs.zip'); temporary = None
                state.update(sha256=digest, lastDownloadAt=stamp(now), lastCheckedAt=stamp(now), etag=etag, lastModified=last_modified)
                atomic_json(state_path, state)
                return {**state, 'nextAttemptAt': stamp(now + self.cooldown)}
            except Exception as error:
                state.update(outcome='failed', error=f'{type(error).__name__}: {error}')
                atomic_json(state_path, state)
                raise
            finally:
                if temporary and os.path.exists(temporary): os.unlink(temporary)


def apply_bundle(directory):
    path = directory / 'current.json'
    if not path.exists(): return
    result = subprocess.run(['php', str(ROOT / 'server/bin/console.php'), 'gtfs:sync', str(path)], capture_output=True, text=True, timeout=600)
    if result.returncode: raise RuntimeError(result.stderr.strip() or 'GTFS database synchronization failed')
    print(result.stdout.strip(), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir', type=Path, default=ROOT / 'server/var/gtfs')
    parser.add_argument('--config', type=Path, default=ROOT / 'tools/gtfs-sync-config.json')
    parser.add_argument('--serve', action='store_true', help='Run continuously; persisted cooldown also applies after restarts')
    parser.add_argument('--apply', action='store_true', help='Apply candidate revisions to the local database with the PHP CLI')
    parser.add_argument('--seed', type=Path, default=ROOT / 'data/gtt-urban-drafts.json')
    args = parser.parse_args()
    config = read_json(args.config)
    downloader = Downloader(args.state_dir, config['cooldownHours'], config['lines'],
                            agencies=config.get('agencies'), route_types=config.get('routeTypes'))
    if args.seed.exists(): downloader.seed(args.seed, read_json(ROOT / 'data/gtt-sync-status.json'))
    while True:
        failed = False
        try: print(json.dumps(downloader.run() if os.environ.get('GTFS_DOWNLOAD_ENABLED', '1') != '0' else {'outcome': 'downloads_paused'}), flush=True)
        except Exception as error:
            failed = True; print(json.dumps({'outcome': 'failed', 'error': str(error)}), flush=True)
        if args.apply:
            try: apply_bundle(args.state_dir)
            except Exception as error:
                failed = True; print(json.dumps({'outcome': 'apply_failed', 'error': str(error)}), flush=True)
        if not args.serve:
            if failed: raise SystemExit(1)
            return
        # Hourly local checks do not cause hourly HTTP downloads. Retry database
        # startup failures sooner while still respecting the download reservation.
        time.sleep(60 if failed else 3600)


if __name__ == '__main__': main()
