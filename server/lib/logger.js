/**
 * Logger mínimo con niveles y contexto. Nunca imprime secretos:
 * cualquier clave que parezca credencial se enmascara.
 */

const NIVELES = { debug: 10, info: 20, warn: 30, error: 40 };
const minimo = NIVELES[(process.env.LOG_LEVEL || "info").toLowerCase()] ?? NIVELES.info;
const SENSIBLE = /(pass|secret|token|key|authorization|credential|private)/i;

function limpiar(valor, profundidad = 0) {
    if (valor instanceof Error) return { error: valor.message, ...(valor.code ? { code: valor.code } : {}) };
    if (!valor || typeof valor !== "object" || profundidad > 3) return valor;
    if (Array.isArray(valor)) return valor.map((v) => limpiar(v, profundidad + 1));
    const out = {};
    for (const [k, v] of Object.entries(valor)) {
        out[k] = SENSIBLE.test(k) ? "***" : limpiar(v, profundidad + 1);
    }
    return out;
}

// Los mensajes pueden traer texto de usuarios (nombres de archivo): sin saltos
// de línea ni caracteres de control, nadie puede inventar líneas falsas en el log.
const sinControl = (s) => String(s).replace(/[\u0000-\u001f\u007f]/g, " ");

function escribir(nivel, modulo, mensaje, extra) {
    if (NIVELES[nivel] < minimo) return;
    mensaje = sinControl(mensaje);
    const hora = new Date().toLocaleTimeString("es-MX", { hour12: false, timeZone: "America/Mexico_City" });
    const etiqueta = { debug: "·", info: "ℹ", warn: "⚠", error: "✖" }[nivel];
    const linea = `${hora} ${etiqueta} [${modulo}] ${mensaje}`;
    const datos = extra === undefined ? "" : " " + JSON.stringify(limpiar(extra));
    (nivel === "error" ? console.error : nivel === "warn" ? console.warn : console.log)(linea + datos);
}

export function crearLogger(modulo) {
    return {
        debug: (m, e) => escribir("debug", modulo, m, e),
        info: (m, e) => escribir("info", modulo, m, e),
        warn: (m, e) => escribir("warn", modulo, m, e),
        error: (m, e) => escribir("error", modulo, m, e)
    };
}
