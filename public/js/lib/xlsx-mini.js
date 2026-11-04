/**
 * Generador mínimo de .xlsx en el navegador (sin dependencias).
 * ============================================================
 * Reemplaza a SheetJS 0.18.5, que tiene vulnerabilidades altas sin parche en
 * npm. Aquí solo se ESCRIBE un libro con una hoja: no se lee ningún archivo,
 * así que no hay superficie de parsing.
 *
 * Formato: un ZIP sin compresión (método STORE) con el mínimo de partes de
 * SpreadsheetML. Fechas como fecha real de Excel; texto como inlineStr.
 */

// ---------- ZIP (STORE) ----------
const TABLA_CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function zip(archivos) {
    const enc = new TextEncoder();
    const partes = [];
    const central = [];
    let offset = 0;
    for (const { nombre, contenido } of archivos) {
        const n = enc.encode(nombre);
        const datos = enc.encode(contenido);
        const crc = crc32(datos);
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
        local.setUint16(8, 0, true); local.setUint32(14, crc, true);
        local.setUint32(18, datos.length, true); local.setUint32(22, datos.length, true); local.setUint16(26, n.length, true);
        partes.push(new Uint8Array(local.buffer), n, datos);

        const cd = new DataView(new ArrayBuffer(46));
        cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
        cd.setUint32(16, crc, true); cd.setUint32(20, datos.length, true); cd.setUint32(24, datos.length, true);
        cd.setUint16(28, n.length, true); cd.setUint32(42, offset, true);
        central.push(new Uint8Array(cd.buffer), n);
        offset += 30 + n.length + datos.length;
    }
    const tamCentral = central.reduce((s, p) => s + p.length, 0);
    const fin = new DataView(new ArrayBuffer(22));
    fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
    fin.setUint32(12, tamCentral, true); fin.setUint32(16, offset, true);
    return new Blob([...partes, ...central, new Uint8Array(fin.buffer)],
        { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// ---------- SpreadsheetML ----------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function columna(i) {
    let s = "";
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
}

/** Fecha JS → número de serie de Excel (días desde 1899-12-30, en hora local). */
const serieExcel = (d) => (d.getTime() - d.getTimezoneOffset() * 60000) / 86400000 + 25569;

/** Neutraliza texto que Excel interpretaría como fórmula (inyección CSV/fórmulas). */
const seguro = (v) => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? "'" + v : v);

function celda(ref, v, estilo) {
    if (v === null || v === undefined || v === "") return "";
    if (v instanceof Date && !Number.isNaN(v.getTime())) return `<c r="${ref}" s="2"><v>${serieExcel(v)}</v></c>`;
    if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${estilo ? ` s="${estilo}"` : ""}><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${estilo ? ` s="${estilo}"` : ""}><is><t xml:space="preserve">${esc(seguro(String(v)))}</t></is></c>`;
}

/**
 * Descarga un .xlsx con una hoja.
 * @param {object} o
 * @param {string} o.archivo   nombre del archivo (sin extensión)
 * @param {string} o.hoja      nombre de la hoja
 * @param {object[]} o.filas   arreglo de objetos; las llaves del primero son los encabezados
 * @param {number[]} [o.anchos] ancho de cada columna en caracteres
 */
export function descargarXlsx({ archivo, hoja, filas, anchos = [] }) {
    const encabezados = filas.length ? Object.keys(filas[0]) : [];
    const xmlFilas = [
        `<row r="1">${encabezados.map((h, i) => celda(columna(i) + 1, h, 1)).join("")}</row>`,
        ...filas.map((f, r) => `<row r="${r + 2}">${encabezados.map((h, i) => celda(columna(i) + (r + 2), f[h])).join("")}</row>`)
    ].join("");
    const cols = anchos.length
        ? `<cols>${anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Number(w) || 10}" customWidth="1"/>`).join("")}</cols>`
        : "";
    const nombreHoja = esc(String(hoja).replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Hoja1");

    const blob = zip([
        { nombre: "[Content_Types].xml", contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
        { nombre: "_rels/.rels", contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
        { nombre: "xl/workbook.xml", contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${nombreHoja}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
        { nombre: "xl/_rels/workbook.xml.rels", contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
        { nombre: "xl/styles.xml", contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf xfId="0"/><xf fontId="1" applyFont="1" xfId="0"/><xf numFmtId="164" applyNumberFormat="1" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
        { nombre: "xl/worksheets/sheet1.xml", contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${xmlFilas}</sheetData></worksheet>` }
    ]);

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${String(archivo).replace(/[\\/:*?"<>|]/g, "_")}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Exportado para pruebas.
export const _interno = { crc32, zip, celda, columna, serieExcel };
