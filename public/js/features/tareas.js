/**
 * Tareas del área (workspace).
 */

import {
    collection, doc, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, serverTimestamp
} from "/vendor/firebase/firebase-firestore.js";
import { db } from "../firebase.js";
import { estado, puede, suscribir } from "../estado.js";
import { $, crear, vaciar, alternar, mostrarError, avisar } from "../ui/dom.js";
import { registrar } from "../ui/acciones.js";
import { ESTADOS, LIMITES } from "../dominio.js";
import { fechaAInput, inputAFechaFin, inputAFechaInicio, etiquetaVencimiento } from "../lib/fechas.js";

const ICONO_ESTADO = { "No empezado": "⚪", "En proceso": "⏳", "Completado": "✅" };
const COLOR_BORDE = { "Completado": "var(--status-done)", "En proceso": "var(--status-process)" };

export function cargarTareas(equipo, campus) {
    // Ambos filtros son obligatorios: sin campus, las reglas rechazan la consulta.
    const q = query(collection(db, "tareas"), where("equipo", "==", equipo), where("campus", "==", campus));
    suscribir("tareas", onSnapshot(q, (snap) => {
        const tareas = [];
        snap.forEach((d) => tareas.push({ id: d.id, ...d.data() }));
        pintar(tareas);
    }, (err) => {
        console.error("Tareas:", err);
        vaciar("task-list").append(crear("p", { className: "vacio", text: "No se pudieron cargar las tareas." }));
    }));
}

function ordenar(tareas) {
    return tareas.sort((a, b) => {
        const ca = a.estado === "Completado", cb = b.estado === "Completado";
        if (ca !== cb) return ca ? 1 : -1;
        return (a.fechaFin?.toMillis() ?? Infinity) - (b.fechaFin?.toMillis() ?? Infinity);
    });
}

function pintar(tareas) {
    const caja = vaciar("task-list");
    if (!tareas.length) {
        caja.append(crear("p", { className: "vacio", text: "Todavía no hay tareas en esta área." }));
        return;
    }
    ordenar(tareas).forEach((t) => caja.append(tarjeta(t)));
}

function tarjeta(t) {
    const editable = puede.editar(t.equipo, t.campus);
    const etiqueta = etiquetaVencimiento(t);

    const inicio = crear("input", { attrs: { type: "date", disabled: !editable, "aria-label": "Fecha de inicio" } });
    inicio.value = fechaAInput(t.fechaInicio);
    const fin = crear("input", { attrs: { type: "date", disabled: !editable, "aria-label": "Fecha límite" } });
    fin.value = fechaAInput(t.fechaFin);

    const select = crear("select", { attrs: { disabled: !editable, "aria-label": "Estado" } },
        ESTADOS.map((e) => crear("option", { text: `${ICONO_ESTADO[e]} ${e}`, attrs: { value: e } })));
    select.value = t.estado;

    if (editable) {
        inicio.addEventListener("change", () => actualizar(t, { fechaInicio: inputAFechaInicio(inicio.value) }, () => { inicio.value = fechaAInput(t.fechaInicio); }));
        fin.addEventListener("change", () => actualizar(t, { fechaFin: inputAFechaFin(fin.value) }, () => { fin.value = fechaAInput(t.fechaFin); }));
        select.addEventListener("change", () => actualizar(t, { estado: select.value }, () => { select.value = t.estado; }));
    }

    const card = crear("div", { className: "task-card" },
        crear("div", { className: "task-info" },
            crear("h3", { text: t.titulo }),
            crear("small", { className: "tenue", text: `Responsable: ${t.responsable}` }),
            crear("div", { className: "task-fecha" },
                crear("label", {}, "▶ Inicio:", inicio),
                crear("label", {}, "📅 Límite:", fin),
                etiqueta.texto ? crear("span", { className: `badge-fecha ${etiqueta.clase}`, text: etiqueta.texto }) : null)),
        crear("div", { className: "task-acciones" },
            select,
            editable ? crear("button", {
                className: "btn-borrar", text: "✖",
                attrs: { type: "button", title: "Borrar tarea", "aria-label": `Borrar ${t.titulo}` },
                on: { click: () => borrar(t) }
            }) : null));
    card.style.borderLeftColor = COLOR_BORDE[t.estado] || "var(--panel-bg)";
    return card;
}

/** Valida el orden de fechas antes de mandar; si falla, restaura el input. */
export async function actualizar(t, cambios, restaurar) {
    const nuevoInicio = "fechaInicio" in cambios ? cambios.fechaInicio : t.fechaInicio;
    const nuevoFin = "fechaFin" in cambios ? cambios.fechaFin : t.fechaFin;
    if (nuevoInicio && nuevoFin && nuevoInicio.toMillis() > nuevoFin.toMillis()) {
        avisar("La fecha de inicio no puede ser posterior a la límite.", "error");
        restaurar?.();
        return false;
    }
    try {
        await updateDoc(doc(db, "tareas", t.id), { ...cambios, actualizado: serverTimestamp() });
        return true;
    } catch (e) {
        console.error(e);
        avisar("No se pudo guardar el cambio (¿permisos?).", "error");
        restaurar?.();
        return false;
    }
}

async function borrar(t) {
    if (!confirm(`¿Borrar definitivamente "${t.titulo}"?`)) return;
    try { await deleteDoc(doc(db, "tareas", t.id)); }
    catch (e) { console.error(e); avisar("No tienes permiso para borrar esta tarea.", "error"); }
}

function mostrarFormulario(visible) {
    alternar("nueva-tarea-form", visible);
    alternar("btn-nueva-tarea", !visible);
    mostrarError("nt-error", "");
    if (visible) $("nt-titulo").focus();
}

async function guardarNueva(form) {
    const titulo = $("nt-titulo").value.trim();
    const responsable = $("nt-responsable").value.trim();
    const inicio = $("nt-fecha-inicio").value;
    const fin = $("nt-fecha").value;

    if (!titulo) return mostrarError("nt-error", "Ponle un título a la tarea.");
    if (!responsable) return mostrarError("nt-error", "Falta el responsable.");
    if (inicio && fin && inicio > fin) return mostrarError("nt-error", "La fecha de inicio no puede ser posterior a la límite.");
    if (!puede.editar(estado.equipo)) return mostrarError("nt-error", "No tienes permiso para crear tareas aquí.");

    const boton = form.querySelector('button[type="submit"]');
    boton.disabled = true;
    try {
        await addDoc(collection(db, "tareas"), {
            equipo: estado.equipo,
            campus: estado.campus,
            titulo: titulo.slice(0, LIMITES.titulo),
            responsable: responsable.slice(0, LIMITES.responsable),
            estado: "No empezado",
            fechaInicio: inputAFechaInicio(inicio),
            fechaFin: inputAFechaFin(fin),
            creadoPor: estado.usuario.uid,
            creado: serverTimestamp(),
            actualizado: serverTimestamp()
        });
        form.reset();
        mostrarFormulario(false);
    } catch (e) {
        console.error(e);
        mostrarError("nt-error", "No se pudo crear la tarea (¿permisos?).");
    } finally {
        boton.disabled = false;
    }
}

export function iniciarTareas() {
    registrar({
        "mostrar-form-tarea": () => mostrarFormulario(true),
        "ocultar-form-tarea": () => mostrarFormulario(false),
        "guardar-tarea": guardarNueva
    });
}
