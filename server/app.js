/**
 * Aplicación Express.
 * ============================================================
 * Se construye con dependencias inyectadas (servicios) para poder
 * probarla sin Firebase real. index.js es quien la conecta todo.
 *
 * Superficie pública:
 *   /                       frontend (public/)
 *   /vendor/*               Firebase SDK y SheetJS servidos localmente
 *   /api/config             configuración web de Firebase (pública)
 *   /api/salud              vivo/no vivo
 * Con sesión de Firebase (Bearer):
 *   POST /api/analisis/subir          analizar código subido desde la app
 *   POST /api/documentos/revisar      revisar un documento (similitud, citas, fuentes)
 * Solo coordinación/auditoría:
 *   GET  /api/estado                  estado de correo, Drive, IA
 *   POST /api/analisis/revisar-drive  forzar una vuelta del vigilante
 *   POST /api/correo/prueba           correo de prueba
 *   POST /api/correo/reintentar       vaciar la cola ahora
 *   POST /api/recordatorios/ejecutar  mandar recordatorios ahora
 */

import fs from "node:fs";
import path from "node:path";
import express from "express";
import rateLimit from "express-rate-limit";
import { crearSeguridad, permisos } from "./middleware/seguridad.js";
import { requiereSesion, requiereAdmin } from "./middleware/auth.js";
import { paginaMeme, paginaBloqueo } from "./pages/bloqueado.js";
import { RAIZ } from "./config.js";
import { puedeEditar, EQUIPOS, CAMPUS } from "../public/js/dominio.js";
import { tipoDe, extraerTexto, esAnalizable } from "./services/drive/extractor.js";
import { crearLogger } from "./lib/logger.js";

const log = crearLogger("http");
const PUBLICO = path.join(RAIZ, "public");
const VENDOR_FIREBASE = new Set(["firebase-app.js", "firebase-auth.js", "firebase-firestore.js"]);

/** Lee un bundle de Firebase y reescribe sus imports de gstatic a /vendor. */
function cargarVendorFirebase() {
    const dir = path.join(RAIZ, "node_modules", "firebase");
    const cache = new Map();
    for (const nombre of VENDOR_FIREBASE) {
        const ruta = path.join(dir, nombre);
        if (!fs.existsSync(ruta)) continue;
        const codigo = fs.readFileSync(ruta, "utf8")
            .replace(/https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\//g, "/vendor/firebase/")
            .replace(/\n\/\/# sourceMappingURL=.*$/m, "");
        cache.set(nombre, codigo);
    }
    return cache;
}

/**
 * @param {object} s  servicios: { config, correo, vigilante?, pipeline?, recordatorios?, registrarBloqueo?, usarAuth? }
 */
export function crearApp(s) {
    const { config } = s;
    const app = express();
    app.disable("x-powered-by");
    app.set("trust proxy", config.servidor.confiarProxy ? 1 : false);

    app.use(crearSeguridad(config));
    app.use(permisos);

    // Bitácora mínima de peticiones a la API.
    app.use("/api", (req, res, next) => {
        const inicio = Date.now();
        res.on("finish", () => log.debug(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - inicio}ms`));
        next();
    });

    const limiteGeneral = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false });
    const limiteAnalisis = rateLimit({ windowMs: 10 * 60_000, limit: 15, standardHeaders: "draft-7", legacyHeaders: false,
        message: { error: "Demasiados análisis seguidos. Espera unos minutos." } });
    const limiteAdmin = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false });
    app.use("/api", limiteGeneral);

    const sesion = s.requiereSesion || requiereSesion();
    const admin = s.requiereAdmin || requiereAdmin();

    // ---------------------------------------------------------
    // Trampa: abrir el JS/CSS de la app directo en la barra de
    // direcciones (Sec-Fetch-Dest: document) cae en la página de aviso.
    // Ojo: es un letrero, no una cerradura. El navegador necesita el JS
    // para ejecutarlo; con F12 se ve igual. La seguridad está en las reglas.
    // ---------------------------------------------------------
    // Tope propio: cada intento escribe en Firestore; que nadie infle la bitácora a golpes.
    const limiteTrampa = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false,
        skip: (req) => req.get("sec-fetch-dest") !== "document" });
    app.get(/^\/(js|css|vendor)\/.+\.(js|css)$/, limiteTrampa, async (req, res, next) => {
        if (req.get("sec-fetch-dest") !== "document") return next();
        res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });
        if (!s.registrarBloqueo) return res.status(200).type("html").send(paginaMeme(config.retencion?.bitacoraDias));
        const r = await s.registrarBloqueo(req.ip, {
            navegador: (req.get("user-agent") || "desconocido").slice(0, 250),
            referer: (req.get("referer") || "").slice(0, 250),
            ruta: req.path.slice(0, 200)
        });
        if (r.bloqueado) {
            const segundos = Math.max(0, Math.ceil((r.hasta - Date.now()) / 1000));
            res.set("Retry-After", String(segundos));
            return res.status(429).type("html").send(paginaBloqueo(segundos, config.bloqueo.intentosMax, config.retencion?.bitacoraDias));
        }
        res.status(200).type("html").send(paginaMeme(config.retencion?.bitacoraDias));
    });

    // ---------------------------------------------------------
    // Vendor: Firebase y SheetJS desde node_modules (CSP 'self').
    // ---------------------------------------------------------
    const vendor = cargarVendorFirebase();
    app.get("/vendor/firebase/:archivo", (req, res) => {
        const codigo = vendor.get(req.params.archivo);
        if (!codigo) return res.status(404).end();
        res.type("application/javascript").set("Cache-Control", "public, max-age=86400").send(codigo);
    });

    // ---------------------------------------------------------
    // API pública
    // ---------------------------------------------------------
    app.get("/api/salud", (req, res) => res.json({ ok: true, demo: config.modoDemo }));

    app.get("/api/config", (req, res) => {
        res.set("Cache-Control", "no-store").json({
            firebase: config.firebase.web,
            demo: config.modoDemo,
            emuladores: config.modoDemo ? config.firebase.emuladores : null,
            analisisSubida: !!s.pipeline,
            revisionDocumentos: !!s.pipelineDocumentos
        });
    });

    // ---------------------------------------------------------
    // Análisis manual desde la app (alternativa a Drive)
    // ---------------------------------------------------------
    /**
     * Validación común de las subidas desde la app: nombre, área, campus,
     * permiso (mismo criterio que las reglas) y tamaño. Devuelve el texto
     * extraído o responde el error y devuelve null.
     */
    async function leerSubida(req, res, { extensiones, mensajeTipo }) {
        const { nombre, contenidoBase64, equipo, campus, consentimientoIA } = req.body || {};
        // Sin consentimiento explícito no se procesa nada con IA de terceros.
        if (consentimientoIA !== true) {
            res.status(400).json({ error: "Marca la casilla de aviso de uso de IA para continuar." }); return null;
        }
        // Sin rutas ni caracteres de control (evita nombres que falseen logs o rompan cabeceras).
        if (typeof nombre !== "string" || !nombre.trim() || nombre.length > 200 || /[\\/\u0000-\u001f\u007f]/.test(nombre)) {
            res.status(400).json({ error: "Nombre de archivo inválido." }); return null;
        }
        if (!EQUIPOS.includes(equipo) || !CAMPUS.includes(campus)) {
            res.status(400).json({ error: "Área o campus inválido." }); return null;
        }
        if (!puedeEditar(req.usuario, equipo, campus)) {
            res.status(403).json({ error: "Solo los miembros del área pueden mandar archivos a revisar." }); return null;
        }
        if (typeof contenidoBase64 !== "string" || !contenidoBase64 || contenidoBase64.length > 2_900_000) {
            res.status(400).json({ error: "Archivo vacío o demasiado grande (máx. 2 MB)." }); return null;
        }
        const archivo = { name: nombre.trim(), mimeType: "" };
        if (!extensiones(archivo)) { res.status(415).json({ error: mensajeTipo }); return null; }
        let texto;
        try {
            texto = await extraerTexto(Buffer.from(contenidoBase64, "base64"), tipoDe(archivo));
        } catch (e) {
            res.status(422).json({ error: e.message.startsWith("El archivo parece binario") ? e.message : "No se pudo leer el archivo." });
            return null;
        }
        if (!texto.trim()) { res.status(422).json({ error: "No se pudo extraer texto del archivo." }); return null; }
        return {
            texto, equipo, campus,
            archivo: { ...archivo, id: null, lastModifyingUser: { displayName: req.usuario.nombre, emailAddress: req.usuario.email } }
        };
    }

    app.post("/api/analisis/subir", limiteAnalisis, sesion, express.json({ limit: "3mb" }), async (req, res) => {
        if (!s.pipeline) return res.status(503).json({ error: "El análisis no está disponible en este servidor." });
        const sub = await leerSubida(req, res, {
            extensiones: (a) => esAnalizable(a) || /\.(pdf|docx)$/i.test(a.name),
            mensajeTipo: "Tipo de archivo no soportado. Sube código, .txt, .ipynb, .pdf o .docx."
        });
        if (!sub) return;
        try {
            const r = await s.pipeline({ archivo: sub.archivo, carpeta: { equipo: sub.equipo, campus: sub.campus }, texto: sub.texto });
            res.json({
                id: r.id,
                proveedor: r.doc.proveedor,
                resultado: r.doc.resultado,
                correo: { enviados: r.envio.enviados.length, encolados: r.envio.encolados.length }
            });
        } catch (e) {
            log.error("Análisis manual falló", { error: e.message });
            res.status(500).json({ error: "No se pudo analizar el archivo." });
        }
    });

    // ---------------------------------------------------------
    // Revisión de documentos (similitud interna + citas + fuentes)
    // ---------------------------------------------------------
    app.post("/api/documentos/revisar", limiteAnalisis, sesion, express.json({ limit: "3mb" }), async (req, res) => {
        if (!s.pipelineDocumentos) return res.status(503).json({ error: "La revisión de documentos no está disponible." });
        const sub = await leerSubida(req, res, {
            extensiones: (a) => /\.(pdf|docx|txt|md)$/i.test(a.name),
            mensajeTipo: "Para revisar documentos sube .pdf, .docx, .txt o .md (máx. 2 MB)."
        });
        if (!sub) return;
        try {
            const r = await s.pipelineDocumentos({ archivo: sub.archivo, carpeta: { equipo: sub.equipo, campus: sub.campus }, texto: sub.texto });
            res.json({
                id: r.id,
                proveedor: r.doc.proveedor,
                similitud: { porcentajeTotal: r.doc.similitud.porcentajeTotal, nivel: r.doc.similitud.nivel },
                calidad: r.doc.revision.calidad,
                correo: { enviados: r.envio.enviados.length, encolados: r.envio.encolados.length }
            });
        } catch (e) {
            if (e.codigo === "POCO_TEXTO") return res.status(422).json({ error: e.message });
            log.error("Revisión de documento falló", { error: e.message });
            res.status(500).json({ error: "No se pudo revisar el documento." });
        }
    });

    // ---------------------------------------------------------
    // Administración
    // ---------------------------------------------------------
    app.get("/api/estado", limiteAdmin, sesion, admin, (req, res) => {
        res.json({
            correo: s.correo.estado(),
            drive: s.vigilante ? s.vigilante.resumen() : { activo: false },
            ia: s.analizador ? s.analizador.proveedores : [],
            revisor: s.revisor ? s.revisor.proveedores : [],
            recordatorios: config.recordatorios.activo
        });
    });

    app.post("/api/analisis/revisar-drive", limiteAdmin, sesion, admin, async (req, res) => {
        if (!s.vigilante) return res.status(503).json({ error: "El vigilante de Drive está apagado (DRIVE_WATCH)." });
        res.json(await s.vigilante.revisar());
    });

    app.post("/api/correo/prueba", limiteAdmin, sesion, admin, async (req, res) => {
        const { correoPrueba } = await import("./services/plantillas.js");
        const para = req.usuario.email || config.analisis.destinatariosFijos[0];
        if (!para) return res.status(400).json({ error: "Tu cuenta no tiene correo." });
        const m = correoPrueba({ urlApp: config.servidor.urlPublica, via: s.correo.disponibles().map((t) => t.nombre).join(", ") });
        res.json(await s.correo.enviar({ para, asunto: m.asunto, html: m.html, texto: m.texto, etiqueta: "prueba" }));
    });

    app.post("/api/correo/reintentar", limiteAdmin, sesion, admin, async (req, res) => {
        res.json(await s.correo.procesarCola({ forzar: true }));
    });

    app.post("/api/recordatorios/ejecutar", limiteAdmin, sesion, admin, async (req, res) => {
        if (!s.recordatorios) return res.status(503).json({ error: "Recordatorios apagados." });
        res.json(await s.recordatorios.ejecutar({ forzar: true }));
    });

    app.use("/api", (req, res) => res.status(404).json({ error: "No existe." }));

    // ---------------------------------------------------------
    // Frontend estático. Nada fuera de public/ es accesible.
    // ---------------------------------------------------------
    app.use(express.static(PUBLICO, {
        dotfiles: "deny",
        index: "index.html",
        setHeaders(res, ruta) {
            if (ruta.endsWith(".html")) res.setHeader("Cache-Control", "no-store");
        }
    }));

    app.use((req, res) => res.status(404).type("text").send("No encontrado."));

    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        if (err.type === "entity.too.large") return res.status(413).json({ error: "Archivo demasiado grande." });
        if (err.type === "entity.parse.failed") return res.status(400).json({ error: "JSON inválido." });
        log.error("Error no controlado", { error: err.message, ruta: req.originalUrl });
        res.status(500).json({ error: "Error interno." });
    });

    return app;
}
