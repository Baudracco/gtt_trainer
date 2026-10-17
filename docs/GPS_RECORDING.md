# Capturar un recorrido fijo con GPS

La captura permite obtener vértices reales para un borrador vacío, incluido un
movimiento individual del catálogo DAPER. Requiere una cuenta de editor, HTTPS
(o localhost), permiso de ubicación y mantener la aplicación visible.

## Uso y conservación

1. Abrir **+ Nuevo recorrido** o **Trazar este movimiento**. En DAPER, verificar que
   la evidencia corresponde exactamente al movimiento que se va a registrar.
2. Abrir **Grabar recorrido con GPS** y pulsar **Iniciar grabación GPS**. El mapa
   muestra la captura en verde y permite activar/desactivar su seguimiento.
3. **Pausar grabación** libera el observador. **Retomar grabación** empieza otro
   tramo; no conecta los extremos. Ocultar la app, bloquear la pantalla o cambiar
   de pestaña pausa la captura cuando el navegador entrega el evento de visibilidad.
   Al volver hay que retomarla explícitamente.
4. Pausar y elegir un **Tramo grabado**. **Usar este tramo** copia sus coordenadas
   exactas al formulario vacío, conservando nombre, tipo, sentido y evidencia.
   Revisar el trazado, añadir paradas/maniobras y **Guardar borrador**. Guardar no publica.
5. **Descargar GPX grabado** conserva todos los tramos utilizables separados, sus
   tiempos UTC y la precisión estimada de cada muestra. Se puede reimportar: cada
   segmento genera una candidata distinta con sentido **Sin especificar**.

La captura vive solamente en memoria: no hay subida, IndexedDB ni recuperación
automática. Cerrar el editor, salir de la cuenta, recargar o cerrar la página pierde
la captura que no se haya descargado. El GPX no incluye el texto del PDF. Guardar
el borrador envía la geometría elegida y el documento editorial habitual; los tiempos
y precisiones originales se conservan en el GPX, no en el modelo de ruta.

Si el formulario ya contiene geometría, paradas o instrucciones, la captura sigue
permitida para descargarla, pero **Usar este tramo** queda deshabilitado. No se
reescriben offsets, pertenencias ni instrucciones existentes. Para usar otra captura,
crear un formulario vacío o importar y revisar el GPX por separado.

## Calidad y discontinuidades

| Condición | Resultado |
| --- | --- |
| Precisión estimada entre 0 y 35 m, posición WGS84 finita | Candidata a conservar |
| Menos de 1 s desde el último punto guardado o menos de 3 m de movimiento | Se omite; la observación válida mantiene vivo el reloj de señal |
| Observación con más de 15 s de antigüedad o más de 5 s en el futuro | Se rechaza; el próximo fix válido empieza otro tramo |
| Más de 15 s entre observaciones válidas, pausa, error temporal, mala precisión o salto imposible | Discontinuidad explícita, sin línea de unión |
| Salto mayor a 45 m/s más ambas precisiones estimadas | Se rechaza y separa el siguiente tramo |
| Tiempo repetido o anterior | Se omite sin retroceder el registro |
| Cruce del antimeridiano | Tramos separados, sin atravesar el mapa |
| 10.000 puntos o intento de crear el tramo 101 | La captura se detiene; descargar antes de descartarla |

Son filtros conservadores de adquisición, no una certificación de precisión o de
legalidad del recorrido. Una parada prolongada con señal válida no corta el tramo.
Cada tramo utilizable necesita al menos dos puntos; las observaciones aisladas se
exportan como waypoints y no se convierten en calles. El GPX completo tiene un
límite de 4 MiB, compatible con la previsualización de importaciones.

No se ajustan puntos a calles, suavizan curvas, infieren giros, calculan atajos ni
suplen huecos. El GPS tampoco prueba el sentido operativo, la plataforma de una
parada o que un acceso de depósito permita el vehículo. Comparar con el PDF y las
restricciones antes de revisión/publicación.

## Contrato para mantenimiento

`recording.ts` contiene el estado y las transformaciones puras; recibe el reloj para
pruebas deterministas. `GpsRecorder.tsx` posee un único `watchPosition`, controla su
liberación y entrega arrays separados a `RouteMap`. Cada tramo se representa con
un `LineString` independiente; nunca se aplana el conjunto. `main.tsx` excluye la
navegación y reproducción virtual al iniciar la captura. El editor bloquea cambios
de campos y guardado mientras graba, conservando disponibles pausa y cierre.

Los callbacks del propietario se mantienen estables para que un render no active
la limpieza de desmontaje. Los eventos tardíos de un observador liberado se ignoran.
Denegar permiso o desmontar libera el observador; un error temporal mantiene el
observador activo y separa la siguiente posición válida.

Las pruebas unitarias cubren filtros, límites, exportación/reimportación, errores,
visibilidad, desmontaje y conservación de evidencia. Playwright verifica permisos y
GPS nativos de Chromium, mapa WebGL verde, dos tramos, descarga y guardado explícito
en escritorio y móvil emulado. La continuidad, precisión, permisos y consumo en un
teléfono físico siguen requiriendo validación en campo. No se promete grabación en
segundo plano ni continuidad durante la suspensión del navegador.

Referencias primarias: [Geolocation API](https://www.w3.org/TR/geolocation/) y
[GPX 1.1](https://www.topografix.com/GPX/1/1/). La precisión se exporta como extensión
`gtt:accuracyM`, en metros; no se confunde con el campo adimensional `hdop`.
