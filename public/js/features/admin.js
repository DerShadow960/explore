/**
 * Panel "Estado del servidor" (coordinación y auditoría).
 * Todas las acciones pasan por la API local, que vuelve a verificar
 * el permiso con el token: ocultar el botón no es la protección.
 */

import { puede } from "../estado.js";
import { $, crear, vaciar, mostrarVista, avisar } from "../ui/dom.js";
import { registrar } from "../ui/acciones.js";
import { api } from "../api.js";

function lista(id, pares) {
    const dl = vaciar(id);
    for (const [k, v] of pares) dl.append(crear("dt", { text: k }), crear("dd", { text: v ?? "—" }));
}

const fecha = (iso) => (iso ? new Date(iso).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }) : "—");

async function refrescar() {
    try {
        const e = await api("/api/estado");
        lista("admin-correo", [
            ["Transportes", e.correo.transportes.join(" → ") || "ninguno (solo cola)"],
            ["Modo", e.correo.dryRun ? "DRY RUN (no envía)" : "real"],
            ["En cola", String(e.correo.pendientes)],
            ["Abandonados", String(e.correo.fallidos)],
            ["Próximo reintento", fecha(e.correo.proximoReintento)]
        ]);
        lista("admin-drive", e.drive.carpetas ? [
            ["Carpetas", e.drive.carpetas.map((c) => `${c.equipo}/${c.campus}`).join(", ")],
            ["Archivos conocidos", String(e.drive.archivosConocidos)],
            ["Última revisión", fecha(e.drive.ultimaVuelta)],
            ["Último error", e.drive.ultimoError || "ninguno"]
        ] : [["Estado", "apagado (DRIVE_WATCH=false)"]]);
        lista("admin-ia", [
            ["Código", e.ia.join(" → ")],
            ["Documentos", (e.revisor || []).join(" → ") || "—"],
            ["Recordatorios", e.recordatorios ? "activos" : "apagados"]
        ]);
    } catch (err) {
        avisar(err.message, "error");
    }
}

async function ejecutar(ruta, etiqueta) {
    const salida = $("admin-salida");
    salida.textContent = `${etiqueta}…`;
    try {
        const r = await api(ruta, { metodo: "POST" });
        salida.textContent = JSON.stringify(r, null, 2);
        avisar(`${etiqueta}: listo`, "exito");
    } catch (e) {
        salida.textContent = e.message;
        avisar(e.message, "error");
    }
    refrescar();
}

function abrir() {
    if (!puede.administrar()) return;
    mostrarVista("view-admin");
    refrescar();
}

export function iniciarAdmin() {
    registrar({
        "abrir-admin": abrir,
        "admin-probar-correo": () => ejecutar("/api/correo/prueba", "Correo de prueba"),
        "admin-reintentar": () => ejecutar("/api/correo/reintentar", "Reintento de cola"),
        "admin-revisar-drive": () => ejecutar("/api/analisis/revisar-drive", "Revisión de Drive"),
        "admin-recordatorios": () => ejecutar("/api/recordatorios/ejecutar", "Recordatorios")
    });
}
