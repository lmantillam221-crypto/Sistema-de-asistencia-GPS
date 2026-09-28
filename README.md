# Nube.chic · Asistencia v3

Sistema profesional de **control de asistencia con GPS** para tiendas de **moda y accesorios**: las colaboradoras marcan entrada y salida desde su celular, la ubicación se verifica contra la geocerca de la tienda, eligen sus turnos en una ventana semanal, registran el **cuadre de caja** de su turno y la supervisión ve todo **en vivo** desde un panel con dashboard, multas automáticas, reportes y planilla.

Es la evolución del `index.html` de un solo archivo: ahora hay **servidor y base de datos**, así que lo que marca el celular de cada colaboradora llega de verdad al panel de la supervisión (antes cada navegador guardaba sus propios datos).

---

## ¿Qué cambió respecto a la versión anterior?

| Antes (un solo archivo) | Ahora (v2) |
|---|---|
| Datos en `localStorage` de cada navegador: el celular de la socia y el panel **no compartían datos** | Servidor Node.js + base SQLite: todos ven la misma información en tiempo real |
| La hora la ponía el celular (se podía adelantar/atrasar) | **La hora la pone el servidor**; la geocerca también se calcula en el servidor |
| PIN y clave de supervisor visibles en el código | Contraseñas con **hash scrypt**, sesiones seguras (cookies HttpOnly), bloqueo tras 5 intentos |
| Un solo local | **Varias tiendas**, cada una con su geocerca, plantilla de turnos y cupos |
| Una clave de supervisor para todos | **Roles**: administración, supervisión y colaboradoras; bitácora de auditoría |
| Sin registro de ventas | **Cuadre de caja** por turno (n.º de ventas, prendas, efectivo, Yape/Plin, tarjeta) y **checklists** de apertura/cierre |
| Faltas sin forma de reclamo | **Justificaciones** desde la app, aprobadas o rechazadas en el panel |
| Cambios de turno por chat | **Coberturas**: una ofrece su turno, otra lo toma y queda registrado |
| Sin feriados | **Días especiales**: feriados (cerrado) y horarios de campaña (Día de la Madre, Navidad…) con más cupos |
| Se perdían reportes sin internet | **Cola sin conexión**: los reportes se guardan y se envían al volver la señal |
| — | Detección de **GPS falso** (saltos imposibles, precisión 0) y de **celular distinto** al habitual |
| — | **App instalable** (PWA) en Android e iPhone, pantalla encendida durante el turno |
| — | Mapa en vivo, planilla para pagos, exportación a Excel, respaldo de la base |

Tus datos anteriores **se importan** (ver más abajo): las socias conservan su mismo usuario y PIN.

---

## Módulos

**App del equipo (celular)** — `https://tu-dominio/`
- **Hoy**: tu turno, distancia en vivo a la tienda, *Marcar entrada* (con checklist de apertura), ubicación activa con próximo envío automático, *Marcar salida* con cuadre de caja y checklist de cierre. Si no tienes turno puedes **cubrir** uno.
- **Horario**: elige turnos cuando la ventana está abierta (el primero que elige se queda con el turno), suelta turnos, **pide cobertura** o toma los turnos que otras necesitan cubrir.
- **Multas**: total pendiente, detalle y **justificación** de cada multa.
- **Mi cuenta**: tu mes (turnos, puntualidad, horas, ventas), cambio de PIN e instrucciones para instalar la app.

**Panel de control** — `https://tu-dominio/panel`
- **En vivo**: turnos del día con estado (en tienda, no llega, sin señal, fuera de tienda…), línea de tiempo de reportes GPS, alertas, mapa con geocercas y última posición, recordatorios por WhatsApp y reporte del día para copiar o enviar.
- **Dashboard**: asistencia, puntualidad, tardanzas, faltas, horas, ventas, ticket promedio y multas; gráficos por turno, por persona y por día; tabla detallada ordenable; exportación a Excel e impresión.
- **Horarios**: semana con asignación directa, turnos extra, plantilla semanal con cupos, feriados y horarios de campaña, aviso al grupo y horario para compartir por WhatsApp.
- **Multas**: deudas por persona, justificaciones por revisar, registrar pago, notificar por WhatsApp, anular, multas manuales.
- **Equipo**: altas, roles, PIN nuevo (con mensaje de acceso listo para WhatsApp), desactivar y desvincular celular.
- **Reportes**: planilla por período (turnos, horas, puntualidad, ventas, S/ por hora, multas) para liquidar pagos.
- **Tiendas**: ubicación y radio de la geocerca eligiendo en el mapa o con tu GPS.
- **Configuración** *(admin)*: reglas, montos, políticas, checklists, respaldo e importación.
- **Auditoría** *(admin)*: quién hizo qué y cuándo.

---

## Puesta en marcha

Requisitos: **Node.js 22.13 o superior** (usa el SQLite integrado de Node; no hay que instalar base de datos).

```bash
npm install
cp .env.example .env          # edita ADMIN_PASSWORD
npm start                     # http://localhost:3000  (app)  y  /panel
```

Si defines `ADMIN_CODIGO` / `ADMIN_PASSWORD`, se crea ese administrador al arrancar. Si no, al abrir `/panel` por primera vez aparece el asistente **Configura tu sistema**.

Luego, en el panel: **Tiendas** → agrega tu tienda (o importa tus datos) → **Horarios** → plantilla semanal → **Equipo** → agrega a las colaboradoras (el sistema genera el PIN y el mensaje de WhatsApp con el enlace y sus datos).

### Importar tus datos de la versión anterior

Desde el panel: **Configuración → Importar desde la versión anterior** y elige el `index.html` anterior o la *copia de seguridad (.json)* que se descargaba desde él. También por consola:

```bash
npm run importar -- ruta/al/index.html
```

Se crean la tienda con su geocerca, la plantilla de turnos, las socias **con su mismo usuario y PIN**, los turnos elegidos, las marcas GPS y las multas con su estado de pago. Es seguro repetirlo: no duplica personas.

### Modo demostración

```bash
npm run demo                  # crea tienda, equipo y 3 semanas de datos
DEMO_MODE=1 npm start
```

Habilita el **reloj simulado** (En vivo → barra de demostración), el **simulador de ubicación** en la app y los botones de datos de ejemplo. Accesos: app `V01`/`1111` … `V08`/`8888`; panel `supervisor`/`supervisor2026`. **Nunca actives `DEMO_MODE` en el sistema real.**

---

## Marcas (varias empresas con el mismo sistema)

El mismo código sirve a varias empresas. Cada marca vive en `marcas/<id>/`:

| Marca | Carpeta | Paleta | Tipografía |
|---|---|---|---|
| **Nube.chic** (predeterminada) | `marcas/nube-chic` | rosa #FC90AE · ciruela #3F1D35 | Outfit + Figtree |
| **Mundo Nuvana** | `marcas/mundo-nuvana` | azul petróleo #3387A2 · celeste #C0DEF0 · tinta #14323F | Cormorant Garamond + Manrope |

- `marca.json`: nombre, rubro, colores del navegador y valores iniciales del asistente (tienda y turno).
- `publico/`: archivos que reemplazan a los de `public/` (logo, íconos y `css/marca.css` con los tokens de color y fuentes).
- Se elige con la variable **`MARCA`** (`nube-chic` o `mundo-nuvana`). Cada empresa es un sitio distinto con **sus propios datos**.
- Para agregar otra empresa: copia `marcas/mundo-nuvana`, cambia logo, `marca.json` y tokens de `css/marca.css`, y regístrala en `src/marcas.js`.

## Publicarlo en Netlify (recomendado)

El proyecto trae `netlify.toml`: el sitio (app y panel), la API como **función de Netlify** y una **función programada** (`tareas`, cada 15 minutos de 8 a. m. a medianoche, hora de Perú; de noche no corre para que la base se apague sola y el uso quede dentro de los planes gratuitos) que calcula multas automáticas y hace mantenimiento. Los datos viven en **PostgreSQL** (Neon / Netlify DB). HTTPS viene activado, así que el GPS de los celulares funciona.

### 1. Base de datos (una sola vez)

Elige una opción:

- **Neon directo (recomendada: permanente y gratis)**: crea una cuenta en [neon.tech](https://neon.tech), crea un proyecto (región *AWS São Paulo* o *US East*), copia la **connection string** (*Connection string → Pooled connection*, empieza con `postgresql://…`) y agrégala en Netlify → **Site configuration → Environment variables** como `DATABASE_URL`.
- **Netlify DB**: en tu sitio de Netlify → **Extensions → Neon** → instalar y crear la base (o `npx netlify-cli db init` en la carpeta del proyecto). Netlify define `NETLIFY_DATABASE_URL` sola. Importante: **reclama la base en tu cuenta de Neon** (botón *Claim database*) para que no se elimine pasados unos días.

Sin base conectada, la API responde con un mensaje claro (“Falta conectar la base de datos”).

### 2. Desplegar

1. [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing project → GitHub** y elige este repositorio. No cambies la configuración de build (la lee de `netlify.toml`) y pulsa **Deploy**. También sirve `npx netlify-cli deploy --build --prod` desde la carpeta.
2. Abre `https://tu-sitio.netlify.app/panel`: la primera vez aparece **Configura tu sistema** (cuenta de administración, tienda y equipo).
3. Comparte `https://tu-sitio.netlify.app/` con el equipo para que instalen la app.

**¿Ya usabas la versión anterior (Netlify Blobs)?** No pierdes nada: al primer acceso con la base conectada, el sistema copia solo todos los datos (equipo, claves, turnos, marcas, multas) a PostgreSQL. Las claves siguen siendo las mismas.

Para **Mundo Nuvana** crea un segundo sitio (con **su propia base de datos**) y agrega la variable `MARCA` = `mundo-nuvana`.

> Netlify no permite subir funciones arrastrando una carpeta (Netlify Drop). Usa GitHub o la CLI.

### Por qué PostgreSQL (el “error 505/502/503” intermitente)

La versión anterior guardaba toda la base como **un solo archivo en Netlify Blobs**: cada cambio (una marca, elegir un turno) descargaba, modificaba y volvía a subir el archivo completo, y cada instancia de la función lo hacía por su cuenta. Con varias personas a la vez —sobre todo el domingo de 9 a 10 p. m.— las peticiones se hacían esperar, vencía el tiempo de la función y Netlify respondía con error 5xx; además dos instancias podían pisarse los cambios. Ahora:

- **PostgreSQL** atiende cientos de conexiones a la vez; cada cambio escribe solo sus filas, dentro de **transacciones con bloqueo de fila** (dos socias nunca se quedan con el mismo cupo ni se supera el máximo por semana).
- Consultas **en lote** (sin N+1) e **índices** en todas las búsquedas por fecha, persona y turno; los reportes tienen un tope de un año por consulta.
- Las tareas pesadas (multas automáticas) salieron de las peticiones y corren en la **función programada**.
- La app **reintenta sola** las lecturas ante un corte breve de red o del servidor (y los cambios cuando el servidor avisa que no los procesó).
- El límite de intentos por conexión cuenta **solo los fallidos**: muchas socias en la misma wifi o red móvil pueden ingresar a la vez.

**Pruebas de carga** (PostgreSQL 16, 150 socias + 5 supervisores al mismo tiempo: ingreso, pantalla Hoy, horario, elegir turnos en la ventana, marcar entrada con GPS, multas; el panel consultando cada 0,5 s):

| Escenario | Peticiones | Errores 5xx | p50 | p95 |
|---|---|---|---|---|
| Función de Netlify (1 instancia, 3 conexiones) | 10 761 en 11 s | **0** | 71 ms | 309 ms |
| Servidor Node + PostgreSQL | 30 840 en 26 s | **0** | 106 ms | 163 ms |
| Servidor Node + SQLite | 29 519 en 28 s | **0** | 89 ms | 147 ms |

En todos los casos se llenaron exactamente los 210 cupos de la semana, nadie superó su máximo y se registraron 150/150 entradas. Con **5 años de historial simulado** (200 000 turnos, 400 000 marcas, 400 000 registros de auditoría ≈ 183 MB) las pantallas del panel responden en 5–230 ms y un reporte de un año completo en unos 3 s.

## Publicarlo en un servidor propio (obligatorio HTTPS)

Los navegadores **solo entregan el GPS en páginas HTTPS**. Opciones:

- **Render.com**: conecta el repositorio; `render.yaml` ya define el servicio Docker, el disco persistente para la base y el chequeo de salud. Define `ADMIN_PASSWORD` en el panel de Render.
- **Railway / Fly.io / VPS con Docker**:
  ```bash
  docker compose up -d --build     # usa .env y guarda la base en un volumen
  ```
  Detrás de Nginx/Caddy/Cloudflare con HTTPS y `TRUST_PROXY=1`.

Con `DATABASE_URL` (PostgreSQL: Neon, Supabase, RDS, el de tu VPS…) el servidor usa PostgreSQL con un pool de conexiones (`DB_POOL_MAX`, 20 por defecto); es lo recomendado para muchas personas y varios años de datos. Sin `DATABASE_URL` usa SQLite: la base es un solo archivo (`DB_PATH`). **Respáldala**: botón *Descargar respaldo* en Configuración, o `npm run respaldo` programado con cron (guarda los últimos 30).

Variables de entorno: ver `.env.example`.

---

## Reglas del negocio (configurables)

- **Tardanza**: entrada después de la hora de inicio + tolerancia (30 min por defecto) → multa de tardanza.
- **Falta**: termina el turno sin entrada → multa de falta. Se anula sola si luego aparece la entrada, o al aprobar una justificación.
- **Salida anticipada** (opcional): salida antes del fin − tolerancia.
- **Reportes GPS**: cada N minutos desde la entrada (30 por defecto). Cada franja se empareja con el reporte más cercano (± N/2); las que no llegan aparecen como "No llegó".
- **Geocerca**: distancia a la tienda menos el margen de error del GPS (hasta medio radio) ≤ radio → "en tienda". Precisión peor que el máximo configurado → "impreciso". Opcionalmente se puede **exigir** estar dentro para marcar entrada.
- **Entrada**: desde 2 horas antes del turno. La hora siempre es la del servidor, en la zona horaria de la empresa.
- **Ventana de elección**: día y horario configurables (domingo 21:00–22:00 por defecto) para la semana siguiente, con máximo de turnos por persona; opcionalmente abierta toda la semana previa.

## Limitaciones conocidas del GPS en navegador

Una página web no puede enviar la ubicación con el celular bloqueado o la app cerrada. Por eso la app mantiene la pantalla encendida (Wake Lock), reintenta al volver a abrirse, guarda los reportes sin internet y el panel marca claramente los reportes que no llegaron. Si en el futuro se necesita seguimiento en segundo plano, la API ya está lista para una app nativa (Capacitor/React Native) que use los mismos endpoints.

---

## Arquitectura

```
src/
  server.js            arranque, apagado ordenado
  app.js               Express: seguridad (Helmet/CSP), estáticos, API
  config.js            variables de entorno
  jobs.js              tareas cada minuto (multas, coberturas vencidas, sesiones)
  domain/              lógica pura y probada (compartida con el navegador vía /shared)
    tiempo.js  geo.js  asistencia.js  horarios.js  ajustes.js
  services/            reglas con base de datos: usuarios, tiendas, turnos, asistencia, multas, coberturas…
  routes/              auth.js · app.js (celular) · panel.js (supervisión)
  db/                  motor.js: una interfaz asíncrona para PostgreSQL (pg / Neon / PGlite) y SQLite (node:sqlite, WAL)
                       migrations/postgres y migrations/sqlite: migraciones versionadas
  nube/                función de Netlify (API + tareas programadas) y migración automática desde Netlify Blobs
  lib/                 seguridad (scrypt, tokens), CSV, importador, datos demo
public/
  index.html + js/colaborador/   app PWA del equipo (manifest, service worker, GPS, cola offline)
  panel.html + js/panel/         panel por secciones, tiempo real con Server-Sent Events, mapas Leaflet
test/                  pruebas de dominio, de API (flujo completo) y de navegador (e2e)
```

**Escalabilidad**: la lógica está separada en capas (dominio puro → servicios → rutas) y todo el acceso a datos es asíncrono sobre un mismo motor que funciona con PostgreSQL o SQLite. En PostgreSQL las operaciones que compiten (elegir un cupo, marcar, generar la semana, migrar) usan transacciones con `SELECT … FOR UPDATE`, restricciones únicas y candados consultivos, así que varias instancias pueden atender a la vez sin pisarse. En SQLite las peticiones se atienden de a una sobre la misma conexión (WAL).

## Pruebas

```bash
npm test               # dominio, API completa y función de Netlify con PostgreSQL en memoria (PGlite)
npm run test:postgres  # la API completa sobre PostgreSQL
npm run e2e       # navegador real: marcar entrada/salida y recorrer el panel (requiere Chromium de Playwright)
```

La integración continua (GitHub Actions) ejecuta `npm test` en cada cambio.
