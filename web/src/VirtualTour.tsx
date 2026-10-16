import {useEffect,useMemo,useRef,useState} from 'react';
import * as api from './api';
import {measure,pointAt,bearing,distance} from './geometry';
import type {Coordinate,RouteSnapshot} from './model';
import {MediaGallery} from './MediaGallery';
import {StreetPhoto} from './StreetPhoto';
import {advanceVirtual,type StreetFrame} from './virtual';
import type {Translate} from './i18n';

/**
 * Study player anchored to one immutable route revision. Route progress is local;
 * public street photos are optional context. GPS and virtual playback are mutually
 * exclusive in App. Debouncing and geographic server cache bound provider traffic.
 */
export function VirtualTour({route,onPosition,close,follow,setFollow,t}:{route:RouteSnapshot;onPosition:(point:Coordinate|null)=>void;close:()=>void;follow:boolean;setFollow:(value:boolean)=>void;t:Translate}) {
  const measured=useMemo(()=>measure(route.geometry.coordinates),[route]);
  const [offset,setOffset]=useState(0),[speed,setSpeed]=useState(30),[playing,setPlaying]=useState(false);
  const [frame,setFrame]=useState<StreetFrame|null>(null),[loading,setLoading]=useState(true),[imageBusy,setImageBusy]=useState(false),[photoIndex,setPhotoIndex]=useState(0),[retry,setRetry]=useState(0);
  const sample=Math.min(Math.floor(measured.length),Math.floor(offset/25)*25);
  const point=useMemo(()=>pointAt(measured,offset),[measured,offset]);
  const heading=bearing(pointAt(measured,Math.max(0,offset-1)),pointAt(measured,Math.min(measured.length,offset+5)));
  const candidate=frame?.photos[photoIndex]??null;
  const photo=candidate&&distance(point,candidate.coordinates)<=60?candidate:null;
  const next=route.instructions.find(step=>step.offsetM>offset+1);
  const landmark=route.instructions.filter(step=>Math.abs(step.offsetM-offset)<40&&step.photos?.length).sort((a,b)=>Math.abs(a.offsetM-offset)-Math.abs(b.offsetM-offset))[0];
  const setImageLoading=useRef(setImageBusy).current;
  useEffect(()=>{onPosition(point);},[point,onPosition]);
  useEffect(()=>()=>onPosition(null),[onPosition]);
  useEffect(()=>{
    const controller=new AbortController();let alive=true;
    const timer=setTimeout(()=>{
      setLoading(true);
      void api.request<StreetFrame>(`/routes/${route.id}/revisions/${route.revisionId}/streetview/${sample}`,'GET',undefined,controller.signal)
        .then(result=>{if(alive){setFrame(result);setPhotoIndex(0);}})
        .catch(()=>{if(alive)setFrame({provider:'panoramax',status:'unavailable',photos:[],coordinate:pointAt(measured,sample),bearing:0,length:measured.length,offsetM:sample});})
        .finally(()=>{if(alive)setLoading(false);});
    },250);
    return()=>{alive=false;clearTimeout(timer);controller.abort();};
  },[route.id,route.revisionId,sample,measured,retry]);
  useEffect(()=>{if(frame?.status!=='loading')return;const timer=setTimeout(()=>setRetry(value=>value+1),1500);return()=>clearTimeout(timer);},[frame]);
  useEffect(()=>{
    if(!playing||loading||imageBusy)return;
    let previous=performance.now();
    const timer=setInterval(()=>{const now=performance.now();const elapsed=(now-previous)/1000;previous=now;setOffset(value=>advanceVirtual(value,speed,elapsed,measured.length));},100);
    return()=>clearInterval(timer);
  },[playing,loading,imageBusy,speed,measured.length]);
  useEffect(()=>{if(offset>=measured.length)setPlaying(false);},[offset,measured.length]);
  useEffect(()=>{if(!photo)setImageBusy(false);},[photo]);
  function jump(value:number){setPlaying(false);setOffset(Math.max(0,Math.min(measured.length,value)));}
  return <section className="virtual-tour" aria-label={t('virtualTour')}><div className="section-heading"><h2>{t('virtualTour')}</h2><button onClick={close}>{t('close')}</button></div>
    {photo?<StreetPhoto photo={photo} bearing={heading} onLoading={setImageLoading} t={t}/>:<div className="coverage-gap" role="status">{loading?t('streetLoading'):t(frame?.status==='unavailable'?'streetUnavailable':frame?.status==='rate_limited'?'streetBudget':'streetEmpty')}{landmark&&<MediaGallery photos={landmark.photos??[]} fallback={landmark.text}/>}</div>}
    <div className="photo-attribution">{photo&&<><a href={photo.sourceUrl} target="_blank" rel="noreferrer">Panoramax · {photo.credit}</a> · {photo.licenseUrl?<a href={photo.licenseUrl} target="_blank" rel="noreferrer">{photo.license}</a>:photo.license}<span> · {photo.capturedAt.slice(0,10)} · {Math.round(distance(point,photo.coordinates))} m · {photo.panorama?'360°':t('planePhoto')}</span></>}{loading&&<span role="status"> · {t('streetLoading')}</span>}</div>
    {frame&&frame.photos.length>1&&<div className="photo-options"><button disabled={photoIndex===0} onClick={()=>setPhotoIndex(value=>value-1)}>{t('previousPhoto')}</button><span>{photoIndex+1}/{frame.photos.length}</span><button disabled={photoIndex>=frame.photos.length-1} onClick={()=>setPhotoIndex(value=>value+1)}>{t('nextPhoto')}</button></div>}
    <label className="tour-progress">{t('routeProgress')} · {Math.round(offset)} / {Math.round(measured.length)} m<input aria-label={t('routeProgress')} type="range" min={0} max={measured.length} step={1} value={offset} onChange={e=>jump(Number(e.target.value))}/></label>
    <div className="tour-controls"><button disabled={offset===0} onClick={()=>jump(offset-20)}>−20 m</button><button className="primary" disabled={offset>=measured.length} onClick={()=>setPlaying(value=>!value)}>{t(playing?'pauseTour':'playTour')}</button><button disabled={offset>=measured.length} onClick={()=>jump(offset+20)}>+20 m</button><label>{t('virtualSpeed')}<select aria-label={t('virtualSpeed')} value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{[5,15,30,60,120].map(value=><option key={value} value={value}>{value} km/h</option>)}</select></label><button disabled={!next} onClick={()=>jump(next?.offsetM??measured.length)}>{t('nextInstruction')}</button></div>
    <label className="check"><input type="checkbox" checked={follow} onChange={e=>setFollow(e.target.checked)}/>{t('followTour')}</label>
    <p className="virtual-instruction"><strong>{next?.text??t(offset>=measured.length?'arrive':'continueRoute')}</strong>{next?.notes&&<span>{next.notes}</span>}</p><small>{t('virtualHelp')}</small>
  </section>;
}
