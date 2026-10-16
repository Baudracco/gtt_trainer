# Fotos, video y URLs de revisiones

## Servidor y despliegue

Docker ejecuta **Nginx** (web estática y puerta de la API), **PHP 8.3-FPM** (API orientada
a objetos), **PostgreSQL/PostGIS** (versiones, geometría y auditoría) y el proceso Python
`gtfs-sync` (actualizaciones periódicas). No necesita Apache ni una tarea de ChatGPT.
El bucle del sincronizador reemplaza un cron: despierta, comprueba estado persistente y
solo descarga si terminó el cooldown. Reiniciar el contenedor no evita esa comprobación.

## URLs sin query params

La web permite compartir una revisión mediante `/routes/{id}/revisions/{revisionId}`.
Nginx resuelve el enlace a la SPA; al cargar, la selección respeta la revisión disponible
para ese usuario. La API usa parámetros de ruta y cuerpos JSON/multipart. Rechaza query
params, para detectar clientes antiguos y evitar interpretaciones ambiguas.

| Acción | Método y ruta |
| --- | --- |
| Catálogo disponible | `GET /api/v1/routes` |
| Papelera (editor) | `GET /api/v1/routes/trash` |
| Revisión concreta | `GET /api/v1/routes/{id}/revisions/{revisionId}` |
| Reporte PDF en español | `GET /api/v1/routes/{id}/revisions/{revisionId}/report/es.pdf` |
| Vista de impresión italiana | `GET /api/v1/routes/{id}/revisions/{revisionId}/report/it.html` |
| Foto opcional | `POST /api/v1/media/photos` |
| Video opcional | `POST /api/v1/media/videos` |
| Archivo autorizado / búsqueda del video | `GET` o `HEAD /api/v1/media/{id}`; cabecera `Range` opcional |

Los enlaces externos a proveedores pueden usar sus propios parámetros; esto no cambia
el contrato sin query params de nuestra API. Véase `openapi.yaml` para el contrato completo.

## Material de estudio

Cada instrucción admite una referencia escrita (`notes`) y hasta tres fotos opcionales.
El recorrido admite un video completo opcional. Descripción y atribución quedan dentro
del snapshot, de modo que una nueva edición no modifica lo ya publicado. El editor puede
previsualizar, quitar una referencia o subir otro archivo; el archivo anterior se conserva
para las revisiones históricas. El video usa controles nativos, búsqueda por tiempo y
velocidad 0.25×–4×. La velocidad de video no cambia la geometría ni su orden.

Las fotos aceptan JPEG/PNG/WebP de hasta 12 MiB y 32 megapíxeles. PHP verifica el contenido,
lo decodifica con GD, corrige orientación EXIF cuando existe, elimina metadatos y guarda
JPEG normalizado de hasta 2400 píxeles y una miniatura para PDF. Transparencias se componen
sobre blanco. Se registran los hashes del original y del archivo persistido.

Los videos aceptan MP4/H.264 (también AV1 en contenedor MP4) o WebM/VP8/VP9/AV1, hasta 1 GiB.
Se reciben a disco mediante multipart, se inspeccionan con ffprobe con límite de tiempo
y se conservan sin recodificar. La compatibilidad de AV1 depende del navegador; MP4/H.264
es la opción de intercambio principal. No se carga el video entero en memoria PHP.

La interfaz muestra progreso de transferencia/procesamiento y conserva el borrador ante
un error. Durante la subida se bloquean los campos para que una respuesta tardía no
sobrescriba una edición concurrente del formulario. Cerrar el editor cancela la transferencia.
No se inventan fotografías de esquinas ni material de calle.

## Acceso y persistencia

Los archivos están en `serverdata`, fuera de la raíz pública. `media_assets` conserva sus
metadatos inmutables y `revision_media` enlaza cada revisión. Editores/admin pueden ver los
archivos subidos. Visitantes/viewer solo acceden a archivos referenciados en una publicación
vigente cuyo recorrido no esté en papelera. Adivinar un UUID no concede acceso.

PHP autoriza cada lectura. Nginx entrega los bytes mediante una ubicación `internal` y
`X-Accel-Redirect`, con soporte de rangos; la URL interna directa devuelve 404. En desarrollo
hay un envío por bloques con rangos simples. `HEAD` no exige CSRF porque es lectura.
Las subidas exigen sesión de editor, origen y CSRF válidos; no se confía en el MIME/nombre
proporcionado por el cliente. SVG/HTML y archivos no válidos se rechazan.

Los reportes incluyen referencias escritas, miniaturas, descripciones/atribuciones y un
enlace al video. Dompdf sigue sin descargar recursos remotos. La caché offline excluye
API y archivos multimedia; las referencias JSON exportadas no incluyen los bytes de las
fotos/videos. Un traslado de servidor requiere conservar **Postgres y serverdata juntos**.

## Verificación y mantenimiento

Las pruebas HTTP realizan subidas reales de PNG/MP4, comprueban decodificación, permisos,
CSRF, publicación, rangos/HEAD, referencias de tipo incorrecto y PDF/HTML. Playwright prueba
el formulario con transferencias interceptadas, rutas compartibles, superposiciones WebGL
y GPS. La validación de bytes/formato se realiza en el servidor real con PostGIS.

No borrar archivos por antigüedad sin consultar `revision_media`: pueden pertenecer a una
revisión histórica. La retención de subidas abandonadas necesita una política explícita;
no hay una eliminación automática que pueda romper el historial.
