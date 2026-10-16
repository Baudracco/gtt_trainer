# GTT Trainer

Aplicación web para celular y escritorio: estudio y navegación GPS de recorridos fijos de transporte público de Torino.

Permite superponer variantes, mostrar/ocultar recorridos y paradas, detectar paradas de varias líneas,
marcar puestos de cambio por sentido, editar instrucciones y observaciones, y descargar reportes PDF.
El navegador sigue la geometría guardada y avisa de desvíos sin recalcular el recorrido.

React/TypeScript + MapLibre, PHP 8.3, PostgreSQL/PostGIS. Sesiones, roles, CSRF, límites de solicitudes,
revisiones inmutables, revisión/publicación, papelera/restauración e historial auditable.

Incluye un catálogo inicial de **139 variantes GTFS oficiales** como borradores, **133 bloques DAPER**
de referencia de depósitos y **30 entradas de puestos de cambio de Gerbido**. Los nombres andata/ritorno,
las maniobras detalladas y los movimientos DAPER se validan antes de publicación; no se inventan geometrías.

Inicio local con Docker:

```sh
cp .env.example .env
# Cambiar POSTGRES_PASSWORD en .env por una contraseña local fuerte.
docker compose up --build -d
read -rs -p 'Contraseña del administrador: ' GTT_ADMIN_PASSWORD
printf '%s\n' "$GTT_ADMIN_PASSWORD" | docker compose exec -T api php bin/console.php user:create admin@example.com admin
unset GTT_ADMIN_PASSWORD
```

Abrir http://localhost:8080 e iniciar sesión. Revisar una variante, generar y completar sus instrucciones,
enviarla a revisión y publicarla. Los visitantes ven las revisiones publicadas. El catálogo conserva el
trazado original aunque cambien horarios o condiciones de tráfico. No hay credenciales predeterminadas.

El servicio `gtfs-sync` carga el catálogo inicial y actualiza automáticamente desde GTT. Compara el
SHA-256 del ZIP y respeta **al menos 24 horas entre intentos**, incluidos los fallidos, también tras
reiniciar Docker. El intervalo se configura en `tools/gtfs-sync-config.json` (mínimo 24). Un ZIP sin
cambios evita la conversión; un cambio solo de horarios no crea revisiones. Los cambios de recorrido
crean borradores, conservando la publicación y las ediciones manuales. La pestaña **Fuentes GTT**
muestra el hash, las descargas y los pendientes. No es necesario importar el catálogo a mano.

GPS en el celular requiere HTTPS y permiso de ubicación; la posición permanece en el dispositivo.
Se conservan recorridos publicados para consulta sin conexión; el mapa de fondo necesita conexión.

Documentación: [arquitectura](docs/ARCHITECTURE.md), [estado y pendientes](docs/ROADMAP.md),
[operación e importación](docs/OPERATIONS.md), [fuentes y licencias](docs/SOURCES.md),
[OpenAPI](docs/openapi.yaml), [errores](docs/API_RESPONSE_CATALOG.md).

Fotos por giro, video completo, rangos de reproducción y enlaces compartibles:
[material visual y URLs](docs/MEDIA_AND_URLS.md).

Los cambios se realizan mediante ramas y PR a `main`, con verificaciones registradas en GitHub.
El usuario autorizó el 15/10/2026 la creación de PR y los merges autónomos después de verificarlos.
