/**
 * Navegación: selector de campus → hub → workspace.
 */

import { estado, puede, cancelarTodas } from "../estado.js";
import { $, crear, vaciar, mostrarVista, alternar, avisar } from "../ui/dom.js";
import { registrar } from "../ui/acciones.js";
import { INFO_EQUIPOS, equiposDelCampus, tituloEquipo } from "../dominio.js";
import { cargarTareas } from "./tareas.js";
import { cargarChatArea, mostrarChatGlobal, ocultarChatGlobal } from "./chat.js";
import { cargarAnalisisArea } from "./analisis.js";
import { cargarRevisionesArea } from "./revisiones.js";

// Suscripciones que sobreviven al cambio de vista dentro del hub.
const PERSISTENTES = ["sesion", "chat-global"];

export function irASelectorCampus() {
    cancelarTodas(["sesion"]);
    ocultarChatGlobal();
    estado.campus = null;
    estado.equipo = null;
    $("campus-saludo").textContent = `Hola, ${estado.usuario.nombre}`;
    mostrarVista("view-campus");
}

function entrarCampus(el) {
    const campus = el.dataset.campus;
    if (!puede.entrarACampus(campus)) {
        $("denegado-campus").textContent = campus;
        mostrarVista("view-denegado");
        return;
    }
    estado.campus = campus;
    irAHub();
}

export function irAHub() {
    cancelarTodas(PERSISTENTES);
    estado.equipo = null;
    mostrarVista("view-hub");
    $("hub-campus").textContent = estado.campus;

    const grid = vaciar("teams-grid");
    for (const equipo of equiposDelCampus(estado.campus)) {
        const info = INFO_EQUIPOS[equipo] || { titulo: equipo, img: "/assets/LogoUP.png" };
        const editable = puede.editar(equipo);
        grid.append(crear("div", { className: "team-card" },
            crear("img", { className: "team-img", attrs: { src: info.img, alt: info.titulo, loading: "lazy" } }),
            crear("h3", { text: info.titulo }),
            crear("span", { className: `badge-rol ${editable ? "rol-editor" : "rol-lector"}`, text: editable ? "✏️ Puedes editar" : "👁 Solo lectura" }),
            crear("div", {},
                crear("button", { text: "Entrar al Espacio", attrs: { type: "button" }, dataset: { accion: "abrir-workspace", equipo } }))
        ));
    }

    alternar("btn-accesos", puede.verBitacora());
    alternar("btn-admin", puede.administrar());
    mostrarChatGlobal();
}

function abrirWorkspace(el) {
    const equipo = el.dataset.equipo;
    // No confiamos en el botón: el área debe existir en este campus.
    if (!equiposDelCampus(estado.campus).includes(equipo)) {
        avisar("Esa área no existe en este campus.", "error");
        return;
    }
    cancelarTodas(PERSISTENTES);
    estado.equipo = equipo;
    const editable = puede.editar(equipo);
    const info = INFO_EQUIPOS[equipo] || {};

    mostrarVista("view-workspace");
    $("workspace-title").textContent = `${tituloEquipo(equipo)} · ${estado.campus}`;
    const drive = $("drive-link");
    drive.href = info.drive || "#";
    drive.setAttribute("aria-disabled", info.drive ? "false" : "true");

    alternar("aviso-lectura", !editable);
    alternar("btn-nueva-tarea", editable);
    alternar("nueva-tarea-form", false);
    alternar("chat-compositor", editable);
    alternar("subida-analisis", editable);

    cargarTareas(equipo, estado.campus);
    cargarChatArea(equipo, estado.campus);
    cargarAnalisisArea(equipo, estado.campus);
    cargarRevisionesArea(equipo, estado.campus);
}

export function iniciarNavegacion() {
    registrar({
        "entrar-campus": entrarCampus,
        "volver-selector": irASelectorCampus,
        "volver-hub": irAHub,
        "abrir-workspace": abrirWorkspace
    });
}
