/**
 * Fechas en el navegador.
 * Fecha límite = FINAL del día local (23:59:59): "vence el 1" = tienes todo el día 1.
 * Fecha de inicio = PRINCIPIO del día, para que la barra del Gantt cubra el día.
 * Se parsea "YYYY-MM-DD" a mano: new Date("2026-09-01") lo toma como UTC y en
 * México se corre un día hacia atrás.
 */

import { Timestamp } from "/vendor/firebase/firebase-firestore.js";

export const DIA_MS = 86400000;

export function fechaAInput(ts) {
    if (!ts || typeof ts.toDate !== "function") return "";
    const d = ts.toDate();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function partes(str) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str || "")) return null;
    const [a, m, d] = str.split("-").map(Number);
    return a && m && d ? [a, m, d] : null;
}

export function inputAFechaFin(str) {
    const p = partes(str);
    return p ? Timestamp.fromDate(new Date(p[0], p[1] - 1, p[2], 23, 59, 59)) : null;
}

export function inputAFechaInicio(str) {
    const p = partes(str);
    return p ? Timestamp.fromDate(new Date(p[0], p[1] - 1, p[2], 0, 0, 0)) : null;
}

export const aMedianoche = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

export function diasRestantes(ts) {
    if (!ts || typeof ts.toDate !== "function") return null;
    return Math.round((aMedianoche(ts.toDate()) - aMedianoche(new Date())) / DIA_MS);
}

export function etiquetaVencimiento(tarea) {
    if (tarea.estado === "Completado") return { texto: "", clase: "" };
    const dias = diasRestantes(tarea.fechaFin);
    if (dias === null) return { texto: "Sin fecha", clase: "sin-fecha" };
    if (dias < 0) return { texto: `Vencida hace ${Math.abs(dias)} d`, clase: "vencida" };
    if (dias === 0) return { texto: "Vence hoy", clase: "vencida" };
    if (dias === 1) return { texto: "Mañana", clase: "urgente" };
    if (dias <= 3) return { texto: `En ${dias} días`, clase: "urgente" };
    if (dias <= 7) return { texto: `En ${dias} días`, clase: "proxima" };
    return { texto: `En ${dias} días`, clase: "lejana" };
}

export const fmtCorta = (d) => d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
export const fmtFechaHora = (d) => d.toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
