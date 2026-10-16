import {useRef,useState} from 'react';
import {mediaUrl} from './api';
import type {Translate} from './i18n';

/** Native video controls retain seeking; playback rate never changes route geometry. */
export function RouteVideo({id,t}:{id:string;t:Translate}) {
  const node=useRef<HTMLVideoElement>(null),[rate,setRate]=useState(1);
  return <div className="route-video"><video ref={node} aria-label={t('routeVideo')} controls playsInline preload="metadata" src={mediaUrl(id)} onLoadedMetadata={()=>{if(node.current)node.current.playbackRate=rate;}}/><label>{t('playbackSpeed')}<select value={rate} onChange={e=>{const value=Number(e.target.value);setRate(value);if(node.current)node.current.playbackRate=value;}}>{[.25,.5,1,1.5,2,4].map(value=><option key={value} value={value}>{value}×</option>)}</select></label></div>;
}
