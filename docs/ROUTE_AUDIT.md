# Revisar recorridos repetidos

Un registro GTFS no equivale necesariamente a un recorrido operativo diferente.
La identidad de sincronización conserva `route_id`, `shape_id`, `direction_id` y
paradas ordenadas para poder seguir cada fuente. Dos identidades pueden describir
el mismo trazado. La auditoría compara su contenido sin alterar esas identidades.

## Resultado del catálogo empaquetado

La comprobación reproducible del snapshot 20261013 está en
[gtfs-duplicate-audit.json](../data/gtfs-duplicate-audit.json).

| Medida | Cantidad | Interpretación |
| --- | ---: | --- |
| Registros de fuente | 633 | Candidatos importados, todos como borradores |
| Códigos de línea | 137 | No son 633 líneas |
| Grupos exactos de trazado/paradas dentro de cada línea | 630 | Tres registros adicionales repiten una huella dentro de su línea |
| Grupos repetidos dentro de la misma línea | 3 | Tres pares; requieren decisión operativa |
| Grupos compartidos entre líneas distintas | 6 | Mantener las líneas separadas |
| Huellas exactas de trazado/paradas sin separar líneas | 624 | Medida geométrica, no cantidad de recorridos operativos aprobados |
| Pares adicionales con geometría cercana y mismas paradas | 0 | Comparación aproximada completa para este snapshot |

Los pares de la misma línea son:

| Línea | Shape A | Shape B |
| --- | --- | --- |
| 17/ | `17BUDi17BR02` | `17BUDi17BR04` |
| 83 | `83UAs83AVR4` | `83UAs83AVR8` |
| 83 | `83UDi66895` | `83UDi83RD4` |

Estos pares tienen las mismas coordenadas ordenadas, paradas y metadatos de
pertenencia en la fuente. Sus identificadores/notas de importación difieren. La
coincidencia no acredita por sí sola condiciones operativas o calendarios que no
forman parte de la navegación fija. Los 633 registros, publicaciones y revisiones
permanecen conservados. No se ha certificado que existan 630 recorridos operativos
únicos ni se han eliminado variantes.

## Auditoría automática y reproducible

```sh
python3 tools/audit_routes.py data/gtt-urban-drafts.json --output /tmp/gtt-audit.json
python3 tools/audit_routes.py server/var/gtfs/current.json --output /tmp/current-audit.json
python3 tools/test_audit_routes.py
```

El lector del catálogo verifica base/correcciones antes de analizar. Los informes
incluyen SHA-256 del conjunto de documentos e identidades, versión del auditor,
contadores y claves de fuente. No vuelven a incluir las geometrías completas.

El worker Docker añade `duplicateAudit` al bundle retenido antes de aplicarlo.
También actualiza bundles anteriores durante el cooldown o con las descargas
pausadas. Usa el mismo lock de descarga/copias; si está ocupado, lo deja para la
próxima comprobación. Nunca modifica `state.json`, ZIP, reservas, claves de fuente,
fingerprints de rutas o revisiones para producir esta evidencia. No hay otra
descarga ni un nuevo servicio programado por esta función.

La igualdad exacta conserva sentido de marcha, tipo, `direction_id`, coordenadas,
orden/repeticiones de paradas, códigos, offsets y datos de cada pertenencia. La
comparación no trata un cambio de shape/trip/calendario como prueba de un camino
diferente. Nombres e identificadores quedan disponibles como procedencia; notas,
instrucciones y video diferentes se señalan para revisión.

Para buscar muestreos distintos del mismo camino, se comparan únicamente pares
de una misma línea/sentido con las mismas paradas y metadatos, permitiendo que
varíen sus offsets medidos. Ambos caminos se miden en orden y se comparan en la
unión de las fracciones de avance de sus vértices. Se exigen diferencias de
longitud y separación de hasta 5 m. Es una señal para revisión, nunca equivalencia
operativa ni un reemplazo de geometría. Se acota a 10.000 pares y dos millones de
vértices; `nearGeometryComplete=false` indica trabajo aproximado pendiente. La
agrupación exacta se completa aunque se alcance ese presupuesto.

## Comparar en la aplicación

Marcar dos recorridos y pulsar **Comparar seleccionados**. El mapa muestra A en
azul y B en naranja, ajusta el encuadre a ambos y conserva las coordenadas guardadas.
Cerrar la comparación restaura los colores de línea. Solo se elige una revisión
activa para GPS; abrir la comparación requiere detener GPS/reproducción virtual.

El panel muestra línea, sentido, tipo, longitud, revisión/estado y coincidencia de
geometría, secuencia de paradas, pertenencias/cambios, instrucciones, observaciones,
fuente y video. Las diferencias se presentan por posición de parada, incluyendo
visitas repetidas, puesto de cambio y sentido. Se muestran 20 a la vez. La igualdad
de geometría en esta vista es exacta: un muestreo diferente aparece como diferencia.
La vista funciona con publicaciones guardadas sin conexión y no realiza escrituras.

En **Fuentes GTT → Revisión de repeticiones GTFS** se consultan los contadores y
grupos del último bundle aplicado. **Comparar versiones actuales** abre los dos
recorridos locales vinculados. Esas revisiones pueden contener trabajo editorial
posterior al análisis de la fuente: el panel las compara nuevamente en el dispositivo.
Si faltan vínculos o hay más de dos miembros, seleccionar dos desde el catálogo.

## Referencias privadas de depósito

```sh
python3 tools/audit_routes.py server/var/references --private-references \
  --output server/var/private-duplicate-audit.json
```

Primero se validan hashes/identidades del índice y sus partes. El informe se
restringe a almacenamiento privado y guarda permisos `0600`; solo muestra claves
opacas/hashes, sin texto operativo. No publicarlo como parte del catálogo GTFS.

El análisis distingue texto y contexto idénticos de planes de calles compartidos.
Conserva título, línea, salida/regreso, extremos, depósito, condiciones y orden de
calles. Aunque dos textos sean iguales, sus posiciones/páginas se conservan como
evidencia. No confirma geometría, accesos ni equivalencia de movimientos sin trazar.

La consolidación de referencias de origen y cualquier cambio de catálogo quedan
pendientes de una decisión documentada por grupo. No usar el número de huellas o
textos como número de recorridos operativos validados. Seguimiento: issue #16.
