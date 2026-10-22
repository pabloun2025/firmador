# Detección de firmas — cambio de política de v1

Solicitud aprobada: detectar firmas y sus nombres, sin evaluar su validez. El
PDF original puede contener cero o varias firmas; cada turno añade exactamente
una, aunque firme otra vez la misma persona. Las iniciales no son turnos LeapSign.

Política nueva: `leapsign-v1.1-signature-detection-1`.
El proceso privado enumera campos de firma rellenos con un contenedor CMS
SignedData legible y al menos un SignerInfo. Ignora campos vacíos y sellos de
tiempo documentales. Extrae el nombre del certificado correspondiente al SID,
sin comprobar su cadena ni autenticidad; si falta, usa el nombre declarado en
la firma o deja «Nombre no disponible». Nunca confunde la CA con el firmante.

Se comparan identificadores SHA-256 del CMS normalizado, no nombres de personas:
los del padre deben seguir presentes y debe aparecer uno nuevo. Cero nuevos y
varios nuevos tienen mensajes distintos. El nombre del archivo ya no bloquea
la subida; las descargas conservan el nombre elegido por el propietario.

**No se verifican** integridad matemática, ByteRange, cobertura, modificaciones
de contenido, actualización incremental, caducidad, confianza, revocación o
validez jurídica. La presencia de CMS no prueba autenticidad ni identifica a
una persona. Un CMS copiado/falsificado pero legible no tiene garantía de validez.
La comparación de presencia tampoco demuestra que se conserve el contenido PDF.
La UI dice «firmas detectadas» y muestra nombres, no «firmas válidas».

Se mantienen PDF legible/no cifrado, límites de recursos/tamaño, rechazo de
contenido activo/adjuntos, cuotas, propietario, descarga previa, turno vigente,
invitación, persistencia atómica y recibos recuperables. En la ruta nueva tampoco
se exige tamaño relativo, páginas idénticas ni prefijo binario. No se envían
P12/PFX, contraseñas o claves privadas al servidor.

## Compatibilidad y publicación

Migración aditiva `20261022020000_signature_detection.sql`: permite la política
nueva y la relación `signatures_detected`, sin reescribir inventarios históricos.
Mantiene soporte de la política anterior para rollback. Las nuevas firmas llevan
`integrity`, `subsequentChanges`, `coverage`, `certificateValidity` y `trust` como
`not_evaluated`, revocación `unknown`; no se fabrican resultados de validación.
El nombre de campo heredado `previousSignaturesIntact` se conserva por contrato:
en la política nueva significa únicamente que los IDs anteriores siguen presentes.

La RPC de liberación de reserva solo actúa antes de subir, con claim y lease
correctos y estado reserved. Evita esperar 120 segundos para corregir un archivo;
no libera validaciones en commit ni recibos aceptados ni reinicia el cupo de intentos.

Respaldo de código previo: etiqueta `v1.1-before-signature-detection`, commit
`21c8bac3290dd5717071d5753d33e00426c46e5f`. Worker previo retenido:
`005d3934-ada6-4d9c-be6d-4483f147054a`. Paquete Edge y exportación anteriores en
`/workspace/restore-points/detection-20261022`, fuera del repositorio y protegidos.
Para volver a la política anterior, restaurar Render al commit previo e instalar
el paquete anterior de submit y ese Worker; la migración admite ambos contratos.
No borrar tablas, PDFs ni recibos. Si hay que apagar la integración, apagar SQL
primero y Edge después según docs/v1.1-release.md.

El motor antiguo queda solo para compatibilidad y diagnóstico histórico: el
worker de aceptación usa `validator.detection`, no el motor criptográfico.

## Verificación y despliegue del 22 de octubre de 2026

- npm: 146 pruebas; Python: 86 (incluyendo 24 de detección, certificados de
  prueba EC/ES); Deno: 6; PostgreSQL: 15 grupos con concurrencia y liberación
  segura de reservas; Chromium/Axe: 161 comprobaciones a 1440/768/390 px.
- Pruebas RED/GREEN del contrato nuevo, mensajes, UI y SQL. Se aceptan firmas
  sintéticas con integridad matemática dañada y con certificado vencido porque
  no se valida eso. Campos vacíos no cuentan. Sin certificado, nombre desconocido.
- Online en Supabase v1 y Render: original ya con dos firmas, pase 1 → tres,
  pase 2 → cuatro; mismo nombre de firmante en todas, nombre de archivo de carga
  totalmente distinto. Se rechazaron cero y dos firmas nuevas con sus mensajes,
  y se pudo corregir inmediatamente el archivo sin esperar el lease. Turnos
  completados: dos, no cuatro. Inventarios/nombres y estados not_evaluated correctos.
- Recibo idéntico en reintento, invitaciones consumidas, aprobación y descarga
  final byte a byte idéntica. Sin emails enviados. Se purgó solo el proceso
  sintético y su usuario temporal; no se eliminaron documentos existentes.
- Migración aplicada en lgsdoutarthfymbjgdrj. Submit versión 25, JWT obligatorio.
  Render instancia free, auto-deploy no; dep-dbd48rjl550s73aj9h70 en f003758.
  Readiness autenticada informa la política de detección. Los secretos no cambiaron.
- Una primera lectura de claves existentes por la API de gestión respondió 500
  antes de crear datos de prueba; repetir esa lectura funcionó. No fue una carga
  rechazada por la aplicación ni se rotaron credenciales para sortearlo.

Persisten las advertencias conocidas de tamaño del bundle y deprecación de
Starlette. No se ha probado el certificado real del usuario ni se afirma un
escaneo oficial de seguridad. V2 no se modificó.
