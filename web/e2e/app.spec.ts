import {test,expect,type Page} from '@playwright/test';
import {emptyRoute,type RouteSnapshot} from '../src/model';

const shared={id:'abcd1234-0000-4000-8000-000000000010',code:'10',name:'Esquina compartida',coordinates:[7.6,45.05] as [number,number],offsetM:0,exchange:false,exchangeDirection:null,notes:''};
const route=(n:number):RouteSnapshot=>({...emptyRoute(),line:n===1?'2':'5',name:n===1?'Control Alfa':'Control Beta',direction:'andata',
  id:`abcd1234-0000-4000-8000-00000000000${n}`,revisionId:`abcd1234-0000-4000-8000-00000000001${n}`,revision:1,version:1,status:'published',deleted:false,createdAt:'2026-10-16',
  geometry:{type:'LineString',coordinates:n===1?[[7.6,45.05],[7.604,45.05],[7.604,45.054]]:[[7.6,45.05],[7.6,45.054],[7.604,45.054]]},
  color:n===1?'#2463eb':'#b32f80',stops:[{...shared,exchange:n===1,exchangeDirection:n===1?'andata':null}],
  instructions:[]});

async function prepare(page:Page,editor=false) {
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const routes=[route(1),route(2)];const writes:string[]=[];
  await page.route('**/api/v1/**',async request=>{
    const path=new URL(request.request().url()).pathname.replace('/api/v1','');
    if(request.request().method()!=='GET')writes.push(path);
    let data:unknown;
    if(path==='/session')data={csrf:'fixture-token',user:editor?{id:routes[0].id,email:'editor@test.invalid',role:'editor'}:null};
    else if(path==='/sources/gtt')data={archiveSha256:'a'.repeat(64),summary:{unchanged:2},download:{lastAttemptAt:'2026-10-16T06:00:00Z',nextAttemptAt:'2026-10-17T06:00:00Z'},issues:[{key:'gtt:'+'a'.repeat(64),state:'rejected',identity:{route:'T',shape:'S'},reason:'Synthetic stop/shape discrepancy',hasDocument:false}]};
    else if(path==='/routes' && request.request().method()==='POST') {
      const doc=request.request().postDataJSON();const created={...routes[0],...doc,id:crypto.randomUUID(),revisionId:crypto.randomUUID(),status:'draft'};routes.push(created);data=created;
    } else if(path==='/routes')data=routes;
    else throw Error(`Unexpected API call: ${path}`);
    await request.fulfill({json:{data,trace_id:'e2e-fixture'}});
  });
  // Exercise real MapLibre/WebGL and workers without depending on an external tile
  // provider's availability. Route geometry is the fixture; no map API is mocked.
  const transparent=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3XQAAAAASUVORK5CYII=','base64');
  await page.route('https://tiles.openfreemap.org/**',async request=>{
    const url=request.request().url();
    if(url.endsWith('/planet'))return request.fulfill({json:{tilejson:'3.0.0',tiles:['https://fixture.tiles.invalid/{z}/{x}/{y}.pbf'],minzoom:0,maxzoom:14,attribution:'Test fixture'}});
    if(/\.json$/.test(url))return request.fulfill({json:{}});
    if(/\.png$/.test(url))return request.fulfill({body:transparent,contentType:'image/png'});
    return request.fulfill({body:Buffer.alloc(0),contentType:'application/x-protobuf'});
  });
  await page.route('https://fixture.tiles.invalid/**',request=>request.fulfill({body:Buffer.alloc(0),contentType:'application/x-protobuf'}));
  await page.goto('/');await expect(page.getByRole('button',{name:/Control Alfa/})).toBeVisible();
  return {errors,writes};
}

async function pixels(page:Page) {
  const png=await page.locator('.maplibregl-canvas').screenshot();
  return page.evaluate(async data=>{
    const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();
    const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
    const ctx=canvas.getContext('2d')!;ctx.drawImage(img,0,0);const values=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let blue=0,pink=0;for(let i=0;i<values.length;i+=4){const [r,g,b]=[values[i],values[i+1],values[i+2]];if(b>180&&r<100&&g>40&&g<170)blue++;if(r>130&&b>80&&r>b&&g<100)pink++;}
    return {blue,pink};
  },png.toString('base64'));
}

test('renders real WebGL overlays, preserves hide-all and shares stop memberships',async({page},testInfo)=>{
  const {errors}=await prepare(page);
  await expect.poll(async()=>{const p=await pixels(page);return p.blue>30&&p.pink>30;}).toBe(true);
  await page.getByRole('button',{name:'Ocultar todos'}).click();
  await expect.poll(async()=>pixels(page)).toEqual({blue:0,pink:0});
  await page.getByRole('button',{name:'Actualizar',exact:true}).click();
  await expect.poll(async()=>pixels(page)).toEqual({blue:0,pink:0});
  await page.getByRole('button',{name:'Mostrar todos'}).click();
  await page.getByRole('button',{name:'10 Esquina compartida 2 · 5'}).click();
  await expect(page.locator('.stop-detail')).toContainText('Posto cambio');
  await expect(page.locator('.stop-detail')).toContainText('5 · Ida');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('map-overlays.png')});expect(errors).toEqual([]);
});

test('uses native browser GPS on one route without API writes or premature arrival',async({page,context},testInfo)=>{
  await context.grantPermissions(['geolocation']);await context.setGeolocation({longitude:7.6001,latitude:45.05,accuracy:5});
  const {errors,writes}=await prepare(page);
  await page.getByRole('button',{name:'Iniciar navegación',exact:true}).click();
  await expect(page.locator('.nav-state')).toHaveText('Siguiendo el trazado fijo');
  await expect(page.locator('.navigation-hud h2')).toHaveText('Seguí el trazado indicado');
  await expect(page.getByRole('button',{name:/Control Beta/})).toBeDisabled();
  await context.setGeolocation({longitude:7.62,latitude:45.07,accuracy:5});
  await expect(page.locator('.nav-state')).toContainText('Fuera del trazado');
  expect(writes).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('gps-off-route.png')});
  await page.getByRole('button',{name:'Detener navegación',exact:true}).click();
  await expect(page.getByRole('button',{name:/Control Beta/})).toBeEnabled();expect(errors).toEqual([]);
});

test('authors ordered map vertices and inspects automatic source state',async({page})=>{
  const {errors,writes}=await prepare(page,true);
  await page.getByRole('button',{name:'Fuentes GTT',exact:true}).click();
  await expect(page.getByText('a'.repeat(64),{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'T · S'})).toBeVisible();
  await page.getByRole('button',{name:'Recorridos',exact:true}).click();
  await page.getByRole('button',{name:'+ Nuevo recorrido'}).click();
  await page.getByRole('textbox',{name:'Línea',exact:true}).fill('T');
  await page.getByRole('textbox',{name:'Nombre',exact:true}).fill('Dibujo de control');
  await page.getByRole('button',{name:'Añadir vértices en el mapa',exact:true}).click();
  const map=page.locator('.maplibregl-canvas');const box=(await map.boundingBox())!;
  await map.click({position:{x:box.width*.4,y:box.height*.55}});await map.click({position:{x:box.width*.65,y:box.height*.65}});
  await expect(page.locator('.editor summary').first()).toContainText('2');
  await page.locator('.editor-actions').getByRole('button',{name:'Guardar borrador'}).click();
  await expect(page.getByRole('button',{name:/Dibujo de control/})).toBeVisible();
  expect(writes).toEqual(['/routes']);expect(errors).toEqual([]);
});
