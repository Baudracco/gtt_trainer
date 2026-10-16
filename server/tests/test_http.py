"""Real HTTP/DB integration, including CSRF, role guards and publication visibility."""
import http.cookiejar
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid

ROOT=Path(__file__).resolve().parents[2]
PHP=os.environ.get('PHP_BINARY','php')
PORT=8089
URL=f'http://127.0.0.1:{PORT}/api/v1'
count=0

class Client:
    def __init__(self):
        self.opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.csrf=''
    def send(self,path,method='GET',body=None,token=True,origin=None,raw=None,content_type='application/json',extra_headers=None):
        headers=dict(extra_headers or {})
        if method not in ('GET','HEAD'):
            headers['Content-Type']=content_type
            if token:headers['X-CSRF-Token']=self.csrf
        if origin:headers['Origin']=origin
        data=raw if raw is not None else json.dumps(body).encode() if body is not None else None
        request=urllib.request.Request(URL+path,data=data,headers=headers,method=method)
        try:response=self.opener.open(request)
        except urllib.error.HTTPError as error:response=error
        payload=response.read()
        if 'application/json' in response.headers.get('Content-Type',''):
            payload=json.loads(payload)
            if isinstance(payload.get('data'),dict) and 'csrf' in payload['data']:self.csrf=payload['data']['csrf']
        return response.status,payload,response.headers
    def upload(self,path,blob,name='photo.png',mime='image/png',token=True):
        boundary='gtt-'+str(uuid.uuid4())
        raw=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: {mime}\r\n\r\n').encode()+blob+f'\r\n--{boundary}--\r\n'.encode()
        return self.send(path,'POST',raw=raw,token=token,content_type='multipart/form-data; boundary='+boundary)

def check(condition,label):
    global count
    if not condition:raise AssertionError(label)
    count+=1;print('PASS',label,flush=True)

def error(result,status,code):
    check(result[0]==status and result[1]['error']['code']==code,f'{status} {code}')

environment=dict(os.environ,APP_ENV='development',APP_ORIGIN='http://localhost:5173')
server_log=tempfile.TemporaryFile(mode='w+')
server=subprocess.Popen([PHP,'-S',f'127.0.0.1:{PORT}','-t',str(ROOT/'server/public'),str(ROOT/'server/public/index.php')],env=environment,stdout=server_log,stderr=server_log)
try:
    for _ in range(50):
        try:
            with socket.create_connection(('127.0.0.1',PORT),timeout=.2):break
        except OSError:time.sleep(.1)
    password='test-only-password-2026'
    clients={}
    for role in ['viewer','editor','admin']:
        email=f'{role}-{uuid.uuid4()}@test.invalid'
        subprocess.run([PHP,str(ROOT/'server/bin/console.php'),'user:create',email,role],input=(password+'\n').encode(),check=True,stdout=subprocess.DEVNULL,env=environment)
        c=Client();s=c.send('/session');check(s[0]==200 and s[1]['data']['user'] is None,'Anonymous session bootstrap')
        cookie=s[2].get('Set-Cookie','');check('HttpOnly' in cookie and 'SameSite=Strict' in cookie,'Cookie security attributes')
        error(c.send('/login','POST',{'email':email,'password':password},token=False),403,'csrf_failed')
        error(c.send('/login','POST',{'email':email,'password':password},origin='https://unexpected.invalid'),403,'csrf_failed')
        result=c.send('/login','POST',{'email':email,'password':password});check(result[0]==200 and result[1]['data']['user']['role']==role,'Authenticated '+role)
        clients[role]=c
    anonymous=Client();anonymous.send('/session')
    error(anonymous.send('/routes','POST',{}),401,'authentication_required')
    error(clients['viewer'].send('/routes','POST',{}),403,'permission_denied')
    error(anonymous.send('/sources/gtt'),401,'authentication_required')
    error(clients['viewer'].send('/sources/gtt'),403,'permission_denied')
    check(clients['editor'].send('/sources/gtt')[0]==200,'Editor can inspect GTFS synchronization status')
    error(anonymous.send('/sources/gtt/gtt:'+('a'*64)+'/document'),401,'authentication_required')
    doc={'line':'HTTP-'+str(uuid.uuid4())[:8],'name':'Synthetic HTTP test','direction':'andata','kind':'service','color':'#2463eb',
         'geometry':{'type':'LineString','coordinates':[[7.6,45],[7.61,45]]},'source':{'name':'Synthetic test fixture'},
         'stops':[],'notes':'<script>alert(1)</script>','instructions':[{'offsetM':0,'text':'Depart'},{'offsetM':700,'text':'Arrive'}]}
    editor=clients['editor'];admin=clients['admin']
    error(editor.send('/routes?trash=1'),422,'validation_failed')
    check(editor.send('/routes/trash')[0]==200,'Trash uses a friendly path')
    error(anonymous.send('/routes/trash'),401,'authentication_required')
    import base64
    photo=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==')
    error(anonymous.upload('/media/photos',photo),401,'authentication_required')
    error(clients['viewer'].upload('/media/photos',photo),403,'permission_denied')
    error(editor.upload('/media/photos',photo,token=False),403,'csrf_failed')
    error(editor.upload('/media/photos',b'<svg xmlns="http://www.w3.org/2000/svg"/>',name='bad.jpg',mime='image/jpeg'),415,'unsupported_media')
    asset=editor.upload('/media/photos',photo)[1]['data'];photo_id=asset['id']
    check(asset['kind']=='photo' and asset['mime']=='image/jpeg','Photo is decoded and normalized independently of client MIME/name')
    check(editor.send('/media/'+photo_id)[1].startswith(b'\xff\xd8'),'Editor can preview the persisted normalized JPEG')
    error(anonymous.send('/media/'+photo_id),404,'not_found')
    with tempfile.TemporaryDirectory() as directory:
        video_path=Path(directory)/'fixture.mp4'
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=blue:s=160x120:d=1','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',str(video_path)],check=True)
        video=video_path.read_bytes()
    video_asset=editor.upload('/media/videos',video,name='whole-route.mp4',mime='video/mp4')[1]['data'];video_id=video_asset['id']
    check(video_asset['metadata']['durationSeconds']>0 and video_asset['kind']=='video','Complete video is inspected and persisted')
    error(anonymous.send('/media/'+video_id),404,'not_found')
    result=editor.send('/media/'+video_id,extra_headers={'Range':'bytes=0-31'})
    check(result[0]==206 and result[1]==video[:32] and result[2]['Content-Range'].startswith('bytes 0-31/'),'Video byte ranges support seeking without loading the whole file')
    error(editor.send('/media/'+video_id,extra_headers={'Range':'bytes=999999999-'}),416,'invalid_range')
    doc['instructions'][0]['photos']=[{'id':photo_id,'caption':'Esquina <script>control</script>','credit':'Synthetic CI author'}]
    doc['instructions'][0]['notes']='Written landmark for the turn'
    doc['video']={'id':video_id,'caption':'Full synthetic route','credit':''}
    invalid=dict(doc,video={'id':photo_id})
    error(editor.send('/routes','POST',invalid),422,'invalid_media')
    error(editor.send('/routes','POST',raw=b'{bad json'),400,'invalid_json')
    error(editor.send('/routes','POST',raw=b'[]'),400,'invalid_json')
    result=editor.send('/routes','POST',doc);check(result[0]==201,'Create route via HTTP');draft=result[1]['data'];rid=draft['id']
    error(anonymous.send('/routes/'+rid),404,'not_found')
    error(editor.send('/routes/'+rid+'/publish','POST',{'expectedVersion':draft['version'],'revisionId':draft['revisionId'],'verified':True}),403,'permission_denied')
    result=editor.send('/routes/'+rid+'/review','POST',{'expectedVersion':draft['version'],'revisionId':draft['revisionId']});check(result[0]==200,'Submit for review');review=result[1]['data']
    error(admin.send('/routes/'+rid+'/publish','POST',{'expectedVersion':review['version'],'revisionId':review['revisionId']}),422,'publication_incomplete')
    result=admin.send('/routes/'+rid+'/publish','POST',{'expectedVersion':review['version'],'revisionId':review['revisionId'],'verified':True});check(result[0]==200,'Admin publishes reviewed revision');published=result[1]['data']
    result=anonymous.send('/routes/'+rid);check(result[0]==200 and result[1]['data']['revisionId']==published['revisionId'],'Anonymous can browse publication')
    check(anonymous.send('/media/'+photo_id)[0]==200 and anonymous.send('/media/'+video_id,method='HEAD')[0]==200,'Published media follows current route visibility and supports HEAD')
    result=anonymous.send(f'/routes/{rid}/revisions/{published["revisionId"]}/report/it.pdf');check(result[0]==200 and result[1].startswith(b'%PDF-'),'Download actual PDF over HTTP')
    result=anonymous.send(f'/routes/{rid}/revisions/{published["revisionId"]}/report/es.html');check(result[0]==200 and b'<script>' not in result[1] and b'&lt;script&gt;' in result[1],'Report HTML escapes observations')
    check(b'data:image/jpeg;base64,' in result[1] and b'Written landmark' in result[1] and b'/api/v1/media/' in result[1],'Reports include turn photos, written references, credits and video link')
    edited=dict(doc,notes='New draft',expectedVersion=published['version']);result=editor.send(f'/routes/{rid}/draft','PUT',edited);check(result[0]==200,'Save new draft');new=result[1]['data']
    error(editor.send(f'/routes/{rid}/draft','PUT',edited),409,'version_conflict')
    error(anonymous.send(f'/routes/{rid}/revisions/{new["revisionId"]}'),404,'not_found')
    error(anonymous.send(f'/routes/{rid}/revisions/{new["revisionId"]}/streetview/0'),404,'not_found')
    error(editor.send(f'/routes/{rid}/revisions/{new["revisionId"]}/streetview/999999999'),422,'validation_failed')
    check(editor.send(f'/routes/{rid}/revisions/{new["revisionId"]}')[0]==200,'Editor can retrieve a revision with a friendly path')
    bad=dict(doc,geometry={'type':'LineString','coordinates':[[200,45],[7,45]]})
    before=len(editor.send('/routes')[1]['data'])
    error(editor.send('/imports','POST',{'documents':[doc,bad]}),422,'validation_failed')
    check(len(editor.send('/routes')[1]['data'])==before,'Invalid batch leaves no partial imports')
    error(editor.send('/routes/not-a-uuid'),422,'validation_failed')
    logout=editor.send('/logout','POST',{});check(logout[0]==200,'Logout rotates session')
    error(editor.send('/routes','POST',doc),401,'authentication_required')
    wrong=Client();wrong.send('/session')
    for i in range(10):error(wrong.send('/login','POST',{'email':'unknown-throttle@test.invalid','password':'wrong'}),401,'invalid_credentials')
    limited=wrong.send('/login','POST',{'email':'unknown-throttle@test.invalid','password':'wrong'})
    error(limited,429,'rate_limited');check(int(limited[2]['Retry-After'])>0,'Rate limit provides Retry-After')
    for i in range(241):
        response=anonymous.send('/routes')
        if response[0]==429:break
    error(response,429,'rate_limited')
    check(bool(response[1]['trace_id']) and response[2].get('X-Trace-Id')==response[1]['trace_id'],'Trace IDs connect response and logs')
    print(f'{count} HTTP checks passed.')
except BaseException:
    server_log.seek(0);print(server_log.read(),file=sys.stderr);raise
finally:
    server.terminate();server.wait(timeout=10)
    server_log.close()
