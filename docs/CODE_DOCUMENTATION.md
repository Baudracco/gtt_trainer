# Documentación generada desde el código

## Un comando

```sh
# Desde la raíz, después de composer install en server y npm ci en web:
sh tools/generate_docs.sh
```

El script también puede invocarse desde otra carpeta. `PHP_BINARY` permite elegir
el ejecutable PHP; Python se ejecuta con `python3`. Abrir `docs/generated/index.html`
o servir esa carpeta con un servidor estático local. No levanta la app, no conecta
Postgres, no inicia sesiones y no descarga GTFS/Panoramax.

| Lenguaje | Herramienta | Entrada | Resultado |
| --- | --- | --- | --- |
| PHP | `tools/generate_php_docs.php`, Reflection/getDocComment nativos | Clases PSR-4 de `server/src` | HTML, Markdown y JSON con firmas/DocBlocks/líneas |
| TypeScript | TypeDoc 0.28.20 | Entry points de `web/typedoc.json` | Sitio HTML navegable y árbol JSON |
| Python | `tools/generate_python_docs.py`, AST estándar | Worker/importadores/extractor | HTML, Markdown y JSON de firmas/docstrings |

Las herramientas PHP/Python son pequeñas y propias, sin un parser de expresiones
regulares que suponga reconocer todo el lenguaje. Reflection toma las firmas reales;
AST obtiene docstrings sin ejecutar imports o efectos del módulo. No se presenta el
generador PHP como phpDocumentor: es una referencia ligera de la API pública.

TypeDoc cubre modelos, geometría/GPS, cliente API, importadores, caché, reproducción
virtual e idiomas. Los componentes se explican además en sus JSDoc y el mapa del
repositorio. Añadir otro módulo público al array `entryPoints` si debe aparecer en la
referencia. Sus constantes y funciones externas no se copian como API del proyecto.

## Convención PHP

```php
/**
 * Create a new draft after checking the optimistic variant version.
 *
 * Published snapshots remain unchanged. The actor is null only for trusted
 * source ingestion; HTTP callers must already have checked editor authority.
 *
 * @param array $document A RouteValidator-normalized complete document.
 * @throws ApiError On stale version, trash state or stop identity conflict.
 * @return array The newly created revision snapshot.
 */
```

Explicar propósito, entrada validada/no validada, unidades y efectos. Un constructor
puede documentar qué conexión/transacción comparte. Evitar que la documentación
prometa autorización dentro de un método si realmente debe comprobarla el controller.

El generador exige DocBlock de cada clase y método público declarado en `server/src`.
Los heredados del runtime no necesitan repetirse. Métodos privados complejos tienen
comentarios, pero la referencia pública no los trata como contrato estable.

## Convención TypeScript y Python

JSDoc `/** ... */` se coloca inmediatamente antes del tipo/función exportada.
Distinguir la revisión inmutable del número de versión para concurrencia, unidades
metros/km/h/grados y posición local del dispositivo. TypeDoc verifica Function,
Class y TypeAlias públicos de sus entry points y trata warnings como errores.

Los docstrings Python describen efectos y recuperación: reserva antes de HTTP,
archivos atómicos, selección de feed, patrones rechazados y retención del último
bundle bueno. Sus métodos críticos explican por qué fallar no autoriza una segunda
descarga inmediata. El generador AST nunca ejecuta `main()` ni importa el worker.

## CI y actualización

El job `documentation` instala dependencias fijadas, genera todas las referencias y
sube **maintainer-docs** como artefacto del commit. Los enlaces internos de los
manuales se comprueban con `python3 tools/check_docs.py`. Los manuales se leen en
GitHub; el artefacto HTML permite navegar la API fuera de GitHub.

`docs/generated/` está ignorado en Git para evitar referencias obsoletas y grandes
diffs de HTML minificado. Se versionan comentarios, configuración y generadores.
Cuando cambia un contrato, actualizar su DocBlock, OpenAPI cuando corresponda y el
manual que lo explica. El artefacto siempre debe corresponder al commit revisado.
