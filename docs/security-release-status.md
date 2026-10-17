# Estado de publicación de seguridad — 17 de octubre de 2026

Las correcciones de seguridad están implementadas y verificadas, pero el
despliegue de producción está pendiente de completar el respaldo solicitado.

## Restauración preparada

- Código original: `5a0d434b2e53f54e0c6067a66ca343ff973b5df6`.
- Etiqueta en GitHub: `restore/leapsign-before-security-2026-10-17`.
- Bundle Git y archivo del estado de trabajo: verificados localmente, incluyendo
  restauración de prueba del bundle en otro directorio.
- Copia lógica privada de las 20 tablas públicas de aplicación: 141 registros,
  capturados antes de esta publicación, con hash SHA-256. No contiene cuentas
  ni credenciales de Auth y no sustituye un dump completo de PostgreSQL.
- Archivos de Storage pendientes: 9 objetos, 1.716.775 bytes en el momento de la
  consulta. No se descargaron ni se modificaron.

La API del proveedor devuelve cero copias automáticas disponibles. El intento
oficial de `db dump` con el CLI no acepta el token proxy del entorno antes de
emitir una petición. El acceso normal a Management API mediante el proxy sí
funciona; esto no justifica extraer o reemplazar credenciales del entorno.

## Bloqueo comprobado

`SUPABASE_SECRET_KEY` no autoriza las solicitudes normales de Storage: con
Authorization y apikey el servicio devuelve HTTP 400, `Invalid Compact JWS`.
Solo con apikey exige el encabezado Authorization. Por tanto, no se trata de un
error por omitir headers ni de falta de conectividad al proyecto.

Es necesario corregir esa vinculación existente mediante la configuración segura
del entorno. No introducir claves en el repositorio, el informe ni el chat. No
crear duplicados del secreto ni habilitar un endpoint privilegiado de respaldo
para sortear esta limitación.

## Trabajo verificado

Se repitieron las 71 pruebas de LeapSign y su build: ambos aprobados. El conjunto
de auditoría incluye además las pruebas SQL y Deno descritas en
`security-audit.md`. Ninguna migración de seguridad se ha aplicado a la base real;
ninguna función se ha desplegado en esta intervención. No se ejecutaron envíos
de prueba ni purgas.

Al corregir el acceso: respaldar y verificar los PDF privados, aplicar las tres
migraciones preparadas, desplegar las 15 funciones y verificar el mantenimiento
autenticado y el funcionamiento legítimo. La autorización del usuario para este
despliegue ya está concedida; no hace falta volver a solicitarla.
