# PAKAL Mission Control

Plataforma interna de **Explore UP** (Universidad Panamericana) para el proyecto
CubeSat 3U **PAKAL**: coordinación de tareas, cronograma y comunicaciones entre
las áreas técnicas, repartidas en dos campus.

**Producción:** [pakal-mission-control.vercel.app](https://pakal-mission-control.vercel.app)
· [exploreup.vercel.app](https://exploreup.vercel.app)

---

## Cómo está organizado

**Dos campus:** Mixcoac y CDUP. El campus es una **frontera dura** — si no es el
tuyo, ni lo lees ni lo tocas. La única excepción es el chat global de Explore UP.

**Tres áreas:** Telecomunicaciones, Sistemas de Control y Dirección de
Operaciones. Qué áreas existen en cada campus se configura en una constante al
inicio de `app.js`.

**Un rol implícito:** eres miembro de las áreas que traes en `equipos` y ahí
puedes modificar; en todo lo demás, dentro de tu campus, solo lees.

---

## Qué hace

### Autenticación
- Correo y contraseña (Firebase Authentication)
- **Google**, restringido a correos `@up.edu.mx`
- Cambio de contraseña obligatorio en el primer ingreso (se salta para Google,
  que no tiene contraseña que cambiar)
- **Sesión única por navegador**: al entrar en otro equipo, la sesión anterior se
  cierra sola
- **La sesión muere al cerrar la pestaña** (`browserSessionPersistence`): volver a
  abrir la página pide login de nuevo

### Tareas
- Alta con título, responsable, fecha de inicio y fecha límite
- Estados: No empezado → En proceso → Completado
- Badge de vencimiento por colores (vencida / 1-3 días / 4-7 días / más)
- Orden automático por urgencia; completadas al fondo
- Modo solo lectura en áreas ajenas: sin botón de alta, campos deshabilitados

### Cronograma (Gantt)
- Uno por campus, con las tareas de todas sus áreas agrupadas
- Zoom día / semana / mes, línea de *hoy*, scroll horizontal
- Tareas sin fecha de inicio se dibujan como hito (rombo)
- Clic en una barra abre el panel para cambiar fechas y estado
- Vista de tabla alterna, para pantallas angostas y lectores de pantalla
- **Paleta validada para daltonismo**: rojo/verde se confunden en deuteranopia
  (ΔE 5.0), así que Completado va en cian y Vencida en rosa-rojo (ΔE 9.5)

### Comunicaciones
- **Chat global** flotante, para todo Explore UP, visible en cualquier pantalla
- **Chat por campus**, en la segunda pestaña del mismo widget
- **Chat por área**, dentro de cada workspace
- Cada mensaje queda firmado con el `uid` del autor, validado por el servidor

### Recordatorios por correo
Cron diario en GitHub Actions: avisa **7, 3 y 1 días antes** del vencimiento.
Un correo por persona agrupando sus tareas, no uno por tarea.
Ver [`scripts/README.md`](scripts/README.md).

### Bitácora de accesos
Quien escribe `/app.js` en la barra de direcciones cae en una función serverless
que registra el intento y devuelve una página de aviso. **Tras 3 intentos en 10
minutos, esa IP se bloquea 5 minutos.** La bitácora se consulta desde la app y se
exporta a Excel; solo la ve quien tenga `Auditoria` en su array `equipos`.

### Exportación a Excel
Tareas del campus en `.xlsx` (campus `General`) y bitácora de accesos en `.xlsx`
(equipo `Auditoria`). SheetJS se carga bajo demanda: no le pesa la app a quien
nunca exporta.

---

## Modelo de datos

```
usuarios/{uid}
  nombre                string
  campus                'Mixcoac' | 'CDUP' | 'General'
  equipos               string[]   áreas donde puede modificar
  debeCambiarPassword   bool

tareas/{id}
  equipo, campus, titulo, responsable
  estado                'No empezado' | 'En proceso' | 'Completado'
  fechaInicio           timestamp | null   (opcional, para el Gantt)
  fechaFin              timestamp | null

chats/{id}
  canal                 'General' | nombre de área
  campus                null (global) | 'Mixcoac' | 'CDUP'
  autor, autorUid, texto, timestamp

sesiones/{uid}          sessionId, desde, navegador
accesos/{id}            bitácora de /app.js (la escribe el servidor)
accesos_control/{id}    contadores del límite de intentos
```

> `equipos[]` admite además `'Auditoria'`, que **no es un área de trabajo**: no
> aparece en `equipoValido()`, ninguna tarea puede pertenecerle, y su único
> efecto es habilitar la bitácora de accesos.

## Matriz de permisos

| Acción | Condición |
|---|---|
| Leer tareas y chats | Estar autenticado **y** que sea tu campus (o ser `General`) |
| Leer el chat global | Cualquiera autenticado |
| Crear/editar/borrar tarea | `equipo ∈ mis equipos` **y** campus compatible |
| Escribir en chat de área | `canal ∈ mis equipos` **y** campus compatible |
| Escribir en chat global | Cualquiera autenticado |
| Leer la bitácora de accesos | Tener `Auditoria` en `equipos` (independiente del campus) |
| Cambiar mi perfil | Solo el flag de contraseña — nadie se auto-asigna campus ni equipos |

`campus` y `equipos` se asignan **a mano desde la consola de Firebase**. El
cliente nunca los escribe: si pudiera, cualquiera se ascendería a `General`.

---

## Arquitectura

```
Frontend        HTML + CSS + JavaScript ES6 (sin build step)
                index.html · index.css · app.js
                Firebase SDK por CDN

Backend         Firebase Authentication  (identidad)
                Cloud Firestore          (datos + reglas de seguridad)
                Vercel Serverless        (api/bloqueado.js)
                GitHub Actions           (cron de recordatorios)

Hospedaje       Vercel, auto-deploy en push a main
```

### Estructura

```
index.html  index.css  app.js       la aplicación
api/bloqueado.js                    registro y bloqueo de /app.js
firestore.rules                     reglas de seguridad
vercel.json                         redirects, rewrites y headers
scripts/                            migración y recordatorios
tests/rules.test.mjs                59 pruebas de las reglas
.github/workflows/                  cron de recordatorios
```

---

## Seguridad

| Capa | Qué hace |
|---|---|
| Transporte | HTTPS forzado por Vercel + CDN global |
| Autenticación | Firebase Auth; contraseñas nunca tocan Firestore |
| Autorización | Firestore Rules: campus + membresía de área, del lado del servidor |
| Integridad del chat | `autorUid == request.auth.uid` y `timestamp == request.time` |
| Inmutabilidad | Los mensajes no se editan ni se borran |
| XSS | Todo texto de usuario entra con `textContent`, nunca `innerHTML` |
| Headers | `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` |
| Límite de intentos | 3 accesos a `/app.js` en 10 min → 5 min de bloqueo por IP |

**Lo que NO es seguridad, y conviene tener claro:**

- La API key de Firebase en `app.js` **es pública por diseño**. No es una
  credencial: identifica el proyecto. Lo que protege los datos son las reglas.
- **`app.js` no se puede ocultar.** El navegador tiene que descargarlo para
  ejecutarlo. El redirect solo atrapa a quien escribe la URL a mano; con F12 o
  `curl` se lee completo. Es un letrero, no una cerradura.
- La **sesión única** corre en el cliente y es evadible desde la consola. Sirve
  contra el uso casual de una cuenta compartida, no contra alguien decidido.
- El **bloqueo de campus en la interfaz** es de navegación. La barrera real son
  las reglas de Firestore, que sí lo aplican del lado del servidor.

---

## Desarrollo local

```bash
git clone https://github.com/DerShadow960/explore.git
cd explore
python3 -m http.server 8000
```

Abre `http://localhost:8000` — **no** con doble clic al archivo: los módulos ES
no cargan desde `file://`.

Requisitos en Firebase para que funcione en local:

1. Authentication → Settings → **Dominios autorizados** → agregar `localhost`
   (sin `http://` ni puerto)
2. Google Cloud Console → Credenciales → tu API key → **Sitios web referentes**
   → agregar `http://localhost:8000/*`

> Local le pega a **Firestore de producción**. No hay emulador de por medio: lo
> que escribas ahí lo ve todo el equipo.

### Pruebas de las reglas

```bash
npm install
npm run test:rules      # 59 pruebas contra el emulador; requiere Java
```

No toca producción.

---

## Despliegue

`git push origin main` → Vercel despliega solo.

**El orden importa cuando cambian las reglas.** Publica primero
`firestore.rules` en la consola de Firebase y luego haz el push. Al revés, la
app queda rota en la ventana entre uno y otro: las reglas nuevas rechazan las
consultas viejas.

### Variables de entorno

**En Vercel** (Settings → Environment Variables):

| Nombre | Para qué |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | JSON de la cuenta de servicio, para `api/bloqueado.js` |

**En GitHub** (Settings → Secrets and variables → Actions):

| Nombre | Para qué |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Leer tareas y usuarios desde el cron |
| `RESEND_API_KEY` + `MAIL_FROM` | Envío por Resend |
| `SMTP_HOST` / `PORT` / `USER` / `PASS` | Alternativa por SMTP |

> El JSON de la cuenta de servicio **sí es una credencial de verdad**: da acceso
> total al proyecto saltándose las reglas. Nunca al repositorio.

### Migración de datos

`scripts/migrar-campus.mjs` convierte el modelo viejo (`equipo` como string) al
nuevo (`campus` + `equipos[]`). Corre en seco por defecto:

```bash
cd scripts && npm install
FIREBASE_SERVICE_ACCOUNT="$(cat ruta/al.json)" node migrar-campus.mjs
FIREBASE_SERVICE_ACCOUNT="..." node migrar-campus.mjs --aplicar
FIREBASE_SERVICE_ACCOUNT="..." node migrar-campus.mjs --aplicar --limpiar
```

`--limpiar` borra el campo `equipo` viejo. Córrelo **solo después** de que el
frontend nuevo esté en producción y verificado.

---

## Privacidad

La plataforma registra accesos, cambios en tareas y mensajes. El aviso está a la
vista en el hub. Los accesos a `/app.js` guardan **IP y navegador** — no hay
sesión de Firebase en esa petición, así que es imposible saber qué usuario fue.

---

## Pendientes

- [ ] Integración con Google Calendar (necesita servidor: el `client_secret` de
      OAuth no puede vivir en el cliente)
- [ ] Notificaciones push
- [ ] Recuperación de contraseña
- [ ] 2FA
- [ ] Retención automática de la bitácora de accesos
- [ ] Backup automático de Firestore

---

**Desarrollo:** Francisco Rafael Lever Gómez
**Equipo:** Explore UP · PAKAL CubeSat 3U
**Institución:** Universidad Panamericana, CDMX
