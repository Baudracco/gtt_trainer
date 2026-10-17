"""Prove backup and isolated HTTP/media/PDF restore in a disposable Compose CI project."""
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.request
import uuid

if os.environ.get('GTT_ISOLATED_CI')!='1':raise SystemExit('Use only in a disposable CI project with GTT_ISOLATED_CI=1')
suffix=uuid.uuid4().hex[:8]
database='gtt_restore_ci_'+suffix
volume='gtt-trainer-ci-restore-'+suffix
container='gtt-trainer-ci-restore-api-'+suffix
source='http://localhost:8080/api/v1'
restored='http://localhost:18089/api/v1'


def run(args,**kwargs):
    """Run only explicit subprocess arguments; never place credentials in a shell or command string."""
    return subprocess.run(args,check=True,stdout=subprocess.PIPE,**kwargs).stdout


def action(*args):return json.loads(run(['docker','compose','run','--rm','--no-deps','backups',*args]))


def client():return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def request(opener,origin,path,method='GET',body=None,token='',headers=None):
    values=dict(headers or {})
    if body is not None:values.update({'Content-Type':'application/json','X-CSRF-Token':token})
    response=opener.open(urllib.request.Request(origin+path,method=method,headers=values,data=json.dumps(body).encode()if body is not None else None),timeout=60)
    raw=response.read()
    return response.status,json.loads(raw)['data']if'application/json'in response.headers.get('Content-Type','')else raw


try:
    run(['docker','compose','stop','backups'])
    fixture=json.loads(Path('web/e2e/fixtures/depot.json').read_bytes())
    script="""import hashlib,json,sys
from pathlib import Path
f=json.load(sys.stdin);root=Path('/var/www/server/var/references');root.mkdir(exist_ok=True)
for kind,data,key in [('parts',f['movements'],f['index']['parts'][0]['sha256']),('blocks',f['blocks'],f['index']['blocksSha256'])]:
 (root/kind).mkdir(exist_ok=True);raw=(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\\n').encode();assert hashlib.sha256(raw).hexdigest()==key;(root/kind/(key+'.json')).write_bytes(raw)
(root/'index.json').write_text(json.dumps(f['index']))
"""
    run(['docker','compose','exec','-T','api','python3','-c',script],input=json.dumps(fixture).encode())
    reservation=run(['docker','compose','exec','-T','api','cat','var/gtfs/state.json'])
    published=request(client(),source,'/routes')[1]
    assert len(published)==1
    route=published[0]
    created=action('once');assert created['outcome']=='created'
    name=created['name'];assert re.fullmatch(r'gtt-backup-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}',name)
    assert action('verify','--bundle','/backups/'+name)['outcome']=='verified'
    output=json.loads(run(['docker','compose','run','--rm','--no-deps','-v',volume+':/restore','backups','restore','--bundle','/backups/'+name,'--database',database,'--output-dir','/restore']))
    assert output['outcome']=='restored'and output['counts']['route_variants']>=633
    check_script="""import hashlib,json,sys
from pathlib import Path
sys.path.insert(0,'/opt/gtt/tools')
from datetime import timedelta
from sync_gtfs import Downloader,parse_stamp
from validate_private_references import validate
p=Path('/restore');assert hashlib.sha256((p/'gtfs/state.json').read_bytes()).hexdigest()==sys.argv[1]
assert validate(p/'references')['movements']==3
class NoHTTP:
 def open(self,*a,**k):raise AssertionError('Restore must not cause a duplicate download')
before=(p/'gtfs/state.json').read_bytes();state=json.loads(before)
d=Downloader(p/'gtfs',agencies=['U'],route_types=['0','3'],opener=NoHTTP(),clock=lambda:parse_stamp(state['lastAttemptAt'])+timedelta(hours=12))
assert d.run()['outcome']=='cooldown';assert(p/'gtfs/state.json').read_bytes()==before
"""
    run(['docker','compose','run','--rm','--no-deps','-v',volume+':/restore','--entrypoint','python3','backups','-c',check_script,hashlib.sha256(reservation).hexdigest()])
    run(['docker','compose','run','-d','--no-deps','--name',container,'-e','DATABASE_DSN=pgsql:host=db;port=5432;dbname='+database,'-e','MEDIA_ACCEL_REDIRECT=0','-v',volume+':/var/www/server/var','-p','127.0.0.1:18089:8089','api','php','-S','0.0.0.0:8089','-t','public','public/index.php'])
    restored_client=client()
    for _ in range(60):
        try:session=request(restored_client,restored,'/session')[1];break
        except(OSError,ValueError):time.sleep(1)
    else:raise AssertionError('Isolated restore HTTP server did not start')
    visible=request(restored_client,restored,'/routes')[1]
    assert len(visible)==1 and visible[0]['revisionId']==route['revisionId']and visible[0]['geometry']==route['geometry']
    photo=route['instructions'][0]['photos'][0]['id'];video=route['video']['id']
    assert request(restored_client,restored,'/media/'+photo)[1].startswith(b'\xff\xd8')
    original_range=request(client(),source,'/media/'+video,headers={'Range':'bytes=0-31'})
    restored_range=request(restored_client,restored,'/media/'+video,headers={'Range':'bytes=0-31'})
    assert original_range==restored_range and restored_range[0]==206
    request(restored_client,restored,'/login','POST',{'email':'compose@test.invalid','password':'gtt-compose-test-only'},session['csrf'])
    assert request(restored_client,restored,'/references/depot')[1]['movementCount']==3
    pdf=request(restored_client,restored,'/routes/'+route['id']+'/revisions/'+route['revisionId']+'/report/it.pdf')[1]
    assert pdf.startswith(b'%PDF-')
    immutable="""require 'vendor/autoload.php';$db=GttTrainer\\Database::connect();$id=$db->query(\"SELECT published_revision_id FROM route_variants WHERE published_revision_id IS NOT NULL LIMIT 1\")->fetchColumn();$db->beginTransaction();try{$db->exec(\"UPDATE route_revisions SET document='{}' WHERE id='\".$id.\"'\");$db->rollBack();exit(1);}catch(PDOException){$db->rollBack();}"""
    run(['docker','compose','run','--rm','--no-deps','-e','DATABASE_DSN=pgsql:host=db;port=5432;dbname='+database,'api','php','-r',immutable])
    refused=subprocess.run(['docker','compose','run','--rm','--no-deps','backups','restore','--bundle','/backups/'+name,'--database','gtt_trainer','--output-dir','/tmp/never-live'],stdout=subprocess.PIPE)
    assert refused.returncode!=0
    assert request(client(),source,'/routes')[1][0]['revisionId']==route['revisionId']
    assert run(['docker','compose','exec','-T','api','cat','var/gtfs/state.json'])==reservation
    print('Backup drill: snapshot counts, private references, media/ranges, PDF, immutable publications and unchanged GTFS cooldown restored in isolation.')
finally:
    subprocess.run(['docker','rm','-f',container],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    subprocess.run(['docker','volume','rm',volume],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    subprocess.run(['docker','compose','exec','-T','db','psql','-U','gtt_trainer','-d','postgres','-v','ON_ERROR_STOP=1'],input=('DROP DATABASE IF EXISTS "'+database+'";\n').encode(),stdout=subprocess.DEVNULL)
    subprocess.run(['docker','compose','start','backups'],stdout=subprocess.DEVNULL)
