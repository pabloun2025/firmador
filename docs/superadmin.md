# Centro de control de LeapSign

El panel administrativo se entrega en `admin.veryfacil.org` y puede verificarse
temporalmente en `/superadmin`. No aparece enlazado desde la aplicación pública.

## Seguridad

- Solo `pabloun@gmail.com` está en la lista inicial de acceso.
- Supabase Auth valida la contraseña y exige un factor TOTP con nivel `aal2`.
- El navegador usa únicamente la clave pública de Supabase.
- `superadmin-console` es la única función con acceso privilegiado a las tablas
  administrativas y registra el motivo de cada mutación.
- El panel muestra metadatos operativos, nunca crea enlaces de descarga ni
  permite abrir el contenido de los PDF.

## Capacidades iniciales

- Métricas de cuentas, procesos, turnos, versiones, correos y purgas.
- Bloqueo, reactivación y eliminación confirmada de cuentas.
- Pausa, reanudación, liberación, cancelación y purga de procesos.
- Interruptores globales de comunicaciones y mantenimiento.
- Edición segura de las plantillas de invitación, cola y turno.
- Procesamiento manual de trabajos de limpieza fallidos o pendientes.
- Auditoría administrativa separada del historial de cada documento.

## Operación

Las migraciones y la función Edge se despliegan con el flujo habitual de
Supabase. El subdominio es una ruta adicional del mismo frontend estático; no
necesita un repositorio ni claves distintas.
