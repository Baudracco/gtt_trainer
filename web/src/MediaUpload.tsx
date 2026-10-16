import {useEffect, useRef, useState} from 'react';
import {uploadMedia} from './api';
import {errorText, type Translate} from './i18n';
import type {MediaReference} from './model';

export function MediaUpload({kind,onUpload,onBusy,t}:{kind:'photo'|'video';onUpload:(media:MediaReference)=>void;onBusy:(busy:boolean)=>void;t:Translate}) {
  const [busy,setBusy]=useState(false),[percent,setPercent]=useState(0),[error,setError]=useState('');
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  async function upload(file:File) {
    setError('');setPercent(0);
    if(file.size>(kind==='photo'?12*1024*1024:1024*1024*1024)){setError(t('media_too_large'));return;}
    const abort=new AbortController();controller.current=abort;setBusy(true);onBusy(true);
    try {const media=await uploadMedia(file,kind,setPercent,abort.signal);if(!abort.signal.aborted)onUpload({id:media.id,caption:'',credit:''});}
    catch(error){if(!abort.signal.aborted)setError(errorText(error,t));}
    finally {if(!abort.signal.aborted){setBusy(false);onBusy(false);}controller.current=null;}
  }
  return <div className="media-upload"><label className="button upload">{t(kind==='photo'?'uploadPhoto':'uploadVideo')}<input aria-label={t(kind==='photo'?'uploadPhoto':'uploadVideo')} type="file" disabled={busy} accept={kind==='photo'?'image/jpeg,image/png,image/webp':'video/mp4,video/webm'} onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);e.target.value='';}}/></label>
    <small>{t(kind==='photo'?'photoHelp':'videoHelp')}</small>{busy&&<div role="status"><progress max={100} value={percent}/><span>{Math.round(percent)}% · {t('mediaProcessing')}</span></div>}{error&&<p className="alert error" role="alert">{error}</p>}
  </div>;
}
