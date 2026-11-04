/**
 * Extracción de texto según el tipo de archivo.
 * ============================================================
 * Convierte lo que se suba a Drive en texto plano analizable:
 * código fuente, Google Docs, PDF, Word y notebooks de Jupyter.
 */

/** Texto de un PDF con pdf.js (build "legacy", la recomendada para Node). */
export async function textoDePdf(buf) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const tarea = pdfjs.getDocument({
        data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0
    });
    const doc = await tarea.promise;
    try {
        const paginas = [];
        for (let i = 1; i <= Math.min(doc.numPages, 200); i++) {
            const pagina = await doc.getPage(i);
            const contenido = await pagina.getTextContent();
            // Reconstruye renglones: hasEOL marca fin de línea en pdf.js.
            paginas.push(contenido.items.map((it) => (it.str || "") + (it.hasEOL ? "\n" : "")).join(""));
        }
        return paginas.join("\n");
    } finally {
        await tarea.destroy();
    }
}

import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

export const MIME_GDOC = "application/vnd.google-apps.document";
export const MIME_CARPETA = "application/vnd.google-apps.folder";
const MIME_PDF = "application/pdf";
const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const MIME_PDF_DOCX = Object.freeze([MIME_PDF, MIME_DOCX]);

export const EXT_CODIGO = new Set([
    "py", "ipynb", "js", "mjs", "cjs", "ts", "tsx", "jsx", "c", "h", "cpp", "hpp", "cc", "ino", "java",
    "go", "rs", "m", "sh", "bash", "ps1", "html", "css", "sql", "yaml", "yml", "json", "grc", "vhd",
    "v", "kt", "cs", "php", "rb", "r", "txt", "md", "toml", "ini", "cfg", "conf", "xml", "lua", "pde"
]);

export function extension(nombre) {
    const m = /\.([a-z0-9]+)$/i.exec(nombre || "");
    return m ? m[1].toLowerCase() : "";
}

/** ¿Vale la pena descargar este archivo? */
export function esAnalizable({ name, mimeType }) {
    if (mimeType === MIME_CARPETA) return false;
    if (mimeType === MIME_GDOC || mimeType === MIME_PDF || mimeType === MIME_DOCX) return true;
    if (EXT_CODIGO.has(extension(name))) return true;
    return typeof mimeType === "string" && mimeType.startsWith("text/");
}

/** Tipo de extracción a usar. */
export function tipoDe({ name, mimeType }) {
    if (mimeType === MIME_GDOC) return "gdoc";
    if (mimeType === MIME_PDF || extension(name) === "pdf") return "pdf";
    if (mimeType === MIME_DOCX || extension(name) === "docx") return "docx";
    if (extension(name) === "ipynb") return "ipynb";
    return "texto";
}

function pareceBinario(buf) {
    const muestra = buf.subarray(0, Math.min(buf.length, 8000));
    let nulos = 0;
    for (const b of muestra) if (b === 0) nulos++;
    return nulos > 0;
}

export function textoDeNotebook(buf) {
    const nb = JSON.parse(buf.toString("utf8"));
    const celdas = Array.isArray(nb.cells) ? nb.cells : [];
    return celdas
        .filter((c) => c.cell_type === "code" || c.cell_type === "markdown")
        .map((c, i) => {
            const src = Array.isArray(c.source) ? c.source.join("") : String(c.source || "");
            return c.cell_type === "code"
                ? `# %% [celda ${i + 1}]\n${src}`
                : `# %% [markdown ${i + 1}]\n${src.split("\n").map((l) => "# " + l).join("\n")}`;
        })
        .join("\n\n");
}

/**
 * @param {Buffer} buf
 * @param {"texto"|"pdf"|"docx"|"ipynb"|"gdoc"} tipo
 */
export async function extraerTextoDirecto(buf, tipo) {
    switch (tipo) {
        case "pdf":
            return textoDePdf(buf);
        case "docx": {
            const mammoth = await import("mammoth");
            return (await mammoth.default.extractRawText({ buffer: buf })).value;
        }
        case "ipynb":
            return textoDeNotebook(buf);
        case "gdoc":
        case "texto":
        default:
            if (pareceBinario(buf)) throw new Error("El archivo parece binario, no texto.");
            return buf.toString("utf8").replace(/^﻿/, "");
    }
}

/**
 * ¿El texto contiene código? Para documentos (Docs/PDF/Word) que pueden
 * ser solo prosa: si no hay código, no se analiza ni se manda correo.
 */
export function pareceCodigo(texto) {
    const lineas = String(texto || "").split(/\r?\n/);
    const patrones = [
        /^\s*(def|class|import|from\s+\S+\s+import|return|if\s.*:|for\s.*:|while\s.*:|elif|else:|try:|except)/,
        /^\s*#include\s*[<"]/, /;\s*(\/\/.*)?$/, /\{\s*$/, /^\s*\}/, /^\s*(const|let|var|function|public|private|void|int|float|double|bool|char)\s/,
        /\w+\s*\([^)]*\)\s*[;{:]?\s*$/, /^\s*(\/\/|#)\s*\S/
    ];
    let cuenta = 0;
    for (const l of lineas) {
        if (patrones.some((p) => p.test(l)) && ++cuenta >= 4) return true;
    }
    return false;
}

// ------------------------------------------------------------
// Extracción protegida.
// PDF y Word son formatos comprimidos: un archivo de 2 MB puede expandirse a
// gigas ("bomba de descompresión") o tardar minutos en procesarse. Dos capas:
//   1. Word: antes de abrirlo se lee el índice del ZIP (sin descomprimir) y se
//      rechaza si declara más de MAX_DESCOMPRIMIDO o demasiadas entradas.
//   2. PDF y Word se procesan en un PROCESO aparte con tope de memoria y de
//      tiempo: si el archivo es malicioso, muere ese proceso y el servidor sigue.
// ------------------------------------------------------------
export const MAX_TEXTO = 1_000_000;            // caracteres que se conservan del texto extraído
const MAX_DESCOMPRIMIDO = 60 * 1024 * 1024;    // 60 MB descomprimidos en total
const MAX_ENTRADAS = 2000;
const TIEMPO_MAX_MS = 20_000;
const MEMORIA_MAX_MB = 256;

/** Lee el directorio central del ZIP y suma los tamaños declarados. No descomprime nada. */
export function revisarZip(buf) {
    const fin = Math.max(0, buf.length - 22 - 65535);
    let eocd = -1;
    for (let i = buf.length - 22; i >= fin; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("El archivo Word está dañado.");
    const entradas = buf.readUInt16LE(eocd + 10);
    const tamCd = buf.readUInt32LE(eocd + 12);
    const inicioCd = buf.readUInt32LE(eocd + 16);
    // ZIP64 (valores 0xFFFF/0xFFFFFFFF) no tiene sentido en un .docx de 2 MB: se rechaza.
    if (entradas === 0xffff || tamCd === 0xffffffff || inicioCd === 0xffffffff) {
        throw new Error("El archivo es demasiado complejo para procesarlo (posible archivo malicioso).");
    }
    if (entradas > MAX_ENTRADAS) throw new Error("El archivo tiene demasiadas partes internas.");
    let pos = inicioCd, total = 0;
    for (let n = 0; n < entradas; n++) {
        if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) throw new Error("El archivo Word está dañado.");
        const descomprimido = buf.readUInt32LE(pos + 24);
        if (descomprimido === 0xffffffff) throw new Error("El archivo es demasiado complejo para procesarlo (posible archivo malicioso).");
        total += descomprimido;
        if (total > MAX_DESCOMPRIMIDO) throw new Error("El archivo es demasiado complejo para procesarlo (posible archivo malicioso).");
        pos += 46 + buf.readUInt16LE(pos + 28) + buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32);
    }
    return { entradas, total };
}

function enProcesoAislado(buf, tipo) {
    return new Promise((ok, mal) => {
        const hijo = fork(fileURLToPath(new URL("./extractor-trabajador.js", import.meta.url)), [], {
            execArgv: [`--max-old-space-size=${MEMORIA_MAX_MB}`],
            serialization: "advanced",
            stdio: ["ignore", "ignore", "ignore", "ipc"]
        });
        let listo = false;
        const terminar = (fn, valor) => { if (listo) return; listo = true; clearTimeout(reloj); hijo.kill("SIGKILL"); fn(valor); };
        const reloj = setTimeout(() => terminar(mal, new Error("El archivo tardó demasiado en procesarse.")), TIEMPO_MAX_MS);
        hijo.once("message", (m) => terminar(m.ok ? ok : mal, m.ok ? m.texto : new Error(m.error)));
        hijo.once("error", () => terminar(mal, new Error("No se pudo leer el archivo.")));
        hijo.once("exit", () => terminar(mal, new Error("El archivo es demasiado complejo para procesarlo (posible archivo malicioso).")));
        hijo.send({ buf, tipo });
    });
}

/**
 * Extrae el texto de un archivo. PDF y Word van a un proceso aislado; el
 * resultado se recorta a MAX_TEXTO caracteres.
 */
export async function extraerTexto(buf, tipo) {
    if (tipo === "docx") revisarZip(buf);
    const texto = (tipo === "pdf" || tipo === "docx") ? await enProcesoAislado(buf, tipo) : await extraerTextoDirecto(buf, tipo);
    return texto.length > MAX_TEXTO ? texto.slice(0, MAX_TEXTO) : texto;
}
