/**
 * Corpus local de documentos revisados (data/corpus.json).
 * ============================================================
 * Solo se guardan las HUELLAS (números) de cada documento, nunca el texto:
 * con eso basta para comparar y no queda una copia legible de los
 * trabajos de nadie en disco.
 *
 * Reglas al comparar un documento nuevo:
 *   - Mismo texto exacto ya revisado → se avisa y no se duplica.
 *   - Versiones anteriores del MISMO archivo (mismo nombre y área) se
 *     muestran aparte y no cuentan para el porcentaje: corregir tu propio
 *     reporte no es copiar.
 *   - Documentos de OTRO campus se comparan, pero su nombre se oculta,
 *     porque el campus es frontera de lectura.
 */

import path from "node:path";
import crypto from "node:crypto";
import { AlmacenJson } from "../../lib/almacen.js";
import { firmaDe } from "./similitud.js";

const MAX_DOCUMENTOS = 1000;

export const huellaTexto = (texto) =>
    crypto.createHash("sha256").update(String(texto).replace(/\s+/g, " ").trim().toLowerCase()).digest("hex");

const nombreBase = (n) => String(n || "").toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[\s_-]*(v\d+|final|corregido|\(\d+\))$/g, "").trim();

export class Corpus {
    constructor(dirDatos) {
        this.almacen = new AlmacenJson(path.join(dirDatos, "corpus.json"), { documentos: [] });
    }

    get documentos() { return this.almacen.leer().documentos; }

    /** Busca un documento con exactamente el mismo texto. */
    buscarIdentico(sha) {
        return this.documentos.find((d) => d.sha === sha) || null;
    }

    /**
     * Prepara el corpus para comparar contra un documento nuevo.
     * @param {{nombre, equipo, campus}} nuevo
     */
    paraComparar(nuevo, shaNuevo) {
        const base = nombreBase(nuevo.nombre);
        return this.documentos
            .filter((d) => d.sha !== shaNuevo)
            .map((d) => {
                const otroCampus = d.campus !== nuevo.campus;
                return {
                    ...d,
                    nombre: otroCampus ? `Documento de otro campus (${d.campus})` : d.nombre,
                    esVersionPropia: !otroCampus && d.equipo === nuevo.equipo && nombreBase(d.nombre) === base
                };
            });
    }

    /** Agrega el documento ya revisado. */
    agregar({ id, nombre, equipo, campus, autor, texto }) {
        const sha = huellaTexto(texto);
        const { palabras, hashes } = firmaDe(texto);
        return this.almacen.actualizar((e) => {
            if (e.documentos.some((d) => d.sha === sha)) return;
            e.documentos.push({ id, nombre, equipo, campus, autor: autor || null, fecha: new Date().toISOString(), sha, palabras, hashes });
            if (e.documentos.length > MAX_DOCUMENTOS) e.documentos.splice(0, e.documentos.length - MAX_DOCUMENTOS);
        });
    }
}
