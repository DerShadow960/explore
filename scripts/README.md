# Recordatorios por correo

Cron diario en GitHub Actions que avisa **7, 3 y 1 días antes** de la fecha límite
de cada tarea sin completar. Un correo por persona con todas sus tareas.

Quién recibe qué: la gente del equipo dueño de la tarea, más quien tenga
`equipo: "General"` (coordinación, que ve todo).

## Configuración (una sola vez)

### 1. Cuenta de servicio de Firebase

Firebase Console → ⚙️ Configuración del proyecto → **Cuentas de servicio** →
*Generar nueva clave privada*. Se descarga un `.json`.

En GitHub: repo → Settings → Secrets and variables → Actions → **New repository secret**

| Secret | Valor |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | El contenido **completo** del `.json`, pegado tal cual |

> Ese archivo da acceso total al proyecto. Nunca lo subas al repo — solo como secret.

### 2. Envío de correo

**Opción A — Resend** (la que elegimos)

1. Cuenta gratis en [resend.com](https://resend.com) (3,000 correos/mes).
2. Verifica un dominio en *Domains*. **Sin dominio verificado, Resend solo te
   deja mandar correos a tu propia dirección de registro** — para avisarle al
   equipo completo necesitas el dominio.
3. Crea una API key.

| Secret | Ejemplo |
|---|---|
| `RESEND_API_KEY` | `re_xxxxxxxx` |
| `MAIL_FROM` | `PAKAL Mission Control <pakal@tudominio.com>` |

**Opción B — SMTP de Gmail** (si no tienes dominio)

Requiere verificación en dos pasos activada y una
[contraseña de aplicación](https://myaccount.google.com/apppasswords).
Límite ~500 correos/día. No configures `RESEND_API_KEY` y el script usa SMTP solo.

| Secret | Valor |
|---|---|
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | tu correo |
| `SMTP_PASS` | la contraseña de aplicación (16 caracteres) |
| `MAIL_FROM` | `PAKAL Mission Control <tucorreo@gmail.com>` |

## Probarlo sin mandar correos

GitHub → pestaña **Actions** → *Recordatorios de tareas* → **Run workflow**,
con `dry_run` en `true`. Imprime a quién le tocaría el correo sin enviar nada.

En local:

```bash
cd scripts
npm install
DRY_RUN=true FIREBASE_SERVICE_ACCOUNT="$(cat ~/ruta/al/serviceaccount.json)" node recordatorios.mjs
```

## Pruebas de la lógica de fechas

```bash
cd scripts
node recordatorios.test.mjs
```

No toca Firestore ni manda correos.

## Detalles

- **Horario:** 08:00 CDMX (14:00 UTC). México ya no cambia de horario, así que
  la hora no se corre en invierno.
- **Zona horaria:** todo se calcula en `America/Mexico_City` comparando cadenas
  `YYYY-MM-DD`. Una tarea que vence el 1 de septiembre avisa el 31 de agosto
  como "mañana", sin importar dónde corra el runner de GitHub.
- **Sin estado:** no se guarda qué ya se envió. Como el cron corre una vez al día
  y el disparo es por diferencia exacta de días (7, 3, 1), cada aviso sale una
  sola vez de forma natural.
- **Si GitHub no corre el cron un día** (pasa: los cron de Actions se retrasan o
  se saltan bajo carga), ese aviso se pierde. Los otros dos siguen llegando.
- **Un correo que rebota** no detiene el resto del envío; el job termina en rojo
  para que te enteres.
