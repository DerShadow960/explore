/**
 * El correo SALE: pruebas contra un servidor SMTP real levantado en la prueba.
 * Cubre envío directo, respaldo entre transportes, cola en disco y reintento.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SMTPServer } from "smtp-server";
import { ServicioCorreo, normalizarDestinatarios } from "../../server/services/correo/index.js";

let smtp, puerto;
const recibidos = [];

before(async () => {
    smtp = new SMTPServer({
        authOptional: true, disabledCommands: ["STARTTLS"], logger: false,
        onData(stream, session, cb) {
            let datos = "";
            stream.on("data", (c) => { datos += c; });
            stream.on("end", () => { recibidos.push({ para: session.envelope.rcptTo.map((r) => r.address), datos }); cb(); });
        }
    });
    await new Promise((ok) => smtp.listen(0, "127.0.0.1", ok));
    puerto = smtp.server.address().port;
});
after(() => new Promise((ok) => smtp.close(ok)));

function cfg(extra = {}) {
    return {
        from: "PAKAL <pakal@test.local>", orden: ["smtp"],
        gmail: { usuario: "", appPassword: "" }, resend: { apiKey: "" },
        smtp: { host: "127.0.0.1", puerto, usuario: "", password: "", seguro: false, ignorarTls: true },
        reintentoSeg: 30, maxIntentos: 3, dryRun: false, ...extra
    };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "pakal-correo-"));

test("normaliza destinatarios: quita inválidos y duplicados", () => {
    assert.deepEqual(normalizarDestinatarios(["a@b.com", "A@B.com", "malo", "", "x@y.mx", "<x>@y.com"]), ["a@b.com", "x@y.mx"]);
});

test("envía por SMTP y deja evidencia en la bitácora", async () => {
    const dir = tmp();
    const svc = new ServicioCorreo(cfg(), dir);
    const antes = recibidos.length;
    const r = await svc.enviar({ para: ["uno@test.mx", "dos@test.mx"], asunto: "Hola", html: "<p>hola</p>", texto: "hola" });
    assert.equal(r.enviados.length, 2);
    assert.equal(r.encolados.length, 0);
    assert.equal(recibidos.length - antes, 2);
    assert.match(recibidos.at(-1).datos, /Subject: Hola/);
    assert.match(fs.readFileSync(path.join(dir, "correo-enviados.log"), "utf8"), /smtp\tdos@test\.mx/);
});

test("si el primer transporte falla, usa el siguiente", async () => {
    const svc = new ServicioCorreo(cfg({ orden: ["gmail", "smtp"] }), tmp());
    svc.transportes.gmail = { nombre: "gmail", enviar: async () => { throw new Error("535 credenciales"); }, verificar: async () => true };
    const r = await svc.enviar({ para: "tres@test.mx", asunto: "Respaldo", html: "x" });
    assert.equal(r.enviados[0].via, "smtp");
});

test("si todos fallan, encola con .eml y lo reenvía al reintentar", async () => {
    const dir = tmp();
    const svc = new ServicioCorreo(cfg({ orden: ["gmail"] }), dir);
    let caido = true;
    svc.transportes = {
        gmail: {
            nombre: "gmail",
            enviar: async () => { if (caido) throw new Error("sin red"); return "ok-id"; },
            verificar: async () => true
        }
    };
    const r = await svc.enviar({ para: "cuatro@test.mx", asunto: "Cola", html: "<b>x</b>" });
    assert.equal(r.enviados.length, 0);
    assert.equal(r.encolados.length, 1);
    assert.equal(svc.estado().pendientes, 1);
    const emls = fs.readdirSync(path.join(dir, "outbox"));
    assert.equal(emls.length, 1);
    assert.match(fs.readFileSync(path.join(dir, "outbox", emls[0]), "utf8"), /Subject: Cola/);

    // Todavía no toca: no reintenta sin forzar.
    assert.equal((await svc.procesarCola()).reintentados, 0);

    caido = false;
    const rr = await svc.procesarCola({ forzar: true });
    assert.deepEqual(rr, { reintentados: 1, enviados: 1 });
    assert.equal(svc.estado().pendientes, 0);
});

test("la cola sobrevive a un reinicio del proceso", async () => {
    const dir = tmp();
    const a = new ServicioCorreo(cfg({ orden: [] }), dir);
    a.transportes = {};
    await a.enviar({ para: "cinco@test.mx", asunto: "Persistente", html: "x" });
    const b = new ServicioCorreo(cfg(), dir);        // "reinicio" con SMTP ya funcionando
    const antes = recibidos.length;
    const r = await b.procesarCola({ forzar: true });
    assert.equal(r.enviados, 1);
    assert.equal(recibidos.length - antes, 1);
});

test("tras agotar intentos pasa a 'fallidos' pero conserva el .eml", async () => {
    const dir = tmp();
    const svc = new ServicioCorreo(cfg({ orden: ["gmail"], maxIntentos: 2 }), dir);
    svc.transportes = { gmail: { nombre: "gmail", enviar: async () => { throw new Error("x"); }, verificar: async () => true } };
    await svc.enviar({ para: "seis@test.mx", asunto: "Muere", html: "x" });
    await svc.procesarCola({ forzar: true });
    assert.equal(svc.estado().pendientes, 0);
    assert.equal(svc.estado().fallidos, 1);
    assert.equal(fs.readdirSync(path.join(dir, "outbox")).length, 1);
});

test("dry run no envía pero guarda el .eml", async () => {
    const dir = tmp();
    const svc = new ServicioCorreo(cfg({ dryRun: true }), dir);
    const antes = recibidos.length;
    const r = await svc.enviar({ para: "siete@test.mx", asunto: "Ensayo", html: "x" });
    assert.equal(r.enviados[0].via, "dry-run");
    assert.equal(recibidos.length, antes);
    assert.equal(fs.readdirSync(path.join(dir, "outbox")).length, 1);
});
