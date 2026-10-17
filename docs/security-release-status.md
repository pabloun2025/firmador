# Estado de publicación de seguridad — 17 de octubre de 2026

Las correcciones de seguridad ya están desplegadas en Supabase: cuatro migraciones
registradas con sus versiones originales y 15 funciones Edge en estado ACTIVE.
El usuario autorizó expresamente continuar sin respaldar los PDF de prueba.

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

## Acceso del entorno: incidencia pendiente que no bloquea esta publicación

`SUPABASE_SECRET_KEY` no autoriza las solicitudes normales de Storage: con
Authorization y apikey el servicio devuelve HTTP 400, `Invalid Compact JWS`.
Solo con apikey exige el encabezado Authorization. Por tanto, no se trata de un
error por omitir headers ni de falta de conectividad al proyecto.

La publicación se realizó mediante la API oficial de administración, con la
credencial ya vinculada al entorno. Las funciones utilizan las credenciales
internas de Supabase y no el secreto inválido del entorno de desarrollo. No se
crearon endpoints de respaldo ni se extrajeron claves de servicio.

## Trabajo verificado

Se repitieron las 74 pruebas de LeapSign y su build: ambos aprobados. El conjunto
de auditoría incluye además las pruebas SQL y Deno descritas en
`security-audit.md`. Se descargaron los cuerpos de las 15 funciones anteriores
antes de publicar. Se conserva el punto de restauración del código en GitHub.

Migraciones aplicadas y registradas: `20261017010000`, `20261017020000`,
`20261017030000` y `20261017040000`. Cada archivo se aplicó junto con su entrada de historial en una
transacción, sin alterar registros ni binarios PDF de los usuarios.

Verificaciones de producción aprobadas:

- Las 15 funciones figuran como ACTIVE y aumentaron su versión respecto a las
  descargadas antes del despliegue; mantenimiento recibió una segunda publicación
  para corregir el timeout detectado.
- El mantenimiento sin autorización devuelve HTTP 401 con `INTERNAL_ONLY`.
- La ruta pública rechaza datos inválidos con HTTP 400 desde el código de la
  aplicación, lo que también comprueba la reserva de presupuesto en su entorno real.
- Cuotas y recuperación están restringidas al rol de servicio; tres triggers de
  protección están activos y la inserción REST directa de procesos está cerrada.
- La credencial interna del planificador se verifica y el cron utiliza el nuevo
  dispatcher autenticado. No se forzaron ejecuciones ni purgas para probarlo.

El cron se ejecutó naturalmente a las 17:15 UTC. El trabajo SQL terminó con éxito,
pero su llamada HTTP agotó los 10 segundos de espera. Se corrigió mediante la
cuarta migración, ampliando la espera a 120 segundos y añadiendo una comprobación
de salud detrás de la misma autorización. Esa llamada real y autenticada devolvió
HTTP 200, sin timeout, con `maintenanceExecuted: false`: no se forzaron mensajes
ni limpiezas para verificarla. La siguiente ejecución ordinaria mantiene la
frecuencia de quince minutos y todavía no se ha observado con el nuevo timeout.

No se verificó un flujo de firma de principio a fin con una cuenta de usuario,
ni la facturación/WAF de Cloudflare. CadenaPDF conserva sus cambios preparados
y requiere infraestructura independiente antes de publicarse.
