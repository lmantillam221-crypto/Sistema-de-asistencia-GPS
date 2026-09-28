-- Esquema inicial · Nube.chic Asistencia v2
-- Fechas: TEXT 'YYYY-MM-DD' y horas 'HH:MM' en la zona horaria del negocio.
-- Instantes: INTEGER en milisegundos desde epoch (UTC).

CREATE TABLE empresa (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  nombre       TEXT    NOT NULL,
  rubro        TEXT    NOT NULL DEFAULT 'Moda y accesorios',
  zona_horaria TEXT    NOT NULL DEFAULT 'America/Lima',
  moneda       TEXT    NOT NULL DEFAULT 'PEN',
  config       TEXT    NOT NULL DEFAULT '{}',
  actualizado  INTEGER NOT NULL
);

CREATE TABLE tiendas (
  id        INTEGER PRIMARY KEY,
  codigo    TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  nombre    TEXT    NOT NULL,
  direccion TEXT    NOT NULL DEFAULT '',
  lat       REAL    NOT NULL,
  lng       REAL    NOT NULL,
  radio_m   INTEGER NOT NULL DEFAULT 80,
  activa    INTEGER NOT NULL DEFAULT 1,
  creado    INTEGER NOT NULL
);

CREATE TABLE usuarios (
  id              INTEGER PRIMARY KEY,
  codigo          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  nombre          TEXT    NOT NULL,
  telefono        TEXT    NOT NULL DEFAULT '',
  rol             TEXT    NOT NULL CHECK (rol IN ('admin', 'supervisor', 'colaborador')),
  secreto         TEXT    NOT NULL,
  tienda_id       INTEGER REFERENCES tiendas(id) ON DELETE SET NULL,
  activo          INTEGER NOT NULL DEFAULT 1,
  dispositivo     TEXT,
  intentos        INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta INTEGER,
  debe_cambiar    INTEGER NOT NULL DEFAULT 0,
  creado          INTEGER NOT NULL
);

CREATE TABLE sesiones (
  token_hash TEXT    PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  creado     INTEGER NOT NULL,
  expira     INTEGER NOT NULL,
  visto      INTEGER NOT NULL,
  agente     TEXT,
  ip         TEXT
);
CREATE INDEX sesiones_usuario ON sesiones(usuario_id);

-- Turnos tipo de cada día de la semana (0 = domingo … 6 = sábado)
CREATE TABLE plantillas (
  id        INTEGER PRIMARY KEY,
  tienda_id INTEGER NOT NULL REFERENCES tiendas(id) ON DELETE CASCADE,
  dia       INTEGER NOT NULL CHECK (dia BETWEEN 0 AND 6),
  inicio    TEXT    NOT NULL,
  fin       TEXT    NOT NULL,
  cupos     INTEGER NOT NULL DEFAULT 1 CHECK (cupos BETWEEN 1 AND 10)
);
CREATE INDEX plantillas_tienda ON plantillas(tienda_id, dia);

-- Feriados, cierres y horarios de campaña (Día de la Madre, Navidad, liquidaciones…)
CREATE TABLE dias_especiales (
  id        INTEGER PRIMARY KEY,
  tienda_id INTEGER REFERENCES tiendas(id) ON DELETE CASCADE,
  fecha     TEXT    NOT NULL,
  cerrado   INTEGER NOT NULL DEFAULT 0,
  turnos    TEXT    NOT NULL DEFAULT '[]',
  motivo    TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX dias_especiales_fecha ON dias_especiales(fecha);

-- Días cuyos turnos ya se generaron a partir de plantillas / días especiales
CREATE TABLE dias_generados (
  tienda_id INTEGER NOT NULL REFERENCES tiendas(id) ON DELETE CASCADE,
  fecha     TEXT    NOT NULL,
  PRIMARY KEY (tienda_id, fecha)
);

CREATE TABLE turnos (
  id           INTEGER PRIMARY KEY,
  tienda_id    INTEGER NOT NULL REFERENCES tiendas(id) ON DELETE CASCADE,
  fecha        TEXT    NOT NULL,
  inicio       TEXT    NOT NULL,
  fin          TEXT    NOT NULL,
  puesto       INTEGER NOT NULL DEFAULT 1,
  usuario_id   INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  origen       TEXT    NOT NULL DEFAULT 'plantilla' CHECK (origen IN ('plantilla', 'especial', 'manual')),
  asignado_por TEXT,
  asignado_en  INTEGER,
  ejemplo      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX turnos_fecha ON turnos(fecha, tienda_id);
CREATE INDEX turnos_usuario ON turnos(usuario_id, fecha);

CREATE TABLE marcas (
  id           INTEGER PRIMARY KEY,
  usuario_id   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  turno_id     INTEGER REFERENCES turnos(id) ON DELETE SET NULL,
  tienda_id    INTEGER REFERENCES tiendas(id) ON DELETE SET NULL,
  tipo         TEXT    NOT NULL CHECK (tipo IN ('entrada', 'control', 'salida')),
  fecha        TEXT    NOT NULL,
  hora         TEXT    NOT NULL,
  ts           INTEGER NOT NULL,
  capturado    INTEGER,
  lat          REAL,
  lng          REAL,
  precision_m  REAL,
  distancia_m  REAL,
  estado       TEXT    NOT NULL CHECK (estado IN ('dentro', 'fuera', 'imprecisa', 'sin_gps')),
  observaciones TEXT   NOT NULL DEFAULT '[]',
  dispositivo  TEXT,
  simulado     INTEGER NOT NULL DEFAULT 0,
  ejemplo      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX marcas_turno ON marcas(turno_id, usuario_id);
CREATE INDEX marcas_usuario_fecha ON marcas(usuario_id, fecha);
CREATE INDEX marcas_fecha ON marcas(fecha);

-- Checklist de apertura/cierre y ventas del turno (cuadre de caja)
CREATE TABLE reportes_turno (
  turno_id      INTEGER NOT NULL REFERENCES turnos(id) ON DELETE CASCADE,
  usuario_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  apertura      TEXT    NOT NULL DEFAULT '[]',
  cierre        TEXT    NOT NULL DEFAULT '[]',
  ventas        INTEGER,
  prendas       INTEGER,
  efectivo      REAL,
  digital       REAL,
  tarjeta       REAL,
  nota          TEXT    NOT NULL DEFAULT '',
  actualizado   INTEGER NOT NULL,
  PRIMARY KEY (turno_id, usuario_id)
);

CREATE TABLE multas (
  id             INTEGER PRIMARY KEY,
  usuario_id     INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  turno_id       INTEGER REFERENCES turnos(id) ON DELETE SET NULL,
  fecha          TEXT    NOT NULL,
  tipo           TEXT    NOT NULL CHECK (tipo IN ('tardanza', 'falta', 'salida_anticipada', 'manual')),
  monto          REAL    NOT NULL,
  detalle        TEXT    NOT NULL,
  estado         TEXT    NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagada', 'anulada')),
  creada         INTEGER NOT NULL,
  notificada     INTEGER,
  vista          INTEGER,
  pagada         INTEGER,
  motivo_anulada TEXT,
  ejemplo        INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX multas_unicas ON multas(turno_id, usuario_id, tipo) WHERE turno_id IS NOT NULL;
CREATE INDEX multas_usuario ON multas(usuario_id, estado);

CREATE TABLE justificaciones (
  id           INTEGER PRIMARY KEY,
  usuario_id   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  multa_id     INTEGER REFERENCES multas(id) ON DELETE CASCADE,
  turno_id     INTEGER REFERENCES turnos(id) ON DELETE SET NULL,
  motivo       TEXT    NOT NULL,
  estado       TEXT    NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
  respuesta    TEXT,
  creada       INTEGER NOT NULL,
  resuelta     INTEGER,
  resuelta_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL
);

-- Solicitudes de cobertura: una colaboradora ofrece su turno y otra lo toma
CREATE TABLE coberturas (
  id             INTEGER PRIMARY KEY,
  turno_id       INTEGER NOT NULL REFERENCES turnos(id) ON DELETE CASCADE,
  solicitante_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  motivo         TEXT    NOT NULL DEFAULT '',
  estado         TEXT    NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'tomada', 'cancelada', 'vencida')),
  tomada_por     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  creada         INTEGER NOT NULL,
  resuelta       INTEGER
);
CREATE INDEX coberturas_estado ON coberturas(estado);

-- Registro de mensajes de WhatsApp enviados (recordatorios, avisos)
CREATE TABLE avisos (
  clave TEXT    PRIMARY KEY,
  tipo  TEXT    NOT NULL,
  en    INTEGER NOT NULL,
  por   INTEGER REFERENCES usuarios(id) ON DELETE SET NULL
);

CREATE TABLE auditoria (
  id         INTEGER PRIMARY KEY,
  ts         INTEGER NOT NULL,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  accion     TEXT    NOT NULL,
  entidad    TEXT,
  entidad_id TEXT,
  detalle    TEXT,
  ip         TEXT
);
CREATE INDEX auditoria_ts ON auditoria(ts);
