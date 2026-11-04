/**
 * Bitácora de accesos (solo equipo Auditoria). La escribe el servidor.
 */

import { collection, query, orderBy, limit, getDocs } from "/vendor/firebase/firebase-firestore.js";
import { db } from "../firebase.js";
import { puede } from "../estado.js";
import { $, crear, vaciar, mostrarVista } from "../ui/dom.js";
import { registrar } from "../ui/acciones.js";
import { fmtFechaHora } from "../lib/fechas.js";
import { exportarFilas } from "./exportar.js";

let accesos = [];

export function navegadorCorto(ua) {
    if (!ua) return "—";
    const nav = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome"
        : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : /curl|wget|python|node/i.test(ua) ? "Script" : "Otro";
    const so = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows"
        : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
    return so ? `${nav} · ${so}` : nav;
}

async function abrir() {
    if (!puede.verBitacora()) return;
    mostrarVista("view-accesos");
    const cuerpo = vaciar("accesos-cuerpo");
    cuerpo.textContent = "Cargando…";
    try {
        const snap = await getDocs(query(collection(db, "accesos"), orderBy("cuando", "desc"), limit(200)));
        accesos = [];
        snap.forEach((d) => accesos.push(d.data()));
        pintar();
    } catch (e) {
        console.error(e);
        cuerpo.textContent = "No se pudieron cargar los accesos. Revisa las reglas de Firestore.";
    }
}

function pintar() {
    const cuerpo = vaciar("accesos-cuerpo");
    const n = accesos.length;
    $("accesos-total").textContent = `${n} intento${n === 1 ? "" : "s"} registrado${n === 1 ? "" : "s"}`;
    if (!n) {
        cuerpo.append(crear("p", { className: "tenue", text: "Todavía nadie ha intentado abrir el código directamente." }));
        return;
    }
    const tbody = crear("tbody", {}, accesos.map((a) => crear("tr", {},
        crear("td", { text: a.cuando?.toDate ? fmtFechaHora(a.cuando.toDate()) : "—" }),
        crear("td", { text: a.ip || "—" }),
        crear("td", { text: navegadorCorto(a.navegador), attrs: { title: a.navegador || "" } }),
        crear("td", { text: a.ruta || "—" }),
        crear("td", { text: a.intentoNumero ? `#${a.intentoNumero}` : "—" }),
        crear("td", { text: a.bloqueado ? "🛑 Bloqueado" : "Registrado" }))));
    const thead = crear("thead", {}, crear("tr", {}, ...["Cuándo", "IP", "Navegador", "Ruta", "Intento", "Resultado"].map((h) => crear("th", { text: h }))));
    cuerpo.append(crear("table", { className: "gantt-tabla" }, thead, tbody));
}

async function exportar() {
    if (!puede.verBitacora() || !accesos.length) return;
    await exportarFilas(accesos.map((a) => ({
        Cuándo: a.cuando?.toDate ? a.cuando.toDate() : "",
        IP: a.ip || "",
        Navegador: navegadorCorto(a.navegador),
        "User-Agent": a.navegador || "",
        Ruta: a.ruta || "",
        Referer: a.referer || "",
        Intento: a.intentoNumero || "",
        Bloqueado: a.bloqueado ? "Sí" : "No"
    })), "Accesos", "PAKAL_accesos", [18, 16, 18, 50, 20, 28, 9, 11]);
}

export function iniciarAccesos() {
    registrar({ "abrir-accesos": abrir, "exportar-accesos": exportar });
}
