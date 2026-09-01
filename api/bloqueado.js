/**
 * /api/bloqueado — registro de accesos directos a /app.js
 * ============================================================
 * A donde vercel.json manda a quien escribe /app.js en la barra de
 * direcciones. Registra el intento y devuelve la página del meme.
 *
 * Tras 3 intentos en 10 minutos, bloquea esa IP 5 minutos (HTTP 429).
 *
 * LÍMITE IMPORTANTE: esta petición NO lleva sesión de Firebase, así que
 * es imposible saber qué usuario fue. Se registra IP y navegador, nada más.
 *
 * Variable de entorno en Vercel:
 *   FIREBASE_SERVICE_ACCOUNT  = el JSON de la cuenta de servicio
 */

import admin from "firebase-admin";
import crypto from "crypto";

const INTENTOS_MAX = 3;
const VENTANA_MS = 10 * 60 * 1000;   // en cuánto tiempo cuentan los 3 intentos
const BLOQUEO_MS = 5 * 60 * 1000;    // cuánto dura el castigo

// El SDK se inicializa una vez por instancia, no en cada petición.
let db = null;
function firestore() {
    if (db) return db;
    const cred = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!cred) return null;
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.cert(JSON.parse(cred)) });
    }
    db = admin.firestore();
    return db;
}

function ipDe(req) {
    const fwd = req.headers["x-forwarded-for"];
    if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
    return req.socket?.remoteAddress || "desconocida";
}

// La IP se guarda tal cual (es lo que pediste), pero el id del documento
// va hasheado para que la ruta no exponga direcciones a quien liste la
// colección desde la consola.
const claveDe = (ip) => crypto.createHash("sha256").update(ip).digest("hex").slice(0, 24);

export default async function handler(req, res) {
    const ip = ipDe(req);
    const navegador = (req.headers["user-agent"] || "desconocido").slice(0, 250);
    const referer = (req.headers["referer"] || "").slice(0, 250);
    const ahora = Date.now();

    let bloqueado = false;
    let segundosRestantes = 0;

    const base = firestore();
    if (base) {
        try {
            const ref = base.collection("accesos_control").doc(claveDe(ip));

            // Transacción: dos pestañas al mismo tiempo no deben contar
            // como un solo intento ni pisarse el contador.
            const resultado = await base.runTransaction(async (tx) => {
                const snap = await tx.get(ref);
                const d = snap.exists ? snap.data() : null;

                if (d?.bloqueadoHasta && d.bloqueadoHasta > ahora) {
                    return { bloqueado: true, hasta: d.bloqueadoHasta, intentos: d.intentos };
                }

                const dentroDeVentana = d?.ventanaInicio && (ahora - d.ventanaInicio) < VENTANA_MS;
                const intentos = dentroDeVentana ? (d.intentos || 0) + 1 : 1;
                const seBloquea = intentos >= INTENTOS_MAX;

                tx.set(ref, {
                    ip,
                    intentos: seBloquea ? 0 : intentos,
                    ventanaInicio: dentroDeVentana && !seBloquea ? d.ventanaInicio : ahora,
                    bloqueadoHasta: seBloquea ? ahora + BLOQUEO_MS : null,
                    ultimoIntento: admin.firestore.FieldValue.serverTimestamp(),
                    navegador
                }, { merge: true });

                return { bloqueado: seBloquea, hasta: ahora + BLOQUEO_MS, intentos };
            });

            bloqueado = resultado.bloqueado;
            segundosRestantes = Math.max(0, Math.ceil((resultado.hasta - ahora) / 1000));

            // Bitácora: un documento por intento, para poder revisarlos después.
            await base.collection("accesos").add({
                ip,
                navegador,
                referer,
                ruta: "/app.js",
                intentoNumero: resultado.intentos || null,
                bloqueado,
                cuando: admin.firestore.FieldValue.serverTimestamp()
            });
        } catch (e) {
            // Si el registro falla, la página se sirve igual. Un log caído
            // no debe convertirse en un sitio caído.
            console.error("No se pudo registrar el acceso:", e);
        }
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");

    if (bloqueado) {
        res.setHeader("Retry-After", String(Math.ceil(BLOQUEO_MS / 1000)));
        return res.status(429).send(paginaBloqueo(segundosRestantes));
    }
    return res.status(200).send(paginaMeme());
}

// ============================================================
// Páginas — se mandan en línea para no depender de que Vercel
// incluya archivos estáticos en el bundle de la función.
// ============================================================
const ENVOLTURA = (titulo, borde, cuerpo) => `<!doctype html>
<html lang="es"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>${titulo}</title>
<link rel="stylesheet" href="/index.css">
<style>
  .bloqueo{max-width:520px;margin:8vh auto;background:var(--panel-bg);border-top:5px solid ${borde};
           border-radius:10px;padding:32px;text-align:center}
  .bloqueo h1{margin:0 0 8px;font-size:1.6em}
  .bloqueo p{color:var(--text-main);line-height:1.5}
  .meme{width:100%;max-width:340px;border-radius:8px;margin:20px auto;display:block}
  .codigo{display:inline-block;font-family:monospace;background:#0b0c10;border:1px solid var(--accent-blue);
          border-radius:4px;padding:3px 8px;color:var(--bright-blue)}
  .volver{display:inline-block;margin-top:18px;background:var(--accent-blue);color:#0b0c10;
          padding:11px 22px;border-radius:5px;text-decoration:none;font-weight:bold}
  .reloj{font-size:2.4em;font-weight:bold;color:#ff6b6b;margin:16px 0}
</style></head>
<body>
<img src="/assets/LogoUP.png" alt="Logo Explore UP" class="logo-explore">
<div class="bloqueo">${cuerpo}</div>
</body></html>`;

const paginaMeme = () => ENVOLTURA("Nada que ver por aquí — Explore UP", "#ff6b6b", `
    <h1>Neta??</h1>
    <img src="/assets/DUDE.jpg" alt="Meme" class="meme" onerror="this.style.display='none'">
    <p>Se quien eres, con mucho cariño, Rafael</p>
    <a class="volver" href="/">⬅ Volver a Mission Control</a>`);

const paginaBloqueo = (segundos) => ENVOLTURA("Demasiados intentos — Explore UP", "#ff6b6b", `
    <h1>🛑 Demasiados intentos</h1>
    <p>Llevas ${INTENTOS_MAX} intentos de abrir <span class="codigo">/app.js</span>.</p>
    <div class="reloj" id="reloj">${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}</div>
    <p>Espera a que termine la cuenta para volver a intentarlo.</p>
    <script>
      let s = ${segundos};
      const el = document.getElementById("reloj");
      const t = setInterval(() => {
        s--;
        if (s <= 0) { clearInterval(t); el.textContent = "0:00"; location.href = "/"; return; }
        el.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
      }, 1000);
    </script>
    <a class="volver" href="/">⬅ Volver a Mission Control</a>`);
