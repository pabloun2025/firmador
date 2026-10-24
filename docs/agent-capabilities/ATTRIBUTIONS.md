# Capacidades de agente en firmador

Registro de lo que esta preparación comprobó el 23 de octubre de 2026 en un Cloud Agent de Cursor, modelo Grok. No es un inventario de Codex ni de Grok como producto aparte.

La plataforma es Cursor. Grok es el modelo de esta sesión, no un segundo sistema de instrucciones. El mecanismo persistente del repositorio es `AGENTS.md`, ya cargado como regla de workspace, y las reglas `.mdc` de `.cursor/rules/`. Un archivo `.md` dentro de `.cursor/rules/` no sería una regla.

Nada de esto modifica la aplicación, despliega, migra ni toca secretos. `AGENTS.md` no se ha editado.

## Cómo se comprobó el reconocimiento

Se consideró reconocida una capacidad solo si el proceso del agente la anunció o si su herramienta respondió en esta sesión. Una carpeta en disco no basta.

- Skills nativas: la lista inyectada al arrancar el agente, contrastada con `/home/ubuntu/.cursor/skills-cursor/*/SKILL.md`.
- Herramientas y plugins MCP: catálogo dinámico de la sesión. `namespaceStatus` tiene que ser utilizable.
- Subagentes: la lista anunciada al arrancar.
- Reglas nuevas: existen como archivos con frontmatter válido. Esta sesión arrancó antes de crearlos, así que no están cargadas aquí. Hace falta una sesión nueva de Agent sobre esta rama.

## Registro

| Capacidad | Forma en esta plataforma | Origen y revisión | Licencia | Archivos | Límite |
| --- | --- | --- | --- | --- | --- |
| Superpowers, quince flujos | Regla local. El plugin oficial de Cursor no está instalado. | https://github.com/obra/superpowers `2ce8aa15d05bd57213e6f746f953aafb7ded7a8b` v7.0.1 | MIT. Copia en `licenses/superpowers-MIT-LICENSE.txt` | `.cursor/rules/leapsign-planning.mdc`, `leapsign-implementation.mdc`, `leapsign-debugging.mdc`, `leapsign-verification.mdc`, `leapsign-superpowers-maintenance.mdc` | Sin hooks, sin scripts y sin descubrimiento de skills. El plugin, si se instala aparte con `/add-plugin superpowers`, registra un `sessionStart` y no forma parte de este cambio. |
| Codex Security, quince skills | No disponible. La sustitución es una revisión manual. | Plugin de Codex. No hay paquete incorporado. | No se copió texto. | `.cursor/rules/leapsign-security-review.mdc` | No es un escaneo. No corrige hallazgos por su cuenta. |
| Entorno cloud de Codex | No disponible. | Skills `cloud-environment-runtime` y `cloud-environment-onboarding:setup` de Codex. | No se copió texto. | `.cursor/rules/leapsign-environment.mdc` | No diagnostica el entorno administrado de Codex. |
| Entorno de Cloud Agent | Skill nativa reconocida: `env-setup`. | Cursor, archivo presente y anunciado en la sesión. | La skill es de Cursor, no se redistribuye. | Ninguno añadido. La regla local solo remite a ella. | No sustituye a la skill. Hay que leerla cuando la tarea sea el entorno. |
| Frontend design | Guía local, modificada. | https://github.com/dobromirdikov/codex-frontend-design-skill `983119775a936d123df9fbfbc3821bdee5bb58fd`; deriva de `anthropics/claude-plugins-official` `frontend-design` | Apache-2.0. Copia en `licenses/frontend-design-APACHE-2.0.txt` | `.cursor/rules/leapsign-frontend.mdc` | No pide una estética nueva. Conserva la rana, los colores y los componentes ya aprobados. |
| Karpathy guidelines | Guía local, traducida y con alcance reducido. | https://github.com/multica-ai/andrej-karpathy-skills `2c606141936f1eeef17fa3043a72095b4765b9c2` | MIT declarado en el README. Esa revisión no trae archivo `LICENSE`. | `.cursor/rules/karpathy-guidelines.mdc` | El origen usa `alwaysApply: true`. Aquí solo entra al trabajar con código de implementación. |
| Límites de producto que faltaban en `AGENTS.md` | Regla de proyecto, siempre activa en sesiones nuevas. | Instrucciones de trabajo de LeapSign. `AGENTS.md` del propio repositorio. | Del repositorio. | `.cursor/rules/leapsign-boundaries.mdc` | No repite ni sustituye `AGENTS.md`. |

## Skills nativas reconocidas en esta sesión

Anunciadas al arrancar y con `SKILL.md` en disco:

`bdk-cli`, `bdk-create-agent`, `bdk-debug`, `bdk-deploy`, `bdk-evals`, `bdk-framework-map`, `bdk-github`, `bdk-hillclimb`, `bdk-mcp-auth`, `bdk-migrate-v2`, `bdk-otel`, `bdk-setup-slack`, `canvas`, `env-setup`, `migrate-to-builds`, `subscribe`, `walkthrough-artifacts`, y la skill `google-drive` del plugin.

`visualize` tiene `SKILL.md` en `/home/ubuntu/.cursor/skills-cursor/visualize/`, pero esta sesión no la anunció. No cuenta como reconocida. Su metadato declara la superficie `ide`.

No aparecieron skills de Superpowers ni de Codex Security.

## Herramientas que respondieron

Catálogo de esta sesión:

- `cursor`: herramientas nativas, entre ellas lectura web, subagentes y lints.
- `cursor-cloud`: ready.
- `cursor-subscriptions`: ready.
- `Github`: ready.
- `Gmail`: ready.
- `Google-calendar`: ready.
- `Google-drive`: ready.
- `Outlook`: el catálogo respondió `needsAuth`. No está utilizable hasta autenticarlo. No se inició esa autenticación.

## Subagentes anunciados

`generalPurpose`, `explore`, `computerUse`, `videoReview`, `cursor-guide`, `ci-investigator`, `bugbot`, `security-review`, `best-of-n-runner`.

`security-review` y `bugbot` son de Cursor. Solo se lanzan si la tarea lo pide de forma expresa. No equivalen a Codex Security.

## Activación de las reglas nuevas

Según la documentación de reglas de Cursor (https://cursor.com/docs/context/rules):

| Regla | Activación en una sesión nueva |
| --- | --- |
| `leapsign-boundaries.mdc` | Siempre. |
| `karpathy-guidelines.mdc` | Al tener en contexto archivos de `src`, `supabase`, `tests`, `scripts`, `server` o `validator` que casen con sus globs. |
| `leapsign-frontend.mdc` | Al tener en contexto CSS, componentes, `src/main.tsx`, `index.html` o `public`. |
| `leapsign-planning.mdc`, `leapsign-implementation.mdc`, `leapsign-debugging.mdc`, `leapsign-verification.mdc`, `leapsign-security-review.mdc`, `leapsign-environment.mdc` | El agente las elige cuando la descripción encaja con la tarea. |
| `leapsign-superpowers-maintenance.mdc` | Solo con `@leapsign-superpowers-maintenance`. |

Esta sesión no puede demostrar esa carga: las reglas se crearon después del arranque.
