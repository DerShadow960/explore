/**
 * Vigilante de Drive.
 * ============================================================
 * Cada DRIVE_INTERVALO_SEG revisa las carpetas configuradas (y sus
 * subcarpetas) buscando archivos nuevos o modificados, y entrega cada
 * uno al pipeline de análisis.
 *
 * Para no mandar 40 correos mientras alguien escribe en un Google Doc:
 *   - Periodo de calma: solo se procesa un archivo que lleva al menos
 *     QUIETUD_MS sin cambios.
 *   - Huella del contenido: si el texto extraído es idéntico al último
 *     analizado, no se repite.
 *   - Enfriamiento: el mismo archivo se reanaliza como máximo una vez
 *     cada ENFRIAMIENTO_MS.
 *
 * El estado (qué se analizó y cuándo se revisó cada carpeta) vive en
 * data/drive-estado.json, así que reiniciar el servidor no reenvía nada.
 */

import crypto from "node:crypto";
import path from "node:path";
import { AlmacenJson } from "../../lib/almacen.js";
import { crearLogger } from "../../lib/logger.js";
import { esAnalizable, tipoDe, extraerTexto, pareceCodigo, MIME_GDOC, MIME_PDF_DOCX } from "./extractor.js";

const log = crearLogger("drive");
const QUIETUD_MS = 60 * 1000;
const ENFRIAMIENTO_MS = 30 * 60 * 1000;
const TRASLAPE_MS = 10 * 60 * 1000;     // margen por relojes desfasados y archivos en calma
const SUBCARPETAS_TTL_MS = 15 * 60 * 1000;

export function huella(texto) {
    return crypto.createHash("sha256").update(texto).digest("hex");
}

export class VigilanteDrive {
    /**
     * @param {object} opciones
     * @param {object} opciones.cliente       crearClienteDrive(...)
     * @param {Array}  opciones.carpetas      [{campus, equipo, id}]
     * @param {Function} opciones.procesar    async ({archivo, carpeta, texto}) => resultado
     * @param {string} opciones.dirDatos
     * @param {number} opciones.maxBytes
     * @param {boolean} opciones.analizarExistentes
     * @param {Function} [opciones.ahora]     para pruebas
     */
    constructor({ cliente, carpetas, procesar, procesarDocumento = null, dirDatos, maxBytes, analizarExistentes = false, ahora = () => Date.now() }) {
        this.cliente = cliente;
        this.procesarDocumento = procesarDocumento;
        this.carpetas = carpetas;
        this.procesar = procesar;
        this.maxBytes = maxBytes;
        this.analizarExistentes = analizarExistentes;
        this.ahora = ahora;
        this.estado = new AlmacenJson(path.join(dirDatos, "drive-estado.json"), { carpetas: {}, archivos: {} });
        this.subcarpetasCache = new Map();
        this.corriendo = false;
        this.ultimaVuelta = null;
        this.ultimoError = null;
    }

    async subcarpetasDe(raiz) {
        const c = this.subcarpetasCache.get(raiz);
        if (c && this.ahora() - c.cuando < SUBCARPETAS_TTL_MS) return c.ids;
        const ids = await this.cliente.subcarpetas(raiz);
        this.subcarpetasCache.set(raiz, { ids, cuando: this.ahora() });
        return ids;
    }

    /** Una vuelta completa. Devuelve cuántos archivos se procesaron. */
    async revisar() {
        if (this.corriendo) return { procesados: 0, omitido: true };
        this.corriendo = true;
        let procesados = 0;
        try {
            for (const carpeta of this.carpetas) {
                procesados += await this.revisarCarpeta(carpeta);
            }
            this.ultimoError = null;
        } catch (e) {
            this.ultimoError = e.message;
            log.error("Fallo al revisar Drive", { error: e.message });
        } finally {
            this.ultimaVuelta = new Date(this.ahora()).toISOString();
            this.corriendo = false;
        }
        return { procesados };
    }

    async revisarCarpeta(carpeta) {
        const est = this.estado.leer();
        const marca = est.carpetas[carpeta.id];
        const inicioVuelta = this.ahora();

        // Primer contacto con la carpeta: o se analiza lo existente, o se
        // toma "ahora" como punto de partida.
        if (!marca && !this.analizarExistentes) {
            await this.estado.actualizar((e) => {
                e.carpetas[carpeta.id] = { desde: new Date(inicioVuelta).toISOString(), equipo: carpeta.equipo, campus: carpeta.campus };
            });
            log.info(`Carpeta ${carpeta.equipo}/${carpeta.campus} registrada; se analizará lo que se suba a partir de ahora.`);
            return 0;
        }

        const desde = marca ? new Date(Date.parse(marca.desde) - TRASLAPE_MS).toISOString() : null;
        const ids = await this.subcarpetasDe(carpeta.id);
        let procesados = 0;
        let pendientesEnCalma = false;

        for (const id of ids) {
            const archivos = await this.cliente.archivosModificados(id, desde);
            for (const archivo of archivos) {
                const r = await this.considerar(archivo, carpeta);
                if (r === "procesado") procesados++;
                if (r === "esperando") pendientesEnCalma = true;
            }
        }

        // La marca avanza solo hasta donde no queden archivos esperando calma;
        // el traslape garantiza que se vuelvan a ver en la siguiente vuelta.
        if (!pendientesEnCalma || !marca) {
            await this.estado.actualizar((e) => {
                e.carpetas[carpeta.id] = { desde: new Date(inicioVuelta).toISOString(), equipo: carpeta.equipo, campus: carpeta.campus };
            });
        }
        return procesados;
    }

    /** @returns {"procesado"|"omitido"|"esperando"|"error"} */
    async considerar(archivo, carpeta) {
        if (!esAnalizable(archivo)) return "omitido";

        const modificado = Date.parse(archivo.modifiedTime);
        const previo = this.estado.leer().archivos[archivo.id];
        const version = `${archivo.md5Checksum || ""}:${archivo.version || ""}:${archivo.modifiedTime}`;
        if (previo?.version === version) return "omitido";

        if (this.ahora() - modificado < QUIETUD_MS) return "esperando";
        if (previo?.analizado && this.ahora() - Date.parse(previo.analizado) < ENFRIAMIENTO_MS) {
            return "esperando";
        }

        let texto;
        try {
            const buf = await this.cliente.descargar(archivo, this.maxBytes);
            texto = await extraerTexto(buf, tipoDe(archivo));
        } catch (e) {
            log.warn(`No se pudo leer ${archivo.name}`, { error: e.message });
            await this.marcar(archivo.id, { version, error: e.message.slice(0, 200), nombre: archivo.name });
            return "error";
        }

        const h = huella(texto);
        if (previo?.huella === h) {
            await this.marcar(archivo.id, { ...previo, version });
            return "omitido";
        }

        // Documentos de prosa sin código no se analizan.
        const esDocumento = archivo.mimeType === MIME_GDOC || MIME_PDF_DOCX.includes(archivo.mimeType);
        if (esDocumento && !pareceCodigo(texto)) {
            if (!this.procesarDocumento) {
                log.info(`${archivo.name}: documento sin código, se omite.`);
                await this.marcar(archivo.id, { version, huella: h, nombre: archivo.name, sinCodigo: true });
                return "omitido";
            }
            log.info(`Documento nuevo/actualizado en ${carpeta.equipo}: ${archivo.name}`);
            try {
                await this.procesarDocumento({ archivo, carpeta, texto });
            } catch (e) {
                if (e.codigo !== "POCO_TEXTO") {
                    log.error(`Falló la revisión de ${archivo.name}`, { error: e.message });
                    return "error";
                }
            }
            await this.marcar(archivo.id, { version, huella: h, nombre: archivo.name, documento: true, analizado: new Date(this.ahora()).toISOString() });
            return "procesado";
        }

        log.info(`Nuevo/actualizado en ${carpeta.equipo}: ${archivo.name}`);
        try {
            await this.procesar({ archivo, carpeta, texto });
            await this.marcar(archivo.id, {
                version, huella: h, nombre: archivo.name,
                analizado: new Date(this.ahora()).toISOString()
            });
            return "procesado";
        } catch (e) {
            // No se marca la versión: se reintenta en la siguiente vuelta.
            log.error(`Falló el procesamiento de ${archivo.name}`, { error: e.message });
            return "error";
        }
    }

    marcar(id, datos) {
        return this.estado.actualizar((e) => { e.archivos[id] = datos; });
    }

    resumen() {
        const e = this.estado.leer();
        return {
            carpetas: this.carpetas.map((c) => ({ equipo: c.equipo, campus: c.campus, desde: e.carpetas[c.id]?.desde || null })),
            archivosConocidos: Object.keys(e.archivos).length,
            ultimaVuelta: this.ultimaVuelta,
            ultimoError: this.ultimoError
        };
    }
}
