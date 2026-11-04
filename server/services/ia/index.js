/**
 * Orquestador de análisis: prueba proveedores en orden y SIEMPRE
 * devuelve un resultado (el heurístico nunca falla).
 */

import { crearGemini, crearAnthropic, crearOllama, crearHeuristico } from "./proveedores.js";
import { normalizarResultado } from "./prompt.js";
import { crearLogger } from "../../lib/logger.js";
import { redactarDatosPersonales } from "../../lib/privacidad.js";

const log = crearLogger("ia");

export function crearAnalizador(cfgIa, { proveedores } = {}) {
    const fabricas = {
        gemini: () => crearGemini(cfgIa.gemini, cfgIa.timeoutMs),
        anthropic: () => crearAnthropic(cfgIa.anthropic, cfgIa.timeoutMs),
        ollama: () => crearOllama(cfgIa.ollama, cfgIa.timeoutMs),
        heuristico: () => crearHeuristico()
    };
    const lista = proveedores || cfgIa.orden.map((n) => fabricas[n]?.()).filter(Boolean);
    // El heurístico va al final aunque no lo pidan: es la red de seguridad.
    if (!lista.some((p) => p.nombre === "heuristico")) lista.push(crearHeuristico());

    return {
        proveedores: lista.map((p) => p.nombre),

        /**
         * @param {{nombre, equipo, campus, autor, contenido}} entrada
         * @returns {Promise<{resultado, proveedor, modelo, intentos}>}
         */
        async analizar(entrada) {
            let contenido = String(entrada.contenido || "");
            const truncado = contenido.length > cfgIa.maxCaracteres;
            if (truncado) contenido = contenido.slice(0, cfgIa.maxCaracteres);
            const datos = { ...entrada, contenido, truncado };
            // A los proveedores en la nube va el texto sin datos personales; el heurístico (local) ve el original.
            const limpio = redactarDatosPersonales(contenido);
            const datosNube = { ...datos, autor: undefined, contenido: limpio.texto };

            const intentos = [];
            for (const p of lista) {
                try {
                    if (!(await p.disponible())) { intentos.push(`${p.nombre}: no disponible`); continue; }
                    const inicio = Date.now();
                    const bruto = await p.analizar(p.nombre === "heuristico" ? datos : datosNube);
                    const resultado = normalizarResultado(bruto);
                    log.info(`${entrada.nombre} analizado con ${p.nombre} en ${Date.now() - inicio} ms`);
                    return { resultado, proveedor: p.nombre, modelo: p.modelo, intentos, truncado };
                } catch (e) {
                    log.warn(`Proveedor ${p.nombre} falló con ${entrada.nombre}`, { error: e.message });
                    intentos.push(`${p.nombre}: ${e.message}`.slice(0, 300));
                }
            }
            // Inalcanzable salvo bug en el heurístico; aun así no rompemos.
            return {
                resultado: normalizarResultado({ resumen: "No se pudo analizar el archivo.", hallazgos: [] }),
                proveedor: "ninguno", modelo: null, intentos, truncado
            };
        }
    };
}
