# Seguridad de LeapSign

Preservar firma secuencial, documentos binarios, autorización por propietario y
plazos publicados. Revisar `docs/security-audit.md` para límites y pendientes.
Las operaciones facturables de Edge pasan por `_shared/economic-guard.ts` y la
reserva atómica `reserve_security_budget`; no introducir rutas de correo/carga
que eviten estos controles. Los límites internos no garantizan un tope de factura.
Ejecutar `npm test` y `npm run build` para cambios de seguridad. Las migraciones,
despliegues y recursos reales requieren autorización expresa; no realizar pruebas
masivas contra producción. No habilitar CadenaPDF contra este backend.
