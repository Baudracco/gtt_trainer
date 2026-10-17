# Documentación de GTT Trainer

El producto permite estudiar, editar y seguir recorridos fijos de GTT. La geometría
y el orden de cada variante son el contrato principal. Los cambios de una fuente,
las fotos de calle y el GPS nunca recalculan una publicación.

## Por dónde empezar

| Necesidad | Documento |
| --- | --- |
| Instalar y crear el primer administrador | [README del proyecto](../README.md) |
| Usar mapas, GPS, referencias y editor | [Manual de uso](USER_GUIDE.md) |
| Entender servicios, revisiones, datos y decisiones | [Arquitectura](ARCHITECTURE.md) |
| Continuar el desarrollo y ejecutar pruebas | [Guía del desarrollador](DEVELOPER_GUIDE.md) |
| Generar referencias desde comentarios del código | [Documentación automática](CODE_DOCUMENTATION.md) |
| Configurar Docker, HTTPS, copias y recuperación | [Despliegue y recuperación](DEPLOYMENT.md) |
| Copias diarias verificadas y ensayo de restauración | [Copias automáticas](BACKUPS.md) |
| Configurar el proxy TLS y comprobar producción | [HTTPS](PRODUCTION_HTTPS.md) |
| Desarrollo local, importadores y verificación existente | [Operación](OPERATIONS.md) |
| Descarga automática GTT, hash, cooldown y conflictos | [Sincronización GTFS](GTFS_SYNC.md) |
| Panoramax, panoramas 360°, velocidades y cobertura | [Recorridos virtuales](VIRTUAL_TOURS.md) |
| Capturar vértices con GPS y descargar tramos separados | [Grabación GPS](GPS_RECORDING.md) |
| Fotos por giro, video, acceso privado y URLs | [Material visual](MEDIA_AND_URLS.md) |
| Datos incorporados, procedencia y límites | [Fuentes](SOURCES.md) |
| Trazar y continuar movimientos individuales de depósito | [Movimientos DAPER](DEPOT_MOVEMENTS.md) |
| Revisar repeticiones y comparar dos variantes | [Auditoría de recorridos](ROUTE_AUDIT.md) |
| API completa | [OpenAPI](openapi.yaml) y [catálogo de errores](API_RESPONSE_CATALOG.md) |
| Qué se adaptó del proyecto Shortener | [Reutilización verificada](SHORTENER_REUSE.md) |
| Estado de implementación y datos aún pendientes | [Hoja de ruta](ROADMAP.md) |

## Estado del catálogo empaquetado

El snapshot oficial 20261013 contiene 633 variantes válidas seleccionadas de 137
códigos de línea urbana: 581 variantes de bus y 52 de tranvía. La selección incluye
todos los registros `agency_id=U`, `route_type=0/3` del feed, no solo las líneas
relacionadas con Gerbido. Los 31 patrones antes rechazados se recuperaron al corregir la proyección global de paradas; siguen sujetos a revisión operativa.

Las 139 variantes del primer lote siguen incluidas y su manifiesto original queda
como evidencia. Una línea puede tener varios shapes, sentidos, parciales y patrones
de paradas; 633 variantes no significa 633 líneas. Todas se importan como borradores.
La auditoría detectó tres pares con el mismo trazado y paradas dentro de su línea:
630 grupos por línea y seis pares adicionales compartidos entre líneas distintas.
Estos contadores no certifican recorridos operativos únicos; las identidades y su
historial se conservan. [Resultado y comparación](ROUTE_AUDIT.md).

El material operativo aportado se importa al volumen privado y requiere sesión.
El catálogo permite iniciar y continuar trazados individuales, que requieren
geometrías verificadas por movimiento. Los puestos y accesos deben confirmar su sentido operativo. Los PDF de servicios,
tranvías y turnos que el usuario aún no entregó siguen como trabajo de datos pendiente.

## Referencias generadas

Después de `sh tools/generate_docs.sh`, abrir `docs/generated/index.html`. Incluye
HTML/JSON/Markdown de PHP y Python y HTML/JSON de TypeScript. CI genera el artefacto
**maintainer-docs** en cada PR; no hace falta tener Docker ni ejecutar un worker para
leerlo. Los manuales y comentarios se versionan; los archivos generados se regeneran.
