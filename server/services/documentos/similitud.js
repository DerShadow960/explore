/**
 * Similitud entre documentos por "huellas" de fragmentos (shingles).
 * ============================================================
 * Cada documento se parte en ventanas de K palabras seguidas; cada ventana
 * se convierte en un número (hash). Dos documentos que comparten muchas
 * ventanas comparten texto literal. Con K = 7 las frases comunes ("de
 * acuerdo con los resultados") casi nunca coinciden por casualidad, pero
 * un párrafo copiado coincide entero aunque le cambien mayúsculas,
 * acentos o puntuación.
 *
 * Lo que NO detecta: paráfrasis (mismas ideas con otras palabras) ni
 * traducciones. Eso es a propósito: aquí solo se reporta texto repetido,
 * que es verificable por cualquiera.
 *
 * Todo es puro (sin disco ni red): fácil de probar.
 */

export const K = 7;

/** FNV-1a de 32 bits: rápido, suficiente para huellas (no es criptográfico). */
function fnv1a(texto) {
    let h = 0x811c9dc5;
    for (let i = 0; i < texto.length; i++) {
        h ^= texto.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

const normalizar = (palabra) => palabra.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Palabras con su posición en el texto ORIGINAL, para poder citar el
 * pasaje tal cual (con acentos y mayúsculas) en el reporte.
 */
export function tokenizar(texto) {
    const tokens = [];
    for (const m of String(texto || "").matchAll(/[\p{L}\p{N}]+/gu)) {
        tokens.push({ w: normalizar(m[0]), ini: m.index, fin: m.index + m[0].length });
    }
    return tokens;
}

/** Hash de cada ventana de K palabras, en orden. */
export function huellas(tokens, k = K) {
    const out = [];
    for (let i = 0; i + k <= tokens.length; i++) {
        let ventana = tokens[i].w;
        for (let j = 1; j < k; j++) ventana += " " + tokens[i + j].w;
        out.push(fnv1a(ventana));
    }
    return out;
}

/** Conjunto único de huellas: lo que se guarda en el corpus. */
export function firmaDe(texto, k = K) {
    const tokens = tokenizar(texto);
    return { palabras: tokens.length, hashes: [...new Set(huellas(tokens, k))] };
}

/** Une posiciones marcadas consecutivas en tramos [ini, fin]. */
function tramos(marcadas) {
    const out = [];
    let ini = -1;
    for (let i = 0; i <= marcadas.length; i++) {
        if (i < marcadas.length && marcadas[i]) { if (ini < 0) ini = i; }
        else if (ini >= 0) { out.push([ini, i - 1]); ini = -1; }
    }
    return out;
}

function recortarPasaje(texto, tokens, [a, b], max = 320) {
    const s = texto.slice(tokens[a].ini, tokens[b].fin).replace(/\s+/g, " ").trim();
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export function nivelDe(porcentaje) {
    if (porcentaje >= 40) return "alta";
    if (porcentaje >= 15) return "media";
    if (porcentaje > 0) return "baja";
    return "ninguna";
}

/**
 * Compara un documento contra el corpus.
 *
 * @param {string} texto                 texto del documento nuevo
 * @param {Array}  corpus                [{id, nombre, equipo, campus, fecha, hashes:number[], esVersionPropia?:bool}]
 * @param {object} [opciones]
 * @param {number} [opciones.maxPasajes=5]
 * @returns {{
 *   palabras: number,
 *   porcentajeTotal: number,           // % del documento que aparece en ALGÚN otro (sin contar versiones propias)
 *   nivel: "alta"|"media"|"baja"|"ninguna",
 *   coincidencias: Array<{id, nombre, equipo, campus, fecha, porcentaje, esVersionPropia, pasajes: string[]}>
 * }}
 */
export function comparar(texto, corpus, { maxPasajes = 5, k = K } = {}) {
    const tokens = tokenizar(texto);
    const hs = huellas(tokens, k);
    const total = tokens.length;
    if (!total || !hs.length) return { palabras: total, porcentajeTotal: 0, nivel: "ninguna", coincidencias: [] };

    const union = new Uint8Array(total);
    const coincidencias = [];

    for (const doc of corpus) {
        const conjunto = doc._set || (doc._set = new Set(doc.hashes));
        const marcadas = new Uint8Array(total);
        let alguna = false;
        for (let i = 0; i < hs.length; i++) {
            if (conjunto.has(hs[i])) {
                alguna = true;
                for (let j = i; j < i + k; j++) marcadas[j] = 1;
            }
        }
        if (!alguna) continue;

        let cubiertas = 0;
        for (let i = 0; i < total; i++) {
            if (marcadas[i]) {
                cubiertas++;
                if (!doc.esVersionPropia) union[i] = 1;
            }
        }
        const pasajes = tramos(marcadas)
            .sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]))
            .slice(0, maxPasajes)
            .map((t) => recortarPasaje(texto, tokens, t));

        coincidencias.push({
            id: doc.id, nombre: doc.nombre, equipo: doc.equipo, campus: doc.campus, fecha: doc.fecha,
            esVersionPropia: !!doc.esVersionPropia,
            porcentaje: Math.round((cubiertas / total) * 1000) / 10,
            pasajes
        });
    }

    coincidencias.sort((a, b) => (a.esVersionPropia - b.esVersionPropia) || (b.porcentaje - a.porcentaje));
    const porcentajeTotal = Math.round((union.reduce((s, v) => s + v, 0) / total) * 1000) / 10;
    return { palabras: total, porcentajeTotal, nivel: nivelDe(porcentajeTotal), coincidencias: coincidencias.slice(0, 10) };
}
