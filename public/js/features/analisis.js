/**
 * Análisis de código con IA.
 *   - En el workspace: análisis del área + subida manual de archivos.
 *   - Vista de campus: los últimos análisis de todas las áreas.
 * Los documentos los escribe SOLO el servidor; aquí únicamente se leen.
 * Todo lo que viene de la IA se pinta con textContent.
 */

import { collection, query, where, orderBy, limit, onSnapshot } from "/vendor/firebase/firebase-firestore.js";
import { db } from "../firebase.js";
import { estado, puede, suscribir } from "../estado.js";
import { $, crear, vaciar, mostrarVista, avisar } from "../ui/dom.js";
import { registrar } from "../ui/acciones.js";
import { tituloEquipo } from "../dominio.js";
import { fmtFechaHora } from "../lib/fechas.js";
import { api } from "../api.js";
import { cargarRevisionesCampus } from "./revisiones.js";
import { leerBase64 } from "../lib/archivos.js";

const MAX_BYTES = 2 * 1024 * 1024;
const NOMBRE_SEV = { critica: "Crítica", alta: "Alta", media: "Media", baja: "Baja", info: "Info" };

function tarjeta(a, { mostrarArea = false } = {}) {
    const r = a.resultado || {};
    const hallazgos = Array.isArray(r.hallazgos) ? r.hallazgos : [];
    const graves = hallazgos.filter((h) => h.severidad === "critica" || h.severidad === "alta").length;
    const nota = Number.isFinite(r.calificacion) ? r.calificacion : null;
    const claseNota = nota === null ? "" : nota < 5 ? "baja" : nota < 8 ? "media" : "";

    const meta = [
        mostrarArea ? tituloEquipo(a.equipo) : null,
        a.autor ? `por ${a.autor}` : null,
        a.creado?.toDate ? fmtFechaHora(a.creado.toDate()) : "procesando…",
        a.proveedor === "heuristico" ? "análisis estático" : a.proveedor ? `IA: ${a.proveedor}` : null,
        graves ? `⚠ ${graves} grave${graves > 1 ? "s" : ""}` : null
    ].filter(Boolean).join(" · ");

    const detalle = crear("div", { className: "detalle hidden" },
        hallazgos.length ? crear("h4", { text: `Hallazgos (${hallazgos.length})` }) : null,
        ...hallazgos.map((h) => crear("div", { className: "hallazgo" },
            crear("span", { className: `sev sev-${h.severidad}`, text: NOMBRE_SEV[h.severidad] || h.severidad }),
            crear("span", { className: "tenue", text: `${h.tipo}${h.ubicacion ? " · " + h.ubicacion : ""}` }),
            crear("div", { text: h.descripcion }),
            h.sugerencia ? crear("div", { className: "sugerencia", text: "→ " + h.sugerencia }) : null)),
        r.fortalezas?.length ? crear("h4", { text: "Lo que está bien" }) : null,
        r.fortalezas?.length ? crear("ul", {}, r.fortalezas.map((f) => crear("li", { text: f }))) : null,
        r.siguientes_pasos?.length ? crear("h4", { text: "Siguientes pasos" }) : null,
        r.siguientes_pasos?.length ? crear("ul", {}, r.siguientes_pasos.map((f) => crear("li", { text: f }))) : null,
        // Solo enlaces https de Drive: el servidor guarda webViewLink, pero no confiamos ciegamente.
        typeof a.archivo?.url === "string" && a.archivo.url.startsWith("https://")
            ? crear("p", {}, crear("a", { text: "📄 Abrir en Drive", attrs: { href: a.archivo.url, target: "_blank", rel: "noopener noreferrer" } }))
            : null);

    const cabeza = crear("div", { className: "cabeza", attrs: { role: "button", tabindex: "0", "aria-expanded": "false" } },
        crear("div", {},
            crear("div", { className: "nombre", text: a.archivo?.nombre || "archivo" }),
            crear("div", { className: "meta", text: meta })),
        crear("div", { className: `nota ${claseNota}`, text: nota === null ? "—" : `${nota}/10` }));

    const plegar = () => {
        const visible = detalle.classList.toggle("hidden") === false;
        cabeza.setAttribute("aria-expanded", String(visible));
    };
    cabeza.addEventListener("click", plegar);
    cabeza.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); plegar(); } });

    return crear("article", { className: "tarjeta-analisis" + (graves ? " grave" : "") },
        cabeza, crear("p", { className: "resumen", text: r.resumen || "" }), detalle);
}

function pintarLista(id, docs, opciones) {
    const caja = vaciar(id);
    if (!docs.length) {
        caja.append(crear("p", { className: "vacio", text: "Todavía no hay análisis. Sube código a la carpeta de Drive del área o usa el formulario." }));
        return;
    }
    docs.forEach((d) => caja.append(tarjeta(d, opciones)));
}

function errorLista(id, err) {
    console.error("Análisis:", err);
    const msg = err?.code === "failed-precondition"
        ? "Falta el índice de Firestore para análisis. Publica firestore.indexes.json (npm run reglas:publicar)."
        : "No se pudieron cargar los análisis.";
    vaciar(id).append(crear("p", { className: "vacio", text: msg }));
}

export function cargarAnalisisArea(equipo, campus) {
    $("estado-subida").textContent = "";
    const q = query(collection(db, "analisis"),
        where("campus", "==", campus), where("equipo", "==", equipo), orderBy("creado", "desc"), limit(20));
    suscribir("analisis-area", onSnapshot(q, (snap) => {
        const docs = [];
        snap.forEach((d) => docs.push({ id: d.id, ...d.data() }));
        pintarLista("lista-analisis-area", docs);
    }, (e) => errorLista("lista-analisis-area", e)));
}

function abrirCampus() {
    mostrarVista("view-analisis");
    $("analisis-campus").textContent = estado.campus;
    const q = query(collection(db, "analisis"), where("campus", "==", estado.campus), orderBy("creado", "desc"), limit(50));
    suscribir("analisis-campus", onSnapshot(q, (snap) => {
        const docs = [];
        snap.forEach((d) => docs.push({ id: d.id, ...d.data() }));
        pintarLista("lista-analisis-campus", docs, { mostrarArea: true });
    }, (e) => errorLista("lista-analisis-campus", e)));
    cargarRevisionesCampus(estado.campus);
}


async function subir(form) {
    const archivo = $("archivo-analisis").files?.[0];
    const estadoTxt = $("estado-subida");
    if (!archivo) return;
    if (!puede.editar(estado.equipo)) return avisar("Solo los miembros del área pueden mandar archivos a analizar.", "error");
    if (archivo.size > MAX_BYTES) return avisar("El archivo pasa de 2 MB.", "error");

    const boton = $("btn-subir-analisis");
    boton.disabled = true;
    estadoTxt.className = "estado-subida";
    estadoTxt.textContent = "Analizando… (puede tardar hasta un minuto)";
    try {
        const r = await api("/api/analisis/subir", {
            metodo: "POST",
            cuerpo: { nombre: archivo.name, contenidoBase64: await leerBase64(archivo), equipo: estado.equipo, campus: estado.campus, consentimientoIA: $("consentimiento-analisis").checked }
        });
        const correo = r.correo.enviados
            ? `correo enviado a ${r.correo.enviados} destinatario(s)`
            : `correo en cola (${r.correo.encolados}); se reintentará solo`;
        estadoTxt.className = "estado-subida texto-ok";
        estadoTxt.textContent = `✅ Listo: ${r.resultado.calificacion ?? "—"}/10 · ${correo}.`;
        form.reset();
    } catch (e) {
        estadoTxt.className = "estado-subida texto-error";
        estadoTxt.textContent = e.message;
    } finally {
        boton.disabled = false;
    }
}

export function iniciarAnalisis() {
    registrar({ "abrir-analisis": abrirCampus, "subir-analisis": subir });
}
