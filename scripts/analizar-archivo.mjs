#!/usr/bin/env node
/**
 * Analiza un archivo local y manda el reporte por correo, sin Drive.
 * Ideal para demostrar el pipeline en vivo.
 *
 *   npm run analizar -- ruta/al/archivo.py [equipo] [campus] [--para correo@x.com] [--sin-firestore]
 *
 * Ej.: npm run analizar -- ejemplos/rotor.ino Control Mixcoac --para rafa@up.edu.mx
 */

import fs from "node:fs";
import path from "node:path";
import { config } from "../server/config.js";
import { ServicioCorreo } from "../server/services/correo/index.js";
import { crearAnalizador } from "../server/services/ia/index.js";
import { crearPipelineAnalisis } from "../server/services/analisis.js";
import { tipoDe, extraerTexto } from "../server/services/drive/extractor.js";
import { EQUIPOS, CAMPUS } from "../public/js/dominio.js";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const para = flag("--para");
const sinFirestore = args.includes("--sin-firestore");
const posicionales = args.filter((a) => !a.startsWith("--"));
const [ruta, equipo = "Control", campus = "Mixcoac"] = posicionales;

if (!ruta || !fs.existsSync(ruta)) {
    console.error("Uso: npm run analizar -- <archivo> [equipo] [campus] [--para correo] [--sin-firestore]");
    process.exit(2);
}
if (!EQUIPOS.includes(equipo) || !CAMPUS.includes(campus)) {
    console.error(`Equipo debe ser uno de ${EQUIPOS.join(", ")} y campus uno de ${CAMPUS.join(", ")}.`);
    process.exit(2);
}

const nombre = path.basename(ruta);
const texto = await extraerTexto(fs.readFileSync(ruta), tipoDe({ name: nombre, mimeType: "" }));

let guardar = null, directorio = null;
// Solo toca Firebase en demo (emuladores) o si pediste producción a propósito.
const hayFirebase = !sinFirestore && (config.modoDemo || (config.produccion && config.firebase.cuentaDeServicio));
if (hayFirebase) {
    const fb = await import("../server/firebase.js");
    const { crearDirectorio } = await import("../server/services/destinatarios.js");
    fb.iniciarFirebase(config);
    directorio = crearDirectorio({ db: fb.db, auth: fb.auth });
    guardar = async (doc) => (await fb.db().collection("analisis").add({ ...doc, creado: fb.FieldValue.serverTimestamp() })).id;
}

const correo = new ServicioCorreo(config.correo, config.datos);
const pipeline = crearPipelineAnalisis({ analizador: crearAnalizador(config.ia), correo, directorio, guardar, config });

console.log(`Analizando ${nombre} (${texto.length} caracteres) como ${equipo}/${campus}…`);
let r;
try {
    r = await pipeline({
        archivo: { name: nombre, mimeType: "", id: null },
        carpeta: { equipo, campus },
        texto,
        extraDestinatarios: para ? [para] : []
    });
} catch (e) {
    console.error(`\n✖ ${e.message}\n  Revisa que exista .env (no .env.example) y tenga ANALISIS_DESTINATARIOS, o usa --para tu@correo.com`);
    process.exit(1);
}

const res = r.doc.resultado;
console.log(`\nProveedor: ${r.doc.proveedor}${r.doc.modelo ? " (" + r.doc.modelo + ")" : ""}`);
console.log(`Calificación: ${res.calificacion ?? "—"}/10`);
console.log(`Resumen: ${res.resumen}`);
res.hallazgos.forEach((h) => console.log(`  [${h.severidad}] ${h.descripcion}`));
console.log(`\nCorreo: ${r.envio.enviados.length} enviado(s) ${r.envio.enviados.map((e) => `${e.to} vía ${e.via}`).join(", ")}`);
if (r.envio.encolados.length) console.log(`        ${r.envio.encolados.length} en cola (se reintenta con el servidor encendido o con npm run correo:probar).`);
process.exit(r.envio.enviados.length ? 0 : 1);
