# Cómo levantar PAKAL Mission Control (paso a paso)

Qué onda, esto es para que levantes Mission Control en tu compu. Todo corre en
**local**: la base de datos son emuladores de Firebase en tu máquina, o sea que no
tocas nada de producción aunque le muevas lo que quieras. La IA es Gemini en la nube,
así que tampoco te va a matar la GPU.

Si algo se atora, ve a la sección de **Problemas comunes** hasta abajo antes de
mandarme mensaje, porfa 🙏

---

## 0. Lo que necesitas instalado

| Qué | Versión | Pa' qué |
|---|---|---|
| **Node.js** | **22.13 o más** (22 LTS o 24) | Corre el servidor y todo lo demás |
| **Java (JDK)** | **21 o más** | Los emuladores de Firebase son Java. Sin esto no levanta nada |
| **Internet** | — | La primera vez para `npm install` y para que se bajen los emuladores (~100 MB). Luego para Gemini y Gmail |
| Navegador | Chrome, Firefox o Edge | Pa' usar la app |

**Cómo instalarlos:**

- **Arch:**
  ```bash
  node -v                     # si ya da 22.13 o más (ej. nodejs-lts-jod), NO instales nodejs
  sudo pacman -S jdk21-openjdk
  sudo archlinux-java set java-21-openjdk
  # solo si no tienes Node o es viejo: sudo pacman -S nodejs-lts-jod npm
  ```
  Si pacman te pregunta si quitar `nodejs-lts-*`, dile que **no**: si no, cancela
  todo y tampoco instala Java.
- **Ubuntu / Debian:**
  ```bash
  sudo apt install openjdk-21-jdk
  # Node 22 no viene en apt viejo; usa nvm:
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  nvm install 22
  ```
- **Windows:** baja Node 22 LTS de <https://nodejs.org> y el JDK 21 de
  <https://adoptium.net> (Temurin). En el instalador de Java marca *"Set JAVA_HOME"*
  y *"Add to PATH"*. Después cierra y vuelve a abrir la terminal.
- **Mac:** `brew install node@22 openjdk@21`

Revisa que quedó bien:

```bash
node -v     # v22.13.0 o más
java -version   # tiene que decir 21 o más
```

---

## 1. Baja el proyecto e instala

```bash
git clone https://github.com/DerShadow960/explore.git pakal-mission-control
cd pakal-mission-control
npm install
```

Tarda un ratito (son ~770 paquetes). Si sale algún *warning* de `npm audit`, ignóralo.

---

## 2. Crea tu `.env`

```bash
cp .env.example .env          # Windows: copy .env.example .env
```

Ábrelo y llena **solo estas 4 cosas**; lo demás ya viene listo pa' local:

```env
GEMINI_API_KEY=tu_key
GMAIL_USER=tucorreo@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
ANALISIS_DESTINATARIOS=tucorreo@gmail.com
```

### 2.1 Key de Gemini (gratis)

1. Entra a <https://aistudio.google.com/apikey> con tu cuenta de Google (la de la uni
   o una personal, da igual).
2. *Create API key* → cópiala → pégala en `GEMINI_API_KEY`.

Si no pones key igual funciona, nomás que el análisis es el "estático" (reglas fijas,
sin IA).

> Ojo: en la capa gratis Google puede usar lo que le mandes pa' mejorar sus cosas. No
> subas archivos con contraseñas o llaves.

### 2.2 Contraseña de aplicación de Gmail

Pa' que los reportes te lleguen al correo:

1. Tu cuenta de Gmail tiene que tener **verificación en 2 pasos** activada.
2. Ve a <https://myaccount.google.com/apppasswords>, ponle un nombre (ej. "PAKAL") y
   te da 16 letras.
3. Esas van en `GMAIL_APP_PASSWORD` (con o sin espacios, da igual).
   **No es tu contraseña normal de Gmail**, nel, esa no funciona.

Si no configuras correo, no truena: los correos se guardan en `data/outbox/` y se
mandan solos en cuanto lo configures.

### 2.3 A quién le llegan los reportes

`ANALISIS_DESTINATARIOS` = tu correo (o varios separados por coma). En modo local
**solo** les llega a ellos; nunca a los usuarios de prueba.

---

## 3. Checa que todo esté bien

```bash
npm run verificar
```

Te dice si te falta Node, Java, el `.env`, o si algún puerto está ocupado. Todo
tiene que salir ✅ (los ⚠️ son opcionales).

Y pa' confirmar que el correo **sí sale**:

```bash
npm run correo:probar -- tucorreo@gmail.com
```

Si dice `✅ ENVIADO`, revisa tu bandeja (y spam). Si no, te dice exactamente por qué.

---

## 4. Levántalo

```bash
npm run demo
```

La primera vez se baja los emuladores, tenle paciencia. Cuando veas esto ya quedó:

```
✅ Datos de demo listos. Usuarios (contraseña: pakal-demo-2026):
ℹ [pakal] Mission Control en http://localhost:8080  (MODO DEMO · emuladores)
```

Abre **<http://localhost:8080>**. Arriba sale un aviso naranja de "MODO DEMO": así
sabes que estás en local.

Pa' apagarlo: **Ctrl + C** en la terminal.

> Cada vez que lo levantas la base arranca limpia con los datos de prueba. Lo que
> hagas se borra al apagar. Es a propósito.

---

## 5. Entra y pruébalo

Contraseña de todos: **`pakal-demo-2026`**

| Usuario | Qué puede hacer |
|---|---|
| `coordinacion@up.edu.mx` | Todo: ve los dos campus, edita todas las áreas, ve la bitácora y el panel ⚙️ |
| `control@up.edu.mx` | Solo campus Mixcoac; edita Control, lo demás lo ve en solo lectura |
| `telecom.cdup@up.edu.mx` | Solo campus CDUP, área Telecomunicaciones |

**Recorrido rápido pa' enseñarlo:**

1. Entra como `coordinacion@up.edu.mx` → campus **Mixcoac**.
2. **Sistemas de Control** → crea una tarea, cámbiale estado, manda un mensaje en el chat.
3. Abajo, en **🧠 Análisis de código del área**, sube
   `tests/fixtures/rotor_demo.ino` (viene en el proyecto), marca la casilla de aviso de IA → *Analizar*.
   En unos segundos aparece el reporte con su calificación y **te llega el correo**.
4. Regresa al Hub → **📊 Cronograma** (Gantt) → clic en una barra pa' editarla.
5. **⚙️ Estado del servidor** → *Enviarme un correo de prueba*.
6. Cierra sesión, entra como `control@up.edu.mx` e intenta entrar a **CDUP**: te
   rebota. Esa es la parte de permisos.

**Revisión de documentos (similitud y citas):**

7. En la misma área, baja a **📄 Revisión de documentos** y sube
   `tests/fixtures/reporte_qfh_ana.docx`, marca la casilla → *Revisar*. Sale 0% (es el primero).
8. Ahora sube `tests/fixtures/avances_antena_cdup.docx`: copia dos párrafos del
   anterior, así que sale **coincidencia alta (~49%)** con los pasajes marcados.
   Te llega el correo con todo.

> Ojo con cómo se usa esto: marca **texto repetido**, no "plagio". Puede ser una
> cita bien hecha, una plantilla o el mismo autor. Y **no** detecta si algo lo
> escribió una IA (esos detectores fallan mucho). Siempre hay que hablar con la
> persona antes de concluir algo.

**Análisis desde la terminal** (sin abrir la app):

```bash
npm run analizar -- tests/fixtures/rotor_demo.ino Control Mixcoac --sin-firestore
npm run revisar  -- tests/fixtures/reporte_qfh_ana.docx Telecomunicaciones Mixcoac --sin-firestore
```

---

## 6. Comandos que te sirven

| Comando | Qué hace |
|---|---|
| `npm run demo` | Levanta todo (emuladores + datos de prueba + servidor) |
| `npm run verificar` | Checa que tengas todo instalado |
| `npm run correo:probar -- correo@x.com` | Manda un correo de prueba y vacía la cola |
| `npm run analizar -- archivo [área] [campus]` | Analiza código y manda el reporte |
| `npm run revisar -- doc.pdf [área] [campus]` | Revisa un documento (similitud, citas, fuentes) |
| `npm test` | Corre las 62 pruebas |

Archivos que acepta el análisis de código: `.py .ino .cpp .c .h .js .ts .java .go .m .sh .ipynb`
y más. La revisión de documentos: `.pdf .docx .txt .md`. Máximo 2 MB.

---

## 7. Problemas comunes

| Te sale… | Qué hacer |
|---|---|
| `Java no está instalado` o `Could not spawn java` | Instala JDK 21 y **reabre la terminal**. En Arch: `sudo archlinux-java set java-21-openjdk` |
| `Unsupported java version` | Tienes Java viejo. Necesitas 21+ (`java -version`) |
| `Port 8080 is not open` / `EADDRINUSE` | Algo ya usa el puerto. `npm run verificar` te dice cuál. O cambia `PORT` en `.env` |
| `Sin PAKAL_DEMO=true el servidor se conectaría al Firebase REAL` | En tu `.env` pon `PAKAL_DEMO=true`. Siempre usa `npm run demo`, no `npm start` |
| Gmail: `535 Username and Password not accepted` | Estás usando tu contraseña normal. Tiene que ser la **de aplicación** (paso 2.2) |
| El correo no llega | `npm run correo:probar -- tucorreo@gmail.com`; revisa spam |
| El análisis dice "Análisis estático (sin IA…)" | No pusiste `GEMINI_API_KEY`, o se acabó la cuota gratis del minuto. Espera y reintenta |
| `Marca la casilla de aviso de uso de IA` | Hay que aceptar el aviso antes de mandar un archivo a la IA |
| `Demasiados análisis seguidos` | Límite de 15 análisis cada 10 min por seguridad. Espérate tantito |
| La página se queda en "Conectando…" | El servidor no está corriendo, o abriste otra URL. Tiene que ser `http://localhost:8080` |
| `npm install` falla con `EBADENGINE` | Tu Node es viejo. Actualiza a 22.13+ |

---

¿Quieres saber cómo está hecho por dentro? Lee `README.md`.
