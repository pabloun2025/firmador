# Salto de firma y podio histórico

Implementación en rama `feature/queue-arcade-top3`. No desplegada.

## Experiencia

Nueva rana con pluma, paisaje suave, PDFs y rúbricas, marcador y dificultad
progresiva. El juego ya se muestra abierto; se inicia explícitamente. Teclado,
táctil y botones, pausa manual y pausa automática al ocultar la pestaña.
El juego no modifica la cola ni bloquea que llegue el turno de firma.

Ranking global (no por proceso, usuario ni dispositivo): tres resultados más
altos, con desempate por antigüedad. El alias y resultado se publican únicamente
tras consentimiento. No se copian nombre, correo, PDF ni identificadores de
participantes. Los tres récords no caducan con los documentos; un resultado
inferior se elimina y deja de ocupar espacio. No se promete conservación tras
borrado administrativo o pérdida del servicio; seguir la política de copias del
proveedor. La retirada de alias se solicita por el contacto de privacidad.

## Seguridad y consumo

- Edge protegida con el guard económico existente. El navegador no puede leer
  ni escribir las tablas ni llamar a las RPC directamente.
- Ticket aleatorio de un solo uso, semilla del servidor, caducidad de 10 minutos.
- Simulación determinista compartida a 60 Hz: el servidor reproduce los saltos,
  calcula la puntuación (ignora cualquier score enviado), exige partida terminada
  y comprueba que no se haya jugado más rápido que el tiempo transcurrido.
- Máximo 5 minutos de simulación, 1.000 entradas de salto y cuerpo limitado por
  el guard existente. No es un sistema antitrampas completo: un bot puede ejecutar
  la simulación. No hay premios ni verificación de identidad del alias.
- 300 inicios registrados/día globales y 10/hora por ranura de origen, sujetos
  también a las cuotas globales de solicitudes. Al agotar cuota funciona el modo
  práctica, sin récord persistente. Los límites no son topes de factura.
- Hasta 500 tickets activos; limpieza de caducados en cada inicio. Si no vuelven
  a iniciarse partidas, los tickets caducados pueden permanecer físicamente hasta
  el siguiente inicio (no contienen datos del firmante). Solo tres récords.
- Lectura al abrir, iniciar y guardar, nunca en cada salto ni en un temporizador.
  Registro y poda del podio en una misma transacción con bloqueo para concurrencia.
- Alias público de 2–24 caracteres, solo letras/números/espacios/guiones/puntos;
  sin HTML, enlaces o correos. Renderizado como texto de React.

## Verificación local

- `npm test`: motor, entradas inválidas, replay, consentimiento, expiración,
  tiempos imposibles, cuotas y puntuación calculada por la Edge real con cliente
  Supabase simulado; más regresiones existentes.
- `npm run build` y Deno check de `queue-arcade/index.ts`.
- `ARCADE_TEST_CONTAINER=codex-arcade-test-... node scripts/test-queue-arcade-db.mjs`:
  solo contenedor local desechable; crea BD nueva y se niega a reiniciarla.
  Persistencia, top 3, empate, concurrencia, replay, expiración, permisos y cupo.
- `scripts/check-ui.mjs`: interfaz general y accesibilidad en 1440, 768 y 390 px.
- `scripts/check-arcade-ui.mjs`: juego real con reloj determinista, prueba de
  saltos, pausa, alias/consentimiento, envío único, recarga y caída del ranking
  con modo práctica; todas las peticiones externas interceptadas.

## Publicación pendiente

Requiere autorización específica para aplicar la migración
`20261019010000_queue_arcade.sql`, desplegar `queue-arcade` con la configuración
de puerta de acceso existente y publicar el frontend. No requiere servicios,
proveedores de IA, bibliotecas ni credenciales nuevas. No ejecutar migraciones
históricas ni cambiar tablas del flujo de firma. Mientras el backend no esté
instalado, el frontend ofrece práctica y muestra la indisponibilidad del podio.
