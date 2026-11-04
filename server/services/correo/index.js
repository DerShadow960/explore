/**
 * Servicio de correo con entrega garantizada.
 * ============================================================
 * 1. Intenta los transportes configurados en orden (MAIL_TRANSPORTES):
 *      gmail  → SMTP de Gmail con contraseña de aplicación
 *      resend → API HTTP de Resend
 *      smtp   → cualquier servidor SMTP
 *    El primero que acepte el mensaje gana.
 * 2. Si TODOS fallan (sin red, credencial mala, cuota agotada), el correo
 *    NO se pierde: se guarda en data/outbox.json + un .eml legible, y el
 *    planificador lo reintenta cada MAIL_REINTENTO_SEG con espera creciente.
 * 3. Cada envío exitoso queda en data/correo-enviados.log como evidencia.
 *
 * Un correo por destinatario: si una dirección rebota, las demás salen.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { AlmacenJson } from "../../lib/almacen.js";
import { crearLogger } from "../../lib/logger.js";

const log = crearLogger("correo");
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

export function correoValido(c) {
    return typeof c === "string" && c.length <= 254 && EMAIL_RE.test(c);
}

/** Quita duplicados (sin distinguir mayúsculas) y direcciones inválidas. */
export function normalizarDestinatarios(lista) {
    const vistos = new Map();
    for (const c of lista || []) {
        const limpio = String(c || "").trim();
        if (!correoValido(limpio)) continue;
        const clave = limpio.toLowerCase();
        if (!vistos.has(clave)) vistos.set(clave, limpio);
    }
    return [...vistos.values()];
}

// ------------------------------------------------------------
// Transportes
// ------------------------------------------------------------
function crearTransportes(cfg) {
    const t = {};
    const { gmail, resend, smtp } = cfg;

    if (gmail.usuario && gmail.appPassword) {
        const tr = nodemailer.createTransport({
            service: "gmail",
            auth: { user: gmail.usuario, pass: gmail.appPassword },
            connectionTimeout: 20000, greetingTimeout: 20000, socketTimeout: 30000
        });
        t.gmail = {
            nombre: "gmail",
            // Gmail reescribe el remitente a la cuenta autenticada; lo fijamos
            // nosotros para que el "From" sea coherente y no caiga en spam.
            enviar: async (m) => {
                const nombre = (cfg.from.match(/^(.*?)\s*</)?.[1] || "PAKAL Mission Control").replace(/"/g, "");
                const info = await tr.sendMail({ ...m, from: `"${nombre}" <${gmail.usuario}>` });
                return info.messageId;
            },
            verificar: () => tr.verify()
        };
    }

    if (resend.apiKey) {
        t.resend = {
            nombre: "resend",
            enviar: async (m) => {
                const res = await fetch("https://api.resend.com/emails", {
                    method: "POST",
                    headers: { Authorization: `Bearer ${resend.apiKey}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
                    signal: AbortSignal.timeout(30000)
                });
                const cuerpo = await res.text();
                if (!res.ok) throw new Error(`Resend ${res.status}: ${cuerpo.slice(0, 300)}`);
                try { return JSON.parse(cuerpo).id; } catch { return "resend"; }
            },
            verificar: async () => {
                const res = await fetch("https://api.resend.com/domains", {
                    headers: { Authorization: `Bearer ${resend.apiKey}` }, signal: AbortSignal.timeout(15000)
                });
                // Las keys "solo envío" responden 401 aquí pero sí envían.
                if (!res.ok && res.status !== 401) throw new Error(`Resend respondió ${res.status}`);
                return true;
            }
        };
    }

    if (smtp.host) {
        const tr = nodemailer.createTransport({
            host: smtp.host,
            port: smtp.puerto,
            secure: smtp.seguro,
            ignoreTLS: smtp.ignorarTls,
            auth: smtp.usuario ? { user: smtp.usuario, pass: smtp.password } : undefined,
            connectionTimeout: 20000, greetingTimeout: 20000, socketTimeout: 30000
        });
        t.smtp = {
            nombre: "smtp",
            enviar: async (m) => (await tr.sendMail(m)).messageId,
            verificar: () => tr.verify()
        };
    }
    return t;
}

/** Construye el mensaje RFC 822 completo, para guardarlo como .eml. */
async function aEml(mensaje) {
    const tr = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
    const info = await tr.sendMail(mensaje);
    return info.message;
}

// ------------------------------------------------------------
// Servicio
// ------------------------------------------------------------
export class ServicioCorreo {
    /**
     * @param {object} cfg       config.correo
     * @param {string} dirDatos  carpeta para outbox, .eml y bitácora
     */
    constructor(cfg, dirDatos) {
        this.cfg = cfg;
        this.dir = dirDatos;
        this.transportes = crearTransportes(cfg);
        this.cola = new AlmacenJson(path.join(dirDatos, "outbox.json"), { pendientes: [], fallidos: [] });
        this.dirEml = path.join(dirDatos, "outbox");
        this.bitacora = path.join(dirDatos, "correo-enviados.log");
        this.procesando = false;
    }

    /** Transportes en el orden pedido, solo los que tienen credenciales. */
    disponibles() {
        return this.cfg.orden.map((n) => this.transportes[n]).filter(Boolean);
    }

    /**
     * Envía (o encola) un correo para cada destinatario.
     * @returns {Promise<{enviados: object[], encolados: object[]}>}
     */
    async enviar({ para, asunto, html, texto, etiqueta = "general", adjuntos }) {
        const destinatarios = normalizarDestinatarios(Array.isArray(para) ? para : [para]);
        if (!destinatarios.length) throw new Error("No hay destinatarios válidos.");

        const enviados = [];
        const encolados = [];
        for (const to of destinatarios) {
            const mensaje = { from: this.cfg.from, to, subject: asunto, html, text: texto, attachments: adjuntos };
            const r = await this.intentar(mensaje);
            if (r.ok) {
                enviados.push({ to, via: r.via, id: r.id });
            } else {
                const id = await this.encolar(mensaje, etiqueta, r.errores);
                encolados.push({ to, id, errores: r.errores });
            }
        }
        return { enviados, encolados };
    }

    /** Un intento por cada transporte disponible. */
    async intentar(mensaje) {
        if (this.cfg.dryRun) {
            const ruta = await this.guardarEml(mensaje, "dryrun");
            log.info(`[DRY RUN] ${mensaje.to} · ${mensaje.subject} → ${path.relative(process.cwd(), ruta)}`);
            this.registrar(mensaje, "dry-run", ruta);
            return { ok: true, via: "dry-run", id: path.basename(ruta) };
        }

        const errores = [];
        for (const tr of this.disponibles()) {
            try {
                const id = await tr.enviar(mensaje);
                log.info(`Enviado por ${tr.nombre} a ${mensaje.to}: ${mensaje.subject}`);
                this.registrar(mensaje, tr.nombre, id);
                return { ok: true, via: tr.nombre, id };
            } catch (e) {
                log.warn(`Falló ${tr.nombre} para ${mensaje.to}`, { error: e.message });
                errores.push(`${tr.nombre}: ${e.message}`.slice(0, 400));
            }
        }
        if (!errores.length) errores.push("No hay ningún transporte de correo configurado.");
        return { ok: false, errores };
    }

    async encolar(mensaje, etiqueta, errores) {
        const id = crypto.randomUUID();
        const eml = await this.guardarEml(mensaje, id);
        await this.cola.actualizar((estado) => {
            estado.pendientes.push({
                id, etiqueta, mensaje,
                intentos: 1,
                creado: new Date().toISOString(),
                siguiente: Date.now() + this.cfg.reintentoSeg * 1000,
                ultimoError: errores.join(" | "),
                eml: path.basename(eml)
            });
        });
        log.warn(`Correo encolado para reintento (${id}) → ${mensaje.to}. Copia en ${path.relative(process.cwd(), eml)}`);
        return id;
    }

    /** Reintenta lo que toque. Lo llama el planificador. */
    async procesarCola({ forzar = false } = {}) {
        if (this.procesando) return { reintentados: 0, enviados: 0 };
        this.procesando = true;
        let reintentados = 0, enviados = 0;
        try {
            const ahora = Date.now();
            const pendientes = [...this.cola.leer().pendientes].filter((p) => forzar || p.siguiente <= ahora);
            for (const p of pendientes) {
                reintentados++;
                const r = await this.intentar(p.mensaje);
                await this.cola.actualizar((estado) => {
                    const i = estado.pendientes.findIndex((x) => x.id === p.id);
                    if (i < 0) return;
                    if (r.ok) {
                        estado.pendientes.splice(i, 1);
                        enviados++;
                        return;
                    }
                    const item = estado.pendientes[i];
                    item.intentos += 1;
                    item.ultimoError = r.errores.join(" | ");
                    // Espera creciente: 1×, 2×, 4×… hasta 6 h.
                    const espera = Math.min(this.cfg.reintentoSeg * 2 ** Math.min(item.intentos - 1, 8), 6 * 3600);
                    item.siguiente = Date.now() + espera * 1000;
                    if (item.intentos >= this.cfg.maxIntentos) {
                        estado.pendientes.splice(i, 1);
                        estado.fallidos.push({ ...item, abandonado: new Date().toISOString() });
                        log.error(`Correo ${item.id} abandonado tras ${item.intentos} intentos. El .eml sigue en data/outbox/`);
                    }
                });
            }
        } finally {
            this.procesando = false;
        }
        if (reintentados) log.info(`Cola de correo: ${enviados}/${reintentados} reenviados.`);
        return { reintentados, enviados };
    }

    async guardarEml(mensaje, nombre) {
        fs.mkdirSync(this.dirEml, { recursive: true, mode: 0o700 });
        const ruta = path.join(this.dirEml, `${new Date().toISOString().replace(/[:.]/g, "-")}_${nombre}.eml`);
        fs.writeFileSync(ruta, await aEml(mensaje), { mode: 0o600 });
        return ruta;
    }

    registrar(mensaje, via, id) {
        const linea = `${new Date().toISOString()}\t${via}\t${mensaje.to}\t${id || ""}\t${mensaje.subject}\n`;
        try {
            fs.mkdirSync(this.dir, { recursive: true });
            fs.appendFileSync(this.bitacora, linea, { mode: 0o600 });
        } catch (e) { log.warn("No se pudo escribir la bitácora de correo", { error: e.message }); }
    }

    /** Comprueba credenciales de cada transporte sin enviar nada. */
    async verificar() {
        const resultado = {};
        for (const [nombre, tr] of Object.entries(this.transportes)) {
            try { await tr.verificar(); resultado[nombre] = { ok: true }; }
            catch (e) { resultado[nombre] = { ok: false, error: e.message }; }
        }
        return resultado;
    }

    estado() {
        const c = this.cola.leer();
        return {
            transportes: this.disponibles().map((t) => t.nombre),
            dryRun: this.cfg.dryRun,
            pendientes: c.pendientes.length,
            fallidos: c.fallidos.length,
            proximoReintento: c.pendientes.length
                ? new Date(Math.min(...c.pendientes.map((p) => p.siguiente))).toISOString()
                : null
        };
    }
}
