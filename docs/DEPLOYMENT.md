# Despliegue, mantenimiento y recuperación

## Contenedores

La instalación usa `docker compose up --build -d`. Requiere `.env` privado con una
contraseña PostgreSQL local fuerte. El compose publicado enlaza HTTP 8080 y DB 5432
solo a loopback; exponer el servicio al teléfono requiere un proxy HTTPS confiable.

| Servicio | Función | Reinicio/datos |
| --- | --- | --- |
| `web` | Nginx, assets y FastCGI | `unless-stopped`; medios en solo lectura |
| `api` | PHP-FPM y migraciones al arrancar | `unless-stopped`; `serverdata` |
| `db` | PostGIS | `unless-stopped`; `pgdata`, healthcheck |
| `gtfs-sync` | Daemon Python y CLI de ingestión | `unless-stopped`; `serverdata`, espera DB sana |
| `reference-import` | Herramienta opcional de importación privada, perfil `tools` | Ejecución puntual; `serverdata/references`; original montado en solo lectura |
| `backups` | Copia diaria y herramientas de verificación/restauración aislada | `unless-stopped`; volumen privado `backups`, fuente en solo lectura |

El worker no necesita cron. Al arrancar adopta el catálogo empaquetado y su fecha de
descarga, luego aplica un bundle validado. Sus chequeos locales horarios no equivalen
a una descarga cada hora. Reiniciar el contenedor conserva el cooldown.

No ejecutar `docker compose down -v` sobre una instalación que se quiera conservar:
los volúmenes contienen rutas, auditoría, archivos y la reserva GTFS. Ese comando
solo se usa en CI o instalaciones descartables.

## Variables

| Variable | Función |
| --- | --- |
| `POSTGRES_PASSWORD` | Secreto local usado por los servicios, nunca en Git |
| `DATABASE_DSN`, `DATABASE_USER`, `DATABASE_PASSWORD` | Conexión PHP/CLI, definida por compose |
| `APP_ENV` | `development` solo local; otro valor activa cookie Secure/HSTS |
| `APP_ORIGIN` | Origin público exacto, sin path, para escrituras/CSRF |
| `GTFS_DOWNLOAD_ENABLED` | `1` normal; `0` pausa HTTP sin borrar bundle/cooldown |
| `MEDIA_ACCEL_REDIRECT` | `1` con Nginx del paquete; fallback PHP para desarrollo |
| `MEDIA_DIR` | Directorio privado de medios si se configura otro volumen |
| `REFERENCE_DIR` | Directorio privado de referencias; por defecto `server/var/references`, excluido de Git y del web root |
| `BACKUP_INTERVAL_HOURS`, `BACKUP_KEEP` | Intervalo de copias y cantidad de copias completas retenidas; por defecto 24 h y 7 |
| `POSTGRES_DB` | Base usada por todos los servicios; por defecto `gtt_trainer`, permite elegir una base ya restaurada |
| `AUDIT_FALLBACK_LOG` | NDJSON diagnóstico privado; compose usa `serverdata/errors.log` |
| `VITE_TILE_URL`, `VITE_TILE_ATTRIBUTION` | Proveedor raster opcional fijado al construir la web |

`tools/gtfs-sync-config.json` configura cooldown (24–8760 horas) y selección. Tras
cambiar código/config reconstruir los servicios. Si se conservó el ZIP, otra selección
se procesa sin HTTP; no borrar la reserva para forzar una descarga.

## Publicación detrás de HTTPS

Terminar TLS en un proxy administrado, reenviar a Nginx local y fijar `APP_ENV=production`
y `APP_ORIGIN=https://dominio-real`. Recrear API/worker para aplicar configuración.
Configurar la IP confiable del proxy para que FastCGI REMOTE_ADDR sea el cliente real;
no aceptar sin validación X-Forwarded-For suministrado por Internet. Verificar login,
CSRF, medios, reportes y permiso GPS desde la URL pública.

El entorno de desarrollo usa una cuenta DB única por comodidad. En producción
separar propietario de migraciones y rol de aplicación: DML/seq de tablas necesarias,
sin superuser ni DDL. El arranque automático de migraciones requiere ejecutarlo con
el propietario antes de iniciar un FPM con rol restringido; adaptar el entrypoint de
ese despliegue. No se afirma que el compose local ya cree esa separación de roles.

Crear usuarios mediante `user:create` con contraseña por stdin, como muestra el
README. No colocar contraseñas en argumentos, URL, logs o historial. Viewer lee;
editor trabaja borradores; admin publica después de verificación operativa.

## Controles operativos

```sh
docker compose ps
docker compose logs --tail=100 gtfs-sync
docker compose logs --tail=100 api
curl -fsS http://localhost:8080/api/v1/health
```

`/health` comprueba el proceso HTTP y su versión, no toda la DB ni el worker. Para
GTFS usar la pestaña Fuentes GTT con un editor: SHA, último intento, próximo intento,
resumen y conflictos. El estado también existe en `server/var/gtfs/state.json`; leerlo
no autoriza a modificar sus fechas. Una falla no borra el último catálogo bueno.

Para un error 500 correlacionar X-Trace-Id con `system_logs.trace_id`, el NDJSON y
stderr PHP. Son diagnósticos saneados; las acciones de negocio están en audit_events
con su actor y revisión. El archivo usa lock acotado y una falla de archivo/DB no
suprime el registro nativo. Rotar/archivar los logs con una política del despliegue;
`system_logs` puede purgarse por antigüedad acordada, `audit_events` es append-only.

La caché streetview es prescindible y puede limpiarse por expiración. Los medios
históricos y el estado GTFS no son cachés descartables: no borrarlos automáticamente.
Las subidas sin usar se conservan hasta una política de retención revisada; no hay
un recolector destructivo silencioso.

## Copias y recuperación

El compose incluye un worker de copias diarias verificadas y restauración en otra
base/volumen. El [manual de copias automáticas](BACKUPS.md) describe el snapshot
compartido DB/medios, locks de GTFS/referencias, retención, verificación, comandos,
permisos y el ensayo Docker/HTTP de CI. Conservar el commit y configuración de secretos
fuera del volumen; respaldar también los originales aportados y una segunda copia
protegida fuera del host.
