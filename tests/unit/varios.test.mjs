import { test } from "node:test";
import assert from "node:assert/strict";
import { siguienteEstado, claveDe } from "../../server/services/bloqueo.js";
import { agruparPorUsuario } from "../../server/services/recordatorios.js";
import { correoAnalisis } from "../../server/services/plantillas.js";
import { diasEntre, ymd } from "../../server/lib/fechas.js";
import * as D from "../../public/js/dominio.js";

const CFG = { intentosMax: 3, ventanaMs: 600000, duracionMs: 300000 };

test("bloqueo: 3 intentos en la ventana bloquean; al expirar se reinicia", () => {
    let e = null, t = 1_000_000;
    let r = siguienteEstado(e, t, CFG); assert.equal(r.bloqueado, false); e = r.nuevo;
    r = siguienteEstado(e, t + 1000, CFG); assert.equal(r.intentos, 2); e = r.nuevo;
    r = siguienteEstado(e, t + 2000, CFG); assert.equal(r.bloqueado, true); e = r.nuevo;
    r = siguienteEstado(e, t + 60000, CFG); assert.equal(r.bloqueado, true); assert.equal(r.nuevo, null);
    r = siguienteEstado(e, t + 2000 + 300001, CFG); assert.equal(r.bloqueado, false); assert.equal(r.intentos, 1);
    // fuera de ventana el contador vuelve a 1
    r = siguienteEstado({ intentos: 2, ventanaInicio: t }, t + 700000, CFG); assert.equal(r.intentos, 1);
    assert.equal(claveDe("1.2.3.4").length, 24);
    assert.notEqual(claveDe("1.2.3.4"), "1.2.3.4");
});

test("fechas en CDMX", () => {
    assert.equal(diasEntre("2026-10-21", "2026-10-24"), 3);
    assert.equal(diasEntre("2026-12-31", "2027-01-01"), 1);
    // 05:00 UTC del 22 todavía es 21 en CDMX
    assert.equal(ymd(new Date("2026-10-22T05:00:00Z")), "2026-10-21");
});

test("recordatorios: usa equipos[] y campus (no el modelo viejo)", () => {
    const enDias = (n) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(23, 59, 0, 0); return d; };
    const tareas = [
        { titulo: "A", equipo: "Control", campus: "Mixcoac", estado: "En proceso", fechaFin: enDias(3) },
        { titulo: "B", equipo: "Control", campus: "Mixcoac", estado: "Completado", fechaFin: enDias(3) },
        { titulo: "C", equipo: "Telecomunicaciones", campus: "CDUP", estado: "No empezado", fechaFin: enDias(1) },
        { titulo: "D", equipo: "Control", campus: "Mixcoac", estado: "No empezado", fechaFin: enDias(5) }
    ];
    const usuarios = [
        { correo: "c@x", campus: "Mixcoac", equipos: ["Control"] },
        { correo: "t@x", campus: "Mixcoac", equipos: ["Telecomunicaciones"] },   // C es de CDUP: no le toca
        { correo: "g@x", campus: "General", equipos: ["Control", "Telecomunicaciones"] }
    ];
    const { salida } = agruparPorUsuario(usuarios, tareas, ymd(new Date()), [7, 3, 1]);
    const mapa = Object.fromEntries(salida.map((s) => [s.usuario.correo, s.tareas.map((t) => t.titulo)]));
    assert.deepEqual(mapa, { "c@x": ["A"], "g@x": ["C", "A"] });
});

test("el correo de análisis escapa todo lo que viene de la IA", () => {
    const { html, asunto, texto } = correoAnalisis({
        archivo: { name: "x\"><script>.py", webViewLink: "javascript:alert(1)\"" },
        carpeta: { equipo: "Control", campus: "Mixcoac" },
        analisis: {
            proveedor: "anthropic", modelo: "m",
            resultado: {
                resumen: "<img src=x onerror=alert(1)>", lenguajes: ["<b>"], calificacion: 3,
                hallazgos: [{ severidad: "critica", tipo: "seguridad", ubicacion: "<i>", descripcion: "</td><script>", sugerencia: "&" }],
                fortalezas: ["<u>"], siguientes_pasos: []
            }
        },
        urlApp: "http://localhost:8080"
    });
    assert.doesNotMatch(html, /<script>|<img src=x|<b>|<u>|<i>/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(html, /javascript:/, "solo enlaces https");
    assert.match(asunto, /⚠️/);
    assert.match(texto, /Calificación: 3\/10/);
});

test("permisos del dominio (espejo de las reglas)", () => {
    const control = { nombre: "D", campus: "Mixcoac", equipos: ["Control"] };
    const coord = { nombre: "R", campus: "General", equipos: ["Auditoria", "Telecomunicaciones"] };
    assert.equal(D.puedeEntrarACampus(control, "CDUP"), false);
    assert.equal(D.puedeEditar(control, "Control", "Mixcoac"), true);
    assert.equal(D.puedeEditar(control, "Operaciones", "Mixcoac"), false);
    assert.equal(D.puedeEditar(control, "Control", "CDUP"), false, "Control no existe en CDUP");
    assert.equal(D.puedeEditar(coord, "Telecomunicaciones", "CDUP"), true);
    assert.equal(D.esAuditor(coord), true);
    assert.equal(D.perfilValido({ nombre: "x", campus: "Marte", equipos: [] }), false);
});

test("el correo sale aunque Firestore y el directorio fallen", async () => {
    const fs = await import("node:fs"); const os = await import("node:os"); const path = await import("node:path");
    const { ServicioCorreo } = await import("../../server/services/correo/index.js");
    const { crearAnalizador } = await import("../../server/services/ia/index.js");
    const { crearPipelineAnalisis } = await import("../../server/services/analisis.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pakal-pipe-"));
    const correo = new ServicioCorreo({
        from: "a <a@b.c>", orden: [], gmail: {}, resend: {}, smtp: {}, reintentoSeg: 30, maxIntentos: 3, dryRun: true
    }, dir);
    const pipeline = crearPipelineAnalisis({
        analizador: crearAnalizador({ orden: ["heuristico"], maxCaracteres: 1000 }),
        correo,
        directorio: { miembrosDe: async () => { throw new Error("auth caído"); } },
        guardar: async () => { throw new Error("firestore caído"); },
        config: { datos: dir, servidor: { urlPublica: "http://x" }, analisis: { destinatariosFijos: ["rafa@x.mx"], notificarEquipo: true, notificarAutor: false } }
    });
    const r = await pipeline({ archivo: { name: "a.py" }, carpeta: { equipo: "Control", campus: "Mixcoac" }, texto: "print(1)\nx = eval('2')\n" });
    assert.equal(r.envio.enviados.length, 1);
    assert.equal(fs.readdirSync(path.join(dir, "analisis")).length, 1, "copia local del análisis");
});

test("sin PAKAL_DEMO ni PAKAL_PRODUCCION el servidor se niega a arrancar contra Firebase real", async () => {
    const { validar } = await import("../../server/config.js");
    const base = {
        modoDemo: false, produccion: false,
        firebase: { cuentaDeServicio: {}, web: { apiKey: "x", appId: "y" } },
        drive: { activo: false, carpetas: [] },
        ia: { orden: ["heuristico"], gemini: { apiKey: "" } },
        correo: { dryRun: true, gmail: {}, resend: {}, smtp: {} },
        analisis: { destinatariosFijos: ["a@b.c"], notificarEquipo: false },
        servidor: { host: "127.0.0.1" }
    };
    assert.ok(validar(base).errores.some((e) => /Firebase REAL/.test(e)));
    assert.equal(validar({ ...base, produccion: true }).errores.length, 0);
    assert.equal(validar({ ...base, modoDemo: true }).errores.length, 0);
});

test("en demo no se avisa a usuarios sembrados ni corren recordatorios", async () => {
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync(process.execPath, ["-e",
        "import('./server/config.js').then(m=>console.log(JSON.stringify([m.config.analisis.notificarEquipo,m.config.analisis.notificarAutor,m.config.recordatorios.activo])))"],
        { env: { ...process.env, PAKAL_ENV_FILE: "/nonexistent", PAKAL_DEMO: "true" } }).toString();
    assert.deepEqual(JSON.parse(out), [false, false, false]);
});

test("retención: borra bitácora vieja en Firestore y copias locales viejas, no lo reciente", async () => {
    const fs = await import("node:fs"); const os = await import("node:os"); const path = await import("node:path");
    const { crearRetencion } = await import("../../server/services/retencion.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pakal-ret-"));
    fs.mkdirSync(path.join(dir, "analisis"));
    const viejo = path.join(dir, "analisis", "viejo.json"), nuevo = path.join(dir, "analisis", "nuevo.json");
    fs.writeFileSync(viejo, "{}"); fs.writeFileSync(nuevo, "{}");
    const hace400 = (Date.now() - 400 * 86400000) / 1000;
    fs.utimesSync(viejo, hace400, hace400);

    // Firestore falso: colección con documentos y filtro "<" por campo.
    const datos = { accesos: [{ cuando: 1 }, { cuando: 2 }, { cuando: Date.now() }], accesos_control: [{ ultimoIntento: 1 }] };
    const borrados = [];
    const consulta = (col, campo, corte) => ({
        limit: () => ({ get: async () => {
            const docs = datos[col].filter((d) => d[campo] < corte && !d.borrado).map((d) => ({ ref: d }));
            return { empty: !docs.length, size: docs.length, docs };
        } })
    });
    const base = {
        collection: (col) => ({ where: (campo, _op, corte) => consulta(col, campo, corte.ms) }),
        batch: () => { const l = []; return { delete: (r) => l.push(r), commit: async () => l.forEach((r) => { r.borrado = true; borrados.push(r); }) }; }
    };
    const Timestamp = { fromMillis: (ms) => ({ ms }) };
    const r = await crearRetencion({ db: () => base, Timestamp, config: { datos: dir, retencion: { bitacoraDias: 90, copiasLocalesDias: 365 } } }).ejecutar();
    assert.deepEqual(r, { accesos: 2, contadores: 1, copias: 1 });
    assert.equal(fs.existsSync(viejo), false);
    assert.equal(fs.existsSync(nuevo), true);
});

test("página de bloqueo: ya no dice 'sé quién eres' y explica qué se registra", async () => {
    const { paginaMeme } = await import("../../server/pages/bloqueado.js");
    const html = paginaMeme(90);
    assert.doesNotMatch(html, /s[eé] qui[eé]n eres/i);
    assert.match(html, /No sabemos quién eres/);
    assert.match(html, /90 días/);
});

test("xlsx propio: CRC correcto, fechas como fecha y fórmulas neutralizadas", async () => {
    const { _interno: x } = await import("../../public/js/lib/xlsx-mini.js");
    assert.equal(x.crc32(new TextEncoder().encode("123456789")), 0xcbf43926);   // vector estándar de CRC-32
    assert.equal(x.columna(0), "A"); assert.equal(x.columna(26), "AA");
    assert.match(x.celda("A1", "=1+1"), /<t xml:space="preserve">'=1\+1<\/t>/);
    assert.match(x.celda("A1", "<script>"), /&lt;script&gt;/);
    assert.match(x.celda("B2", new Date(2026, 0, 1)), /s="2"><v>46023<\/v>/);
    assert.equal(x.celda("C3", ""), "");
});
