import {describe, expect, it} from 'vitest';
import {bearing, generateInstructions, matchFix, measure, nearestOffset, pointAt, type Fix} from './geometry';
import {groupStops, emptyRoute, type RouteSnapshot} from './model';
import {parseGeoJSON, validateDocument} from './importers';

const straight = measure([[7.6,45],[7.62,45]]);
const now = 1_000_000;
const fix = (offset:number,time=now,extra:Partial<Fix>={}):Fix => ({coordinate:pointAt(straight,offset),accuracy:5,heading:90,speed:8,timestamp:time,...extra});
describe('fixed path navigation',()=>{
  it('tracks progress without ever changing geometry',()=>{
    const before=JSON.stringify(straight.coordinates);
    const first=matchFix(straight,fix(30),null,0,now);
    const next=matchFix(straight,fix(90,now+10000),first,0,now+10000);
    expect(next.state).toBe('tracking');expect(next.offsetM).toBeCloseTo(90,0);expect(JSON.stringify(straight.coordinates)).toBe(before);
  });
  it('rejects GPS jumps to a later traversal',()=>{
    const first=matchFix(straight,fix(10),null,0,now);
    const jump=matchFix(straight,fix(1200,now+1000),first,0,now+1000);
    expect(jump.state).toBe('off-route');expect(jump.offsetM).toBe(first.offsetM);
  });
  it('keeps progress on weak or stale GPS',()=>{
    const first=matchFix(straight,fix(30),null,0,now);
    expect(matchFix(straight,fix(80,now+5000,{accuracy:150}),first,0,now+5000).offsetM).toBe(first.offsetM);
    expect(matchFix(straight,fix(80,now+5000),first,0,now+30000).state).toBe('weak-gps');
  });
  it('warns when the vehicle travels in the opposite direction',()=>{
    expect(matchFix(straight,fix(30,now,{heading:270}),null,0,now).state).toBe('wrong-direction');
  });
  it('does not regress or reroute on an off-path fix',()=>{
    const first=matchFix(straight,fix(60),null,0,now);
    const back=matchFix(straight,fix(45,now+1000),first,0,now+1000);
    expect(back.offsetM).toBe(first.offsetM);
    const outside=matchFix(straight,fix(70,now+2000,{coordinate:[7.6,45.02]}),first,0,now+2000);
    expect(outside.state).toBe('off-route');expect(outside.offsetM).toBe(first.offsetM);
  });
  it('uses the selected stop as the initial progress anchor',()=>{
    const p=matchFix(straight,fix(1200),null,1180,now);expect(p.state).toBe('tracking');expect(p.offsetM).toBeCloseTo(1200,0);
  });
  it('does not skip a loop when the same geometry occurs twice',()=>{
    const route=measure([[7.6,45],[7.61,45],[7.61,45.01],[7.6,45.01],[7.6,45],[7.61,45]]);
    const p=matchFix(route,{coordinate:[7.6005,45],accuracy:4,heading:90,speed:5,timestamp:now},null,0,now);
    expect(p.state).toBe('tracking');expect(p.offsetM).toBeLessThan(100);
  });
  it('generates a left turn and preserves original vertices',()=>{
    const route=measure([[7.6,45],[7.61,45],[7.61,45.01]]);
    const steps=generateInstructions(route,{depart:'depart',left:'left',right:'right',arrive:'arrive'});
    expect(steps.map(s=>s.kind)).toEqual(['depart','left','arrive']);expect(route.coordinates).toHaveLength(3);
    expect(bearing([7.6,45],[7.61,45])).toBeCloseTo(90,0);
  });
});
describe('imports and memberships',()=>{
  it('keeps source LineString order and drops altitude without changing longitude/latitude',()=>{
    const points=[[7.6,45,10],[7.61,45,20]];
    const docs=parseGeoJSON({type:'Feature',properties:{line:'T',name:'Test',direction:'ritorno'},geometry:{type:'LineString',coordinates:points}},'test');
    expect(docs[0].geometry.coordinates).toEqual([[7.6,45],[7.61,45]]);expect(docs[0].direction).toBe('ritorno');
  });
  it('rejects MultiLineString rather than joining disconnected geometry',()=>{
    expect(()=>parseGeoJSON({type:'MultiLineString',coordinates:[[[7,45],[8,45]],[[9,45],[10,45]]]},'test')).toThrow();
  });
  it('rejects ambiguous stop membership in multi-route GeoJSON',()=>{
    const line={type:'Feature',properties:{line:'T',name:'Test'},geometry:{type:'LineString',coordinates:[[7.6,45],[7.61,45]]}};
    const stop={type:'Feature',properties:{name:'Stop'},geometry:{type:'Point',coordinates:[7.6,45]}};
    expect(()=>parseGeoJSON({type:'FeatureCollection',features:[line,line,stop]},'test')).toThrow(/route_id/);
  });
  it('rejects coordinates outside WGS84 and unsorted instructions',()=>{
    const d=emptyRoute();d.line='T';d.name='Test';d.geometry.coordinates=[[181,45],[7,45]];
    expect(()=>validateDocument(d)).toThrow();d.geometry.coordinates=[[7.6,45],[7.61,45]];
    d.instructions=[{offsetM:50,text:'A',notes:'',kind:'note'},{offsetM:10,text:'B',notes:'',kind:'note'}];expect(()=>validateDocument(d)).toThrow();
  });
  it('counts shared lines, while exchange metadata stays per membership',()=>{
    const stop={id:'00000000-0000-4000-8000-000000000001',name:'Shared',code:'10',coordinates:[7.6,45] as [number,number],offsetM:0,exchange:true,exchangeDirection:'andata' as const,notes:''};
    const a={...emptyRoute(),id:'a',line:'2',stops:[stop]} as RouteSnapshot;
    const b={...a,id:'b',line:'5',stops:[{...stop,exchange:false,exchangeDirection:null}]} as RouteSnapshot;
    const groups=groupStops([a,b]);expect(groups).toHaveLength(1);expect(groups[0].lines).toEqual(['2','5']);expect(groups[0].memberships[1].stop.exchange).toBe(false);
    expect(groupStops([a,{...a,id:'c'}])[0].lines).toEqual(['2']);
  });
  it('finds ordered repeated stop occurrences without collapsing them',()=>{
    const route=measure([[7.6,45],[7.61,45],[7.6,45],[7.61,45]]);
    const first=nearestOffset(route,[7.605,45]);const later=nearestOffset(route,[7.605,45],first+100);
    expect(later).toBeGreaterThan(first+100);
  });
});
