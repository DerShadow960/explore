/**
 * Pipeline de revisión de documentos:
 *   texto → similitud contra el corpus → revisión IA (con búsqueda) →
 *   Firestore `revisiones` + copia local → corpus → correo.
 * Mismo criterio que el análisis de código: cada paso tolera fallos y el
 * correo sale aunque Firestore no responda.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { comparar } from "./similitud.js";
import { Corpus, huellaTexto } from "./corpus.js";
import { correoRevision } from "../plantillas.js";
import { normalizarDestinatarios } from "../correo/index.js";
import { conLimite } from "../../lib/tiempo.js";
import { crearLogger } from "../../lib/logger.js";

const log = crearLogger("documentos");
export const MIN_PALABRAS = 40;
// La similitud cuesta (palabras × documentos del corpus). Con un tope, un documento
// enorme no puede bloquear el servidor; ~40 páginas de texto alcanzan para comparar.
export const MAX_CARACTERES_SIMILITUD = 200_000;

export function crearPipelineDocumentos({ revisor, correo, directorio, guardar, config, corpus }) {
    const dir = path.join(config.datos, "revisiones");
    const corp = corpus || new Corpus(config.datos);

    async function destinatarios({ archivo, carpeta, extra }) {
        const lista = [...config.analisis.destinatariosFijos, ...extra];
        if (config.analisis.notificarEquipo && directorio) {
            try { lista.push(...await conLimite(directorio.miembrosDe(carpeta.equipo, carpeta.campus), 10000)); }
            catch (e) { log.warn("Sin miembros del área", { error: e.message }); }
        }
        const autorCorreo = archivo.lastModifyingUser?.emailAddress;
        if (config.analisis.notificarAutor && autorCorreo) lista.push(autorCorreo);
        return normalizarDestinatarios(lista);
    }

    /**
     * @param {{archivo: object, carpeta: {equipo, campus}, texto: string, extraDestinatarios?: string[]}} p
     */
    return async function revisar({ archivo, carpeta, texto, extraDestinatarios = [] }) {
        const palabras = (String(texto).match(/[\p{L}\p{N}]+/gu) || []).length;
        if (palabras < MIN_PALABRAS) {
            const e = new Error(`El documento tiene muy poco texto (${palabras} palabras) para revisarlo.`);
            e.codigo = "POCO_TEXTO";
            throw e;
        }
        const autor = archivo.lastModifyingUser?.displayName || archivo.owners?.[0]?.displayName || null;
        const nuevo = { nombre: String(archivo.name).slice(0, 300), equipo: carpeta.equipo, campus: carpeta.campus };
        const sha = huellaTexto(texto);

        // 1) Similitud interna (siempre, local, instantánea).
        const identico = corp.buscarIdentico(sha);
        const textoComparar = texto.length > MAX_CARACTERES_SIMILITUD ? texto.slice(0, MAX_CARACTERES_SIMILITUD) : texto;
        const similitud = comparar(textoComparar, corp.paraComparar(nuevo, sha));
        if (textoComparar !== texto) similitud.recortado = true;
        if (identico) {
            similitud.yaRevisado = {
                nombre: identico.campus === carpeta.campus ? identico.nombre : `Documento de otro campus (${identico.campus})`,
                fecha: identico.fecha
            };
        }

        // 2) Revisión con IA.
        const ia = await revisor.revisar({ ...nuevo, autor, contenido: texto });

        const doc = {
            archivo: { id: archivo.id || null, nombre: nuevo.nombre, mime: archivo.mimeType || null, url: archivo.webViewLink || null },
            equipo: carpeta.equipo, campus: carpeta.campus, autor,
            proveedor: ia.proveedor, modelo: ia.modelo || null, conBusqueda: !!ia.conBusqueda, truncado: !!ia.truncado,
            similitud, revision: ia.revision
        };

        // 3) Copia local + Firestore.
        const idLocal = crypto.randomUUID();
        try {
            fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
            fs.writeFileSync(path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}_${idLocal}.json`),
                JSON.stringify({ ...doc, creado: new Date().toISOString() }, null, 2), { mode: 0o600 });
        } catch (e) { log.warn("No se pudo guardar la copia local", { error: e.message }); }

        let firestoreId = null;
        if (guardar) {
            try { firestoreId = await conLimite(guardar(doc), 10000, "Firestore no respondió en 10 s"); }
            catch (e) { log.warn("No se pudo guardar la revisión en Firestore", { error: e.message }); }
        }

        // 4) Al corpus (solo huellas), para comparar contra los siguientes.
        try { await corp.agregar({ id: firestoreId || idLocal, ...nuevo, autor, texto: textoComparar }); }
        catch (e) { log.warn("No se pudo agregar al corpus", { error: e.message }); }

        // 5) Correo.
        const para = await destinatarios({ archivo, carpeta, extra: extraDestinatarios });
        if (!para.length) throw new Error("La revisión no tiene destinatarios: configura ANALISIS_DESTINATARIOS.");
        const m = correoRevision({ archivo: { ...archivo, autor }, carpeta, doc, urlApp: config.servidor.urlPublica });
        const envio = await correo.enviar({ para, asunto: m.asunto, html: m.html, texto: m.texto, etiqueta: "revision" });

        log.info(`${nuevo.nombre}: similitud ${similitud.porcentajeTotal}% · ${envio.enviados.length} correo(s), ${envio.encolados.length} en cola.`);
        return { id: firestoreId || idLocal, doc, envio };
    };
}
