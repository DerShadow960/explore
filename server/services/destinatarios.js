/**
 * Directorio de usuarios: perfil de Firestore + correo de Firebase Auth.
 * Firestore no guarda correos; salen de Auth con el Admin SDK.
 * Se cachea unos minutos para no listar Auth en cada archivo.
 */

import { crearLogger } from "../lib/logger.js";
import { CAMPUS_COORDINACION } from "../../public/js/dominio.js";

const log = crearLogger("directorio");
const TTL_MS = 5 * 60 * 1000;

export function crearDirectorio({ db, auth }) {
    let cache = null;

    async function cargar() {
        if (cache && Date.now() - cache.cuando < TTL_MS) return cache.usuarios;
        const correos = new Map();
        let pagina = await auth().listUsers(1000);
        for (;;) {
            pagina.users.forEach((u) => { if (u.email && !u.disabled) correos.set(u.uid, u.email); });
            if (!pagina.pageToken) break;
            pagina = await auth().listUsers(1000, pagina.pageToken);
        }
        const usuarios = [];
        (await db().collection("usuarios").get()).forEach((d) => {
            const correo = correos.get(d.id);
            if (correo) usuarios.push({ uid: d.id, correo, ...d.data() });
        });
        cache = { usuarios, cuando: Date.now() };
        return usuarios;
    }

    return {
        cargar,
        invalidar() { cache = null; },

        /** Miembros del equipo en ese campus (más coordinación, que ve todo). */
        async miembrosDe(equipo, campus) {
            try {
                const usuarios = await cargar();
                return usuarios
                    .filter((u) => Array.isArray(u.equipos) && u.equipos.includes(equipo)
                        && (u.campus === campus || u.campus === CAMPUS_COORDINACION))
                    .map((u) => u.correo);
            } catch (e) {
                log.warn("No se pudo leer el directorio de usuarios", { error: e.message });
                return [];
            }
        }
    };
}
