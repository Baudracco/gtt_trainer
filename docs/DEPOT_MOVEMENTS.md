# Movimientos individuales de depósito

Cada columna USCITA o RIENTRO del DAPER puede reunir varios orígenes/destinos.
El extractor identifica los movimientos por sus encabezados en negrita. El material
del operador se importa al volumen privado; el repositorio y los assets públicos
incluyen el código y pruebas sintéticas. Ninguna secuencia textual se presenta como
un recorrido GPS verificado.

## Usar el catálogo

1. Importá el documento localmente e iniciá sesión. Abrí **Depósitos y cambios**. Filtrá por línea, depósito y salida/regreso; la
   búsqueda libre incluye destinos y texto literal. Se muestran 50 resultados por vez.
2. Abrí el movimiento exacto y revisá su página, encabezado y secuencia de calles.
3. Con sesión de editor, **Trazar este movimiento** abre un formulario con geometría
   vacía. El texto de otra alternativa del mismo bloque no se mezcla con este movimiento.
4. Importá, dibujá o [grabá con GPS](GPS_RECORDING.md) sus vértices siguiendo las calles indicadas. Agregá giros, paradas,
   restricciones y referencias escritas/fotográficas. La dirección inicial queda sin confirmar.
5. Guardá el borrador. El catálogo lo cuenta como **con trazado guardado**, que no
   significa aprobado. **Continuar trazado** retoma la variante y su historial/versionado.
6. Verificá geometría, sentidos, accesos de depósito y restricciones antes de enviarlo
   a revisión. La publicación sigue siendo una acción editorial independiente.

Los bloques originales completos siguen disponibles como evidencia, sin un botón
para convertir toda una columna con alternativas en una sola ruta.

## Evidencia conservada por revisión

`source.provenance` es opcional. Una ruta iniciada desde DAPER conserva SHA-256 del PDF,
identidad de bloque/movimiento, páginas, título, texto literal, SHA-256 de título + LF +
texto y secuencia textual de calles. El editor muestra ese plan mientras se dibuja;
las observaciones operativas se editan por separado y comienzan vacías. La base de
datos, las revisiones restauradas y las exportaciones/reportes de editor conservan
la evidencia. Las respuestas de rutas y reportes públicos o de viewer la omiten;
la caché offline de publicaciones también la elimina. Un viewer habilitado puede
consultar el catálogo privado mediante los endpoints de referencias autenticados.

Un hash identifica los bytes de origen; no certifica vigencia ni aprobación operativa.
Las rutas existentes sin evidencia no reciben campos vacíos ni cambian su fingerprint.
El vínculo se busca por SHA del documento y movimiento, conservando variantes distintas
y sin confundir una futura edición del PDF con la actual.

## Reproducir la extracción

Colocá el PDF en `private-input/daper.pdf`, directorio excluido de Git y del contexto
de construcción Docker. No lo copies a `web/public`, `data` ni otro directorio versionado.
El siguiente comando monta el original en solo lectura, extrae el contenido y lo guarda
en `serverdata/references`; no copia el PDF al volumen ni al repositorio. Indicá la
versión y vigencia reales de tu documento:

```sh
docker compose --profile tools run --rm -v "$PWD/private-input:/input:ro" reference-import /input/daper.pdf --version 05/26 --effective-from 2026-09-11
python3 tools/test_depot_movements.py
```

El importador calcula el SHA-256 del original y lo exige en ambas extracciones. Se leen las columnas
físicas, el estilo tipográfico y los límites de tabla; se conservan página y caja de
cada fragmento. Las continuaciones sin borde de páginas 47, 54 y 58 mantienen el bloque
activo. Una disposición o alineación inesperada produce un error; una columna sin
encabezado reconocido queda en `unresolvedColumns`.

El resultado utiliza `server/var/references/index.json`, bloques y partes de 32
movimientos con nombres derivados de su SHA-256, fuera de Git y del web root. El extractor conserva partes anteriores para que una
pestaña abierta no pierda la versión que estaba leyendo. Las pruebas comprueban todos
los hashes, identidades únicas, páginas, bloques, textos y ausencia de geometrías.
`tools/validate_private_references.py DIRECTORIO` valida una importación real sin imprimir
su contenido operativo. Las pruebas de CI usan referencias sintéticas.

Las consultas usan `/api/v1/references/depot`, `/references/depot/parts/{sha256}`,
`/references/depot/blocks/{sha256}` y `/references/changes` bajo el mismo prefijo API.
Requieren una cuenta habilitada, responden `Cache-Control: no-store` y quedan fuera
de CacheStorage. Una instalación vacía muestra que falta importar el documento.

Para importar una transcripción local de puestos de cambio, añadir
`--changes-json /input/gerbido.json` al comando. El objeto debe contener `posts` con
campos `line`, `place`, `access`, `notes` y `direction: null` mientras no esté confirmado.

## Límites de la interpretación

- USCITA y RIENTRO determinan el tipo del movimiento; no prueban andata/ritorno de línea.
- La normalización de nombres de depósito sirve solo al filtro; el texto original se conserva.
- Los guiones dentro de paréntesis o nombres compuestos no se convierten en giros.
- Condiciones y alternativas se señalan para revisión. Separar un encabezado no resuelve
  automáticamente condiciones internas de su texto.
- Hace falta digitalizar y comprobar cada trazado, sus giros y accesos reales. No se
  solicita una ruta óptima ni se conectan extremos por rectas para suplir información.

La referencia de mantenimiento se genera desde las docstrings del extractor y el
JSDoc de los componentes, mediante [las herramientas de documentación](CODE_DOCUMENTATION.md).
