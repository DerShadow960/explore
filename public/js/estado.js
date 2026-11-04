/**
 * Estado de la sesión en el navegador + registro de suscripciones.
 * Cada módulo guarda sus listeners de Firestore aquí con una clave,
 * y cambiar de vista los cancela sin que nadie tenga que recordarlo.
 */

import * as D from "./dominio.js";

export const estado = {
    usuario: null,        // { uid, email, nombre, campus, equipos, ... }
    campus: null,         // campus que se está viendo
    equipo: null          // área abierta en el workspace
};

const suscripciones = new Map();

export function suscribir(clave, cancelar) {
    cancelarSuscripcion(clave);
    suscripciones.set(clave, cancelar);
}

export function cancelarSuscripcion(clave) {
    const fn = suscripciones.get(clave);
    if (fn) { try { fn(); } catch { /* ya cancelada */ } }
    suscripciones.delete(clave);
}

/** Cancela todo menos las claves indicadas. */
export function cancelarTodas(excepto = []) {
    for (const clave of [...suscripciones.keys()]) {
        if (!excepto.includes(clave)) cancelarSuscripcion(clave);
    }
}

// Atajos de permisos sobre el estado actual.
export const puede = {
    entrarACampus: (campus) => D.puedeEntrarACampus(estado.usuario, campus),
    editar: (equipo, campus = estado.campus) => D.puedeEditar(estado.usuario, equipo, campus),
    verBitacora: () => D.esAuditor(estado.usuario),
    administrar: () => D.esCoordinacion(estado.usuario) || D.esAuditor(estado.usuario),
    exportar: () => D.esCoordinacion(estado.usuario)
};
