import {useEffect, useRef, useState} from 'react';
import maplibregl, {type Map as MapInstance, type GeoJSONSource, type StyleSpecification} from 'maplibre-gl';
import basemap from './basemap.json';
import type {Coordinate, RouteDocument, RouteSnapshot, StopGroup} from './model';
import type {Translate} from './i18n';
import 'maplibre-gl/dist/maplibre-gl.css';

type Props = {routes: RouteSnapshot[]; active: string; groups: StopGroup[]; showStops: boolean; edit: RouteDocument | null; drawMode: 'vertex' | 'stop' | null; onPoint: (p: Coordinate) => void; onStop: (id: string) => void; position: Coordinate | null; follow: boolean; t: Translate};
export function RouteMap(props: Props) {
  const node = useRef<HTMLDivElement>(null), map = useRef<MapInstance | null>(null), latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
  const tileUrl = import.meta.env.VITE_TILE_URL || '';
  useEffect(() => {
    if (!node.current) return;
    let m: MapInstance;
    try {
      m = new maplibregl.Map({container: node.current, center: [7.63, 45.06], zoom: 11, style: tileUrl ? {
        version: 8,
        sources: tileUrl ? {basemap: {type: 'raster', tiles: [tileUrl], tileSize: 256, attribution: import.meta.env.VITE_TILE_ATTRIBUTION || '© OpenStreetMap contributors'}} : {},
        layers: [{id: 'background', type: 'background', paint: {'background-color': '#e8edf1'}}, ...(tileUrl ? [{id: 'basemap', type: 'raster' as const, source: 'basemap'}] : [])],
      } : basemap as StyleSpecification});
      m.addControl(new maplibregl.NavigationControl(), 'top-right');
      m.on('style.load', () => {
        for (const source of ['routes','stops','position','edit','vertices']) m.addSource(source, {type: 'geojson', data: {type: 'FeatureCollection', features: []}});
        m.addLayer({id: 'route-outline', type: 'line', source: 'routes', paint: {'line-color': '#fff', 'line-width': ['case',['get','active'],10,6], 'line-opacity': .85}});
        m.addLayer({id: 'routes', type: 'line', source: 'routes', layout: {'line-cap': 'round','line-join': 'round'}, paint: {'line-color': ['get','color'], 'line-width': ['case',['get','active'],6,3], 'line-opacity': ['case',['get','active'],1,.65]}});
        m.addLayer({id: 'edit', type: 'line', source: 'edit', paint: {'line-color': '#ad2a71', 'line-width': 5, 'line-dasharray': [2,1]}});
        m.addLayer({id: 'vertices', type: 'circle', source: 'vertices', paint: {'circle-color': '#ad2a71','circle-radius': 4,'circle-stroke-width': 1,'circle-stroke-color': '#fff'}});
        m.addLayer({id: 'stops', type: 'circle', source: 'stops', paint: {'circle-radius': ['case',['get','exchange'],9,6], 'circle-color': ['case',['get','exchange'],'#f5ad35',['get','common'],'#8060ce','#fff'], 'circle-stroke-width': 2,'circle-stroke-color': '#253858'}});
        m.addLayer({id: 'position', type: 'circle', source: 'position', paint: {'circle-radius': 8,'circle-color': '#1670ef','circle-stroke-width': 3,'circle-stroke-color': '#fff'}});
        setReady(true);
      });
      m.on('click', e => {
        const p = latest.current;
        if (p.drawMode) { p.onPoint([e.lngLat.lng, e.lngLat.lat]); return; }
        const found = m.getLayer('stops') ? m.queryRenderedFeatures(e.point, {layers: ['stops']})[0] : null;
        if (found) {
          const id = found.properties?.id;
          p.onStop(id);
          const group = p.groups.find(g => g.stop.id === id);
          if (group) {
            const content = document.createElement('div'); content.className = 'stop-popup';
            const title = document.createElement('strong'); title.textContent = `${group.stop.code} ${group.stop.name}`;
            const lines = document.createElement('p'); lines.textContent = `${p.t('linesHere')}: ${group.lines.join(' · ')}`;
            content.append(title, lines);
            for (const membership of group.memberships.filter(x => x.stop.exchange)) {
              const detail = document.createElement('p'); detail.textContent = `${p.t('exchange')} · ${membership.route.line} · ${membership.stop.exchangeDirection}`; content.append(detail);
            }
            new maplibregl.Popup({maxWidth: '300px'}).setLngLat(group.stop.coordinates).setDOMContent(content).addTo(m);
          }
        }
      });
      map.current = m;
    } catch { setFailed(true); }
    return () => {map.current?.remove(); map.current = null; setReady(false);};
  }, [tileUrl]);
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const set = (id: string, features: GeoJSON.Feature[]) => (m.getSource(id) as GeoJSONSource).setData({type: 'FeatureCollection', features});
    set('routes', props.routes.map(r => ({type: 'Feature', geometry: r.geometry, properties: {active: r.revisionId === props.active, color: r.color}})));
    set('stops', props.showStops ? props.groups.map(g => ({type: 'Feature', geometry: {type: 'Point', coordinates: g.stop.coordinates}, properties: {id: g.stop.id, exchange: g.memberships.some(m => m.stop.exchange), common: g.lines.length > 1}})) : []);
    set('edit', props.edit && props.edit.geometry.coordinates.length >= 2 ? [{type: 'Feature', geometry: props.edit.geometry, properties: {}}] : []);
    set('vertices', props.edit ? props.edit.geometry.coordinates.map(p => ({type: 'Feature', geometry: {type: 'Point', coordinates: p}, properties: {}})) : []);
    m.getCanvas().style.cursor = props.drawMode ? 'crosshair' : '';
  }, [ready, props.routes, props.groups, props.showStops, props.active, props.edit, props.drawMode]);
  useEffect(() => {
    if (!ready || !map.current) return;
    (map.current.getSource('position') as GeoJSONSource).setData({type:'FeatureCollection',features: props.position ? [{type:'Feature',geometry:{type:'Point',coordinates:props.position},properties:{}}] : []});
  },[ready,props.position]);
  useEffect(() => {
    const m = map.current;
    const active = props.routes.find(r => r.revisionId === props.active);
    if (!ready || !m || !active || props.follow) return;
    const bounds = new maplibregl.LngLatBounds(); active.geometry.coordinates.forEach(p => bounds.extend(p));
    m.fitBounds(bounds, {padding: 70, maxZoom: 16, duration: 600});
  }, [ready, props.active]);
  useEffect(() => {if (ready && props.follow && props.position) map.current?.easeTo({center: props.position, zoom: 16, duration: 700});}, [ready, props.position, props.follow]);
  useEffect(() => {
    if (!node.current) return;
    const observer = new ResizeObserver(() => map.current?.resize()); observer.observe(node.current); return () => observer.disconnect();
  }, []);
  return <div className="map-surface"><div className="map-canvas" ref={node} aria-label={props.t('map')}/>{failed && <div className="map-message" role="alert">{props.t('mapError')}</div>}</div>;
}
