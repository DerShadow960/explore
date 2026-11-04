/**
 * Planificador de tareas periódicas. Sin dependencias: setTimeout
 * encadenado, para que una vuelta lenta nunca se encime con la siguiente.
 */

import { crearLogger } from "../lib/logger.js";

const log = crearLogger("planificador");

export function crearPlanificador() {
    const timers = new Map();
    let detenido = false;

    return {
        cada(nombre, intervaloMs, fn, primeraEnMs = intervaloMs) {
            const vuelta = async () => {
                if (detenido) return;
                try { await fn(); }
                catch (e) { log.error(`Tarea "${nombre}" falló`, { error: e.message }); }
                if (!detenido) timers.set(nombre, setTimeout(vuelta, intervaloMs));
            };
            timers.set(nombre, setTimeout(vuelta, primeraEnMs));
        },
        detener() {
            detenido = true;
            for (const t of timers.values()) clearTimeout(t);
            timers.clear();
        }
    };
}
