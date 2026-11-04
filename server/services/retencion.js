/**
 * Retención de datos: borra lo que ya no hace falta guardar.
 * ============================================================
 *   - Bitácora de accesos (`accesos`, con IP y navegador): RETENCION_BITACORA_DIAS (90).
 *   - Contadores de bloqueo (`accesos_control`) sin actividad en ese mismo plazo.
 *   - Copias locales de análisis y revisiones (data/analisis, data/revisiones):
 *     RETENCION_COPIAS_DIAS (365).
 * No toca tareas ni chats: son el historial técnico de la misión.
 * Corre al arrancar y luego una vez al día.
 */

import fs from "node:fs";
import path from "node:path";
import { crearLogger } from "../lib/logger.js";

const log = crearLogger("retencion");
const DIA = 86400000;
const LOTE = 400;

/** Borra en lotes los documentos de una consulta. Devuelve cuántos borró. */
async function borrarConsulta(base, consulta) {
    let total = 0;
    for (;;) {
        const snap = await consulta.limit(LOTE).get();
        if (snap.empty) return total;
        const lote = base.batch();
        snap.docs.forEach((d) => lote.delete(d.ref));
        await lote.commit();
        total += snap.size;
        if (snap.size < LOTE) return total;
    }
}

/** Borra archivos de una carpeta con fecha de modificación anterior al corte. */
export function purgarCarpeta(dir, corteMs, ahora = Date.now()) {
    if (!fs.existsSync(dir)) return 0;
    let borrados = 0;
    for (const nombre of fs.readdirSync(dir)) {
        const ruta = path.join(dir, nombre);
        try {
            const st = fs.lstatSync(ruta);
            if (st.isFile() && ahora - st.mtimeMs > corteMs) { fs.unlinkSync(ruta); borrados++; }
        } catch (e) { log.warn(`No se pudo revisar ${nombre}`, { error: e.message }); }
    }
    return borrados;
}

export function crearRetencion({ db, Timestamp, config }) {
    const { bitacoraDias, copiasLocalesDias } = config.retencion;

    async function ejecutar(ahora = Date.now()) {
        const resultado = { accesos: 0, contadores: 0, copias: 0 };
        // 1) Copias locales (no dependen de Firestore).
        for (const sub of ["analisis", "revisiones"]) {
            resultado.copias += purgarCarpeta(path.join(config.datos, sub), copiasLocalesDias * DIA, ahora);
        }
        // 2) Firestore.
        if (db) {
            try {
                const base = db();
                const corte = Timestamp.fromMillis(ahora - bitacoraDias * DIA);
                resultado.accesos = await borrarConsulta(base, base.collection("accesos").where("cuando", "<", corte));
                resultado.contadores = await borrarConsulta(base, base.collection("accesos_control").where("ultimoIntento", "<", corte));
            } catch (e) {
                log.warn("No se pudo purgar la bitácora en Firestore", { error: e.message });
            }
        }
        if (resultado.accesos || resultado.contadores || resultado.copias) {
            log.info(`Retención: ${resultado.accesos} accesos, ${resultado.contadores} contadores y ${resultado.copias} copias locales borrados.`);
        }
        return resultado;
    }

    return { ejecutar };
}
