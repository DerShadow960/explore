/**
 * Configuración — lee .env, valida y congela.
 * ============================================================
 * Todo lo que el servidor necesita del entorno pasa por aquí. Ningún
 * otro módulo lee process.env directamente: así hay un solo lugar donde
 * ver qué variables existen y qué valores admiten.
 *
 * Si algo obligatorio falta, el servidor NO arranca y dice qué falta.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Node 22 trae cargador de .env; no hace falta dotenv.
const archivoEnv = process.env.PAKAL_ENV_FILE || path.join(RAIZ, ".env");
if (fs.existsSync(archivoEnv)) {
    try { process.loadEnvFile(archivoEnv); }
    catch (e) { console.error(`No se pudo leer ${archivoEnv}: ${e.message}`); }
} else if (!process.env.PAKAL_ENV_FILE) {
    console.warn(`⚠ No existe ${archivoEnv}: se usan valores por defecto. Corre: cp .env.example .env y llénalo.`);
}

const env = process.env;

function texto(nombre, porDefecto = "") {
    const v = env[nombre];
    return v === undefined || v === "" ? porDefecto : String(v).trim();
}
function entero(nombre, porDefecto) {
    const v = texto(nombre);
    if (!v) return porDefecto;
    const n = Number.parseInt(v, 10);
    if (!Number.isFinite(n)) throw new Error(`${nombre} debe ser un número (vale "${v}").`);
    return n;
}
function booleano(nombre, porDefecto = false) {
    const v = texto(nombre).toLowerCase();
    if (!v) return porDefecto;
    return ["1", "true", "si", "sí", "yes", "on"].includes(v);
}
function lista(nombre) {
    return texto(nombre).split(",").map((s) => s.trim()).filter(Boolean);
}

/** Lee la cuenta de servicio desde ruta (preferido) o JSON en línea. */
function cuentaDeServicio() {
    const ruta = texto("FIREBASE_SERVICE_ACCOUNT_PATH");
    if (ruta) {
        const abs = path.isAbsolute(ruta) ? ruta : path.join(RAIZ, ruta);
        if (!fs.existsSync(abs)) throw new Error(`FIREBASE_SERVICE_ACCOUNT_PATH apunta a ${abs}, que no existe.`);
        return JSON.parse(fs.readFileSync(abs, "utf8"));
    }
    const enLinea = texto("FIREBASE_SERVICE_ACCOUNT");
    if (enLinea) return JSON.parse(enLinea);
    return null;
}

/**
 * Carpetas de Drive a vigilar. Formato:
 *   DRIVE_CARPETAS=Mixcoac:Telecomunicaciones:<folderId>,Mixcoac:Control:<folderId>
 */
function carpetasDrive() {
    return lista("DRIVE_CARPETAS").map((entrada) => {
        const [campus, equipo, id] = entrada.split(":").map((s) => s.trim());
        if (!campus || !equipo || !id) {
            throw new Error(`DRIVE_CARPETAS: "${entrada}" no tiene el formato campus:equipo:folderId`);
        }
        return Object.freeze({ campus, equipo, id });
    });
}

function construir() {
    const modoDemo = booleano("PAKAL_DEMO");
    // En demo Firebase usa emuladores (sin credencial), pero si hay cuenta de
    // servicio se sigue usando para leer Drive: así la demo muestra el flujo real.
    let cuentaArchivo = null;
    try { cuentaArchivo = cuentaDeServicio(); }
    catch (e) { if (booleano("PAKAL_PRODUCCION")) throw e; }
    const cuenta = modoDemo ? null : cuentaArchivo;
    // En demo SIEMPRE "demo-pakal": el prefijo demo- hace que Firebase rechace cualquier
    // intento de hablar con servicios reales, aunque el .env traiga la config de producción.
    const projectId = modoDemo ? "demo-pakal" : texto("FIREBASE_PROJECT_ID", cuenta?.project_id || "");

    return {
        entorno: texto("NODE_ENV", "development"),
        modoDemo,
        produccion: booleano("PAKAL_PRODUCCION"),
        servidor: {
            host: texto("HOST", "127.0.0.1"),
            puerto: entero("PORT", 8080),
            // Detrás de un proxy (nginx/cloudflared) para que req.ip sea la real.
            confiarProxy: booleano("TRUST_PROXY", false),
            urlPublica: texto("PUBLIC_URL", `http://localhost:${entero("PORT", 8080)}`)
        },
        firebase: {
            projectId,
            cuentaDeServicio: cuenta,
            emuladores: modoDemo ? {
                firestore: texto("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8085"),
                auth: texto("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099")
            } : null,
            // Configuración web: es PÚBLICA por diseño (identifica el proyecto,
            // no da acceso). Lo que protege los datos son las reglas.
            web: modoDemo ? {
                apiKey: "demo-api-key",
                authDomain: "demo-pakal.firebaseapp.com",
                projectId,
                storageBucket: "",
                messagingSenderId: "",
                appId: "demo-pakal"
            } : {
                apiKey: texto("FIREBASE_WEB_API_KEY"),
                authDomain: texto("FIREBASE_WEB_AUTH_DOMAIN", projectId ? `${projectId}.firebaseapp.com` : ""),
                projectId,
                storageBucket: texto("FIREBASE_WEB_STORAGE_BUCKET"),
                messagingSenderId: texto("FIREBASE_WEB_SENDER_ID"),
                appId: texto("FIREBASE_WEB_APP_ID")
            }
        },
        drive: {
            activo: booleano("DRIVE_WATCH", false) && (!modoDemo || !!cuentaArchivo || !!texto("DRIVE_SERVICE_ACCOUNT_PATH")),
            carpetas: carpetasDrive(),
            intervaloSeg: Math.max(30, entero("DRIVE_INTERVALO_SEG", 120)),
            // Credencial de Google Drive: por defecto la misma cuenta de servicio.
            // Las carpetas se COMPARTEN con el correo de la cuenta de servicio.
            cuentaDeServicio: (() => {
                const ruta = texto("DRIVE_SERVICE_ACCOUNT_PATH");
                if (!ruta) return cuentaArchivo;
                const abs = path.isAbsolute(ruta) ? ruta : path.join(RAIZ, ruta);
                return JSON.parse(fs.readFileSync(abs, "utf8"));
            })(),
            maxBytes: entero("DRIVE_MAX_BYTES", 2 * 1024 * 1024),
            // En el primer arranque, ¿analizar lo que ya existía? Por defecto no:
            // solo lo que se suba de aquí en adelante.
            analizarExistentes: booleano("DRIVE_ANALIZAR_EXISTENTES", false),
            // Documentos de prosa (sin código) → revisión de documentos en vez de ignorarlos.
            revisarDocumentos: booleano("DRIVE_REVISAR_DOCUMENTOS", true)
        },
        ia: {
            // Orden de proveedores; el primero que responda gana.
            // Por defecto solo nube (Gemini) + respaldo estático. Ollama (GPU local) solo si lo pides.
            orden: lista("IA_PROVEEDORES").length ? lista("IA_PROVEEDORES") : ["gemini", "heuristico"],
            gemini: {
                apiKey: texto("GEMINI_API_KEY"),
                // Si el primero da 429 (cuota) o 5xx, se intenta el siguiente.
                modelos: lista("GEMINI_MODELOS").length ? lista("GEMINI_MODELOS") : ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-flash-latest"],
                url: texto("GEMINI_URL", "https://generativelanguage.googleapis.com/v1beta")
            },
            anthropic: {
                apiKey: texto("ANTHROPIC_API_KEY"),
                modelo: texto("ANTHROPIC_MODEL", "claude-sonnet-5-5"),
                url: texto("ANTHROPIC_URL", "https://api.anthropic.com/v1/messages")
            },
            ollama: {
                url: texto("OLLAMA_URL", "http://127.0.0.1:11434"),
                modelo: texto("OLLAMA_MODEL", "qwen2.5-coder:7b")
            },
            timeoutMs: entero("IA_TIMEOUT_MS", 120000),
            maxCaracteres: entero("IA_MAX_CARACTERES", 60000)
        },
        correo: {
            from: texto("MAIL_FROM", "PAKAL Mission Control <no-reply@localhost>"),
            // Orden de transportes. Si uno falla se intenta el siguiente.
            orden: lista("MAIL_TRANSPORTES").length ? lista("MAIL_TRANSPORTES") : ["gmail", "resend", "smtp"],
            gmail: { usuario: texto("GMAIL_USER"), appPassword: texto("GMAIL_APP_PASSWORD").replace(/\s+/g, "") },
            resend: { apiKey: texto("RESEND_API_KEY") },
            smtp: {
                host: texto("SMTP_HOST"),
                puerto: entero("SMTP_PORT", 587),
                usuario: texto("SMTP_USER"),
                password: texto("SMTP_PASS"),
                seguro: booleano("SMTP_SECURE", entero("SMTP_PORT", 587) === 465),
                // Solo para pruebas locales con un SMTP de mentira.
                ignorarTls: booleano("SMTP_IGNORE_TLS", false)
            },
            reintentoSeg: Math.max(30, entero("MAIL_REINTENTO_SEG", 300)),
            maxIntentos: Math.max(1, entero("MAIL_MAX_INTENTOS", 50)),
            dryRun: booleano("MAIL_DRY_RUN", false)
        },
        analisis: {
            // Siempre reciben el análisis, además del equipo dueño de la carpeta.
            destinatariosFijos: lista("ANALISIS_DESTINATARIOS"),
            // En demo los usuarios son de prueba (coordinacion@up.edu.mx…) y podrían
            // existir de verdad: solo se manda a ANALISIS_DESTINATARIOS.
            notificarEquipo: !modoDemo && booleano("ANALISIS_NOTIFICAR_EQUIPO", true),
            // Quien subió el archivo recibe su propio reporte.
            notificarAutor: !modoDemo && booleano("ANALISIS_NOTIFICAR_AUTOR", true)
        },
        recordatorios: {
            // En demo irían a los usuarios de prueba: apagados.
            activo: !modoDemo && booleano("RECORDATORIOS", true),
            hora: entero("RECORDATORIOS_HORA", 8),              // hora local CDMX
            avisos: lista("RECORDATORIOS_DIAS").map(Number).filter((n) => n > 0).length
                ? lista("RECORDATORIOS_DIAS").map(Number).filter((n) => n > 0)
                : [7, 3, 1]
        },
        // Plazos de borrado (minimización): bitácora con IP y copias locales de reportes.
        retencion: {
            bitacoraDias: Math.max(1, entero("RETENCION_BITACORA_DIAS", 90)),
            copiasLocalesDias: Math.max(1, entero("RETENCION_COPIAS_DIAS", 365))
        },
        bloqueo: {
            intentosMax: entero("BLOQUEO_INTENTOS", 3),
            ventanaMs: entero("BLOQUEO_VENTANA_MIN", 10) * 60000,
            duracionMs: entero("BLOQUEO_DURACION_MIN", 5) * 60000
        },
        datos: path.resolve(RAIZ, texto("PAKAL_DATA_DIR", "data")),
        zonaHoraria: "America/Mexico_City"
    };
}

function congelar(obj) {
    Object.values(obj).forEach((v) => { if (v && typeof v === "object" && !Object.isFrozen(v)) congelar(v); });
    return Object.freeze(obj);
}

/** Errores de configuración que impiden arrancar. */
export function validar(c) {
    const errores = [];
    const avisos = [];
    if (!c.modoDemo && !c.produccion) {
        errores.push("Sin PAKAL_DEMO=true el servidor se conectaría al Firebase REAL. Usa `npm run demo`, " +
            "o pon PAKAL_PRODUCCION=true en .env si de verdad quieres producción.");
    }
    if (c.ia.orden.includes("gemini") && !c.ia.gemini.apiKey) {
        avisos.push("IA: falta GEMINI_API_KEY (https://aistudio.google.com/apikey). Mientras, se usa el análisis estático.");
    }
    if (!c.modoDemo) {
        if (!c.firebase.cuentaDeServicio) errores.push("Falta FIREBASE_SERVICE_ACCOUNT_PATH (o PAKAL_DEMO=true para usar emuladores).");
        if (!c.firebase.web.apiKey) errores.push("Falta FIREBASE_WEB_API_KEY (está en Firebase → Configuración del proyecto → Tus apps).");
        if (!c.firebase.web.appId) avisos.push("Falta FIREBASE_WEB_APP_ID; el login puede fallar.");
    }
    if (c.drive.activo) {
        if (!c.drive.carpetas.length) errores.push("DRIVE_WATCH=true pero DRIVE_CARPETAS está vacío.");
        if (!c.drive.cuentaDeServicio) errores.push("DRIVE_WATCH=true pero no hay cuenta de servicio para Drive.");
    }
    const hayTransporte = c.correo.dryRun
        || (c.correo.gmail.usuario && c.correo.gmail.appPassword)
        || c.correo.resend.apiKey
        || c.correo.smtp.host;
    if (!hayTransporte) avisos.push("No hay ningún transporte de correo configurado: los correos se quedarán en la cola local (data/outbox) hasta que configures uno.");
    if (!c.analisis.destinatariosFijos.length && !c.analisis.notificarEquipo) {
        errores.push(c.modoDemo
            ? "Falta ANALISIS_DESTINATARIOS en .env: pon tu correo pa' recibir los reportes."
            : "Los análisis no tendrían destinatario: define ANALISIS_DESTINATARIOS o ANALISIS_NOTIFICAR_EQUIPO=true.");
    }
    if (c.servidor.host !== "127.0.0.1" && c.servidor.host !== "localhost") {
        avisos.push(`El servidor escucha en ${c.servidor.host}: será accesible desde tu red local.`);
    }
    return { errores, avisos };
}

export const config = congelar(construir());
export default config;
