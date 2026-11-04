/**
 * Almacén JSON en disco con escritura atómica.
 * ============================================================
 * Para estado local del servidor (marcas de Drive, cola de correo,
 * contadores de bloqueo cuando no hay Firestore). Escribe a un archivo
 * temporal y luego renombra: si el proceso muere a mitad de escritura,
 * el archivo anterior queda intacto.
 */

import fs from "node:fs";
import path from "node:path";

export class AlmacenJson {
    constructor(ruta, porDefecto = {}) {
        this.ruta = ruta;
        this.porDefecto = porDefecto;
        this.cache = null;
        this.cadena = Promise.resolve();   // serializa escrituras
    }

    leer() {
        if (this.cache) return this.cache;
        try {
            this.cache = JSON.parse(fs.readFileSync(this.ruta, "utf8"));
        } catch (e) {
            if (e.code !== "ENOENT") {
                // Archivo corrupto: se respalda en vez de perderlo.
                try { fs.renameSync(this.ruta, `${this.ruta}.corrupto-${Date.now()}`); } catch { /* nada */ }
            }
            this.cache = structuredClone(this.porDefecto);
        }
        return this.cache;
    }

    /** Aplica `fn(estado)` y persiste. Las llamadas se encolan. */
    actualizar(fn) {
        this.cadena = this.cadena.then(() => {
            const estado = this.leer();
            const resultado = fn(estado);
            this.guardarSync();
            return resultado;
        });
        return this.cadena;
    }

    guardarSync() {
        fs.mkdirSync(path.dirname(this.ruta), { recursive: true, mode: 0o700 });
        const tmp = `${this.ruta}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(this.cache, null, 2), { mode: 0o600 });
        fs.renameSync(tmp, this.ruta);
    }
}
