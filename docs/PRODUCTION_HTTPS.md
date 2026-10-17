# HTTPS para el paquete Docker

La aplicación conserva Nginx como servidor de archivos/URLs amigables y PHP-FPM
como API. El override de producción añade Caddy delante para TLS y renovación de
certificados. Node se utiliza durante la construcción de React, no como servidor
de la aplicación desplegada.

| Servicio | Exposición |
| --- | --- |
| `https` (Caddy) | Puertos públicos 80 y 443; redirección HTTP→HTTPS y certificados |
| `web` (Nginx) | HTTP interno; 8080 del host permanece en loopback |
| `api` (PHP-FPM) | Puerto interno 9000; sesiones/CSRF, API y reportes |
| `db` (PostGIS) | Red interna; 5432 del host permanece en loopback |
| `gtfs-sync`, `backups` | Workers internos con volúmenes persistentes |

## Preparar el dominio y arrancar

Usar un hostname propio cuyos registros A/AAAA apunten al servidor. El servidor
debe ser accesible por los puertos públicos 80/443 para la validación y servicio
HTTPS. Eliminar registros AAAA que apunten a otro destino. Si otro proxy ya ocupa
esos puertos, aplicar su configuración equivalente y conservar el compose base.

Configurar `.env` privado; el origin debe ser exactamente el que enviará el navegador,
en minúsculas, sin slash final ni puerto 443 explícito. Sustituir el dominio de ejemplo:

```dotenv
APP_DOMAIN=trainer.example.org
APP_ORIGIN=https://trainer.example.org
APP_ENV=production
```

Conservar una contraseña PostgreSQL privada de al menos 16 caracteres, diferente
del ejemplo. El validador consulta el JSON resuelto por Compose sin imprimir secretos:

```sh
python3 tools/check_production.py
docker compose -f docker-compose.yml -f docker-compose.production.yml up --build -d
docker compose -f docker-compose.yml -f docker-compose.production.yml logs --tail=100 https
```

Los certificados/claves persisten en `caddydata`; conservar también `caddyconfig`.
Estos volúmenes y `.env` pertenecen a la protección de infraestructura. El worker
de [copias de aplicación](BACKUPS.md) protege la base, medios, referencias y reserva
GTFS; conservar una réplica protegida de configuración/certificados fuera del host.

## IP del cliente y cookies

Caddy prepara las cabeceras de proxy; Nginx acepta `X-Forwarded-For` únicamente desde
la dirección del servicio `https`, resuelta al cargar configuración. Esto conserva
los límites por cliente sin confiar en cabeceras de cualquier visitante. Se inicia
`https` antes de `web` para disponer de ese nombre DNS. Si se reemplaza el contenedor
Caddy por otro con distinta dirección, recrear o recargar Nginx para resolverla otra vez:

```sh
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --force-recreate web
```

`APP_ENV=production` activa la cookie Secure y HSTS de la API; Caddy añade HSTS al
sitio HTTPS. `APP_ORIGIN` valida el Origin de las escrituras. El mismo dominio sirve
la interfaz y `/api/v1`; se conservan las URLs de revisión/reporte y la política sin
query params. El perfil base sigue disponible para desarrollo local.

## Comprobar en el servidor y teléfono

1. Abrir la URL pública y comprobar certificado válido/redirección desde HTTP.
2. Iniciar sesión y guardar un borrador; comprobar sesión/CSRF desde el origin real.
3. Abrir foto, avanzar un video, generar un PDF y consultar referencias con sesión.
4. Dar permiso GPS desde el teléfono y comprobar voz, señal temporalmente ausente,
   desvío y retorno al trazado durante una prueba real controlada.
5. Verificar estado GTFS y última copia; conservar las fechas de la reserva original.

El validador comprueba sintaxis de hostname/origin, cookie, contraseña de ejemplo,
dependencia del proxy y puertos de loopback. DNS público, emisión real de certificado
y GPS físico se comprueban en el destino. El paquete no selecciona ni modifica un
servidor recordado de otro proyecto.

## Validación automatizada

CI resuelve el compose de producción con un dominio sintético, provisiona/valida la
configuración Caddy y comprueba `nginx -t` con un peer DNS temporal. El peer ejecuta
solo una espera; no se arranca un sitio HTTPS ni se solicitan certificados a una CA.
El resto del paquete se prueba con HTTP real, navegador, PostgreSQL y restauración.

Referencias de mantenimiento: [HTTPS de Caddy](https://caddyserver.com/docs/quick-starts/https),
[reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) y
[direcciones confiables de Nginx](https://nginx.org/en/docs/http/ngx_http_realip_module.html).
