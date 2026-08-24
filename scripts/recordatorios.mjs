/**
 * Recordatorios de tareas por correo — PAKAL Mission Control
 * ============================================================
 * Corre una vez al día desde GitHub Actions. Busca tareas sin completar
 * cuya fecha límite caiga exactamente en 7, 3 o 1 días, y manda un
 * resumen por correo a la gente del equipo dueño de la tarea
 * (más quien tenga equipo "General", que coordina todo).
 *
 * Se manda UN correo por persona con todas sus tareas, no un correo
 * por tarea: si se juntan cinco vencimientos nadie quiere cinco correos.
 *
 * Variables de entorno (secrets del repo en GitHub):
 *   FIREBASE_SERVICE_ACCOUNT   JSON completo de la cuenta de servicio
 *   RESEND_API_KEY             API key de Resend           (opción A)
 *   SMTP_HOST/PORT/USER/PASS   servidor SMTP               (opción B)
 *   MAIL_FROM                  remitente, ej. "PAKAL <pakal@tudominio.com>"
 *   DRY_RUN                    "true" para imprimir sin enviar
 */

import admin from "firebase-admin";

const TZ = "America/Mexico_City";
const AVISOS = [7, 3, 1];              // días antes del vencimiento
const DRY_RUN = process.env.DRY_RUN === "true";

// ============================================================
// Fechas — todo se calcula en la zona horaria de CDMX.
// Se comparan cadenas "YYYY-MM-DD" en vez de restar milisegundos
// para que el horario de verano no corra los días.
// ============================================================
export function ymd(fecha) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
    }).format(fecha);
}

export function diasEntre(desdeYmd, hastaYmd) {
    const [a1, a2, a3] = desdeYmd.split("-").map(Number);
    const [b1, b2, b3] = hastaYmd.split("-").map(Number);
    return Math.round((Date.UTC(b1, b2 - 1, b3) - Date.UTC(a1, a2 - 1, a3)) / 86400000);
}

function fechaLegible(fecha) {
    return new Intl.DateTimeFormat("es-MX", {
        timeZone: TZ, weekday: "long", day: "numeric", month: "long"
    }).format(fecha);
}

// ============================================================
// Envío de correo — Resend si hay API key, si no SMTP.
// ============================================================
async function enviarCorreo({ para, asunto, html }) {
    const from = process.env.MAIL_FROM || "PAKAL Mission Control <onboarding@resend.dev>";

    if (DRY_RUN) {
        console.log(`\n  [DRY RUN] Para: ${para}\n  Asunto: ${asunto}`);
        return;
    }

    if (process.env.RESEND_API_KEY) {
        const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ from, to: [para], subject: asunto, html })
        });
        if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
        return;
    }

    if (process.env.SMTP_HOST) {
        const { default: nodemailer } = await import("nodemailer");
        const transporte = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT || 587),
            secure: Number(process.env.SMTP_PORT) === 465,
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        });
        await transporte.sendMail({ from, to: para, subject: asunto, html });
        return;
    }

    throw new Error("No hay forma de enviar correo: falta RESEND_API_KEY o SMTP_HOST.");
}

// ============================================================
// Plantilla del correo
// ============================================================
export function construirHtml(nombre, tareas) {
    const filas = tareas.map((t) => {
        const color = t.dias <= 1 ? "#c62828" : t.dias <= 3 ? "#ef6c00" : "#2e7d32";
        const cuando = t.dias === 1 ? "mañana" : `en ${t.dias} días`;
        return `
        <tr>
          <td style="padding:12px 14px;border-bottom:1px solid #e6e6e6;">
            <strong style="color:#111;">${escapar(t.titulo)}</strong><br>
            <span style="color:#666;font-size:13px;">
              ${escapar(t.equipo)} · Responsable: ${escapar(t.responsable)}
            </span>
          </td>
          <td style="padding:12px 14px;border-bottom:1px solid #e6e6e6;text-align:right;white-space:nowrap;">
            <span style="color:${color};font-weight:bold;">Vence ${cuando}</span><br>
            <span style="color:#666;font-size:13px;">${escapar(t.fechaTexto)}</span>
          </td>
        </tr>`;
    }).join("");

    return `<!doctype html>
<html lang="es"><body style="margin:0;padding:24px;background:#f4f6f8;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" style="max-width:620px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e0e0e0;">
    <tr>
      <td style="background:#0b0c10;padding:20px 24px;">
        <div style="color:#66fcf1;font-size:19px;font-weight:bold;">PAKAL Mission Control</div>
        <div style="color:#c5c6c7;font-size:13px;">Explore UP · CubeSat 3U</div>
      </td>
    </tr>
    <tr>
      <td style="padding:22px 24px 6px;">
        <p style="margin:0 0 6px;color:#111;font-size:15px;">Hola ${escapar(nombre)},</p>
        <p style="margin:0;color:#555;font-size:14px;">
          ${tareas.length === 1 ? "Tienes una tarea próxima a vencer:" : `Tienes ${tareas.length} tareas próximas a vencer:`}
        </p>
      </td>
    </tr>
    <tr><td style="padding:14px 10px 0;"><table role="presentation" width="100%">${filas}</table></td></tr>
    <tr>
      <td style="padding:22px 24px;">
        <a href="https://pakal-mission-control.vercel.app"
           style="display:inline-block;background:#45a29e;color:#0b0c10;padding:11px 20px;border-radius:5px;text-decoration:none;font-weight:bold;font-size:14px;">
          Abrir Mission Control
        </a>
      </td>
    </tr>
    <tr>
      <td style="padding:0 24px 22px;color:#999;font-size:12px;border-top:1px solid #eee;padding-top:14px;">
        Correo automático. Se envía 7, 3 y 1 día antes de cada fecha límite.
      </td>
    </tr>
  </table>
</body></html>`;
}

function escapar(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ============================================================
// Principal
// ============================================================
async function main() {
    const credenciales = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!credenciales) throw new Error("Falta el secret FIREBASE_SERVICE_ACCOUNT.");

    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(credenciales)) });
    const db = admin.firestore();
    const auth = admin.auth();

    // --- Correos desde Firebase Auth (Firestore no los guarda) ---
    const correos = new Map();
    let pagina = await auth.listUsers(1000);
    while (true) {
        pagina.users.forEach((u) => { if (u.email) correos.set(u.uid, u.email); });
        if (!pagina.pageToken) break;
        pagina = await auth.listUsers(1000, pagina.pageToken);
    }

    // --- Perfiles ---
    const usuarios = [];
    (await db.collection("usuarios").get()).forEach((doc) => {
        const correo = correos.get(doc.id);
        if (correo) usuarios.push({ uid: doc.id, correo, ...doc.data() });
    });

    // --- Tareas que vencen en 7, 3 o 1 días ---
    const hoy = ymd(new Date());
    const porVencer = [];
    (await db.collection("tareas").get()).forEach((doc) => {
        const t = doc.data();
        if (t.estado === "Completado" || !t.fechaFin) return;

        const fecha = t.fechaFin.toDate();
        const dias = diasEntre(hoy, ymd(fecha));
        if (!AVISOS.includes(dias)) return;

        porVencer.push({
            titulo: t.titulo,
            equipo: t.equipo,
            responsable: t.responsable || "Sin asignar",
            dias,
            fechaTexto: fechaLegible(fecha)
        });
    });

    console.log(`Hoy (${TZ}): ${hoy}`);
    console.log(`Usuarios con correo: ${usuarios.length}`);
    console.log(`Tareas que vencen en ${AVISOS.join(", ")} días: ${porVencer.length}`);

    if (!porVencer.length) {
        console.log("Nada que avisar hoy.");
        return;
    }

    // --- Un correo por persona, agrupando sus tareas ---
    let enviados = 0, fallidos = 0;
    for (const usuario of usuarios) {
        const suyas = porVencer.filter(
            (t) => usuario.equipo === "General" || t.equipo === usuario.equipo
        );
        if (!suyas.length) continue;

        suyas.sort((a, b) => a.dias - b.dias);
        const masUrgente = suyas[0].dias;
        const asunto = suyas.length === 1
            ? `⏰ "${suyas[0].titulo}" vence ${masUrgente === 1 ? "mañana" : `en ${masUrgente} días`}`
            : `⏰ ${suyas.length} tareas de PAKAL por vencer`;

        try {
            await enviarCorreo({
                para: usuario.correo,
                asunto,
                html: construirHtml(usuario.nombre || "equipo", suyas)
            });
            console.log(`  ✅ ${usuario.correo} (${suyas.length} tarea/s)`);
            enviados++;
        } catch (e) {
            // Un correo que rebota no debe tumbar el resto del envío.
            console.error(`  ❌ ${usuario.correo}: ${e.message}`);
            fallidos++;
        }
    }

    console.log(`\nEnviados: ${enviados} · Fallidos: ${fallidos}`);
    if (fallidos > 0) process.exitCode = 1;
}

// Solo corre si se ejecuta directamente; así las pruebas pueden
// importar las funciones de fecha sin disparar el envío de correos.
const ejecutadoDirecto = process.argv[1] && process.argv[1].endsWith("recordatorios.mjs");
if (ejecutadoDirecto) {
    main().catch((e) => {
        console.error("Error fatal:", e);
        process.exit(1);
    });
}
