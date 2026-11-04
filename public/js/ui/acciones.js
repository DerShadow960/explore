/**
 * Delegación de eventos.
 * ============================================================
 * El HTML no tiene onclick (la CSP los bloquearía). En su lugar:
 *   data-accion="nombre"   → click (y Enter/Espacio si es role="button")
 *   data-enviar="nombre"   → submit de un <form>
 * Cada módulo registra sus manejadores con `registrar({...})`.
 * Nada se cuelga de `window`: desde la consola no hay funciones
 * globales que llamar.
 */

const acciones = new Map();

export function registrar(mapa) {
    for (const [nombre, fn] of Object.entries(mapa)) {
        if (acciones.has(nombre)) console.warn(`Acción duplicada: ${nombre}`);
        acciones.set(nombre, fn);
    }
}

async function ejecutar(nombre, el, evento) {
    const fn = acciones.get(nombre);
    if (!fn) { console.warn(`Acción sin manejador: ${nombre}`); return; }
    try { await fn(el, evento); }
    catch (e) { console.error(`Acción ${nombre}:`, e); }
}

export function iniciarAcciones(raiz = document) {
    raiz.addEventListener("click", (e) => {
        const el = e.target.closest("[data-accion]");
        if (!el || el.disabled) return;
        e.preventDefault();
        ejecutar(el.dataset.accion, el, e);
    });

    raiz.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const el = e.target.closest('[data-accion][role="button"]');
        if (!el || e.target !== el) return;
        e.preventDefault();
        ejecutar(el.dataset.accion, el, e);
    });

    raiz.addEventListener("submit", (e) => {
        const form = e.target.closest("form[data-enviar]");
        if (!form) return;
        e.preventDefault();
        ejecutar(form.dataset.enviar, form, e);
    });
}
