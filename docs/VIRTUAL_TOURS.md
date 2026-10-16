# Recorridos virtuales y fotografías de calle

La solución integrada es **Panoramax**, consultado desde el servidor mediante su API
pública compatible con STAC, y **Photo Sphere Viewer** para mirar alrededor de una
fotografía realmente panorámica. No requiere una clave de Google ni configurar un
token para el proveedor elegido. La cobertura es colaborativa: no se promete una
imagen por esquina ni una secuencia continua. Se comprobaron imágenes de Torino,
incluidos panoramas GoPro Max con campo de visión de 360°, antes de elegirlo.

## Uso

1. Seleccionar una variante y pulsar **Recorrido virtual**.
2. Avanzar con −20 m / +20 m, arrastrar la barra o saltar a la próxima instrucción.
3. Pulsar **Reproducir recorrido** y elegir 5, 15, 30, 60 o 120 km/h. Pausar permite
   mirar una esquina con calma. La velocidad se refiere al avance sobre el trazado.
4. Arrastrar un panorama 360° para mirar alrededor; usar zoom o pantalla completa.
   Las fotos planas se muestran como fotos y no se convierten artificialmente en 360°.
5. Alternar las fotos cercanas, consultar su fecha, autor/proveedor y licencia.

El mapa sigue la posición virtual. La carga de metadatos/imagen pausa brevemente el
avance automático; una pestaña suspendida no salta kilómetros al volver. Si faltan
imágenes, sigue disponible el mapa, las instrucciones y las fotos propias del giro
cuando se hayan añadido. El video completo del recorrido mantiene sus controles
propios y velocidad 0,25×–4×; no se afirma sincronización GPS de un video sin marcas.

El estudio virtual y el GPS son excluyentes. Iniciar GPS cierra el reproductor; al
navegar no se puede cambiar la variante activa. Ambos recorren la misma geometría
inmutable y nunca solicitan un camino alternativo al proveedor de imágenes.

## Cómo se elige una imagen

`GET /api/v1/routes/{routeId}/revisions/{revisionId}/streetview/{offsetM}` recibe una
revisión visible y una distancia entera en metros. Interpola esa posición dentro del
LineString guardado. No acepta coordenadas GPS ni rutas arbitrarias del navegador.
La API externa recibe una celda geográfica aproximada del recorrido, nunca la
posición del dispositivo. El navegador descarga la imagen elegida directamente del
servidor de imágenes y, por ello, ese servidor puede observar su IP.

El servidor conserva únicamente metadatos factuales: coordenadas, fecha, azimut,
proyección, URLs HTTPS, crédito y licencia. No utiliza descripciones generadas,
semántica, instrucciones inventadas o HTML del proveedor. Solo muestra candidatos
hasta 60 m del punto del trazado; las fotos planas que apuntan más de 90° en sentido
contrario se excluyen. Una foto cercana puede estar en una calle paralela o ser antigua:
es contexto de estudio, no una prueba de que un giro esté permitido hoy.

La proyección panorámica requiere metadatos explícitos de 360°/esféricos. No se
deduce de la proporción de la imagen. Se conserva atribución y enlace a la ficha de
origen; cada foto mantiene su licencia, que puede diferir entre instancias Panoramax.
No se incorporan imágenes del proveedor a los PDF ni a un archivo offline propio.

## Caché, límites y fallos

- Metadatos compartidos en Postgres durante siete días por celda aproximada de 222 m.
- Consultas del reproductor cada 25 m, con debounce y cancelación de peticiones viejas.
- Bloqueo consultivo por celda y segunda lectura para evitar descargas concurrentes.
- Presupuesto global de la aplicación: 300 consultas externas por hora. Este es un
  límite interno conservador; no se presenta como una cuota garantizada del proveedor.
- HTTP a un endpoint fijo, sin redirecciones, diez segundos y máximo 4 MiB por respuesta.
- Errores/límite se guardan cinco minutos; si existen fotos antiguas se conservan como
  caché caducada. Los huecos tienen un mensaje explícito y no modifican el trazado.

La retención de esta caché de metadatos puede limpiarse sin perder rutas:
`DELETE FROM streetview_cache WHERE expires_at < now() - interval '30 days';`.
No borrar `serverdata/gtfs` para limpiar esta caché: contiene el cooldown de GTFS.

## Decisión y alternativas

Mapillary requiere token para integrar su visor; KartaView se evaluó, pero las
consultas de prueba devolvieron respuestas vacías o timeouts en este entorno.
Panoramax devolvió imágenes reales de Torino y permite integrar el visor local.
La elección prioriza una integración usable sin credenciales del usuario; la
cobertura puede cambiar. Si la esquina no tiene imagen, se añaden referencias
escritas/fotos propias y opcionalmente el video del trayecto desde el editor.

## Código y validación

- `server/src/FixedGeometry.php`: medición del LineString guardado, sin motor de rutas.
- `server/src/StreetView.php`: contrato STAC, filtro, caché y recuperación.
- `server/src/RateLimiter.php`: presupuesto atómico compartido sin abrir sesiones.
- `web/src/VirtualTour.tsx`: control de avance y estado de reproducción.
- `web/src/StreetPhoto.tsx`: carga diferida del visor 360°, destrucción al cerrar.
- `server/tests/streetview.php`: transporte inyectado, caché PostGIS y fallos deterministas.
- `web/e2e/app.spec.ts`: visor/WebGL real, controles, huecos y exclusión con GPS en
  Chromium de escritorio y emulación móvil. El panorama de prueba es sintético.

Referencias primarias: [Panoramax API](https://api.panoramax.xyz/api),
[compatibilidad STAC](https://docs.panoramax.fr/backend/dev/STAC_compatibility/),
[visor Panoramax](https://docs.panoramax.fr/web-viewer/),
[Photo Sphere Viewer](https://photo-sphere-viewer.js.org/guide/).
