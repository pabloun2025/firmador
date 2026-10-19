# Propuesta visual: mesa documental

Propuesta de interfaz aislada en `design/editorial-workspace-20261019`.
No publicada. No modifica backend, datos, cuotas ni el flujo de firma.

## Dirección

Verde tinta, papel cálido y superficies de trabajo blancas. Encabezados de acceso
editoriales; tipografía funcional más ligera en los formularios. Bordes precisos,
sombras mínimas, iconos existentes y rana conservada. La ilustración pesada de
acceso se sustituye por una composición documental ligera, sin recursos externos.

## Alcance

Acceso, registro, creación, compartir, seguimiento y pantalla del firmante.
El panel de superadministración conserva su diseño actual. La propuesta no añade
pasos ni modifica textos legales ni promesas de seguridad.

La fuente de cuerpo usa las tipografías disponibles en el equipo, sin descargas
remotas; su apariencia exacta puede variar entre sistemas. Verificación visual
con Chromium a 1440, 768 y 390 píxeles y datos sintéticos, no cuentas reales.

## Revisión

Capturas y resultados de accesibilidad en
`/workspace/review-evidence/design-studio-verified/`. Pruebas de navegador en
`scripts/check-ui.mjs`; pruebas unitarias con `npm test`; compilación con
`npm run build`. Aprobar la dirección visual antes de publicar.
