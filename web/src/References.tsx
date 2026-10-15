import {useEffect, useState} from 'react';
import {emptyRoute, type RouteDocument} from './model';
import type {Translate} from './i18n';
type Reference = {id:string;line:string;pages:number[];uscita:string;rientro:string;notes?:string};
type ChangePost = {line:string;place:string;access:string;notes:string;direction:null};
type Catalog = {title:string;version:string;effectiveFrom:string;source:string;sha256:string;references:Reference[]};
export function References({t,onAuthor}:{t:Translate;onAuthor?: (doc:RouteDocument)=>void}) {
  const [catalog,setCatalog] = useState<Catalog | null>(null), [changes,setChanges] = useState<ChangePost[]>([]), [search,setSearch] = useState(''), [error,setError] = useState(false);
  useEffect(() => {let live=true;void Promise.all([fetch('/data/depot-references.json').then(r=>{if(!r.ok)throw Error();return r.json();}),fetch('/data/gerbido-change-posts.json').then(r=>{if(!r.ok)throw Error();return r.json();})]).then(([c,p])=>{if(live){setCatalog(c);setChanges(p.posts);}}).catch(()=>{if(live)setError(true);});return()=>{live=false;};},[]);
  const query=search.toLocaleLowerCase();
  function author(ref:Reference,which:'uscita'|'rientro') {
    const doc=emptyRoute(); doc.line=ref.line;doc.name=`${ref.line} · ${which.toUpperCase()} · p. ${ref.pages.join(', ')}`;
    doc.direction='none';doc.kind=which==='uscita'?'depot_out':'depot_in';doc.notes=ref[which];
    doc.source={name:`${catalog?.title} · ${catalog?.version} · p. ${ref.pages.join(', ')}`,url:'',license:'User-provided operational reference; original document is not redistributed.',retrievedAt:catalog?.effectiveFrom??''};
    onAuthor?.(doc);
  }
  return <section className="references"><div className="eyebrow">GERBIDO · DAPER</div><h1>{t('references')}</h1><input type="search" aria-label={t('search')} placeholder={t('search')} value={search} onChange={e=>setSearch(e.target.value)}/>
    {error && <p className="alert error">{t('error')}</p>}
    <h2>{t('exchange')}</h2><p className="muted">{t('noDirection')}</p>
    {changes.filter(p=>`${p.line} ${p.place} ${p.access}`.toLowerCase().includes(query)).map((p,i)=><article className="reference-card" key={i}><div className="section-heading"><span className="line-badge neutral">{p.line}</span><strong>{p.place}</strong></div><p>{t('access')}: <b>{p.access||'—'}</b></p>{p.notes&&<small className="muted">{p.notes}</small>}</article>)}
    <h2>DAPER · {catalog?.version}</h2><p className="muted">{catalog?.effectiveFrom} · {t('noGeometry')}</p>
    {catalog?.references.filter(r=>`${r.line} ${r.uscita} ${r.rientro}`.toLocaleLowerCase().includes(query)).map(ref=><details key={ref.id}><summary><b>{ref.line}</b> · {t('sourcePage')} {ref.pages.join(', ')}</summary>{(['uscita','rientro']as const).map(which=><div key={which}><h3>{which.toUpperCase()}</h3><p className="source-text">{ref[which]||'—'}</p>{onAuthor&&ref[which]&&<button onClick={()=>author(ref,which)}>{t('new')} · {which.toUpperCase()}</button>}</div>)}</details>)}
  </section>;
}
