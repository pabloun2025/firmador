# Rollback solicitado: Version 1 Final

22 de octubre de 2026. Se restaura la aplicación del tag version-1-final,
commit 2f8048291bdc6230282d0ae2ba1f52bc96733bb3, sin reescribir Git.

Se apagó signature_inventory_settings.enabled y el secreto Edge
PDF_SIGNATURE_INVENTORY_ENABLED. Se restauraron los paquetes Edge reales de
submit-signed-version y get-owner-round anteriores a v1.1, y el Worker conservado
31c3a2bc-5dad-4dbc-81a2-cbca8a61ad6c. El servicio exclusivo de Render
srv-dbcgenuea8bs73b0t6ag fue suspendido, no borrado.

Las dos migraciones ya aplicadas se conservan en el repositorio como historial,
no como funcionalidad activa: no se eliminan tablas, recibos, PDFs ni cuentas.
Todo el resto del código de aplicación vuelve al tag guardado. Las mejoras
retiradas siguen recuperables en el historial y en su rama, no en main.

Comprobación online del flujo anterior: login, creación, descarga y recepción
del PDF firmado correctos con datos sintéticos; solo esos datos de prueba se
purgaron. V2 no fue modificada. No se diagnosticó ni intentó corregir el fallo
del detector: se atendió exclusivamente la petición de restauración.
