# Manual de uso

## Entrar y elegir una variante

Abrir la aplicación y elegir ES, IT o EN. El idioma y el tema se recuerdan en el
navegador. Visitantes y cuentas viewer ven las publicaciones vigentes. Editores y
administradores también ven borradores y revisiones en revisión. En una instalación
nueva el administrador entra para revisar el catálogo: no existen rutas publicadas
ni contraseñas predeterminadas.

El selector **Línea** filtra por código exacto, distinguiendo por ejemplo una línea
y su variante con barra. La búsqueda de texto sigue permitiendo destinos y paradas;
un número de parada en otra línea no afecta al filtro exacto. Se puede combinar
con el filtro de sentido. **Sin especificar** indica
que falta confirmar la correspondencia operativa: GTFS 0/1 no se convierte a
andata/ritorno automáticamente. El tipo distingue servicio, salida/entrada de
depósito, traslado, parcial y circular.

Pulsar el título selecciona una revisión activa y la hace visible. La URL contiene
su variante y revisión para poder compartirla. El destinatario necesita permiso
para verla; un enlace a un borrador no lo convierte en público. El PDF y el JSON
identifican el contenido exacto exportado.

## Comparar recorridos y paradas

La casilla de mapa hace visible cada superposición. **Mostrar todos**, **Ocultar
todos** y **Seleccionados** controlan lo visible; la selección para comparación se
marca aparte. Con catálogos de más de 25 revisiones, la apertura inicial muestra las
variantes de la primera línea para conservar legibilidad. Se puede activar cualquier
otra; la lista muestra 100 resultados y permite cargar más.

Marcar dos variantes y pulsar **Comparar seleccionados** abre una comparación A/B:
azul y naranja en el mapa, revisión/estado, longitud y diferencias de trazado,
paradas, puestos de cambio, instrucciones, observaciones, fuente y video. Las
visitas repetidas a una parada se comparan por su posición. Cerrar restaura los
colores originales. La comparación conserva ambos recorridos y no guarda cambios.
Detener GPS/reproducción virtual antes de abrirla. [Detalles](ROUTE_AUDIT.md).

La sección Paradas permite mostrar/ocultar, ver solo compartidas entre líneas o solo
puestos de cambio. Una parada compartida tiene una identidad canónica y conserva
las pertenencias a cada recorrido. El panel muestra línea, sentido y observaciones
de cada pertenencia. El estado de cambio de una variante no se hereda en otra.

Mientras GPS o reproducción virtual están activos, su recorrido permanece visible.
Se pueden superponer otros para comparar; sigue habiendo una sola posición activa.

## Estudiar virtualmente

**Recorrido virtual** abre las imágenes Panoramax cercanas a la geometría guardada.
Usar −20 m/+20 m, la barra, la próxima maniobra o reproducción de 5–120 km/h. Los
panoramas 360° permiten mirar alrededor y ampliar; las fotos planas se ven planas.
La fecha, crédito, licencia y enlace de cada foto permanecen visibles.

Si faltan fotos o el proveedor falla, la app indica el hueco y conserva mapa e
instrucciones. Las referencias propias de un giro se muestran cuando están cerca.
Las imágenes pueden ser antiguas o de una calle cercana; comprobar el trazado y las
maniobras contra la evidencia operativa. [Detalles y límites](VIRTUAL_TOURS.md).

Un video cargado del trayecto se reproduce en su propio panel a 0,25×–4×. El archivo
no se sincroniza por GPS sin datos de tiempo/posición que definan esa relación.

## Seguir el recorrido con GPS

1. Abrir en HTTPS (localhost también admite GPS) y mantener la app en primer plano.
2. Seleccionar **una** variante y el comienzo o la parada desde donde se iniciará.
   Este ancla evita saltos a una vuelta posterior cuando se repiten calles.
3. Activar seguimiento del mapa y, si se desea, avisos por voz.
4. Pulsar **Iniciar navegación** y conceder el permiso del navegador.
5. Seguir el avance, próxima maniobra, referencia escrita/foto, próxima parada y
   distancia restante. **Detener navegación** libera la selección activa.

La posición se procesa en el dispositivo. **GPS débil**, **Fuera del trazado** o
**Sentido contrario** conservan el progreso previo y avisan; nunca se dibuja un
atajo para recuperar tiempo. Un timeout o posición temporalmente no disponible
mantiene el observador para recuperarse con el próximo fix válido. Si se deniega el
permiso, se detiene y hay que volver a concederlo desde el navegador.

Las pruebas automatizadas usan Chromium real y GPS del navegador con coordenadas
sintéticas. La precisión, voces y continuidad en un teléfono real se verifican en
campo. La navegación en segundo plano no está garantizada por esta PWA.

## Crear o corregir recorridos

El editor puede abrir un borrador, crear uno nuevo o previsualizar un JSON/GeoJSON/GPX.
La importación no escribe nada hasta Guardar y cada documento crea un borrador.
Los archivos grandes GTFS/CSV/XLSX se convierten por CLI y el worker gestiona el feed
oficial; no importar su semilla a mano, porque crearía variantes de usuario adicionales.

Añadir vértices explícitos en orden de marcha. Añadir/reutilizar paradas canónicas,
ordenarlas por distancia recorrida y especificar cambio/sentido solo cuando esté
confirmado. Una misma parada puede aparecer más de una vez en una circular.

Las sugerencias geométricas de giros ayudan a comenzar. Completar calles,
continuaciones rectas aunque cambie el nombre, maniobras y referencias escritas.
Se pueden adjuntar hasta tres fotos por instrucción y un video completo opcional.
Las subidas bloquean temporalmente los campos para no asociarlas a una edición vieja.

**Guardar borrador** crea otra revisión completa. **Enviar a revisión** fija la
candidata a comprobar. El administrador confirma la revisión y publica después de
verificar calles, sentido, paradas, fuente y maniobras. Un nuevo borrador nunca
cambia la publicación anterior. Una edición concurrente devuelve conflicto y pide
recargar para poder comparar, no sobrescribe silenciosamente.

## Historial, papelera y fuentes

El historial conserva todas las revisiones. Revertir copia una antigua en un borrador
nuevo; no modifica la fila histórica. Papelera oculta la variante y Restaurar
recupera su publicación vigente. La sincronización no resucita lo eliminado.

**Fuentes GTT** permite revisar hash/fechas, próximo intento, resumen de cambios y
patrones pendientes. Un cambio de fuente genera otra candidata cuando no hay trabajo
manual en curso. Si hay conflicto o una revisión ya está siendo revisada, se conserva
el documento entrante para exportarlo y compararlo. Abrir el panel no descarga GTFS.

**Revisión de repeticiones GTFS** distingue registros de fuente, coincidencias
dentro de una línea y trazados compartidos entre líneas. **Comparar versiones
actuales** abre las variantes locales vinculadas; pueden contener cambios
editoriales posteriores a la auditoría de la fuente. Una coincidencia no confirma
que sean el mismo servicio operativo.

**Depósitos y cambios** requiere sesión y una importación local del material operativo privado.
Filtrá por línea, depósito y salida/regreso. Cada movimiento conserva su página y texto;
**Trazar este movimiento** inicia un formulario con geometría vacía y el plan de calles
visible. **Continuar trazado** retoma una variante guardada y su historial. Los bloques
completos quedan como evidencia. [Procedimiento y límites](DEPOT_MOVEMENTS.md).

## Sin conexión y reportes

Después de cargar publicaciones, el navegador conserva sus documentos y la interfaz.
El modo offline se indica en pantalla. Login, edición, PDF del servidor, imágenes
externas y el mapa de fondo requieren conexión. No se descargan áreas de mapa ni
fotografías externas masivamente.

El reporte HTML/PDF contiene revisión, trazado, paradas, instrucciones, referencias,
fotos normalizadas y enlace al video. Los borradores siguen requiriendo acceso de
editor incluso cuando se abre su URL de reporte.
