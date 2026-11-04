import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { VigilanteDrive } from "../../server/services/drive/vigilante.js";
import { esAnalizable, tipoDe, textoDeNotebook, pareceCodigo, extraerTexto } from "../../server/services/drive/extractor.js";

const CARPETA = { campus: "Mixcoac", equipo: "Control", id: "carpetaRaiz123" };

function clienteFalso(archivos, contenidos) {
    return {
        descargas: 0,
        subcarpetas: async (raiz) => [raiz, "subcarpeta456"],
        archivosModificados: async (carpetaId, desde) =>
            archivos.filter((a) => a.parent === carpetaId && (!desde || Date.parse(a.modifiedTime) > Date.parse(desde))),
        async descargar(a) { this.descargas++; return Buffer.from(contenidos[a.id] ?? ""); }
    };
}

function vigilante(cliente, ahora, extra = {}) {
    const procesados = [];
    const v = new VigilanteDrive({
        cliente, carpetas: [CARPETA], dirDatos: fs.mkdtempSync(path.join(os.tmpdir(), "pakal-drive-")),
        maxBytes: 1e6, procesar: async (x) => { procesados.push(x); }, ahora: () => ahora.t, ...extra
    });
    return { v, procesados };
}

const ISO = (ms) => new Date(ms).toISOString();

test("primer arranque registra la carpeta sin analizar lo existente", async () => {
    const ahora = { t: Date.parse("2026-10-21T10:00:00Z") };
    const archivos = [{ id: "viejo1", name: "viejo.py", mimeType: "text/x-python", modifiedTime: ISO(ahora.t - 86400000), parent: CARPETA.id }];
    const { v, procesados } = vigilante(clienteFalso(archivos, { viejo1: "print(1)" }), ahora);
    await v.revisar();
    assert.equal(procesados.length, 0);
});

test("analiza un archivo nuevo (también en subcarpetas) una sola vez", async () => {
    const ahora = { t: Date.parse("2026-10-21T10:00:00Z") };
    const archivos = [];
    const contenidos = {};
    const cli = clienteFalso(archivos, contenidos);
    const { v, procesados } = vigilante(cli, ahora);
    await v.revisar();                                  // registra

    archivos.push({ id: "n1", name: "rotor.ino", mimeType: "", modifiedTime: ISO(ahora.t + 1000), version: "3", parent: "subcarpeta456" });
    contenidos.n1 = "void setup(){}\nvoid loop(){ delay(1000); }";
    ahora.t += 5 * 60000;
    await v.revisar();
    assert.equal(procesados.length, 1);
    assert.equal(procesados[0].archivo.name, "rotor.ino");
    assert.equal(procesados[0].carpeta.equipo, "Control");

    ahora.t += 5 * 60000;
    await v.revisar();                                  // misma versión
    assert.equal(procesados.length, 1);
});

test("espera el periodo de calma antes de analizar", async () => {
    const ahora = { t: Date.parse("2026-10-21T10:00:00Z") };
    const archivos = [];
    const { v, procesados } = vigilante(clienteFalso(archivos, { e1: "x = 1\nprint(x)\n" }), ahora);
    await v.revisar();
    archivos.push({ id: "e1", name: "edit.py", mimeType: "", modifiedTime: ISO(ahora.t + 10000), parent: CARPETA.id });
    ahora.t += 20000;                                   // 10 s después de modificarse
    await v.revisar();
    assert.equal(procesados.length, 0);
    ahora.t += 2 * 60000;
    await v.revisar();
    assert.equal(procesados.length, 1);
});

test("Google Doc sin código se omite; con código se analiza", async () => {
    const ahora = { t: Date.parse("2026-10-21T10:00:00Z") };
    const archivos = [];
    const contenidos = {
        prosa: "Minuta de la reunión.\nAcordamos revisar la antena.\nSin más.",
        codigo: "Este es el script del rotor:\nimport serial\ndef mover(az):\n    s.write(b'AZ')\n    return True\nfor i in range(3):\n    mover(i)\n"
    };
    const { v, procesados } = vigilante(clienteFalso(archivos, contenidos), ahora);
    await v.revisar();
    const gdoc = "application/vnd.google-apps.document";
    archivos.push({ id: "prosa", name: "Minuta", mimeType: gdoc, modifiedTime: ISO(ahora.t + 1), parent: CARPETA.id });
    archivos.push({ id: "codigo", name: "Script rotor", mimeType: gdoc, modifiedTime: ISO(ahora.t + 1), parent: CARPETA.id });
    ahora.t += 5 * 60000;
    await v.revisar();
    assert.deepEqual(procesados.map((p) => p.archivo.id), ["codigo"]);
});

test("si el procesamiento falla, se reintenta en la siguiente vuelta", async () => {
    const ahora = { t: Date.parse("2026-10-21T10:00:00Z") };
    const archivos = [];
    let falla = true;
    const intentos = [];
    const v = new VigilanteDrive({
        cliente: clienteFalso(archivos, { f1: "print('hola')\nx=1\n" }), carpetas: [CARPETA],
        dirDatos: fs.mkdtempSync(path.join(os.tmpdir(), "pakal-drive-")), maxBytes: 1e6, ahora: () => ahora.t,
        procesar: async (x) => { intentos.push(x); if (falla) throw new Error("sin destinatarios"); }
    });
    await v.revisar();
    archivos.push({ id: "f1", name: "f.py", mimeType: "", modifiedTime: ISO(ahora.t + 1), parent: CARPETA.id });
    ahora.t += 5 * 60000;
    await v.revisar();
    falla = false;
    ahora.t += 5 * 60000;
    await v.revisar();
    assert.equal(intentos.length, 2);
});

test("extractor: tipos y notebooks", async () => {
    assert.equal(esAnalizable({ name: "a.py", mimeType: "" }), true);
    assert.equal(esAnalizable({ name: "foto.jpg", mimeType: "image/jpeg" }), false);
    assert.equal(esAnalizable({ name: "x", mimeType: "application/vnd.google-apps.folder" }), false);
    assert.equal(tipoDe({ name: "r.PDF", mimeType: "" }), "pdf");
    assert.equal(tipoDe({ name: "n.ipynb", mimeType: "" }), "ipynb");
    const nb = Buffer.from(JSON.stringify({ cells: [{ cell_type: "code", source: ["import numpy\n", "x=1"] }, { cell_type: "markdown", source: "Título" }] }));
    const t = textoDeNotebook(nb);
    assert.match(t, /# %% \[celda 1\]\nimport numpy\nx=1/);
    assert.match(t, /# Título/);
    await assert.rejects(extraerTexto(Buffer.from([0, 1, 2, 0]), "texto"), /binario/);
});

test("pareceCodigo distingue prosa de código", () => {
    assert.equal(pareceCodigo("Hola equipo.\nMañana hay junta.\nSaludos."), false);
    assert.equal(pareceCodigo("#include <Stepper.h>\nvoid setup() {\n  Serial.begin(9600);\n}\n"), true);
});

test("extrae texto real de PDF y Word", async () => {
    const pdf = await extraerTexto(fs.readFileSync("tests/fixtures/codigo.pdf"), "pdf");
    assert.match(pdf, /import serial/);
    assert.match(pdf, /def mover/);
    const docx = await extraerTexto(fs.readFileSync("tests/fixtures/codigo.docx"), "docx");
    assert.match(docx, /Serial\.begin\(9600\)/);
});

test("un Word bomba (pocos KB que se expanden a cientos de MB) se rechaza sin tumbar el proceso", async () => {
    const buf = fs.readFileSync("tests/fixtures/bomba.docx");
    const antes = process.memoryUsage().rss;
    const inicio = Date.now();
    await assert.rejects(extraerTexto(buf, "docx"), /demasiado complejo|tardó demasiado|No se pudo leer/);
    assert.ok(Date.now() - inicio < 25000, "respeta el tope de tiempo");
    assert.ok(process.memoryUsage().rss - antes < 200 * 2 ** 20, "la memoria del proceso principal no se dispara");
    // El proceso sigue sano: un archivo normal se procesa después.
    assert.match(await extraerTexto(fs.readFileSync("tests/fixtures/codigo.docx"), "docx"), /Serial\.begin/);
});
