/**
 * Registro y límite de intentos de abrir el código fuente a mano.
 * ============================================================
 * Versión local de api/bloqueado.js. Tras N intentos en la ventana, la IP
 * queda bloqueada un rato (HTTP 429). Los contadores viven en Firestore
 * (accesos_control) y cada intento en `accesos`; si Firestore no
 * responde, se usa un contador en memoria: la protección no se cae
 * porque se caiga la base.
 *
 * La IP se guarda tal cual en la bitácora; el ID del documento va
 * hasheado para que la ruta no exponga direcciones.
 */

import crypto from "node:crypto";
import { crearLogger } from "../lib/logger.js";

const log = crearLogger("bloqueo");

export const claveDe = (ip) => crypto.createHash("sha256").update(String(ip)).digest("hex").slice(0, 24);

/** Pura: siguiente estado del contador. */
export function siguienteEstado(previo, ahora, { intentosMax, ventanaMs, duracionMs }) {
    if (previo?.bloqueadoHasta && previo.bloqueadoHasta > ahora) {
        return { bloqueado: true, hasta: previo.bloqueadoHasta, intentos: previo.intentos || intentosMax, nuevo: null };
    }
    const dentro = previo?.ventanaInicio && ahora - previo.ventanaInicio < ventanaMs;
    const intentos = dentro ? (previo.intentos || 0) + 1 : 1;
    const seBloquea = intentos >= intentosMax;
    return {
        bloqueado: seBloquea,
        hasta: seBloquea ? ahora + duracionMs : null,
        intentos,
        nuevo: {
            intentos: seBloquea ? 0 : intentos,
            ventanaInicio: dentro && !seBloquea ? previo.ventanaInicio : ahora,
            bloqueadoHasta: seBloquea ? ahora + duracionMs : null
        }
    };
}

export function crearBloqueo({ db, FieldValue, cfg }) {
    const memoria = new Map();

    async function conFirestore(ip, ahora, meta) {
        const base = db();
        const ref = base.collection("accesos_control").doc(claveDe(ip));
        const r = await base.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const sig = siguienteEstado(snap.exists ? snap.data() : null, ahora, cfg);
            if (sig.nuevo) tx.set(ref, { ip, ...sig.nuevo, ultimoIntento: FieldValue.serverTimestamp(), navegador: meta.navegador }, { merge: true });
            return sig;
        });
        await base.collection("accesos").add({
            ip, navegador: meta.navegador, referer: meta.referer, ruta: meta.ruta,
            intentoNumero: r.intentos || null, bloqueado: r.bloqueado,
            cuando: FieldValue.serverTimestamp()
        });
        return r;
    }

    function enMemoria(ip, ahora) {
        const sig = siguienteEstado(memoria.get(ip), ahora, cfg);
        if (sig.nuevo) memoria.set(ip, sig.nuevo);
        if (memoria.size > 5000) memoria.delete(memoria.keys().next().value);
        return sig;
    }

    return async function registrar(ip, meta) {
        const ahora = Date.now();
        try {
            // Si Firestore tarda, no dejamos colgada la respuesta: 4 s y a memoria.
            return await Promise.race([
                conFirestore(ip, ahora, meta),
                new Promise((_, mal) => setTimeout(() => mal(new Error("Firestore no respondió en 4 s")), 4000).unref())
            ]);
        } catch (e) {
            log.warn("Firestore no disponible; contador en memoria", { error: e.message });
            return enMemoria(ip, ahora);
        }
    };
}
