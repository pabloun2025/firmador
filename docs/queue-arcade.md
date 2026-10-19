# Salto de firma y podio histórico

Implementación en rama `feature/queue-arcade-top3`. Publicación autorizada el
19 de octubre de 2026 para `firma.veryfacil.org`, sin cambiar `leapsign.app`.

## Experiencia

Nueva rana con pluma, paisaje suave, PDFs y rúbricas, marcador y dificultad
progresiva. El juego ya se muestra abierto; se inicia explícitamente. Teclado,
táctil y botones, pausa manual y pausa automática al ocultar la pestaña.
El juego no modifica la cola ni bloquea que llegue el turno de firma.

Revisión compacta (rama `design/compact-arcade-podium`, pendiente de publicación):
solo se solicitan iniciales/nombre cuando un resultado positivo puede entrar en
el top 3. Los empates no desplazan al récord anterior. El botón «Guardar récord»,
con aviso de visibilidad pública y alternativa «Omitir», sustituye a la casilla
de consentimiento. El servidor sigue verificando y decidiendo el podio final
ante resultados simultáneos. Tres ranitas oro/plata/bronce sobre peldaños.
La animación decorativa de espera mide 86 px y termina en cuatro segundos,
sin botón de pausa; respeta movimiento reducido. El juego conserva su pausa.

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
  también a las cuotas globales de solicitudes. En la revisión compacta no hay
  modo práctica: si el servidor no autoriza el inicio, se ofrece reintentar sin
  afectar a la cola. Los límites no son topes de factura.
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
  saltos, pausa, iniciales solo al clasificar, publicación mediante botón, envío
  único, recarga, podio compacto y reintento ante caída del servicio;
  todas las peticiones externas interceptadas.

## Publicación

Se aplicó la migración `20261019010000_queue_arcade.sql` de forma transaccional,
registrada en el historial, y se desplegó `queue-arcade` (ACTIVE, versión 1,
verify_jwt habilitado). La lectura pública del podio respondió HTTP 200 con
lista vacía, sin insertar récords de prueba. Permisos directos de tablas y RPC
denegados a anon. Copia Git verificada y etiqueta de recuperación
`restore/leapsign-before-arcade-20261019`. La web se publica automáticamente al
enviar el commit a `main`; confirmar su finalización en Cloudflare.
No requiere servicios,
proveedores de IA, bibliotecas ni credenciales nuevas. No ejecutar migraciones
históricas ni cambiar tablas del flujo de firma. La revisión compacta no cambia
la base de datos ni la función desplegada; solo el cliente y sus pruebas.
