"""Exercise the actual Docker/Nginx/PHP/PostGIS package in a disposable CI database."""
import http.cookiejar
import json
from pathlib import Path
import time
import urllib.request

base='http://localhost:8080/api/v1'
opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
token=''

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
assert len(routes)==139 and all(r['status']=='draft' for r in routes),'Seeded candidate count/status mismatch'
status=request('/sources/gtt')
assert status['archiveSha256']==json.loads(Path('data/gtt-gerbido-drafts.manifest.json').read_text())['sha256'],'Automatic sync lost feed provenance'
assert len(status['issues'])==11 and all(i['state']=='rejected' for i in status['issues']),'Rejected GTFS patterns not retained'
first=routes[0]
source=json.loads(Path('data/gtt-gerbido-drafts.json').read_text())[0]
assert first['geometry']==source['geometry'],'Compose import changed source geometry'
for route in routes:
    assert route['stops']==sorted(route['stops'],key=lambda s:s['offsetM']),'Stops reordered'
first['instructions']=[{'offsetM':0,'text':'CI-only departure','notes':'Synthetic instructions in disposable test DB','kind':'depart'}, {'offsetM':0,'text':'CI-only arrival placeholder','notes':'Never published to a user database','kind':'arrive'}]
first['expectedVersion']=first['version']
draft=request('/routes/'+first['id']+'/draft','PUT',first)
review=request('/routes/'+first['id']+'/review','POST',{'expectedVersion':draft['version'],'revisionId':draft['revisionId']})
published=request('/routes/'+first['id']+'/publish','POST',{'expectedVersion':review['version'],'revisionId':review['revisionId'],'verified':True})
pdf=request('/routes/'+first['id']+'/report?format=pdf&lang=it')
assert pdf.startswith(b'%PDF-'),'Compose did not produce a PDF'
request('/logout','POST',{})
visible=request('/routes')
assert len(visible)==1 and visible[0]['revisionId']==published['revisionId'],'Anonymous visibility incorrect'
with opener.open('http://localhost:8080/',timeout=10) as response:
    html=response.read().decode()
    assert 'GTT Trainer' in html and '/assets/' in html,'Production frontend missing'
    assert "worker-src 'self' blob:" in response.headers['Content-Security-Policy'],'Map worker policy missing'
print('Docker package: 139 draft imports, exact geometry, ordered stops, review/publication, PDF and public frontend passed.')
