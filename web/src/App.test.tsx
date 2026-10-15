// @vitest-environment jsdom
import React from 'react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {emptyRoute, type RouteSnapshot} from './model';
import * as api from './api';
import {App} from './main';
vi.mock('./api',()=>({session:vi.fn(),request:vi.fn(),reportUrl:vi.fn(()=>'/report'),login:vi.fn(),logout:vi.fn(),saveDocument:vi.fn()}));
vi.mock('./cache',()=>({cachePublished:vi.fn(async()=>{}),readPublished:vi.fn(async()=>[])}));
vi.mock('./RouteMap',()=>({RouteMap:({routes}:{routes:RouteSnapshot[]})=><div data-testid="map-routes">{routes.map(r=>r.line).join(',')}</div>}));
vi.mock('./References',()=>({References:()=> <div/>}));
const route=(line:string):RouteSnapshot=>({...emptyRoute(),line,name:`Route ${line}`,geometry:{type:'LineString',coordinates:[[7.6,45],[7.61,45]]},id:crypto.randomUUID(),revisionId:crypto.randomUUID(),revision:1,version:1,status:'published',deleted:false,createdAt:'2026-10-15'});
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();vi.mocked(api.session).mockResolvedValue(null);vi.mocked(api.request).mockResolvedValue([route('2'),route('5')]);});
afterEach(cleanup);
it('shows, hides and overlays exactly the variants selected by the user',async()=>{
  render(<App/>);await screen.findByRole('button',{name:/Route 2/});
  expect(screen.getByTestId('map-routes').textContent).toBe('2,5');
  fireEvent.click(screen.getByRole('button',{name:'Ocultar todos'}));expect(screen.getByTestId('map-routes').textContent).toBe('');
  fireEvent.click(screen.getByLabelText('Mapa 5 Route 5'));expect(screen.getByTestId('map-routes').textContent).toBe('5');
  fireEvent.click(screen.getByRole('button',{name:'Mostrar todos'}));expect(screen.getByTestId('map-routes').textContent).toBe('2,5');
});
it('preserves a deliberate hide-all choice when refreshing the same view',async()=>{
  render(<App/>);await screen.findByRole('button',{name:/Route 2/});
  fireEvent.click(screen.getByRole('button',{name:'Ocultar todos'}));
  fireEvent.click(screen.getByRole('button',{name:'Actualizar'}));
  await waitFor(()=>expect(api.request).toHaveBeenCalledTimes(2));
  expect(screen.getByTestId('map-routes').textContent).toBe('');
});
it('navigates one fixed route and sends no location fixes to the API',async()=>{
  let success:PositionCallback | undefined;
  const watchPosition=vi.fn((callback:PositionCallback)=>{success=callback;return 42;});
  const clearWatch=vi.fn();Object.defineProperty(navigator,'geolocation',{configurable:true,value:{watchPosition,clearWatch}});
  render(<App/>);await screen.findByRole('button',{name:/Route 2/});
  const before=vi.mocked(api.request).mock.calls.length;
  fireEvent.click(screen.getByRole('button',{name:'Iniciar navegación'}));
  await waitFor(()=>expect(watchPosition).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button',{name:/Route 5/}).hasAttribute('disabled')).toBe(true);
  success!({coords:{longitude:7.6001,latitude:45,accuracy:5,heading:90,speed:5},timestamp:Date.now()} as GeolocationPosition);
  expect(api.request).toHaveBeenCalledTimes(before);
  fireEvent.click(screen.getByRole('button',{name:'Detener navegación'}));
  expect(clearWatch).toHaveBeenCalledWith(42);
});
it('offers authoring only after an enabled editor session',async()=>{
  vi.mocked(api.session).mockResolvedValue({id:crypto.randomUUID(),email:'editor@test.invalid',role:'editor'});
  render(<App/>);await screen.findByRole('button',{name:/Nuevo recorrido/});
  fireEvent.click(screen.getByRole('button',{name:/Nuevo recorrido/}));
  expect(screen.getByRole('region',{name:'Editar'})).toBeTruthy();
  expect(screen.getByRole('button',{name:'Guardar borrador'})).toBeTruthy();
});
