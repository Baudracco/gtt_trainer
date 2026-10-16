import {test,expect,type Page} from '@playwright/test';
import {measure,pointAt} from '../src/geometry';
import {emptyRoute,type RouteSnapshot} from '../src/model';

const shared={id:'abcd1234-0000-4000-8000-000000000010',code:'10',name:'Esquina compartida',coordinates:[7.6,45.05] as [number,number],offsetM:0,exchange:false,exchangeDirection:null,notes:''};
const route=(n:number):RouteSnapshot=>({...emptyRoute(),line:n===1?'2':'5',name:n===1?'Control Alfa':'Control Beta',direction:'andata',
  id:`abcd1234-0000-4000-8000-00000000000${n}`,revisionId:`abcd1234-0000-4000-8000-00000000001${n}`,revision:1,version:1,status:'published',deleted:false,createdAt:'2026-10-16',
  geometry:{type:'LineString',coordinates:n===1?[[7.6,45.05],[7.604,45.05],[7.604,45.054]]:[[7.6,45.05],[7.6,45.054],[7.604,45.054]]},
  color:n===1?'#2463eb':'#b32f80',stops:[{...shared,exchange:n===1,exchangeDirection:n===1?'andata':null}],
  instructions:[]});

async function prepare(page:Page,editor=false,path='/') {
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const routes=[route(1),route(2)];const writes:string[]=[];
  await page.route('**/api/v1/**',async request=>{
    const path=new URL(request.request().url()).pathname.replace('/api/v1','');
    if(request.request().method()!=='GET')writes.push(path);
    let data:unknown;
    if(/^\/media\/[a-f0-9-]{36}$/.test(path))return request.fulfill({body:transparent,contentType:'image/png'});
    if(path==='/session')data={csrf:'fixture-token',user:editor?{id:routes[0].id,email:'editor@test.invalid',role:'editor'}:null};
    else if(path==='/media/photos'||path==='/media/videos')data={id:crypto.randomUUID()};
    else if(path==='/sources/gtt')data={archiveSha256:'a'.repeat(64),summary:{unchanged:2},download:{lastAttemptAt:'2026-10-16T06:00:00Z',nextAttemptAt:'2026-10-17T06:00:00Z'},issues:[{key:'gtt:'+'a'.repeat(64),state:'rejected',identity:{route:'T',shape:'S'},reason:'Synthetic stop/shape discrepancy',hasDocument:false}]};
    else if(path==='/routes' && request.request().method()==='POST') {
      const doc=request.request().postDataJSON();const created={...routes[0],...doc,id:crypto.randomUUID(),revisionId:crypto.randomUUID(),status:'draft'};routes.push(created);data=created;
    } else if(path==='/routes')data=routes;
    else throw Error(`Unexpected API call: ${path}`);
    await request.fulfill({json:{data,trace_id:'e2e-fixture'}});
  });
  // Exercise real MapLibre/WebGL and workers without depending on an external tile
  // provider's availability. Route geometry is the fixture; no map API is mocked.
  const transparent=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==','base64');
  await page.route('https://tiles.openfreemap.org/**',async request=>{
    const url=request.request().url();
    if(url.endsWith('/planet'))return request.fulfill({json:{tilejson:'3.0.0',tiles:['https://fixture.tiles.invalid/{z}/{x}/{y}.pbf'],minzoom:0,maxzoom:14,attribution:'Test fixture'}});
    if(/\.json$/.test(url))return request.fulfill({json:{}});
    if(/\.png$/.test(url))return request.fulfill({body:transparent,contentType:'image/png'});
    return request.fulfill({body:Buffer.alloc(0),contentType:'application/x-protobuf'});
  });
  await page.route('https://fixture.tiles.invalid/**',request=>request.fulfill({body:Buffer.alloc(0),contentType:'application/x-protobuf'}));
  await page.route('https://fixture.photos.invalid/**',request=>request.fulfill({body:Buffer.from('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','base64'),contentType:'image/png',headers:{'Access-Control-Allow-Origin':'*'}}));
  await page.goto(path);await expect(page.getByRole('button',{name:/Control Alfa/})).toBeVisible();
  return {errors,writes};
}

async function pixels(page:Page) {
  // Subpixel antialiasing in attribution/control text can contain route-like RGB
  // values. Mask those DOM overlays while retaining every WebGL route pixel.
  const png=await page.locator('.maplibregl-canvas').screenshot({mask:[page.locator('.maplibregl-ctrl'),page.locator('.map-label')],maskColor:'#eef0ef'});
  return page.evaluate(async data=>{
    const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();
    const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
    const ctx=canvas.getContext('2d')!;ctx.drawImage(img,0,0);const values=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let blue=0,pink=0;for(let i=0;i<values.length;i+=4){const [r,g,b]=[values[i],values[i+1],values[i+2]];if(b>180&&r<100&&g>40&&g<170)blue++;if(r>130&&b>80&&r>b&&g<170&&r-g>40)pink++;}
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
  await expect(page.locator('.editor summary').filter({hasText:/^Trazado/})).toContainText('2');
  await page.getByRole('button',{name:'Añadir instrucción',exact:true}).click();
  await page.getByRole('textbox',{name:'Instrucciones',exact:true}).fill('Girar en la esquina de control');
  await page.getByLabel('Referencia escrita del giro (opcional)').fill('Semáforo y edificio azul');
  await page.getByLabel('Añadir foto del giro').setInputFiles({name:'corner.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==','base64')});
  await expect(page.getByRole('img',{name:'Girar en la esquina de control'})).toBeVisible();
  await page.locator('.photo-fields').getByLabel('Descripción de la imagen o video').fill('Edificio de la esquina');
  await page.locator('.editor summary').filter({hasText:'Video del recorrido'}).click();
  await page.getByLabel('Subir video completo').setInputFiles({name:'route.mp4',mimeType:'video/mp4',buffer:Buffer.from('browser-fixture-upload')});
  await expect(page.locator('.editor video')).toBeVisible();
  await page.locator('.editor-actions').getByRole('button',{name:'Guardar borrador'}).click();
  await expect(page.getByRole('button',{name:/Dibujo de control/})).toBeVisible();
  expect(writes).toEqual(['/media/photos','/media/videos','/routes']);expect(errors).toEqual([]);
});
test('opens and shares an explicit revision through its friendly URL',async({page})=>{
  const beta=route(2);const path=`/routes/${beta.id}/revisions/${beta.revisionId}`;
  const {errors}=await prepare(page,false,path);
  await expect(page.locator('.route-detail h3').first()).toHaveText('5 · Control Beta');
  await expect(page).toHaveURL(new RegExp(path+'$'));
  await expect(page.getByRole('link',{name:'Reporte PDF',exact:true})).toHaveAttribute('href',`/api/v1${path}/report/es.pdf`);
  expect(errors).toEqual([]);
});

test('plays the fixed route through a real 360 viewer and reports coverage gaps',async({page,context},testInfo)=>{
  await context.grantPermissions(['geolocation']);await context.setGeolocation({longitude:7.6001,latitude:45.05,accuracy:5});
  const {errors,writes}=await prepare(page);
  await page.getByRole('button',{name:'Recorrido virtual',exact:true}).click();
  const tour=page.getByRole('region',{name:'Recorrido virtual'});
  await expect(tour.locator('.panorama-surface canvas')).toBeVisible();
  await expect(tour.locator('.photo-attribution')).toContainText('Synthetic test photographer');
  await page.getByRole('combobox',{name:'Velocidad virtual'}).selectOption('120');
  await page.getByRole('button',{name:'Reproducir recorrido',exact:true}).click();
  const slider=page.getByRole('slider',{name:'Avance por el recorrido'});
  await expect.poll(async()=>Number(await slider.inputValue())).toBeGreaterThan(30);
  await page.getByRole('button',{name:'Pausar recorrido',exact:true}).click();
  const paused=Number(await slider.inputValue());await page.waitForTimeout(400);
  expect(Number(await slider.inputValue())).toBe(paused);
  await page.getByRole('button',{name:'+20 m',exact:true}).click();
  expect(Number(await slider.inputValue())).toBeCloseTo(paused+20,0);
  await slider.press('End');
  await expect(tour.locator('.coverage-gap')).toContainText('Sin imágenes cercanas');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await slider.press('Home');await expect(tour.locator('.panorama-surface canvas')).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('virtual-panorama.png')});
  await page.getByRole('button',{name:'Iniciar navegación',exact:true}).click();
  await expect(tour).toHaveCount(0);await expect(page.locator('.nav-state')).toHaveText('Siguiendo el trazado fijo');
  await expect(page.getByRole('button',{name:'Recorrido virtual',exact:true})).toBeDisabled();
  expect(writes).toEqual([]);expect(errors).toEqual([]);
});
