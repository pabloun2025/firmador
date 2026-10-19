# Propuesta visual: mesa documental

Propuesta de interfaz aislada en `design/editorial-workspace-20261019`.
Publicación autorizada por el propietario el 19 de octubre de 2026.
No modifica backend, datos, cuotas ni el flujo de firma.

## Dirección

Verde tinta, papel cálido y superficies de trabajo blancas. Encabezados de acceso
editoriales; tipografía funcional más ligera en los formularios. Bordes precisos,
sombras mínimas, iconos existentes y rana conservada. La ilustración pesada de
acceso se sustituye por una composición documental ligera, sin recursos externos.
La rana elegida (opción 2) se utiliza en el logo, favicon y personaje con pluma.
Animación CSS de salto y rúbricas: una vez al acceder, ciclo durante la espera,
control para pausar y alternativa estática con movimiento reducido. Recursos
WebP locales de aproximadamente 20 KB en conjunto; sin vídeo ni librería adicional.

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
