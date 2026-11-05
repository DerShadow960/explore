/**
 * Exportación a Excel con el generador propio (lib/xlsx-mini.js).
 * Ya no se carga SheetJS: tenía vulnerabilidades altas sin parche en npm.
 */

import { estado, puede } from "../estado.js";
import { avisar } from "../ui/dom.js";
import { tituloEquipo } from "../dominio.js";
import { diasRestantes } from "../lib/fechas.js";
// Carga perezosa: el generador de Excel solo se baja cuando alguien exporta.
const descargarXlsx = async (o) => (await import("../lib/xlsx-mini.js")).descargarXlsx(o);

const hoyIso = () => new Date().toISOString().slice(0, 10);

export async function exportarTareas(tareas, estadoVisual) {
    if (!puede.exportar()) return;
    try {
        await descargarXlsx({
            archivo: `PAKAL_${estado.campus}_${hoyIso()}`,
            hoja: "Tareas",
            anchos: [10, 22, 42, 18, 14, 14, 12, 12, 15],
            filas: tareas.map((t) => ({
                Campus: t.campus,
                Área: tituloEquipo(t.equipo),
                Tarea: t.titulo,
                Responsable: t.responsable,
                Estado: t.estado,
                "Estado real": estadoVisual(t),
                Inicio: t.fechaInicio ? t.fechaInicio.toDate() : "",
                Límite: t.fechaFin ? t.fechaFin.toDate() : "",
                "Días restantes": t.fechaFin ? diasRestantes(t.fechaFin) : ""
            }))
        });
    } catch (e) {
        console.error(e);
        avisar("No se pudo generar el archivo.", "error");
    }
}

export async function exportarFilas(filas, nombreHoja, archivo, anchos) {
    await descargarXlsx({ archivo: `${archivo}_${hoyIso()}`, hoja: nombreHoja, filas, anchos });
}
