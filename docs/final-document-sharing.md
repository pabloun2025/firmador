# Compartir la versión final

Preparado en código; no desplegado. Requiere publicar el frontend y las funciones
`owner-final-share` y `download-final-share`. Sin nuevas tablas, migraciones,
proveedores ni credenciales. No modifica el flujo de firma ni los PDF.

## Flujo

Tras aceptar la versión final, el propietario ve el enlace y los botones de
copiar, WhatsApp y correo. La pantalla se desplaza al bloque de compartir tras el
cierre. El bloque también está disponible al abrir procesos finalizados.

WhatsApp abre un mensaje de descarga, no una invitación de firma. Correo abre
la aplicación habitual con asunto y cuerpo preparados (`mailto:`); **no envía
desde Resend** ni almacena destinatarios. La fecha del mensaje indica hora de
Madrid de forma explícita. La UI presenta la fecha en la zona del dispositivo.

El destinatario abre `/f/<identificador>#<capacidad>` y puede descargar sin cuenta
ni turno. No ve participantes, correos, historial ni controles del creador.

## Controles

- Solo un propietario autenticado puede generar el enlace. Se valida owner_id,
  estado completed, versión vigente aceptada, no descartada y su ruta privada.
- Capacidad HMAC-SHA256 con separación de dominio por finalidad, ID de proceso y
  versión. Se calcula en el servidor con su credencial existente; no se almacena
  ni se entrega esa credencial. Cambiar la clave del servidor invalida enlaces.
- Token en fragmento URL: no forma parte del HTTP de navegación ni del Referer.
  La página lo envía explícitamente al endpoint de validación; no se registra en
  logs propios. Metadatos noindex/nofollow y política no-referrer.
- Cada vista/descarga comprueba token, estado y caducidad. Se utiliza el mínimo
  entre final_file_delete_at y delete_after. Nunca se amplían los cinco días.
  Los procesos históricos sin fecha final válida no generan enlaces.
- Solo se descarga la versión final actual; no se aceptan IDs de versiones
  arbitrarias del navegador. Reapertura, cambio de versión, eliminación o
  caducidad impiden emitir nuevas descargas.
- Storage sigue privado. El enlace compartido no es una URL de Storage. Se emite
  una URL firmada de hasta 60 segundos, acotada a la vida restante del documento.
  Una URL ya emitida puede seguir válida hasta ese plazo y puede reutilizarse
  durante él: no se promete revocación instantánea ni un tope de factura.
- Ambos endpoints pasan por el guard económico de requests; la emisión de URL
  usa reserveDownload con cuotas compartidas y por versión. No reserva cuota ni
  genera URL en cada consulta del seguimiento: solo al montar el bloque, con
  reintento manual si falla; sin polling adicional ni envío de emails servidor.
- No elimina ni añade filas. No se prueba con documentos reales en producción.

## Verificación

Pruebas de HMAC, enlaces de correo/WhatsApp, propiedad, token alterado/ausente,
estado activo, caducidad, versión descartada o ajena, fallo de BD, cuota agotada,
TTL y mínima información pública. Deno check de ambos endpoints.

Browser QA con datos ficticios a 1440, 768 y 390 px: cierre, enlace visible,
acciones de compartir, recepción sin cuenta, descarga y expiración. Capturas y
reportes de accesibilidad en `/workspace/review-evidence/final-share/`.
