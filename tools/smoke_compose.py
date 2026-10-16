"""Exercise the actual Docker/Nginx/PHP/PostGIS package in a disposable CI database."""
import http.cookiejar
import base64
import json
from pathlib import Path
import subprocess
import time
import urllib.request

base='http://localhost:8080/api/v1'
opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
token=''

def upload(path,content,name,mime):
    boundary='gtt-compose-boundary'
    raw=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: {mime}\r\n\r\n').encode()+content+f'\r\n--{boundary}--\r\n'.encode()
    req=urllib.request.Request(base+path,method='POST',data=raw,headers={'Content-Type':'multipart/form-data; boundary='+boundary,'X-CSRF-Token':token})
    with opener.open(req,timeout=60) as response:return json.load(response)['data']

def request(path,method='GET',data=None):
    global token
    headers={}
    if method!='GET':headers={'Content-Type':'application/json','X-CSRF-Token':token}
    req=urllib.request.Request(base+path,method=method,headers=headers,data=json.dumps(data).encode() if data is not None else None)
    with opener.open(req,timeout=60) as response:
        raw=response.read()
        if 'application/json' not in response.headers.get('Content-Type',''):return raw
        result=json.loads(raw)['data']
        if isinstance(result,dict) and 'csrf' in result:token=result['csrf']
        return result

for attempt in range(90):
    try:
        request('/session');break
    except (OSError,ValueError):time.sleep(1)
else:raise AssertionError('Compose API did not become ready')

request('/login','POST',{'email':'compose@test.invalid','password':'gtt-compose-test-only'})
routes=request('/routes')
manifest=json.loads(Path('data/gtt-urban-drafts.manifest.json').read_text())
assert len(routes)==manifest['routes'] and all(r['status']=='draft' for r in routes),'Seeded candidate count/status mismatch'
status=request('/sources/gtt')
assert status['archiveSha256']==manifest['sha256'],'Automatic sync lost feed provenance'
assert len(status['issues'])==len(manifest['skipped']) and all(i['state']=='rejected' for i in status['issues']),'Rejected GTFS patterns not retained'
first=routes[0]
photo=upload('/media/photos',base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg=='),'corner.png','image/png')
subprocess.run(['docker','compose','exec','-T','api','ffmpeg','-v','error','-f','lavfi','-i','color=c=blue:s=160x120:d=1','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-y','/tmp/gtt-smoke.mp4'],check=True)
video_bytes=subprocess.check_output(['docker','compose','exec','-T','api','cat','/tmp/gtt-smoke.mp4'])
video=upload('/media/videos',video_bytes,'whole-route.mp4','video/mp4')
sources=json.loads(Path('data/gtt-urban-drafts.json').read_text())
source=next(doc for doc in sources if doc['line']==first['line'] and doc['name']==first['name'])
assert first['geometry']==source['geometry'],'Compose import changed source geometry'
for route in routes:
    assert route['stops']==sorted(route['stops'],key=lambda s:s['offsetM']),'Stops reordered'
first['instructions']=[{'offsetM':0,'text':'CI-only departure','notes':'Synthetic instructions in disposable test DB','kind':'depart'}, {'offsetM':0,'text':'CI-only arrival placeholder','notes':'Never published to a user database','kind':'arrive'}]
first['instructions'][0]['photos']=[{'id':photo['id'],'caption':'Synthetic corner','credit':'CI fixture'}]
first['video']={'id':video['id'],'caption':'Synthetic route video','credit':'CI fixture'}
first['expectedVersion']=first['version']
draft=request('/routes/'+first['id']+'/draft','PUT',first)
review=request('/routes/'+first['id']+'/review','POST',{'expectedVersion':draft['version'],'revisionId':draft['revisionId']})
published=request('/routes/'+first['id']+'/publish','POST',{'expectedVersion':review['version'],'revisionId':review['revisionId'],'verified':True})
pdf=request('/routes/'+first['id']+'/revisions/'+published['revisionId']+'/report/it.pdf')
assert pdf.startswith(b'%PDF-'),'Compose did not produce a PDF'
request('/logout','POST',{})
visible=request('/routes')
assert len(visible)==1 and visible[0]['revisionId']==published['revisionId'],'Anonymous visibility incorrect'
assert request('/media/'+photo['id']).startswith(b'\xff\xd8'),'Nginx authorized media offload failed'
req=urllib.request.Request(base+'/media/'+video['id'],headers={'Range':'bytes=0-31'})
with opener.open(req,timeout=10) as response:
    assert response.status==206 and response.read()==video_bytes[:32],'Nginx byte-range playback failed'
with opener.open(urllib.request.Request(base+'/media/'+video['id'],method='HEAD'),timeout=10) as response:
    assert response.status==200 and int(response.headers['Content-Length'])==len(video_bytes),'Nginx HEAD media failed'
try:opener.open('http://localhost:8080/_protected_media/'+photo['id']+'.jpg',timeout=10);raise AssertionError('Internal media URL leaked')
except urllib.error.HTTPError as error:assert error.code==404
with opener.open('http://localhost:8080/',timeout=10) as response:
    html=response.read().decode()
    assert 'GTT Trainer' in html and '/assets/' in html,'Production frontend missing'
    assert "worker-src 'self' blob:" in response.headers['Content-Security-Policy'],'Map worker policy missing'
print(f'Docker package: {manifest["routes"]} draft imports, exact geometry, ordered stops, review/publication, PDF and public frontend passed.')
