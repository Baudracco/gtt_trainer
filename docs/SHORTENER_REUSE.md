# Patrones adaptados de Shortener

GTT Trainer tomó patrones de diseño del proyecto Shortener del usuario. La consulta
fue en solo lectura. La implementación de GTT y sus pruebas se mantienen en este
repositorio; Shortener no se modificó. Este documento público describe el alcance
funcional sin publicar rutas, revisiones o metadatos de su repositorio privado.

## Qué se tomó y por qué

| Patrón de Shortener | Implementación propia en GTT Trainer | Motivo |
| --- | --- | --- |
| Bloqueo de archivos con espera máxima | `server/src/FileLock.php` | Escribir diagnósticos concurrentes sin intercalar registros ni bloquear una respuesta indefinidamente |
| Registros redundantes en DB/archivo/salida crítica | `ErrorLogger.php`, `system_logs`, NDJSON y log PHP | Conservar evidencia aunque una salida esté caída |
| Respuesta JSON uniforme y catálogo estable de errores | Envoltorio data/error/trace y `ErrorCatalog.php` | Contrato uniforme y diagnóstico correlacionado |
| Documentar errores, límites y verificaciones | OpenAPI, catálogo y pruebas HTTP | Reproducir comportamiento y detectar regresiones |

No se trasladó un módulo completo de Shortener. FileLock implementa el patrón con
las primitivas estándar PHP `flock`, `hrtime` y `fwrite`; su contrato y sus pruebas
son específicos de GTT. [Documentación primaria de flock](https://www.php.net/manual/en/function.flock.php).

## Decisiones de la implementación GTT

La adquisición usa flock no bloqueante con espera acotada, reloj monotónico y un
máximo de 250 ms por defecto. La escritura cuenta bytes UTF-8 con strlen y contempla
escrituras parciales. Devuelve false en fallo y no intenta registrar su propio error
recursivamente. El directorio lo prepara el despliegue y los archivos nuevos usan
permisos 0600.

Los tres registros diagnósticos son independientes y siempre se intenta el log
nativo PHP. El sink DB se omite dentro de una transacción: podría estar abortada o
perder el registro con un rollback. No se abre otra conexión en el camino del error.
El archivo se intenta aunque DB falle; un lock ocupado vence sin suprimir la salida
nativa. La auditoría de negocio sigue siendo transaccional y separada.

Los números 2001–2019 y 2099 pertenecen a GTT. No se importaron códigos con otros
significados. `error.code` permanece compatible y `error.number` añade un identificador
estable. El trace conecta API y logs. Se omiten mensajes crudos, cuerpos, passwords,
cookies, parámetros SQL y fixes GPS.

## Partes específicas de GTT

La autenticación usa sesiones same-origin, CSRF y Argon2id. No incorpora claves,
credenciales ni el despliegue de Shortener. Geometría, GPS, pertenencias de paradas,
revisiones inmutables, GTFS automático, medios y Panoramax se implementaron para GTT.
La separación mantiene contratos propios y evita acoplar productos de dominios distintos.

Se comprueban contención de archivos, timeout, escritura UTF-8 por bytes, falla de
archivo, tres sinks con Postgres y transacción activa. El catálogo verifica números
únicos y la declaración de los errores públicos. La documentación generada explica
los contratos del código GTT sin incorporar archivos del proyecto privado.
