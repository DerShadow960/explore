import { test } from "node:test";
import assert from "node:assert/strict";
import { extraerJson, normalizarResultado, construirMensajeUsuario } from "../../server/services/ia/prompt.js";
import { analizarHeuristico, detectarLenguaje } from "../../server/services/ia/heuristico.js";
import { crearAnalizador } from "../../server/services/ia/index.js";

test("extraerJson tolera cercas y texto alrededor", () => {
    assert.deepEqual(extraerJson('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(extraerJson('Claro, aquí está: {"a":"}{","b":[1,2]} ¡listo!'), { a: "}{", b: [1, 2] });
    assert.throws(() => extraerJson("sin json"), /JSON/);
});

test("normalizarResultado acota, ordena y descarta basura", () => {
    const r = normalizarResultado({
        resumen: "x".repeat(5000),
        calificacion: "42",
        lenguajes: ["Python", 3, null],
        hallazgos: [
            { severidad: "info", descripcion: "menor" },
            { severidad: "CRITICA", tipo: "seguridad", descripcion: "grave" },
            { severidad: "inventada", tipo: "raro", descripcion: "otro" },
            { descripcion: "" },
            "no-objeto"
        ]
    });
    assert.equal(r.calificacion, 10);
    assert.ok(r.resumen.length <= 1200);
    assert.deepEqual(r.lenguajes, ["Python", "3"]);
    assert.equal(r.hallazgos.length, 3);
    assert.equal(r.hallazgos[0].severidad, "critica");
    assert.equal(r.hallazgos.at(-1).tipo, "mantenibilidad");
    assert.deepEqual(normalizarResultado(null).hallazgos, []);
});

test("el contenido va delimitado como datos", () => {
    const m = construirMensajeUsuario({ nombre: "a.py", equipo: "Control", campus: "Mixcoac", contenido: "print(1)" });
    assert.match(m, /<archivo>\nprint\(1\)\n<\/archivo>/);
});

test("heurístico detecta credenciales y delay() en Arduino", () => {
    const ino = `const char* password = "superSecreto123";\nvoid setup(){ Serial.begin(9600); }\nvoid loop(){\n  delay(1000);\n}`;
    const r = analizarHeuristico({ nombre: "rotor.ino", contenido: ino });
    assert.ok(r.hallazgos.some((h) => h.severidad === "critica" && h.tipo === "seguridad" && h.ubicacion === "línea 1"));
    assert.ok(r.hallazgos.some((h) => h.tipo === "hardware" && /delay/.test(h.descripcion)));
    assert.ok(r.calificacion < 6);
    assert.deepEqual(r.lenguajes, ["Arduino (C++)"]);
});

test("heurístico: Python con except desnudo y eval", () => {
    const py = "import serial\ntry:\n    x = eval(input())\nexcept:\n    pass\n";
    const r = analizarHeuristico({ nombre: "a.py", contenido: py });
    assert.ok(r.hallazgos.some((h) => /eval/.test(h.descripcion)));
    assert.ok(r.hallazgos.some((h) => /except sin tipo/.test(h.descripcion)));
});

test("detecta lenguaje por contenido en documentos", () => {
    assert.equal(detectarLenguaje("notas", "void setup() {}\nvoid loop() {}"), "Arduino (C++)");
    assert.equal(detectarLenguaje("doc", "import numpy as np\n"), "Python");
});

test("si la IA falla, el heurístico responde (nunca se queda sin análisis)", async () => {
    const roto = { nombre: "anthropic", modelo: "m", disponible: async () => true, analizar: async () => { throw new Error("429"); } };
    const apagado = { nombre: "ollama", modelo: "m", disponible: async () => false, analizar: async () => ({}) };
    const a = crearAnalizador({ maxCaracteres: 1000 }, { proveedores: [roto, apagado] });
    const r = await a.analizar({ nombre: "x.py", contenido: "def f():\n    return 1\n" });
    assert.equal(r.proveedor, "heuristico");
    assert.equal(r.intentos.length, 2);
    assert.match(r.intentos[0], /429/);
});

test("usa la respuesta de la IA cuando funciona y recorta archivos enormes", async () => {
    let visto = null;
    const ia = {
        nombre: "anthropic", modelo: "m", disponible: () => true,
        analizar: async (e) => { visto = e; return { resumen: "ok", calificacion: 8, hallazgos: [] }; }
    };
    const a = crearAnalizador({ maxCaracteres: 10 }, { proveedores: [ia] });
    const r = await a.analizar({ nombre: "x.py", contenido: "a".repeat(50) });
    assert.equal(r.proveedor, "anthropic");
    assert.equal(r.resultado.calificacion, 8);
    assert.equal(visto.contenido.length, 10);
    assert.equal(r.truncado, true);
});

// ---------- Gemini contra un servidor falso local ----------
import http from "node:http";
import { crearGemini } from "../../server/services/ia/proveedores.js";

async function servidorGemini(respuestas) {
    const vistas = [];
    const srv = http.createServer((req, res) => {
        let cuerpo = "";
        req.on("data", (c) => { cuerpo += c; });
        req.on("end", () => {
            const modelo = decodeURIComponent(req.url.match(/models\/(.+):generateContent/)[1]);
            vistas.push({ modelo, key: req.headers["x-goog-api-key"], body: JSON.parse(cuerpo) });
            const [status, json] = respuestas[modelo] || [404, { error: "no" }];
            res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(json));
        });
    });
    await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
    return { url: `http://127.0.0.1:${srv.address().port}/v1beta`, vistas, cerrar: () => new Promise((ok) => srv.close(ok)) };
}
const respuestaOk = (obj) => [200, { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: "STOP" }] }];

test("Gemini: manda prompt, key en cabecera y pide JSON", async () => {
    const s = await servidorGemini({ "gemini-3.8-flash": respuestaOk({ resumen: "bien", calificacion: 9, hallazgos: [] }) });
    try {
        const g = crearGemini({ apiKey: "k-123", modelos: ["gemini-3.8-flash"], url: s.url }, 5000);
        const r = await g.analizar({ nombre: "a.py", equipo: "Control", campus: "Mixcoac", contenido: "print(1)" });
        assert.equal(r.calificacion, 9);
        const v = s.vistas[0];
        assert.equal(v.key, "k-123");
        assert.equal(v.body.generationConfig.responseMimeType, "application/json");
        assert.match(v.body.contents[0].parts[0].text, /<archivo>\nprint\(1\)/);
        assert.match(v.body.systemInstruction.parts[0].text, /PAKAL/);
    } finally { await s.cerrar(); }
});

test("Gemini: si el primer modelo no tiene cuota (429) usa el siguiente", async () => {
    const s = await servidorGemini({
        "gemini-3.8-flash": [429, { error: { status: "RESOURCE_EXHAUSTED" } }],
        "gemini-3.5-flash-lite": respuestaOk({ resumen: "lite", calificacion: 7, hallazgos: [] })
    });
    try {
        const g = crearGemini({ apiKey: "k", modelos: ["gemini-3.8-flash", "gemini-3.5-flash-lite"], url: s.url }, 5000);
        const r = await g.analizar({ nombre: "a.py", contenido: "x" });
        assert.equal(r.resumen, "lite");
        assert.equal(g.modelo, "gemini-3.5-flash-lite");
    } finally { await s.cerrar(); }
});

test("Gemini sin cuota en todos → el orquestador cae al heurístico", async () => {
    const s = await servidorGemini({ "gemini-3.8-flash": [429, {}] });
    try {
        const a = crearAnalizador({ maxCaracteres: 1000 }, {
            proveedores: [crearGemini({ apiKey: "k", modelos: ["gemini-3.8-flash"], url: s.url }, 5000)]
        });
        const r = await a.analizar({ nombre: "x.py", contenido: "x = eval('1')\n" });
        assert.equal(r.proveedor, "heuristico");
        assert.match(r.intentos[0], /sin cuota/);
    } finally { await s.cerrar(); }
});

test("Gemini sin API key no se intenta", () => {
    assert.equal(crearGemini({ apiKey: "", modelos: ["m"] }, 1000).disponible(), false);
});

// ---------- Minimización de datos personales ----------
import { redactarDatosPersonales } from "../../server/lib/privacidad.js";

test("privacidad: quita correos, teléfonos y CURP, pero no números de código", () => {
    const r = redactarDatosPersonales("mail rafa@up.edu.mx tel 55 1234 5678 curp LEGR060208HDFVMF09; freq = 137600000; delay(1000);");
    assert.doesNotMatch(r.texto, /rafa@|1234 5678|LEGR06/);
    assert.match(r.texto, /137600000/);
    assert.match(r.texto, /delay\(1000\)/);
    assert.equal(r.quitados, 3);
});

test("a la IA en la nube no llega el autor ni el correo; el heurístico local sí ve el original", async () => {
    let enviado = null;
    const nube = { nombre: "gemini", modelo: "m", disponible: () => true,
        analizar: async (e) => { enviado = e; return { resumen: "ok", calificacion: 7, hallazgos: [] }; } };
    const a = crearAnalizador({ maxCaracteres: 5000 }, { proveedores: [nube] });
    await a.analizar({ nombre: "x.py", autor: "Diego López", contenido: "# contacto: diego@up.edu.mx\nprint(1)" });
    assert.equal(enviado.autor, undefined);
    assert.doesNotMatch(enviado.contenido, /diego@up\.edu\.mx/);
    const { construirMensajeUsuario } = await import("../../server/services/ia/prompt.js");
    assert.doesNotMatch(construirMensajeUsuario({ ...enviado, autor: "Diego López" }), /Diego/);
});
