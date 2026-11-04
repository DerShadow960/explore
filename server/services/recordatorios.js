/**
 * Recordatorios de vencimiento (antes: GitHub Actions; ahora: servidor local).
 * ============================================================
 * Una vez al día, a RECORDATORIOS_HORA (CDMX), busca tareas sin completar
 * que venzan en 7, 3 o 1 días y manda UN correo por persona con todas sus
 * tareas. Se guarda el día de la última corrida para que reiniciar el
 * servidor no repita los avisos.
 *
 * Corrige el script anterior, que filtraba por `usuario.equipo` (modelo
 * viejo): ahora se usan `equipos[]` y `campus`.
 */

import path from "node:path";
import { AlmacenJson } from "../lib/almacen.js";
import { ymd, diasEntre, fechaLegible, horaLocal } from "../lib/fechas.js";
import { correoRecordatorio } from "./plantillas.js";
import { crearLogger } from "../lib/logger.js";
import { CAMPUS_COORDINACION } from "../../public/js/dominio.js";

const log = crearLogger("recordatorios");

/** Pura: decide qué tareas le tocan a qué usuario. */
export function agruparPorUsuario(usuarios, tareas, hoyYmd, avisos) {
    const porVencer = tareas
        .filter((t) => t.estado !== "Completado" && t.fechaFin)
        .map((t) => {
            const fecha = t.fechaFin.toDate ? t.fechaFin.toDate() : new Date(t.fechaFin);
            return { ...t, fecha, dias: diasEntre(hoyYmd, ymd(fecha)) };
        })
        .filter((t) => avisos.includes(t.dias));

    const salida = [];
    for (const u of usuarios) {
        const equipos = Array.isArray(u.equipos) ? u.equipos : [];
        const suyas = porVencer.filter((t) =>
            equipos.includes(t.equipo) && (u.campus === CAMPUS_COORDINACION || u.campus === t.campus));
        if (suyas.length) {
            suyas.sort((a, b) => a.dias - b.dias);
            salida.push({ usuario: u, tareas: suyas });
        }
    }
    return { porVencer, salida };
}

export function crearRecordatorios({ db, directorio, correo, config }) {
    const estado = new AlmacenJson(path.join(config.datos, "recordatorios-estado.json"), { ultimoDia: null });

    async function ejecutar({ forzar = false } = {}) {
        const hoy = ymd(new Date());
        if (!forzar && estado.leer().ultimoDia === hoy) return { omitido: "ya corrió hoy" };

        const usuarios = await directorio.cargar();
        const tareas = [];
        (await db().collection("tareas").get()).forEach((d) => tareas.push({ id: d.id, ...d.data() }));
        const { porVencer, salida } = agruparPorUsuario(usuarios, tareas, hoy, config.recordatorios.avisos);

        let enviados = 0, encolados = 0;
        for (const { usuario, tareas: suyas } of salida) {
            const msg = correoRecordatorio({
                nombre: usuario.nombre || "equipo",
                tareas: suyas.map((t) => ({ ...t, responsable: t.responsable || "Sin asignar", fechaTexto: fechaLegible(t.fecha) })),
                urlApp: config.servidor.urlPublica
            });
            try {
                const r = await correo.enviar({ para: usuario.correo, asunto: msg.asunto, html: msg.html, texto: msg.texto, etiqueta: "recordatorio" });
                enviados += r.enviados.length;
                encolados += r.encolados.length;
            } catch (e) {
                log.error(`No se pudo avisar a ${usuario.correo}`, { error: e.message });
            }
        }
        await estado.actualizar((e) => { e.ultimoDia = hoy; });
        log.info(`Tareas por vencer: ${porVencer.length} · correos enviados: ${enviados} · en cola: ${encolados}`);
        return { porVencer: porVencer.length, enviados, encolados };
    }

    return {
        ejecutar,
        /** Lo llama el planificador cada minuto; solo actúa a la hora configurada. */
        async tick() {
            if (horaLocal() !== config.recordatorios.hora) return null;
            if (estado.leer().ultimoDia === ymd(new Date())) return null;
            return ejecutar();
        }
    };
}
