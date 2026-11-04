/**
 * Cronograma (Gantt) por campus.
 * Una sola consulta (campus == X) trae todas las áreas: las reglas
 * permiten leer todo el campus.
 *
 * Paleta validada para daltonismo: rojo/verde se confunden en
 * deuteranopia, así que Completado va en cian y Vencida en rosa-rojo.
 * Cada barra lleva además su estado por escrito (tooltip y tabla).
 */

import { collection, query, where, onSnapshot } from "/vendor/firebase/firebase-firestore.js";
import { db } from "../firebase.js";
import { estado, puede, suscribir } from "../estado.js";
import { $, crear, vaciar, mostrarVista, alternar, mostrarError } from "../ui/dom.js";
import { registrar } from "../ui/acciones.js";
import { tituloEquipo } from "../dominio.js";
import { DIA_MS, aMedianoche, diasRestantes, fechaAInput, inputAFechaFin, inputAFechaInicio, fmtCorta } from "../lib/fechas.js";
import { actualizar } from "./tareas.js";
import { exportarTareas } from "./exportar.js";

export const COLOR_ESTADO = {
    "No empezado": "#78829c",
    "En proceso": "#b8862c",
    "Completado": "#2f9cb5",
    "Vencida": "#dd5680"
};
const ZOOMS = { dia: 26, semana: 9, mes: 3.4 };
const ANCHO_ETIQUETA = 220;

let zoom = "semana";
let tareas = [];
let vistaTabla = false;
let tareaEditando = null;

export function estadoVisual(t) {
    if (t.estado === "Completado") return "Completado";
    const d = diasRestantes(t.fechaFin);
    return d !== null && d < 0 ? "Vencida" : t.estado;
}

function abrir() {
    mostrarVista("view-gantt");
    $("gantt-campus").textContent = estado.campus;
    alternar("btn-exportar", puede.exportar());
    const q = query(collection(db, "tareas"), where("campus", "==", estado.campus));
    suscribir("gantt", onSnapshot(q, (snap) => {
        tareas = [];
        snap.forEach((d) => tareas.push({ id: d.id, ...d.data() }));
        dibujar();
    }, (err) => {
        console.error("Gantt:", err);
        $("gantt-cuerpo").textContent = "No se pudieron cargar las tareas.";
    }));
}

function cambiarZoom(el) {
    zoom = el.dataset.nivel;
    ["dia", "semana", "mes"].forEach((z) => $("zoom-" + z).classList.toggle("activa", z === zoom));
    dibujar();
}

function alternarTabla() {
    vistaTabla = !vistaTabla;
    $("btn-tabla").textContent = vistaTabla ? "📊 Ver cronograma" : "▦ Ver como tabla";
    dibujar();
}

function dibujar() {
    const cuerpo = vaciar("gantt-cuerpo");
    const conFecha = tareas.filter((t) => t.fechaFin);
    if (!conFecha.length) {
        cuerpo.append(crear("p", { className: "tenue", text: "No hay tareas con fecha límite en este campus. Ponles fecha desde su área y aparecerán aquí." }));
        return;
    }
    if (vistaTabla) return dibujarTabla(cuerpo, conFecha);

    const hoy = aMedianoche(new Date());
    let min = hoy, max = hoy;
    for (const t of conFecha) {
        const fin = aMedianoche(t.fechaFin.toDate());
        const ini = t.fechaInicio ? aMedianoche(t.fechaInicio.toDate()) : fin;
        if (ini < min) min = ini;
        if (fin > max) max = fin;
    }
    min = new Date(min.getTime() - 3 * DIA_MS);
    max = new Date(max.getTime() + 3 * DIA_MS);

    const pxDia = ZOOMS[zoom];
    const totalDias = Math.round((max - min) / DIA_MS) + 1;
    const ancho = ANCHO_ETIQUETA + totalDias * pxDia;
    const xDe = (f) => ANCHO_ETIQUETA + ((aMedianoche(f) - min) / DIA_MS) * pxDia;

    const lienzo = crear("div", { className: "gantt-lienzo" });
    lienzo.style.width = ancho + "px";
    lienzo.style.minWidth = "100%";
    lienzo.append(encabezado(min, totalDias, pxDia));

    const hoyX = xDe(hoy);
    const linea = crear("div", { className: "gantt-hoy", attrs: { title: "Hoy" } });
    linea.style.left = hoyX + "px";
    lienzo.append(linea);

    const porEquipo = {};
    conFecha.forEach((t) => { (porEquipo[t.equipo] ||= []).push(t); });
    for (const equipo of Object.keys(porEquipo).sort()) {
        const editable = puede.editar(equipo);
        lienzo.append(crear("div", { className: "gantt-grupo", text: tituloEquipo(equipo) + (editable ? "" : "  · solo lectura") }));
        porEquipo[equipo]
            .sort((a, b) => a.fechaFin.toMillis() - b.fechaFin.toMillis())
            .forEach((t) => lienzo.append(fila(t, xDe, pxDia, editable)));
    }

    const scroll = crear("div", { className: "gantt-scroll" }, lienzo);
    cuerpo.append(scroll);
    scroll.scrollLeft = Math.max(0, hoyX - scroll.clientWidth / 3);
}

function encabezado(min, totalDias, pxDia) {
    const meses = crear("div", { className: "gantt-meses" });
    const hueco = crear("div");
    hueco.style.flex = `0 0 ${ANCHO_ETIQUETA}px`;
    meses.append(hueco);
    const dias = crear("div", { className: "gantt-dias" });

    let inicioBanda = 0;
    for (let i = 0; i <= totalDias; i++) {
        const fecha = i < totalDias ? new Date(min.getTime() + i * DIA_MS) : null;
        const anterior = new Date(min.getTime() + inicioBanda * DIA_MS);
        const cambiaMes = !fecha || fecha.getMonth() !== anterior.getMonth() || fecha.getFullYear() !== anterior.getFullYear();
        if (cambiaMes && i > inicioBanda) {
            const nom = anterior.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
            const banda = crear("div", { className: "gantt-mes", text: nom.charAt(0).toUpperCase() + nom.slice(1) });
            banda.style.width = ((i - inicioBanda) * pxDia) + "px";
            meses.append(banda);
            inicioBanda = i;
        }
        if (!fecha) break;
        const esLunes = fecha.getDay() === 1;
        if (pxDia >= 18 || (pxDia >= 6 && esLunes)) {
            const marca = crear("div", {
                className: "gantt-dia" + (esLunes ? " lunes" : ""),
                text: pxDia >= 18 ? fecha.getDate() : `${fecha.getDate()}/${fecha.getMonth() + 1}`
            });
            marca.style.left = (ANCHO_ETIQUETA + i * pxDia) + "px";
            marca.style.width = (pxDia >= 18 ? pxDia : pxDia * 7) + "px";
            dias.append(marca);
        }
    }
    return crear("div", { className: "gantt-cabecera" }, meses, dias);
}

function fila(t, xDe, pxDia, editable) {
    const estadoV = estadoVisual(t);
    const color = COLOR_ESTADO[estadoV] || COLOR_ESTADO["No empezado"];
    const fin = t.fechaFin.toDate();
    let marca;
    if (t.fechaInicio) {
        marca = crear("div", { className: "gantt-barra" });
        const x0 = xDe(t.fechaInicio.toDate());
        const x1 = xDe(fin) + pxDia;
        marca.style.left = x0 + "px";
        marca.style.width = Math.max(x1 - x0, 6) + "px";
    } else {
        marca = crear("div", { className: "gantt-hito" });
        marca.style.left = (xDe(fin) + pxDia / 2 - 7) + "px";
    }
    marca.style.background = color;
    if (!editable) marca.classList.add("gantt-bloqueada");
    marca.setAttribute("role", "button");
    marca.setAttribute("tabindex", "0");
    marca.setAttribute("aria-label", `${t.titulo}: ${estadoV}`);

    const textoFechas = t.fechaInicio ? `${fmtCorta(t.fechaInicio.toDate())} → ${fmtCorta(fin)}` : `Entrega ${fmtCorta(fin)}`;
    marca.addEventListener("mouseenter", (e) => mostrarTooltip(e, t, estadoV, textoFechas));
    marca.addEventListener("mousemove", moverTooltip);
    marca.addEventListener("mouseleave", ocultarTooltip);
    marca.addEventListener("click", () => abrirEdicion(t, editable));
    marca.addEventListener("keydown", (e) => { if (e.key === "Enter") abrirEdicion(t, editable); });

    return crear("div", { className: "gantt-fila" },
        crear("div", { className: "gantt-etiqueta", text: t.titulo, attrs: { title: t.titulo } }), marca);
}

function mostrarTooltip(e, t, estadoV, textoFechas) {
    const tip = vaciar("gantt-tooltip");
    tip.append(
        crear("div", { className: "tt-titulo", text: t.titulo }),
        ...[["Área", tituloEquipo(t.equipo)], ["Responsable", t.responsable], ["Estado", estadoV], ["Fechas", textoFechas]]
            .map(([k, v]) => crear("div", { className: "tt-linea", text: `${k}: ${v}` })));
    tip.classList.remove("hidden");
    moverTooltip(e);
}
function moverTooltip(e) {
    const tip = $("gantt-tooltip");
    tip.style.left = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 12) + "px";
    tip.style.top = Math.min(e.clientY + 14, window.innerHeight - tip.offsetHeight - 12) + "px";
}
function ocultarTooltip() { $("gantt-tooltip").classList.add("hidden"); }

function abrirEdicion(t, editable) {
    ocultarTooltip();
    tareaEditando = t;
    $("ge-titulo").textContent = t.titulo;
    $("ge-meta").textContent = `${tituloEquipo(t.equipo)} · ${t.responsable}`;
    $("ge-inicio").value = fechaAInput(t.fechaInicio);
    $("ge-fin").value = fechaAInput(t.fechaFin);
    $("ge-estado").value = t.estado;
    ["ge-inicio", "ge-fin", "ge-estado"].forEach((id) => { $(id).disabled = !editable; });
    alternar("ge-guardar", editable);
    alternar("ge-aviso", !editable);
    mostrarError("ge-error", "");
    alternar("gantt-edicion", true);
}

function cerrarEdicion() {
    tareaEditando = null;
    alternar("gantt-edicion", false);
}

async function guardarEdicion() {
    const t = tareaEditando;
    if (!t || !puede.editar(t.equipo)) return;
    const ini = $("ge-inicio").value, fin = $("ge-fin").value;
    if (ini && fin && ini > fin) return mostrarError("ge-error", "El inicio no puede ser posterior al límite.");
    const ok = await actualizar(t, {
        fechaInicio: inputAFechaInicio(ini),
        fechaFin: inputAFechaFin(fin),
        estado: $("ge-estado").value
    });
    if (ok) cerrarEdicion();
    else mostrarError("ge-error", "No tienes permiso para modificar esta tarea.");
}

function dibujarTabla(cuerpo, lista) {
    const tbody = crear("tbody");
    lista.slice().sort((a, b) => a.fechaFin.toMillis() - b.fechaFin.toMillis()).forEach((t) => {
        const estadoV = estadoVisual(t);
        const punto = crear("span", { className: "punto-estado" });
        punto.style.background = COLOR_ESTADO[estadoV];
        tbody.append(crear("tr", {},
            crear("td", { text: t.titulo }),
            crear("td", { text: tituloEquipo(t.equipo) }),
            crear("td", { text: t.responsable }),
            crear("td", { text: t.fechaInicio ? fmtCorta(t.fechaInicio.toDate()) : "—" }),
            crear("td", { text: fmtCorta(t.fechaFin.toDate()) }),
            crear("td", {}, punto, estadoV)));
    });
    const thead = crear("thead", {}, crear("tr", {},
        ...["Tarea", "Área", "Responsable", "Inicio", "Límite", "Estado"].map((h) => crear("th", { text: h }))));
    cuerpo.append(crear("table", { className: "gantt-tabla" }, thead, tbody));
}

export function iniciarGantt() {
    registrar({
        "abrir-gantt": abrir,
        "zoom-gantt": cambiarZoom,
        "alternar-tabla": alternarTabla,
        "cerrar-gantt-edicion": cerrarEdicion,
        "guardar-gantt": guardarEdicion,
        "exportar-xlsx": () => exportarTareas(tareas, estadoVisual)
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !$("gantt-edicion").classList.contains("hidden")) cerrarEdicion();
    });
}
