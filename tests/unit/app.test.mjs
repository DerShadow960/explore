/**
 * Servidor HTTP: seguridad, trampa de código fuente, vendor, API con
 * permisos y el flujo completo subida → IA → correo contra SMTP real.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SMTPServer } from "smtp-server";

process.env.PAKAL_DEMO = "true";
process.env.PAKAL_ENV_FILE = "/nonexistent";       // no leer el .env real
const { config } = await import("../../server/config.js");
const { crearApp } = await import("../../server/app.js");
const { ServicioCorreo } = await import("../../server/services/correo/index.js");
const { crearAnalizador } = await import("../../server/services/ia/index.js");
const { crearPipelineAnalisis } = await import("../../server/services/analisis.js");
const { crearRevisor } = await import("../../server/services/documentos/revisor.js");
const { crearPipelineDocumentos } = await import("../../server/services/documentos/pipeline.js");

let servidor, base, smtp;
const correos = [];
const USUARIOS = {
    "tok-control": { uid: "u1", nombre: "Diego", campus: "Mixcoac", equipos: ["Control"], email: "diego@up.edu.mx" },
    "tok-coord": { uid: "u2", nombre: "Rafa", campus: "General", equipos: ["Auditoria"], email: "rafa@up.edu.mx" }
};
let bloqueos = 0;

before(async () => {
    smtp = new SMTPServer({
        authOptional: true, disabledCommands: ["STARTTLS"], logger: false,
        onData(stream, session, cb) {
            let d = ""; stream.on("data", (c) => { d += c; });
            stream.on("end", () => { correos.push({ para: session.envelope.rcptTo.map((r) => r.address), d }); cb(); });
        }
    });
    await new Promise((ok) => smtp.listen(0, "127.0.0.1", ok));

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pakal-app-"));
    const cfgCorreo = {
        ...config.correo, orden: ["smtp"], dryRun: false,
        smtp: { host: "127.0.0.1", puerto: smtp.server.address().port, usuario: "", password: "", seguro: false, ignorarTls: true }
    };
    const correo = new ServicioCorreo(cfgCorreo, dir);
    const analizador = crearAnalizador({ ...config.ia, orden: ["heuristico"] });
    const cfgPipeline = { ...config, datos: dir, analisis: { destinatariosFijos: ["rafalego0208@gmail.com"], notificarEquipo: false, notificarAutor: true } };
    const pipeline = crearPipelineAnalisis({ analizador, correo, config: cfgPipeline });
    const pipelineDocumentos = crearPipelineDocumentos({ revisor: crearRevisor({ ...config.ia, orden: ["heuristico"] }), correo, config: cfgPipeline });

    const sesionFalsa = (req, res, next) => {
        const tok = (req.get("authorization") || "").replace("Bearer ", "");
        if (!USUARIOS[tok]) return res.status(401).json({ error: "Sesión inválida o expirada." });
        req.usuario = USUARIOS[tok];
        next();
    };
    const app = crearApp({
        config, correo, analizador, pipeline, pipelineDocumentos, requiereSesion: sesionFalsa,
        registrarBloqueo: async () => ({ bloqueado: ++bloqueos >= 3, hasta: Date.now() + 60000, intentos: bloqueos })
    });
    await new Promise((ok) => { servidor = app.listen(0, "127.0.0.1", ok); });
    base = `http://127.0.0.1:${servidor.address().port}`;
});
after(async () => {
    await new Promise((ok) => servidor.close(ok));
    await new Promise((ok) => smtp.close(ok));
});

test("sirve el frontend con CSP estricta y cabeceras de seguridad", async () => {
    const r = await fetch(base + "/");
    assert.equal(r.status, 200);
    const csp = r.headers.get("content-security-policy");
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("x-powered-by"), null);
    const html = await r.text();
    assert.doesNotMatch(html, /\son[a-z]+=/i, "no debe haber manejadores en línea");
    assert.doesNotMatch(html, /style="/, "no debe haber estilos en línea");
    assert.doesNotMatch(html, /<script>(?!<\/script>)/, "no debe haber scripts en línea");
});

test("no expone nada fuera de public/", async () => {
    for (const ruta of ["/../server/config.js", "/%2e%2e/server/config.js", "/.env", "/package.json", "/server/app.js"]) {
        const r = await fetch(base + ruta);
        assert.notEqual(r.status, 200, ruta);
    }
});

test("/api/config solo entrega configuración pública", async () => {
    const j = await (await fetch(base + "/api/config")).json();
    assert.ok(j.firebase.projectId);
    assert.equal(JSON.stringify(j).includes("private_key"), false);
});

test("el SDK de Firebase se sirve local y sin URLs de gstatic", async () => {
    const r = await fetch(base + "/vendor/firebase/firebase-firestore.js");
    assert.equal(r.status, 200);
    const js = await r.text();
    assert.doesNotMatch(js, /gstatic\.com/);
    assert.match(js, /\/vendor\/firebase\/firebase-app\.js/);
    assert.equal((await fetch(base + "/vendor/firebase/firebase-messaging.js")).status, 404);
});

test("pedir el JS como script funciona; abrirlo en la barra cae en la trampa y luego bloquea", async () => {
    const normal = await fetch(base + "/js/main.js", { headers: { "sec-fetch-dest": "script" } });
    assert.equal(normal.status, 200);
    assert.match(normal.headers.get("content-type"), /javascript/);

    const t1 = await fetch(base + "/js/main.js", { headers: { "sec-fetch-dest": "document" } });
    assert.equal(t1.status, 200);
    assert.match(await t1.text(), /Neta\?\?/);
    await fetch(base + "/css/base.css", { headers: { "sec-fetch-dest": "document" } });
    const t3 = await fetch(base + "/js/main.js", { headers: { "sec-fetch-dest": "document" } });
    assert.equal(t3.status, 429);
    assert.ok(t3.headers.get("retry-after"));
    assert.match(await t3.text(), /Demasiados intentos/);
});

test("la API rechaza sin token y a quien no es admin", async () => {
    assert.equal((await fetch(base + "/api/estado")).status, 401);
    const r = await fetch(base + "/api/estado", { headers: { Authorization: "Bearer tok-control" } });
    assert.equal(r.status, 403);
    const ok = await fetch(base + "/api/estado", { headers: { Authorization: "Bearer tok-coord" } });
    assert.equal(ok.status, 200);
    const j = await ok.json();
    assert.deepEqual(j.correo.transportes, ["smtp"]);
});

const subir = (token, cuerpo) => fetch(base + "/api/analisis/subir", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ consentimientoIA: true, ...cuerpo })
});
const b64 = (s) => Buffer.from(s).toString("base64");

test("subir sin ser del área → 403; nombre con ruta → 400; binario → error claro", async () => {
    let r = await subir("tok-control", { nombre: "a.py", contenidoBase64: b64("x=1"), equipo: "Telecomunicaciones", campus: "Mixcoac" });
    assert.equal(r.status, 403);
    r = await subir("tok-control", { nombre: "../../etc/passwd", contenidoBase64: b64("x"), equipo: "Control", campus: "Mixcoac" });
    assert.equal(r.status, 400);
    r = await subir("tok-control", { nombre: "foto.png", contenidoBase64: b64("x"), equipo: "Control", campus: "Mixcoac" });
    assert.equal(r.status, 415);
    r = await subir("tok-control", { nombre: "a.py", contenidoBase64: Buffer.from([0, 1, 0, 2]).toString("base64"), equipo: "Control", campus: "Mixcoac" });
    assert.equal(r.status, 422);
    assert.match((await r.json()).error, /binario/);
});

test("FLUJO COMPLETO: subir código → análisis → correo entregado (escapado)", async () => {
    const antes = correos.length;
    const codigo = `// <script>alert(1)</script>\nconst char* token = "abcdefghijkl";\nvoid setup(){}\nvoid loop(){ delay(2000); }\n`;
    const r = await subir("tok-control", { nombre: "rotor<img>.ino", contenidoBase64: b64(codigo), equipo: "Control", campus: "Mixcoac" });
    assert.equal(r.status, 200, await r.clone().text());
    const j = await r.json();
    assert.equal(j.proveedor, "heuristico");
    assert.ok(j.resultado.hallazgos.length >= 2);
    assert.equal(j.correo.enviados, 2, "fijo + autor");
    assert.equal(j.correo.encolados, 0);

    const nuevos = correos.slice(antes);
    const destinatarios = nuevos.flatMap((c) => c.para).sort();
    assert.deepEqual(destinatarios, ["diego@up.edu.mx", "rafalego0208@gmail.com"]);
    const raw = nuevos[0].d;
    assert.match(raw, /An=C3=A1lisis IA|Análisis IA|=?UTF-8?/);
    const parteHtml = raw.split(/Content-Type: text\/html/i)[1] || "";
    assert.match(parteHtml, /rotor&lt;img&gt;\.ino/, "el nombre va escapado en el HTML");
    assert.doesNotMatch(parteHtml, /<img>|<script>alert/, "nada del archivo se inyecta como HTML");
});


const revisar = (token, cuerpo) => fetch(base + "/api/documentos/revisar", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ consentimientoIA: true, ...cuerpo })
});

test("sin consentimiento de IA no se procesa nada", async () => {
    const r = await fetch(base + "/api/analisis/subir", {
        method: "POST", headers: { Authorization: "Bearer tok-control", "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: "a.py", contenidoBase64: b64("x=1"), equipo: "Control", campus: "Mixcoac" })
    });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /aviso de uso de IA/);
});

test("revisión de documentos: valida tipo y permisos, detecta copia y manda correo", async () => {
    const fsm = await import("node:fs");
    const b = (f) => fsm.readFileSync(`tests/fixtures/${f}`).toString("base64");
    assert.equal((await revisar("tok-control", { nombre: "x.py", contenidoBase64: b64("print(1)"), equipo: "Control", campus: "Mixcoac" })).status, 415);
    assert.equal((await revisar("tok-control", { nombre: "r.docx", contenidoBase64: b("reporte_qfh_ana.docx"), equipo: "Telecomunicaciones", campus: "Mixcoac" })).status, 403);
    assert.equal((await revisar("tok-control", { nombre: "corto.txt", contenidoBase64: b64("muy poco texto aquí"), equipo: "Control", campus: "Mixcoac" })).status, 422);

    const antes = correos.length;
    let r = await revisar("tok-control", { nombre: "reporte_qfh_ana.docx", contenidoBase64: b("reporte_qfh_ana.docx"), equipo: "Control", campus: "Mixcoac" });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal((await r.json()).similitud.porcentajeTotal, 0);

    r = await revisar("tok-control", { nombre: "avances.docx", contenidoBase64: b("avances_antena_cdup.docx"), equipo: "Control", campus: "Mixcoac" });
    const j = await r.json();
    assert.ok(j.similitud.porcentajeTotal > 30, `esperaba coincidencia alta, fue ${j.similitud.porcentajeTotal}`);
    assert.equal(j.similitud.nivel, "alta");
    assert.ok(correos.length - antes >= 4, "fijo + autor en cada revisión");
    // El correo viene en quoted-printable: se decodifica antes de buscar.
    const qp = (t) => Buffer.from(t.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8");
    const html = qp(correos.at(-1).d.split(/Content-Type: text\/html/i)[1] || "");
    assert.match(html, /reporte_qfh_ana\.docx/, "en el mismo campus se muestra el nombre del documento fuente");
    assert.doesNotMatch(html, /plagio/i, "nunca se dictamina plagio");
});

test("nombres con caracteres de control se rechazan", async () => {
    const r = await subir("tok-control", { nombre: "a.py\r\nINFO falso", contenidoBase64: b64("x=1"), equipo: "Control", campus: "Mixcoac" });
    assert.equal(r.status, 400);
});
