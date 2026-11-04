# PAKAL Mission Control · v2 (local)

Plataforma interna de **Explore UP** (Universidad Panamericana) para el CubeSat 3U
**PAKAL**: tareas, cronograma, chats por campus/área y, nuevo en v2, **análisis de
código con IA** y **revisión de documentos** (similitud interna, citas faltantes y
posibles fuentes con búsqueda de Google). Los reportes llegan por correo.

Todo corre en tu máquina con `npm run demo`, sobre emuladores de Firebase: nada toca
producción. La IA es Gemini en la nube, así que no usa tu GPU.

---

## Arranque rápido (100 % local)

> ¿Primera vez? Sigue **[INSTRUCCIONES.md](INSTRUCCIONES.md)**: viene paso a paso con dependencias.

```bash
npm install
cp .env.example .env     # pon GEMINI_API_KEY y tu correo (ver abajo)
npm run verificar        # checa Node 22.13+, Java 21+, .env y puertos
npm run demo             # emuladores + datos de prueba + servidor → http://localhost:8080
```

**Por defecto nada toca producción:**

| Pieza | Dónde corre |
|---|---|
| Firebase (Auth + Firestore) | Emuladores en tu máquina (requiere **Java 21+**; la primera vez descarga los emuladores) |
| IA | Gemini en la nube de Google: **no usa tu GPU** |
| Drive | Apagado (`DRIVE_WATCH=false`). Se analiza desde la app o con `npm run analizar` |
| Correo | Sale por tu Gmail, **solo** a `ANALISIS_DESTINATARIOS`. Nunca a los usuarios de prueba |
| Recordatorios | Apagados en demo |

El servidor **se niega a arrancar contra el Firebase real** salvo que pongas
`PAKAL_PRODUCCION=true` a propósito. Lo mismo `npm run usuario:crear`.

Usuarios de prueba (contraseña `pakal-demo-2026`):

| Correo | Campus | Equipos |
|---|---|---|
| `coordinacion@up.edu.mx` | General | Telecom, Control, Operaciones, Auditoria |
| `control@up.edu.mx` | Mixcoac | Control |
| `telecom.cdup@up.edu.mx` | CDUP | Telecomunicaciones |

### Demo del análisis en 10 segundos

```bash
npm run analizar -- tests/fixtures/rotor_demo.ino Control Mixcoac --para tu@correo.com --sin-firestore
```

---

## Configuración (`.env`)

Todo está comentado en `.env.example`. Lo mínimo:

### 1. Gemini (IA)

1. Entra a <https://aistudio.google.com/apikey> (con tu cuenta `@up.edu.mx` o una personal) → *Create API key*.
2. `GEMINI_API_KEY=...` en `.env`.

La key gratis tiene límites por minuto/día (los ves en AI Studio). Si
`gemini-3.8-flash` se queda sin cuota, se usa `gemini-3.5-flash-lite`, y si tampoco
hay, el análisis estático. Tu suscripción Gemini Pro de la uni sube los límites de
la **app** de Gemini, no los de la API; para la demo la cuota gratis sobra.

> En la capa gratis Google puede usar lo que mandas para mejorar sus productos. Para
> código del proyecto está bien; no subas llaves ni datos sensibles.

### 2. Correo

Gmail con [contraseña de aplicación](https://myaccount.google.com/apppasswords)
(requiere verificación en 2 pasos): `GMAIL_USER` + `GMAIL_APP_PASSWORD`. Pon en
`ANALISIS_DESTINATARIOS` a quién le llegan los reportes. Prueba con:

```bash
npm run correo:probar -- tu@correo.com
```

### Producción (solo si algún día la quieres)

`PAKAL_DEMO=false` + `PAKAL_PRODUCCION=true` + cuenta de servicio en `secrets/`.
Para vigilar Drive: habilita Google Drive API, comparte cada carpeta (Lector) con
el `client_email` de la cuenta de servicio y pon `DRIVE_WATCH=true`. Antes, publica
reglas e índices con `npm run reglas:publicar`.

### Proveedores de IA

| Proveedor | Dónde corre | Configuración |
|---|---|---|
| **Gemini** (por defecto) | Nube de Google | `GEMINI_API_KEY`, `GEMINI_MODELOS` |
| Claude | Nube de Anthropic | `ANTHROPIC_API_KEY` + agregar `anthropic` a `IA_PROVEEDORES` |
| Ollama | **Tu GPU** (apagado por defecto) | agregar `ollama` a `IA_PROVEEDORES` |
| Heurístico | Tu CPU, instantáneo | siempre al final como respaldo |

### Revisión de documentos

PDF, Word, `.txt` y `.md` (desde la app, `npm run revisar` o Drive con
`DRIVE_REVISAR_DOCUMENTOS=true`):

1. **Similitud interna (local):** el texto se parte en ventanas de 7 palabras y se
   compara contra todo lo revisado antes (`data/corpus.json`, que guarda solo huellas
   numéricas, nunca el texto). Detecta copia literal aunque cambien mayúsculas,
   acentos o puntuación. No detecta paráfrasis ni traducciones, a propósito.
   - Versiones anteriores del mismo archivo se muestran aparte y no cuentan.
   - Documentos de otro campus se comparan, pero su nombre se oculta.
   - Niveles: ≥40 % alta, ≥15 % media.
2. **Gemini + búsqueda de Google:** señala pasajes que deberían llevar cita y
   posibles fuentes (con la URL que devolvió la búsqueda). Califica claridad y rigor,
   no "originalidad".
3. **Sin dictámenes:** el prompt, la app y el correo hablan de "coincidencias" y
   "pasajes que conviene citar". No hay detector de texto generado por IA: no es
   confiable y castiga a quien escribe formal o en su segundo idioma.

Se guarda en Firestore (`revisiones`, lectura por campus, solo escribe el servidor),
en `data/revisiones/` y se manda por correo.

### Correo — entrega garantizada

Orden por defecto `gmail → resend → smtp`. Basta con uno:

- **Gmail (recomendado):** activa verificación en 2 pasos en la cuenta y crea una
  [contraseña de aplicación](https://myaccount.google.com/apppasswords) →
  `GMAIL_USER` + `GMAIL_APP_PASSWORD`. Límite ~500 correos/día.
- **Resend:** `RESEND_API_KEY`. Con `onboarding@resend.dev` solo llega a tu correo de
  registro; para otros destinatarios verifica un dominio.
- **SMTP** genérico (Outlook: `smtp.office365.com:587`).

Cómo se garantiza que llegue:

1. Si un transporte falla se intenta el siguiente.
2. Si **todos** fallan, el correo **no se pierde**: queda en `data/outbox.json` + un
   `.eml` legible en `data/outbox/`, y se reintenta solo con espera creciente
   (5 min, 10, 20… hasta 6 h; 50 intentos).
3. La cola sobrevive reinicios. `npm run correo:probar` además la vacía si el correo
   ya funciona.
4. Cada envío exitoso queda registrado en `data/correo-enviados.log`.
5. Si Firestore o el directorio de usuarios no responden, el correo sale igual
   (a los fijos y al autor) y el análisis se guarda en `data/analisis/`.

Destinatarios de cada análisis: `ANALISIS_DESTINATARIOS` (siempre). En producción
además los miembros del área y quien subió el archivo; en demo, **solo** los fijos.

---

## Cómo está organizado

```
server/                       Node + Express (todo lo que no ve el navegador)
  index.js · arranque.js      valida .env, conecta servicios, planificador
  app.js                      rutas HTTP, CSP, rate limits, trampa de código fuente
  config.js                   ÚNICO lugar que lee variables de entorno
  firebase.js                 Admin SDK
  middleware/                 auth (verifica token de Firebase), cabeceras de seguridad
  services/
    analisis.js               pipeline: archivo → IA → Firestore + copia local → correo
    documentos/               revisión de documentos: similitud, corpus, revisor, pipeline
    ia/                       proveedores (Gemini, Claude, Ollama, heurístico) y prompt
    drive/                    cliente de Drive, vigilante, extracción de texto
    correo/                   transportes, respaldo y cola de reintentos
    recordatorios.js          avisos de vencimiento (antes era GitHub Actions)
    bloqueo.js                bitácora y bloqueo de quien abre el código a mano
  jobs/planificador.js        tareas periódicas
public/                       lo único que se sirve al navegador
  index.html                  sin onclick ni estilos en línea (CSP estricta)
  css/                        base, vistas, chat, gantt, análisis
  js/
    main.js                   punto de entrada
    dominio.js                campus, áreas y permisos — COMPARTIDO con el servidor
    estado.js, api.js, firebase.js
    ui/                       DOM y delegación de eventos
    features/                 auth, navegación, tareas, chat, gantt, accesos, análisis, admin, exportar
scripts/                      CLI: probar correo, analizar archivo, crear usuario, sembrar demo, zip
tests/unit/                   62 pruebas (npm test)
tests/rules/                  pruebas de firestore.rules (npm run test:rules, requiere Java)
firestore.rules               la seguridad real de los datos
```

### Flujo del análisis

```
 Drive (carpeta del área)          App (subida manual)          CLI (npm run analizar)
          │ cada 2 min                     │ POST /api/analisis/subir    │
          ▼                                ▼ (token + permiso de área)   ▼
   vigilante: ¿nuevo? ¿en calma? ¿cambió? ──► extracción de texto ──► ¿tiene código?
                                                                          │
                                Gemini 3.8 Flash → 3.5 Flash-Lite → heurístico ◄┘
                                                     │
                       ┌─────────────────────────────┼─────────────────────────────┐
                       ▼                             ▼                             ▼
               Firestore `analisis`         data/analisis/*.json       correo (gmail→resend→smtp)
               (se ve en la app)            (copia local)              └─ falla → cola + reintento
```

---

## Seguridad

| Capa | Qué hace |
|---|---|
| Datos | `firestore.rules`: campus como frontera dura, edición solo en tus áreas, validación de esquema campo por campo, mensajes inmutables, todo lo no listado denegado |
| Identidad | Firebase Auth; Google restringido a `@up.edu.mx`; sesión muere al cerrar la pestaña; sesión única por navegador |
| API local | Cada llamada verifica el ID token con el Admin SDK (firma, expiración, revocación) y lee el perfil del servidor. El cliente nunca declara su rol |
| Navegador | CSP `script-src 'self'` sin excepciones: Firebase y SheetJS se sirven desde `/vendor`, cero `onclick`/`<script>`/`style` en línea. `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` |
| XSS | Todo texto de usuario, de Drive o de la IA entra con `textContent`; en correos, todo pasa por `escapar()` y solo se enlazan URLs `https://` |
| IA | El archivo va delimitado como datos; si trae instrucciones, se reporta como hallazgo. La respuesta se valida campo por campo |
| Abuso | Rate limits por IP (API general, análisis, administración, trampa) |
| Archivos | Solo `public/` es accesible; `.env`, `secrets/` y `data/` (permisos 600/700) quedan fuera |
| Archivos subidos | Word: se revisa el índice del ZIP antes de abrirlo (bombas de descompresión). PDF y Word se procesan en un proceso aparte con 256 MB y 20 s como tope; el texto se recorta a 1 M de caracteres y la similitud a 200 mil |
| Logs | Sin caracteres de control: un nombre de archivo no puede inventar líneas falsas |
| CI | Acciones fijadas por commit exacto, permisos de solo lectura, `npm audit` en cada push |
| Excel | Generador propio sin dependencias; celdas que empiezan con `= + - @` se neutralizan (inyección de fórmulas) |

Lo que **no** es seguridad, para tenerlo claro:

- La configuración web de Firebase (API key) es **pública por diseño**; lo que protege
  los datos son las reglas.
- El JS del frontend **no se puede ocultar**: el navegador lo necesita. La trampa de
  `/js/*.js` atrapa a quien lo abre en la barra de direcciones, nada más.
- La sesión única corre en el cliente: frena cuentas compartidas, no a un atacante.

### Permisos

| Acción | Condición |
|---|---|
| Leer tareas, chats y análisis | Tu campus (o `General`) |
| Chat global | Cualquiera con perfil |
| Crear/editar/borrar tareas, escribir en chat de área, mandar archivos a analizar | Ser del área **y** del campus |
| Bitácora de accesos | `Auditoria` en `equipos` |
| Panel "Estado del servidor" | Campus `General` o `Auditoria` |
| Cambiar campus/equipos | Nadie desde la app: `npm run usuario:crear` o consola |

---

## Administración

```bash
# Alta (imprime contraseña temporal una vez; pedirá cambiarla al entrar)
npm run usuario:crear -- --email ana@up.edu.mx --nombre "Ana" --campus CDUP --equipos Telecomunicaciones
# Cambiar permisos
npm run usuario:crear -- --email ana@up.edu.mx --campus General --equipos Telecomunicaciones,Auditoria
```

Desde la app (coordinación/auditoría): **⚙️ Estado del servidor** muestra cola de
correo, estado de Drive e IA, y permite mandar un correo de prueba, vaciar la cola,
forzar revisión de Drive y mandar recordatorios.

---

## Pruebas

```bash
npm test             # 62 pruebas: correo (con SMTP real local), IA, Drive, HTTP, permisos, plantillas
npm run test:rules   # reglas de Firestore contra el emulador (requiere Java)
```

---

## Cambios de privacidad y seguridad (v2.1)

Salieron del análisis ético del proyecto:

- **Minimización:** a Gemini no se le manda el nombre del autor, y del texto se quitan
  correos, teléfonos, CURP, RFC y números de cuenta (`server/lib/privacidad.js`). Los
  nombres propios escritos dentro del texto no se pueden quitar automáticamente; para
  uso real con estudiantes conviene la capa de pago de Gemini.
- **Consentimiento:** antes de subir un archivo hay que marcar una casilla de aviso de IA;
  el servidor rechaza la petición sin ella.
- **Página de bloqueo honesta:** dice qué se registra (IP, navegador, hora), que no
  sabemos quién es la persona y cuándo se borra. Antes decía "sé quién eres".
- **Retención:** la bitácora de accesos se borra a los 90 días y las copias locales de
  reportes a los 365 (`RETENCION_*` en `.env`). Tareas y chats no se tocan.
- **Excel sin SheetJS:** la exportación usa un generador propio (`public/js/lib/xlsx-mini.js`);
  SheetJS 0.18.5 tenía vulnerabilidades altas sin parche en npm.
- **CI:** GitHub Actions corre las pruebas unitarias, las de reglas (con emulador) y
  `npm audit` en cada push.
- **Revisión de seguridad:** extracción de PDF/Word aislada contra archivos bomba,
  tope a la similitud, nombres de archivo sin caracteres de control, `@grpc/grpc-js`
  forzado a una versión sin vulnerabilidades y acciones de CI fijadas por commit.
  Quedan 6 avisos moderados en dependencias internas de Google (`rimraf`/`glob`) que no
  reciben datos de usuarios.
- **Vercel apagado:** `vercel.json` desactiva los despliegues automáticos; este proyecto
  corre en local.

## Qué cambió respecto a v1

- `app.js` de 1 388 líneas → módulos por funcionalidad; dominio compartido cliente/servidor.
- Sin Vercel: un servidor Node local reemplaza a `api/bloqueado.js` y al cron de
  GitHub Actions (`.github/workflows/recordatorios.yml`). Ya no hace falta.
- **Corrección:** los recordatorios filtraban por `usuario.equipo` (modelo viejo) y
  no le llegaban a nadie con el modelo `campus + equipos[]`. Ahora sí.
- `firestore.rules` no estaba en el repo; se reescribió con validación de esquema.
- Tareas nuevas guardan `creadoPor`, `creado`, `actualizado` (las viejas siguen
  funcionando; al editarlas se agrega `actualizado`).
- Contraseña nueva: mínimo 10 caracteres con letras y números (antes 8).
- Nuevo: análisis de código con IA, panel de estado del servidor, modo demo.

> **Orden al publicar reglas:** primero `npm run reglas:publicar`, luego usa la
> versión nueva. Las reglas nuevas exigen `actualizado` en cada edición, cosa que el
> frontend viejo (Vercel) no manda: si sigue en línea, sus ediciones fallarán.

---

## Problemas comunes

| Síntoma | Causa |
|---|---|
| El servidor no arranca y lista errores | Falta algo en `.env`; el mensaje dice qué |
| "Falta el índice de Firestore para análisis" | `npm run reglas:publicar` (publica `firestore.indexes.json`) |
| Drive: `File not found` / 404 | La carpeta no está compartida con el `client_email` de la cuenta de servicio |
| Drive: `Drive API has not been used` | Habilita Google Drive API en Cloud Console |
| Gmail: `535 Username and Password not accepted` | Usa contraseña de **aplicación**, no la normal |
| Login con Google: `unauthorized-domain` | Agrega `localhost` en Authentication → Dominios autorizados |
| Correos no llegan | `npm run correo:probar -- tu@correo.com` te dice exactamente por qué; revisa spam |

---

**Desarrollo:** Francisco Rafael Lever Gómez · **Equipo:** Explore UP · PAKAL CubeSat 3U ·
**Institución:** Universidad Panamericana, CDMX
