/**
 * Proveedores de IA. Cada uno expone `disponible()` y `analizar(entrada)`.
 * El orquestador (./index.js) los prueba en el orden de IA_PROVEEDORES.
 */

import { PROMPT_SISTEMA, construirMensajeUsuario, extraerJson } from "./prompt.js";
import { analizarHeuristico } from "./heuristico.js";

/**
 * Llamada de bajo nivel a Gemini, compartida por el análisis de código y
 * la revisión de documentos. Recorre `cfg.modelos` en orden: si uno se queda
 * sin cuota (429), no existe para tu key (404) o falla Google (5xx), prueba
 * el siguiente.
 *
 * Con `buscar: true` activa la herramienta google_search (grounding) y
 * devuelve las fuentes web que Gemini consultó. Si el modelo rechaza la
 * herramienta (400), se reintenta ese mismo modelo sin búsqueda.
 *
 * @returns {Promise<{texto: string, modelo: string, fuentes: {titulo, url}[], conBusqueda: boolean}>}
 */
export async function llamarGemini(cfg, { sistema, usuario, buscar = false, timeoutMs }) {
    const errores = [];
    for (const modelo of cfg.modelos) {
        for (const conBusqueda of buscar ? [true, false] : [false]) {
            const cuerpoPeticion = {
                systemInstruction: { parts: [{ text: sistema }] },
                contents: [{ role: "user", parts: [{ text: usuario }] }],
                // Con herramientas no se puede forzar JSON; se pide en el prompt y se extrae.
                generationConfig: conBusqueda
                    ? { temperature: 0.2, maxOutputTokens: 8192 }
                    : { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: "application/json" }
            };
            if (conBusqueda) cuerpoPeticion.tools = [{ google_search: {} }];

            const res = await fetch(`${cfg.url}/models/${encodeURIComponent(modelo)}:generateContent`, {
                method: "POST",
                headers: { "x-goog-api-key": cfg.apiKey, "content-type": "application/json" },
                body: JSON.stringify(cuerpoPeticion),
                signal: AbortSignal.timeout(timeoutMs)
            });
            const cuerpo = await res.text();
            if (res.status === 400 && conBusqueda) { errores.push(`${modelo} sin búsqueda`); continue; }
            if (res.status === 429 || res.status >= 500 || res.status === 404) {
                errores.push(`${modelo} ${res.status}`);
                break;                                   // siguiente modelo
            }
            if (!res.ok) throw new Error(`Gemini ${res.status}: ${cuerpo.slice(0, 300)}`);

            const datos = JSON.parse(cuerpo);
            const cand = datos.candidates?.[0];
            if (!cand?.content?.parts?.length) {
                throw new Error(`Gemini sin contenido (${cand?.finishReason || datos.promptFeedback?.blockReason || "desconocido"})`);
            }
            const fuentes = (cand.groundingMetadata?.groundingChunks || [])
                .map((c) => c.web).filter((w) => w && /^https:\/\//.test(w.uri || ""))
                .map((w) => ({ titulo: String(w.title || w.uri).slice(0, 200), url: w.uri }));
            return {
                texto: cand.content.parts.map((p) => p.text || "").join(""),
                modelo, fuentes, conBusqueda
            };
        }
    }
    throw new Error(`Gemini sin cuota o no disponible: ${errores.join(", ")}`);
}

/** Gemini para análisis de código. Corre en la nube: no usa tu GPU. */
export function crearGemini(cfg, timeoutMs) {
    return {
        nombre: "gemini",
        get modelo() { return this._ultimo || cfg.modelos[0]; },
        disponible: () => !!cfg.apiKey && cfg.modelos.length > 0,
        async analizar(entrada) {
            const r = await llamarGemini(cfg, { sistema: PROMPT_SISTEMA, usuario: construirMensajeUsuario(entrada), timeoutMs });
            this._ultimo = r.modelo;
            return extraerJson(r.texto);
        }
    };
}

export function crearAnthropic(cfg, timeoutMs) {
    return {
        nombre: "anthropic",
        modelo: cfg.modelo,
        disponible: () => !!cfg.apiKey,
        async analizar(entrada) {
            const res = await fetch(cfg.url, {
                method: "POST",
                headers: {
                    "x-api-key": cfg.apiKey,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json"
                },
                body: JSON.stringify({
                    model: cfg.modelo,
                    max_tokens: 4000,
                    system: PROMPT_SISTEMA,
                    messages: [{ role: "user", content: construirMensajeUsuario(entrada) }]
                }),
                signal: AbortSignal.timeout(timeoutMs)
            });
            const cuerpo = await res.text();
            if (!res.ok) throw new Error(`Anthropic ${res.status}: ${cuerpo.slice(0, 300)}`);
            const datos = JSON.parse(cuerpo);
            const texto = (datos.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
            return extraerJson(texto);
        }
    };
}

export function crearOllama(cfg, timeoutMs) {
    let sondeado = null;
    return {
        nombre: "ollama",
        modelo: cfg.modelo,
        // Se sondea una vez por minuto como máximo; si Ollama no está corriendo,
        // no queremos esperar el timeout completo en cada archivo.
        async disponible() {
            if (sondeado && Date.now() - sondeado.cuando < 60000) return sondeado.ok;
            let ok = false;
            try {
                const r = await fetch(`${cfg.url}/api/tags`, { signal: AbortSignal.timeout(3000) });
                ok = r.ok;
            } catch { ok = false; }
            sondeado = { ok, cuando: Date.now() };
            return ok;
        },
        async analizar(entrada) {
            const res = await fetch(`${cfg.url}/api/chat`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    model: cfg.modelo,
                    stream: false,
                    format: "json",
                    options: { temperature: 0.2 },
                    messages: [
                        { role: "system", content: PROMPT_SISTEMA },
                        { role: "user", content: construirMensajeUsuario(entrada) }
                    ]
                }),
                signal: AbortSignal.timeout(timeoutMs)
            });
            const cuerpo = await res.text();
            if (!res.ok) throw new Error(`Ollama ${res.status}: ${cuerpo.slice(0, 300)}`);
            return extraerJson(JSON.parse(cuerpo).message?.content);
        }
    };
}

export function crearHeuristico() {
    return {
        nombre: "heuristico",
        modelo: "reglas-estaticas",
        disponible: () => true,
        analizar: async (entrada) => analizarHeuristico(entrada)
    };
}
