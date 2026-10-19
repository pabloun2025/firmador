# Revisión de calidad de LeapSign — 19 de octubre de 2026

Cambios preparados en `improvements/leapsign-ux-review-20261017`, sin despliegue,
migraciones ni modificaciones de datos reales. Punto de recuperación previo:
`restore/leapsign-2026-10-19`, commit `53b3b2e`.

## Skills aplicadas

- Frontend Design: conservar la identidad verde y la rana, priorizar las tareas
  operativas, ajustar composición móvil y revisar pantallas realmente renderizadas.
- Superpowers: investigar causas, reproducir fallos antes de corregirlos, TDD y
  comprobación antes de declarar resultados. Se restauró el registro del plugin
  7.0.0 porque el directorio de configuración temporal se había reiniciado.
- Karpathy Guidelines: cambios localizados; sin cambio de stack, reescrituras,
  dependencias nuevas de aplicación ni servicios de IA adicionales.

## Mejoras implementadas

- Errores de creación inmediatamente bajo la acción, contraste y foco visibles,
  campos móviles de 16 px, cabecera sin esquinas cortadas y agenda más legible.
- Seguimiento sin bloque duplicado de información; formulario de entrada oculto
  cuando ya se está esperando. Se mantienen compartir, histórico y minijuego.
- Estado de carga de sesión y documentos; los fallos de consulta no se presentan
  como una agenda/proceso vacío. Actualizar permite recuperar una primera carga
  fallida del seguimiento y conserva los datos anteriores ante errores posteriores.
- Consultas automáticas serializadas, pausadas en pestañas ocultas o sin conexión.
  Se evita duplicar solicitudes de turno y creación, y se verifica la sesión una
  sola vez por actualización del seguimiento, sin debilitar la autorización.
- Un turno nuevo limpia la descarga, el archivo seleccionado y la revisión previos.
- El editor administrativo conserva el texto tras un guardado fallido, muestra
  el error dentro del diálogo y gestiona foco, Tab y Escape.
- La descarga comprueba que la versión pertenece al proceso solicitado y no
  anuncia éxito si falla el registro de revisión. Las consultas fallidas devuelven
  un error temporal, no colecciones vacías ni diagnósticos privados de la base.
- El validador detecta JavaScript y adjuntos también en objetos PDF comprimidos;
  inspecciona los objetos sin reserializar el documento ni alterar sus bytes.
- En móvil no se solicita la ilustración de escritorio de aproximadamente 1,2 MB.

## Evidencia y alcance de las pruebas

- `npm test`: 91 pruebas correctas, incluyendo ejecución de handlers Edge reales
  con el cliente externo sustituido, control de propietario, turnos caducados,
  fallo de datos, aislamiento entre procesos y ausencia de consultas solapadas.
- Deno: 6 pruebas reales del parser PDF correctas. Las pruebas comprimidas fallaron
  antes de la corrección; se comprobó además que la inspección no cambia los bytes.
- `scripts/check-ui.mjs`: 131 comprobaciones correctas en Chromium a 1440, 768 y
  390 px. Creación, enlace, WhatsApp, agenda, invitación, seguimiento, descarga,
  selección y rechazo de archivos, nuevo turno, envío y confirmación final.
- Se renderizaron también acceso, registro, cola y las cinco secciones del
  superadmin. Se revisaron capturas representativas; se conservaron 39 capturas y
  39 informes axe sin infracciones detectadas de las reglas WCAG A/AA ejecutadas.
  Esto no equivale a una certificación de accesibilidad ni a probar Safari/iOS real.
- PostgreSQL 17 aislado: reservas concurrentes sin sobrepasar cuotas, permisos,
  modo de emergencia, almacenamiento, agenda, dos plazas frente a doce solicitudes
  simultáneas, mantenimiento interno y recuperación administrativa atómica.
- `npm run build` y typecheck Deno de las 15 funciones correctos; `npm audit` sin
  vulnerabilidades y comprobación de secretos sin hallazgos. El typecheck usa un
  import map local Supabase npm 2.117.3, no demuestra resolución JSR en producción.

Las pruebas de interfaz interceptan toda petición externa y usan usuarios y
respuestas ficticios. No prueban entrega real de Resend/SMTP, MFA real, un circuito
completo contra Supabase de pruebas ni validez criptográfica de firmas PAdES.
El SQL utiliza un baseline sintético, no el bootstrap histórico completo.

Capturas y reportes del entorno:
`/workspace/review-evidence/leapsign-2026-10-19/verified/`.

## Repetir las pruebas de navegador

Con Chromium instalado y `npm run dev -- --host 127.0.0.1` en otra terminal:

```bash
npm install --prefix /tmp/leapsign-review --ignore-scripts playwright@1.64.1 axe-core@4.10.3
PLAYWRIGHT_MODULE=/tmp/leapsign-review/node_modules/playwright/index.mjs AXE_CORE_PATH=/tmp/leapsign-review/node_modules/axe-core/axe.min.js node scripts/check-ui.mjs
```

El runner solo admite `127.0.0.1` y bloquea destinos externos. Para PDF:

```bash
npx --yes --package deno@2.9.6 deno test --no-config --no-lock --node-modules-dir=auto scripts/test-pdf-validation.ts
```

## Pendientes y límites

- Revisar en un entorno Supabase independiente correo, recuperación/MFA y flujo
  integrado con documentos de prueba antes de autorizar el despliegue.
- Validar WAF, límites de Auth/REST, Spend Cap y facturación en los proveedores.
  Las cuotas internas se conservan, pero no garantizan un máximo de factura ni
  agregan el gasto de bases independientes; Cloudflare no cubre por sí solo el
  acceso directo al origen Supabase ni la reutilización de URLs aún vigentes.
- Permanece el aviso de Vite por un bundle principal de unos 513 kB (145 kB gzip).
  No se ocultó el aviso ni se introdujo una fragmentación especulativa.
- El parser no es un antivirus ni un verificador criptográfico de firmas; tampoco
  se afirma protección absoluta frente a documentos patológicos o agotamiento de
  recursos del parser. Se mantienen los límites existentes de tamaño y páginas.
- El bootstrap histórico de migraciones requiere una revisión separada. No se
  aplicaron cambios en base de datos ni se tocó CadenaPDF en esta intervención.
