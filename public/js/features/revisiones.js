/**
 * Revisión de documentos: similitud interna, citas faltantes y posibles fuentes.
 * Los documentos de `revisiones` los escribe SOLO el servidor; aquí se leen.
 * Todo texto (pasajes, sugerencias de la IA) entra con textContent.
 */

import { collection, query, where, orderBy, limit, onSnapshot } from "/vendor/firebase/firebase-firestore.js";
import { db } from "../firebase.js";
import { estado, puede, suscribir } from "../estado.js";
import { $, crear, vaciar, avisar } from "../ui/dom.js";
import { registrar } from "../ui/acciones.js";
import { tituloEquipo } from "../dominio.js";
import { fmtFechaHora } from "../lib/fechas.js";
import { api } from "../api.js";
import { leerBase64 } from "../lib/archivos.js";

const MAX_BYTES = 2 * 1024 * 1024;
const NIVEL = { alta: "Coincidencia alta", media: "Coincidencia media", baja: "Coincidencia baja", ninguna: "Sin coincidencias" };
const esHttps = (u) => typeof u === "string" && /^https:\/\//.test(u);
const fecha = (iso) => { try { return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short" }); } catch { return ""; } };

function tarjeta(d, { mostrarArea = false } = {}) {
    const s = d.similitud || { porcentajeTotal: 0, nivel: "ninguna", coincidencias: [] };
    const r = d.revision || {};
    const ajenas = (s.coincidencias || []).filter((c) => !c.esVersionPropia);
    const propias = (s.coincidencias || []).filter((c) => c.esVersionPropia);
    const citas = r.citas_faltantes || [];
    const fuentes = r.posibles_fuentes || [];

    const meta = [
        mostrarArea ? tituloEquipo(d.equipo) : null,
        d.autor ? `por ${d.autor}` : null,
        d.creado?.toDate ? fmtFechaHora(d.creado.toDate()) : "procesando…",
        `${s.palabras ?? "?"} palabras`,
        r.calidad ? `calidad ${r.calidad}/10` : null,
        d.proveedor === "gemini" ? (d.conBusqueda ? "Gemini + Google" : "Gemini") : "revisión básica"
    ].filter(Boolean).join(" · ");

    const barra = crear("div", { className: `barra-similitud ${s.nivel}` }, crear("i"));
    barra.firstChild.style.width = Math.min(100, s.porcentajeTotal) + "%";

    const detalle = crear("div", { className: "detalle hidden" },
        s.yaRevisado ? crear("p", { className: "chico", text: `Este mismo texto ya se había revisado como "${s.yaRevisado.nombre}" (${fecha(s.yaRevisado.fecha)}).` }) : null,

        ajenas.length ? crear("h4", { text: "Texto que coincide con otros documentos" }) : null,
        ...ajenas.map((c) => crear("div", { className: "coincidencia" },
            crear("span", { className: "porc", text: `${c.porcentaje}%` }),
            crear("strong", { text: c.nombre }),
            crear("span", { className: "tenue", text: ` · ${tituloEquipo(c.equipo)} · ${fecha(c.fecha)}` }),
            ...(c.pasajes || []).slice(0, 3).map((p) => crear("div", { className: "pasaje", text: `“${p}”` })))),

        propias.length ? crear("p", { className: "chico tenue",
            text: `Versiones anteriores del mismo archivo (no cuentan): ${propias.map((c) => `${fecha(c.fecha)} ${c.porcentaje}%`).join(", ")}` }) : null,

        citas.length ? crear("h4", { text: "Pasajes que conviene citar" }) : null,
        ...citas.map((c) => crear("div", { className: "coincidencia" },
            crear("div", { className: "pasaje cita", text: `“${c.pasaje}”` }),
            crear("div", { className: "sugerencia", text: "→ " + c.motivo }))),

        fuentes.length ? crear("h4", { text: "Posibles fuentes (búsqueda en Google)" }) : null,
        ...fuentes.map((f) => crear("div", { className: "coincidencia" },
            crear("div", { className: "pasaje", text: `“${f.pasaje}”` }),
            esHttps(f.url)
                ? crear("a", { text: f.fuente, attrs: { href: f.url, target: "_blank", rel: "noopener noreferrer" } })
                : crear("span", { text: f.fuente }),
            f.verificada ? crear("span", { className: "etiqueta-verif", text: "de la búsqueda" }) : null)),

        r.observaciones?.length ? crear("h4", { text: "Observaciones" }) : null,
        r.observaciones?.length ? crear("ul", {}, r.observaciones.map((o) => crear("li", { text: o }))) : null,
        r.siguientes_pasos?.length ? crear("h4", { text: "Siguientes pasos" }) : null,
        r.siguientes_pasos?.length ? crear("ul", {}, r.siguientes_pasos.map((o) => crear("li", { text: o }))) : null,

        r.fuentes_consultadas?.length ? crear("h4", { text: "Fuentes que consultó la búsqueda" }) : null,
        r.fuentes_consultadas?.length ? crear("ul", {}, r.fuentes_consultadas.filter((f) => esHttps(f.url)).map((f) =>
            crear("li", {}, crear("a", { text: f.titulo, attrs: { href: f.url, target: "_blank", rel: "noopener noreferrer" } })))) : null);

    const cabeza = crear("div", { className: "cabeza", attrs: { role: "button", tabindex: "0", "aria-expanded": "false" } },
        crear("div", {},
            crear("div", { className: "nombre", text: d.archivo?.nombre || "documento" }),
            crear("div", { className: "meta", text: meta })),
        crear("div", { className: `nota nivel-${s.nivel}`, text: `${s.porcentajeTotal}%`, attrs: { title: NIVEL[s.nivel] } }));
    const plegar = () => cabeza.setAttribute("aria-expanded", String(!detalle.classList.toggle("hidden")));
    cabeza.addEventListener("click", plegar);
    cabeza.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); plegar(); } });

    return crear("article", { className: "tarjeta-analisis" + (s.nivel === "alta" ? " grave" : "") },
        cabeza,
        crear("p", { className: "resumen", text: r.resumen || "" }),
        crear("div", { className: "chico tenue", text: `${NIVEL[s.nivel]} con documentos ya revisados · ${citas.length} cita(s) por revisar` }),
        barra, detalle);
}

function pintar(id, docs, opciones) {
    const caja = vaciar(id);
    if (!docs.length) {
        caja.append(crear("p", { className: "vacio", text: "Todavía no hay documentos revisados." }));
        return;
    }
    docs.forEach((d) => caja.append(tarjeta(d, opciones)));
}

function error(id, err) {
    console.error("Revisiones:", err);
    vaciar(id).append(crear("p", { className: "vacio", text: err?.code === "failed-precondition"
        ? "Falta el índice de Firestore para revisiones (npm run reglas:publicar)."
        : "No se pudieron cargar las revisiones." }));
}

function suscribirLista(clave, id, q, opciones) {
    suscribir(clave, onSnapshot(q, (snap) => {
        const docs = [];
        snap.forEach((d) => docs.push({ id: d.id, ...d.data() }));
        pintar(id, docs, opciones);
    }, (e) => error(id, e)));
}

export function cargarRevisionesArea(equipo, campus) {
    $("estado-revision").textContent = "";
    $("subida-revision").classList.toggle("hidden", !puede.editar(equipo, campus));
    suscribirLista("revisiones-area", "lista-revisiones-area",
        query(collection(db, "revisiones"), where("campus", "==", campus), where("equipo", "==", equipo), orderBy("creado", "desc"), limit(20)));
}

export function cargarRevisionesCampus(campus) {
    suscribirLista("revisiones-campus", "lista-revisiones-campus",
        query(collection(db, "revisiones"), where("campus", "==", campus), orderBy("creado", "desc"), limit(50)),
        { mostrarArea: true });
}

async function subir(form) {
    const archivo = $("archivo-revision").files?.[0];
    const txt = $("estado-revision");
    if (!archivo) return;
    if (!puede.editar(estado.equipo)) return avisar("Solo los miembros del área pueden mandar documentos a revisar.", "error");
    if (archivo.size > MAX_BYTES) return avisar("El archivo pasa de 2 MB.", "error");

    const boton = $("btn-subir-revision");
    boton.disabled = true;
    txt.className = "estado-subida";
    txt.textContent = "Revisando… (con búsqueda de fuentes puede tardar hasta un minuto)";
    try {
        const r = await api("/api/documentos/revisar", {
            metodo: "POST",
            cuerpo: { nombre: archivo.name, contenidoBase64: await leerBase64(archivo), equipo: estado.equipo, campus: estado.campus, consentimientoIA: $("consentimiento-revision").checked }
        });
        const correo = r.correo.enviados ? `correo enviado a ${r.correo.enviados}` : `correo en cola (${r.correo.encolados})`;
        txt.className = "estado-subida texto-ok";
        txt.textContent = `✅ Listo: ${r.similitud.porcentajeTotal}% de coincidencia interna · ${correo}.`;
        form.reset();
    } catch (e) {
        txt.className = "estado-subida texto-error";
        txt.textContent = e.message;
    } finally {
        boton.disabled = false;
    }
}

export function iniciarRevisiones() {
    registrar({
        "subir-revision": subir,
        "mostrar-aviso-ia": () => $("aviso-ia").classList.remove("hidden"),
        "cerrar-aviso-ia": () => $("aviso-ia").classList.add("hidden")
    });
}
