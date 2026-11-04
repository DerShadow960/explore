import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { comparar, firmaDe, tokenizar, nivelDe } from "../../server/services/documentos/similitud.js";
import { Corpus } from "../../server/services/documentos/corpus.js";
import { normalizarRevision, revisionHeuristica, crearRevisor } from "../../server/services/documentos/revisor.js";
import { crearPipelineDocumentos } from "../../server/services/documentos/pipeline.js";
import { ServicioCorreo } from "../../server/services/correo/index.js";
import { correoRevision } from "../../server/services/plantillas.js";

const A = "La antena QFH se eligió para recibir los satélites METEOR en la banda de 137 MHz porque ofrece polarización circular y un patrón casi hemisférico que permite recibir pasadas completas sin rotor alguno.";
const RELLENO = "Este párrafo es completamente distinto y habla de la logística del hackathon, de los horarios de las comidas y de cómo se van a repartir los equipos entre los salones disponibles del edificio.";
const doc = (id, texto, extra = {}) => ({ id, nombre: `${id}.docx`, equipo: "Telecomunicaciones", campus: "Mixcoac", fecha: "2026-10-01T00:00:00Z", ...firmaDe(texto), ...extra });

test("similitud: copia literal se detecta aunque cambien mayúsculas, acentos y puntuación", () => {
    const corpus = [doc("orig", A)];
    const copia = A.toUpperCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/,/g, ";");
    const r = comparar(copia, corpus);
    assert.equal(r.porcentajeTotal, 100);
    assert.equal(r.nivel, "alta");
    assert.equal(r.coincidencias[0].id, "orig");
});

test("similitud: copia parcial da porcentaje parcial y cita el pasaje original", () => {
    const r = comparar(`${RELLENO} ${A}`, [doc("orig", A)]);
    assert.ok(r.porcentajeTotal > 40 && r.porcentajeTotal < 60, String(r.porcentajeTotal));
    assert.match(r.coincidencias[0].pasajes[0], /^La antena QFH se eligió/);
});

test("similitud: texto distinto o frases comunes cortas no coinciden", () => {
    assert.equal(comparar(RELLENO, [doc("orig", A)]).porcentajeTotal, 0);
    assert.equal(comparar("de acuerdo con los resultados obtenidos se concluye", [doc("x", "de acuerdo con los resultados se observa que")]).porcentajeTotal, 0);
    assert.equal(comparar("", [doc("orig", A)]).palabras, 0);
});

test("similitud: versiones propias se muestran pero no cuentan", () => {
    const r = comparar(A, [doc("v1", A, { esVersionPropia: true })]);
    assert.equal(r.porcentajeTotal, 0);
    assert.equal(r.coincidencias[0].esVersionPropia, true);
    assert.equal(r.coincidencias[0].porcentaje, 100);
});

test("tokenizar conserva posiciones del texto original", () => {
    const t = tokenizar("Hola, Ñandú 137 MHz");
    assert.deepEqual(t.map((x) => x.w), ["hola", "nandu", "137", "mhz"]);
    assert.equal("Hola, Ñandú 137 MHz".slice(t[1].ini, t[1].fin), "Ñandú");
    assert.equal(nivelDe(15), "media");
});

test("corpus: solo guarda huellas, detecta idénticos, oculta otros campus y marca versiones propias", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pakal-corpus-"));
    const c = new Corpus(dir);
    await c.agregar({ id: "1", nombre: "Reporte QFH v1.docx", equipo: "Telecomunicaciones", campus: "Mixcoac", texto: A });
    await c.agregar({ id: "2", nombre: "rfi.docx", equipo: "Telecomunicaciones", campus: "CDUP", texto: RELLENO });
    await c.agregar({ id: "3", nombre: "dup.docx", equipo: "Control", campus: "Mixcoac", texto: A });   // mismo texto: no se duplica
    const crudo = fs.readFileSync(path.join(dir, "corpus.json"), "utf8");
    assert.doesNotMatch(crudo, /antena QFH/, "no guarda texto legible");
    assert.equal(c.documentos.length, 2);

    const lista = c.paraComparar({ nombre: "Reporte QFH v2.docx", equipo: "Telecomunicaciones", campus: "Mixcoac" }, "otro-sha");
    assert.equal(lista.find((d) => d.id === "1").esVersionPropia, true);
    assert.equal(lista.find((d) => d.id === "2").nombre, "Documento de otro campus (CDUP)");
});

test("revisión: normaliza la IA, descarta URLs no https y marca las verificadas por la búsqueda", () => {
    const r = normalizarRevision({
        calidad: "99", resumen: "ok",
        citas_faltantes: [{ pasaje: "dato", motivo: "sin fuente" }, { motivo: "sin pasaje" }],
        posibles_fuentes: [
            { pasaje: "p1", fuente: "Wiki", url: "https://es.wikipedia.org/wiki/QFH" },
            { pasaje: "p2", fuente: "Malo", url: "javascript:alert(1)" }
        ]
    }, [{ titulo: "Wiki", url: "https://es.wikipedia.org/wiki/QFH" }]);
    assert.equal(r.calidad, 10);
    assert.equal(r.citas_faltantes.length, 1);
    assert.equal(r.posibles_fuentes[0].verificada, true);
    assert.equal(r.posibles_fuentes[1].url, null);
});

test("revisión heurística: avisa si no hay referencias y hay datos sin citar", () => {
    const r = revisionHeuristica("La ganancia es de 3 dB. La frecuencia es 137 MHz. El consumo es de 500 mA. " + RELLENO.repeat(4));
    assert.ok(r.observaciones.some((o) => /referencias/.test(o)));
    assert.ok(r.observaciones.some((o) => /datos técnicos/.test(o)));
});

test("revisor: usa Gemini con búsqueda y cae al heurístico si falla", async () => {
    const cfg = { orden: ["gemini"], gemini: { apiKey: "k", modelos: ["m"] }, maxCaracteres: 1000, timeoutMs: 1000 };
    let pedido = null;
    const ok = crearRevisor(cfg, { llamar: async (_c, p) => { pedido = p; return { texto: '{"resumen":"bien","calidad":8}', modelo: "m", fuentes: [], conBusqueda: true }; } });
    const r = await ok.revisar({ nombre: "a.pdf", contenido: "texto" });
    assert.equal(r.proveedor, "gemini");
    assert.equal(pedido.buscar, true);
    assert.match(pedido.usuario, /<documento>\ntexto\n<\/documento>/);

    const roto = crearRevisor(cfg, { llamar: async () => { throw new Error("429"); } });
    const r2 = await roto.revisar({ nombre: "a.pdf", contenido: "texto" });
    assert.equal(r2.proveedor, "heuristico");
});

test("pipeline: revisa, guarda en corpus, avisa repetidos y manda correo aunque Firestore falle", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pakal-docs-"));
    const correo = new ServicioCorreo({ from: "a <a@b.c>", orden: [], gmail: {}, resend: {}, smtp: {}, reintentoSeg: 30, maxIntentos: 3, dryRun: true }, dir);
    const p = crearPipelineDocumentos({
        revisor: crearRevisor({ orden: ["heuristico"], maxCaracteres: 5000 }),
        correo,
        guardar: async () => { throw new Error("firestore caído"); },
        config: { datos: dir, servidor: { urlPublica: "http://x" }, analisis: { destinatariosFijos: ["r@x.mx"], notificarEquipo: false, notificarAutor: false } }
    });
    const carpeta = { equipo: "Telecomunicaciones", campus: "Mixcoac" };
    const texto = `${A} ${RELLENO}`;
    const r1 = await p({ archivo: { name: "a.docx" }, carpeta, texto });
    assert.equal(r1.envio.enviados.length, 1);
    assert.equal(r1.doc.similitud.porcentajeTotal, 0);
    const r2 = await p({ archivo: { name: "b.docx" }, carpeta, texto });
    assert.ok(r2.doc.similitud.yaRevisado, "avisa que el texto ya se revisó");
    await assert.rejects(p({ archivo: { name: "c.txt" }, carpeta, texto: "hola" }), /muy poco texto/);
    assert.equal(fs.readdirSync(path.join(dir, "revisiones")).length, 2);
});

test("correo de revisión: escapa pasajes y nunca dice 'plagio'", () => {
    const { html, asunto } = correoRevision({
        archivo: { name: "x<script>.docx" }, carpeta: { equipo: "Control", campus: "Mixcoac" }, urlApp: "http://x",
        doc: {
            proveedor: "gemini", modelo: "m", conBusqueda: true,
            similitud: { palabras: 100, porcentajeTotal: 55, nivel: "alta", coincidencias: [{ nombre: "<b>otro</b>", equipo: "Control", fecha: "2026-10-01", porcentaje: 55, esVersionPropia: false, pasajes: ["<img src=x onerror=alert(1)>"] }] },
            revision: normalizarRevision({ resumen: "r", posibles_fuentes: [{ pasaje: "p", fuente: "f", url: "https://ok.mx" }] })
        }
    });
    assert.doesNotMatch(html, /<script>|<img src=x|<b>otro/);
    assert.doesNotMatch(html + asunto, /plagio/i);
    assert.match(asunto, /⚠️/);
});

test("revisor: no manda autor ni correos a Gemini", async () => {
    let pedido = null;
    const r = crearRevisor({ orden: ["gemini"], gemini: { apiKey: "k", modelos: ["m"] }, maxCaracteres: 5000, timeoutMs: 1000 },
        { llamar: async (_c, p) => { pedido = p; return { texto: '{"resumen":"ok"}', modelo: "m", fuentes: [], conBusqueda: false }; } });
    await r.revisar({ nombre: "a.docx", equipo: "Control", campus: "Mixcoac", autor: "Ana Pérez", contenido: "Contacto: ana.perez@gmail.com, 55 8765 4321." });
    assert.doesNotMatch(pedido.usuario, /Ana Pérez|ana\.perez@gmail\.com|8765 4321/);
});

test("similitud con documentos enormes se recorta (no bloquea el servidor)", async () => {
    const { MAX_CARACTERES_SIMILITUD } = await import("../../server/services/documentos/pipeline.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pakal-grande-"));
    const correo = new ServicioCorreo({ from: "a <a@b.c>", orden: [], gmail: {}, resend: {}, smtp: {}, reintentoSeg: 30, maxIntentos: 3, dryRun: true }, dir);
    const p = crearPipelineDocumentos({ revisor: crearRevisor({ orden: ["heuristico"], maxCaracteres: 5000 }), correo,
        config: { datos: dir, servidor: { urlPublica: "http://x" }, analisis: { destinatariosFijos: ["r@x.mx"], notificarEquipo: false, notificarAutor: false } } });
    const enorme = (RELLENO + " ").repeat(Math.ceil((MAX_CARACTERES_SIMILITUD * 3) / RELLENO.length));
    const inicio = Date.now();
    const r = await p({ archivo: { name: "enorme.txt" }, carpeta: { equipo: "Control", campus: "Mixcoac" }, texto: enorme });
    assert.equal(r.doc.similitud.recortado, true);
    assert.ok(Date.now() - inicio < 10000);
});
