/**
 * Utilidades de DOM. Regla de oro: texto de usuario SIEMPRE con
 * textContent (vía `crear`), nunca con innerHTML.
 */

export const $ = (id) => document.getElementById(id);

export const VISTAS = [
    "view-cargando", "view-login", "view-password", "view-campus", "view-denegado",
    "view-hub", "view-workspace", "view-gantt", "view-accesos", "view-analisis", "view-admin"
];

export function mostrarVista(id) {
    VISTAS.forEach((v) => $(v)?.classList.toggle("hidden", v !== id));
    window.scrollTo({ top: 0 });
}

export function alternar(id, visible) {
    $(id)?.classList.toggle("hidden", !visible);
}

/**
 * crear("div", { className: "x", text: "hola", attrs: { title: "t" } }, hijos...)
 */
export function crear(tag, opciones = {}, ...hijos) {
    const el = document.createElement(tag);
    const { className, text, attrs, dataset, on } = opciones;
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = String(text);
    if (attrs) for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? "" : String(v));
    if (dataset) Object.assign(el.dataset, dataset);
    if (on) for (const [evento, fn] of Object.entries(on)) el.addEventListener(evento, fn);
    for (const h of hijos.flat()) if (h !== null && h !== undefined && h !== false) el.append(h instanceof Node ? h : String(h));
    return el;
}

export function vaciar(el) {
    if (typeof el === "string") el = $(el);
    if (el) el.replaceChildren();
    return el;
}

export function mostrarError(id, mensaje) {
    const el = $(id);
    if (!el) return;
    el.textContent = mensaje || "";
    el.classList.toggle("hidden", !mensaje);
}

/** Aviso flotante temporal (sustituye a alert()). */
export function avisar(mensaje, tipo = "info", ms = 5000) {
    const caja = $("avisos");
    if (!caja) return;
    const el = crear("div", { className: `aviso ${tipo}`, text: mensaje, attrs: { role: tipo === "error" ? "alert" : "status" } });
    caja.append(el);
    setTimeout(() => el.remove(), ms);
}
