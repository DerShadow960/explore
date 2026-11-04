/**
 * Pipeline de análisis: archivo → IA → Firestore + copia local → correo.
 * ============================================================
 * Lo usan el vigilante de Drive, el endpoint de análisis manual y el
 * script `npm run analizar`. Cada paso es tolerante a fallos:
 *   - Si la IA falla, el heurístico responde.
 *   - Si Firestore falla, queda la copia local en data/analisis/.
 *   - Si el correo falla, queda en la cola y se reintenta.
 * Lo único que hace fallar el pipeline es no tener a quién mandarlo.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { correoAnalisis } from "./plantillas.js";
import { normalizarDestinatarios } from "./correo/index.js";
import { crearLogger } from "../lib/logger.js";
import { conLimite } from "../lib/tiempo.js";

const log = crearLogger("analisis");

/**
 * @param {object} deps
 * @param {object} deps.analizador     crearAnalizador(...)
 * @param {object} deps.correo         ServicioCorreo
 * @param {object} [deps.directorio]   crearDirectorio(...)
 * @param {Function} [deps.guardar]    async (doc) => id   (Firestore)
 * @param {object} deps.config         config completa
 */
export function crearPipelineAnalisis({ analizador, correo, directorio, guardar, config }) {
    const dir = path.join(config.datos, "analisis");

    async function destinatarios({ carpeta, autorCorreo, extra = [] }) {
        const lista = [...config.analisis.destinatariosFijos, ...extra];
        if (config.analisis.notificarEquipo && directorio) {
            try {
                lista.push(...await conLimite(directorio.miembrosDe(carpeta.equipo, carpeta.campus), 10000, "Directorio sin respuesta"));
            } catch (e) { log.warn("Sin miembros del área; se manda a los fijos y al autor", { error: e.message }); }
        }
        if (config.analisis.notificarAutor && autorCorreo) lista.push(autorCorreo);
        return normalizarDestinatarios(lista);
    }

    /**
     * @param {{archivo: object, carpeta: {campus, equipo}, texto: string, extraDestinatarios?: string[]}} p
     */
    return async function procesar({ archivo, carpeta, texto, extraDestinatarios = [] }) {
        const autor = archivo.lastModifyingUser?.displayName || archivo.owners?.[0]?.displayName || null;
        const autorCorreo = archivo.lastModifyingUser?.emailAddress || null;

        const analisis = await analizador.analizar({
            nombre: archivo.name, equipo: carpeta.equipo, campus: carpeta.campus, autor, contenido: texto
        });

        const doc = {
            archivo: {
                id: archivo.id || null,
                nombre: String(archivo.name).slice(0, 300),
                mime: archivo.mimeType || null,
                url: archivo.webViewLink || null,
                modificado: archivo.modifiedTime || null
            },
            equipo: carpeta.equipo,
            campus: carpeta.campus,
            autor,
            proveedor: analisis.proveedor,
            modelo: analisis.modelo || null,
            truncado: !!analisis.truncado,
            resultado: analisis.resultado
        };

        // 1) Copia local (siempre, es la evidencia para mostrar avances).
        const idLocal = crypto.randomUUID();
        try {
            fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
            fs.writeFileSync(path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}_${idLocal}.json`),
                JSON.stringify({ ...doc, creado: new Date().toISOString() }, null, 2), { mode: 0o600 });
        } catch (e) { log.warn("No se pudo guardar la copia local", { error: e.message }); }

        // 2) Firestore, para que se vea en la app.
        let firestoreId = null;
        if (guardar) {
            try { firestoreId = await conLimite(guardar(doc), 10000, "Firestore no respondió en 10 s"); }
            catch (e) { log.warn("No se pudo guardar el análisis en Firestore", { error: e.message }); }
        }

        // 3) Correo.
        const para = await destinatarios({ carpeta, autorCorreo, extra: extraDestinatarios });
        if (!para.length) {
            throw new Error("El análisis no tiene destinatarios: configura ANALISIS_DESTINATARIOS.");
        }
        const { asunto, html, texto: textoPlano } = correoAnalisis({
            archivo: { ...archivo, autor }, carpeta, analisis, urlApp: config.servidor.urlPublica
        });
        const envio = await correo.enviar({ para, asunto, html, texto: textoPlano, etiqueta: "analisis" });

        log.info(`${archivo.name}: ${envio.enviados.length} enviado(s), ${envio.encolados.length} en cola.`);
        return { id: firestoreId || idLocal, doc, envio };
    };
}
