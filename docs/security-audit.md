# Seguridad y consumo — 17 de octubre de 2026

Estado: **protecciones parciales publicadas en Supabase**. Las tres migraciones
y las 15 funciones se publicaron y verificaron el 17 de octubre de 2026, después
de que el usuario descartara expresamente el respaldo de los PDF de prueba.
Detalles actuales en `security-release-status.md`.

Hallazgos prioritarios: mantenimiento sin autorización interna en el código,
cuotas acumuladas ausentes y CadenaPDF apuntando al mismo backend. La API confirmó
la función de mantenimiento desplegada sin JWT, bucket privado de 10 MiB y RLS.

Se añadieron guardas a las 15 funciones, cuotas transaccionales y configuración
de emergencia por servicio. Creación: 100/día global, 20/día/propietario y 20
procesos activos por propietario. Cargas: 500 MiB/día global, 100 MiB/día por
propietario, 2 GiB de almacenamiento vivo más reservas; PDF máximo 10 MiB.
Correo: 500 destinatarios/día y 5.000 por ventana fija de 30 días; 100 invitaciones
por propietario/día. Solicitudes: 50.000/día compartidas, 6.000/hora por endpoint,
1.200/hora por actor. Cada periodo es una ventana fija, no una factura.

Las cuotas y suspensiones son de servidor, en `security_budget_settings`. Las
reservas se toman antes de subir o enviar; si el sistema de cuota falla, la
operación se rechaza. Se conserva una causa de bloqueo cada quince minutos.
La emisión de descargas tiene cupo separado y enlaces de 60 segundos; no impide
que Storage sirva varias veces una URL aún vigente. Los contadores no incluyen
todos los posibles costes directos del proveedor ni Auth/REST externo a Edge.

Se prepararon recuperación administrativa atómica, serialización de plazas de
invitación, límite de agenda y cron con credencial generada internamente sin
copiar secretos. Los PDF y el diseño no se modificaron.

Verificación local: 71 pruebas, build, npm audit sin hallazgos y typecheck de las
15 funciones con Deno 2.9.6, usando Supabase 2.117.3 de npm como sustituto de
resolución JSR en un import map local. PostgreSQL 17 aislado verificó concurrencia,
cuotas, modo de protección, permisos, recuperación e invitaciones. No se probaron
despliegue, SMTP ni cron contra producción.

Para repetir la prueba SQL, crear un contenedor PostgreSQL temporal y ejecutar
`SECURITY_TEST_CONTAINER=<id> node scripts/test-security-database.mjs firmador`.
El script crea una base sintética y rechaza sobrescribir una existente. CI ejecuta
la misma prueba con un contenedor del job y sin secretos de producción.

Aplicadas con autorización: `20261017010000_security_budgets.sql`,
`20261017020000_atomic_admin_recovery.sql` y
`20261017030000_authenticated_maintenance.sql` y las funciones, en la misma
intervención. Queda observar la siguiente ejecución natural del cron. Revisar
cuotas con volumen real, Cloudflare/WAF, Spend Cap y facturación de Supabase/Resend.
No hay garantía de gasto máximo ni auditoría de proyectos fuera de este entorno.

El bootstrap histórico desde cero presenta un cambio de retorno de
`release_open_turn` sin DROP previo; las nuevas migraciones se validaron contra
un baseline sintético, no contra una reproducción completa de Supabase.

Informe consolidado del entorno: `/workspace/security-audit/INFORME.md`.
