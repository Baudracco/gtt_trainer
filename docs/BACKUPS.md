# Copias automáticas y restauración

El servicio Docker `backups` toma una copia privada cada 24 horas y conserva las
siete últimas copias completas. Espera las migraciones y la primera adopción GTFS;
no necesita cron ni acceso al socket Docker. El calendario y el último resultado
persisten en el volumen `backups`. Reiniciar el contenedor conserva ese estado.

`BACKUP_INTERVAL_HOURS` admite 1–168 horas; `BACKUP_KEEP`, 2–365 copias. Un intento
fallido conserva la última copia completa y se reintenta después de una hora. El
healthcheck falla si no existe una copia exitosa o tiene más de dos intervalos de edad.

## Contenido y coherencia

Cada directorio `gtt-backup-FECHA-ID` contiene tres archivos privados:

| Archivo | Contenido |
| --- | --- |
| `database.dump` | Dump custom de PostgreSQL: cuentas, revisiones, paradas, instrucciones, enlaces, medios, fuentes y auditoría |
| `files.tar` | Medios originales normalizados, thumbnails, reserva/bundle/ZIP GTFS y referencias operativas privadas |
| `manifest.json` | SHA-256 y tamaño de artefactos/miembros, conteos de tablas y checksums de migraciones |

El inventario de medios y `pg_dump` comparten un snapshot exportado REPEATABLE READ.
Los archivos de medios se escriben antes del commit de sus metadatos y permanecen
inmutables; se copian después del snapshot, comprobando su SHA comprometido en DB.
Un futuro recolector de medios deberá respetar las copias en curso antes de eliminar
archivos históricos. El estado mutable GTFS se captura bajo su lock; las referencias,
bajo el lock de importación, conservando todas sus partes inmutables.

La copia verifica reserva/bundle/ZIP, referencias privadas, cada miembro y ambos
artefactos antes de publicar el directorio completo mediante rename atómico. Las
copias parciales nunca son candidatas de restauración o retención. La limpieza solo
elimina directorios reconocidos y verificados; mantiene la copia recién creada y
no toca otros directorios del volumen.

El dump es consistente con una instantánea de la base, no con cada escritura posterior
del servicio. Usuarios e historial conservan sus identidades. Los logs de archivo,
las sesiones PHP del contenedor, `.env`, el código y los PDF originales montados para
importación se conservan por separado; el texto operativo importado sí está incluido.
Guardar el commit desplegado y los secretos en el procedimiento del despliegue.

## Consultar y crear una copia

```sh
docker compose exec backups python3 /opt/gtt/tools/backup.py status
docker compose run --rm --no-deps backups once
```

`once` crea una copia adicional completa y actualiza el calendario. El resultado
incluye su nombre y el SHA-256 del manifiesto. Para comprobar una copia concreta:

```sh
docker compose run --rm --no-deps backups verify --bundle /backups/NOMBRE-DE-LA-COPIA
```

Los directorios tienen modo 0700 y los artefactos 0600; el volumen no se monta en
Nginx. El límite actual es 50 GiB por artefacto y por conjunto de archivos expandidos;
una copia demasiado grande falla conservando la anterior. SHA-256 detecta cambios,
no autentica el origen: restaurar copias propias y mantenerlas protegidas.

El volumen local requiere una segunda copia protegida fuera del host para cubrir
la pérdida del servidor. Se puede extraer con `docker compose cp backups:/backups
/ruta/privada` o con la herramienta de copias del despliegue; no publicarlo en GitHub.

## Restaurar primero en aislamiento

Elegir una base y un volumen nuevos. El comando exige un nombre `gtt_restore_…`,
rechaza bases existentes y destinos no vacíos, y deja la instalación activa disponible:

```sh
docker compose run --rm --no-deps -v gtt-restored-review:/restore backups restore --bundle /backups/NOMBRE-DE-LA-COPIA --database gtt_restore_review --output-dir /restore
```

Se comprueban todos los hashes, rutas, tamaños y miembros antes de crear la base.
`pg_restore` ejecuta una sola transacción y aborta ante errores. Después se comparan
conteos y migraciones, se extraen solo archivos regulares mediante creación exclusiva
y se restablecen permisos para PHP/Nginx (UID/GID 33). Los enlaces, rutas externas,
duplicados y archivos inesperados se rechazan; no se utiliza `extractall`.

Si el ensayo falla después de crear la base aislada, esta se conserva para diagnóstico
y no se vuelve a usar su nombre. La herramienta no borra ni reutiliza bases existentes.
El estado GTFS se restaura con sus fechas originales, sin ajustar o reiniciar el cooldown.

Para una sustitución planificada, detener escrituras, elegir `POSTGRES_DB=gtt_restore_review`
y montar el volumen restaurado con [el override de volumen](../deploy/restore-volume.example.yml).
Recrear los servicios con el mismo commit, comprobar login, historial/publicación,
fotos, video, PDF, referencias y Fuentes GTT, y crear una copia nueva tras el cambio.
Las sesiones PHP anteriores no se trasladan al contenedor nuevo.

## Ensayo automático

CI usa PostgreSQL/PostGIS y contenedores reales. Publica una ruta sintética de prueba
sobre la geometría GTT, guarda foto/video y referencias ficticias, crea una copia y
la restaura en otra base/volumen. Abre un segundo servidor HTTP, verifica publicación,
geometría, fotos, rangos de video, PDF y consulta privada; comprueba la inmutabilidad
de la publicación restaurada y una reserva GTFS con reloj de prueba, sin hacer HTTP
a GTT. Al final elimina únicamente los recursos aislados que acaba de crear.

`tools/smoke_backup.py` exige `GTT_ISOLATED_CI=1` y está reservado al proyecto CI
descartable. `tools/test_backup.py` cubre corrupción, traversal/enlaces, límites,
destinos existentes, exclusión entre workers, calendario persistente y retención.
