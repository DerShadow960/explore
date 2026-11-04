#!/usr/bin/env node
/**
 * Revisa un documento local (similitud interna + citas + fuentes) y manda el reporte.
 *
 *   npm run revisar -- reporte.pdf [equipo] [campus] [--para correo@x.com] [--sin-firestore]
 *
 * El corpus de similitud vive en data/corpus.json: revisa dos documentos
 * parecidos seguidos y verás las coincidencias.
 */

import fs from "node:fs";
import path from "node:path";
import { config } from "../server/config.js";
import { ServicioCorreo } from "../server/services/correo/index.js";
import { crearRevisor } from "../server/services/documentos/revisor.js";
import { crearPipelineDocumentos } from "../server/services/documentos/pipeline.js";
import { tipoDe, extraerTexto } from "../server/services/drive/extractor.js";
import { EQUIPOS, CAMPUS } from "../public/js/dominio.js";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const para = flag("--para");
const sinFirestore = args.includes("--sin-firestore");
const [ruta, equipo = "Operaciones", campus = "Mixcoac"] = args.filter((a) => !a.startsWith("--"));

if (!ruta || !fs.existsSync(ruta)) {
    console.error("Uso: npm run revisar -- <archivo.pdf|.docx|.txt|.md> [equipo] [campus] [--para correo] [--sin-firestore]");
    process.exit(2);
}
if (!EQUIPOS.includes(equipo) || !CAMPUS.includes(campus)) {
    console.error(`Equipo debe ser uno de ${EQUIPOS.join(", ")} y campus uno de ${CAMPUS.join(", ")}.`);
    process.exit(2);
}

const nombre = path.basename(ruta);
const texto = await extraerTexto(fs.readFileSync(ruta), tipoDe({ name: nombre, mimeType: "" }));

let guardar = null, directorio = null;
if (!sinFirestore && (config.modoDemo || (config.produccion && config.firebase.cuentaDeServicio))) {
    const fb = await import("../server/firebase.js");
    const { crearDirectorio } = await import("../server/services/destinatarios.js");
    fb.iniciarFirebase(config);
    directorio = crearDirectorio({ db: fb.db, auth: fb.auth });
    guardar = async (doc) => (await fb.db().collection("revisiones").add({ ...doc, creado: fb.FieldValue.serverTimestamp() })).id;
}

const correo = new ServicioCorreo(config.correo, config.datos);
const revisar = crearPipelineDocumentos({ revisor: crearRevisor(config.ia), correo, directorio, guardar, config });

console.log(`Revisando ${nombre} como ${equipo}/${campus}…`);
let r;
try {
    r = await revisar({ archivo: { name: nombre, mimeType: "", id: null }, carpeta: { equipo, campus }, texto, extraDestinatarios: para ? [para] : [] });
} catch (e) {
    console.error(`\n✖ ${e.message}`);
    process.exit(1);
}

const { similitud: s, revision: v } = r.doc;
console.log(`\nIA: ${r.doc.proveedor}${r.doc.modelo ? " (" + r.doc.modelo + ")" : ""}${r.doc.conBusqueda ? " + búsqueda de Google" : ""}`);
console.log(`Similitud interna: ${s.porcentajeTotal}% (${s.nivel}) · ${s.palabras} palabras`);
s.coincidencias.forEach((c) => console.log(`  ${c.esVersionPropia ? "(versión propia) " : ""}${c.nombre}: ${c.porcentaje}%`));
if (s.yaRevisado) console.log(`  Este mismo texto ya se revisó como ${s.yaRevisado.nombre}`);
console.log(`Calidad: ${v.calidad ?? "—"}/10 · ${v.citas_faltantes.length} cita(s) por revisar · ${v.posibles_fuentes.length} posible(s) fuente(s)`);
console.log(`Resumen: ${v.resumen}`);
console.log(`\nCorreo: ${r.envio.enviados.length} enviado(s) ${r.envio.enviados.map((e) => `${e.to} vía ${e.via}`).join(", ")}`);
if (r.envio.encolados.length) console.log(`        ${r.envio.encolados.length} en cola.`);
process.exit(r.envio.enviados.length ? 0 : 1);
