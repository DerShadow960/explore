/**
 * Arranque: valida configuración, conecta servicios y levanta el servidor.
 *
 *   npm start         servidor + vigilante de Drive + recordatorios + cola de correo
 *   npm run demo      igual, contra los emuladores de Firebase (no toca producción)
 */

import { config, validar } from "./config.js";
import { crearApp } from "./app.js";
import { iniciarFirebase, db, auth, FieldValue, Timestamp } from "./firebase.js";
import { ServicioCorreo } from "./services/correo/index.js";
import { crearAnalizador } from "./services/ia/index.js";
import { crearDirectorio } from "./services/destinatarios.js";
import { crearPipelineAnalisis } from "./services/analisis.js";
import { crearRevisor } from "./services/documentos/revisor.js";
import { crearPipelineDocumentos } from "./services/documentos/pipeline.js";
import { crearRecordatorios } from "./services/recordatorios.js";
import { crearBloqueo } from "./services/bloqueo.js";
import { crearRetencion } from "./services/retencion.js";
import { crearClienteDrive } from "./services/drive/cliente.js";
import { VigilanteDrive } from "./services/drive/vigilante.js";
import { crearPlanificador } from "./jobs/planificador.js";
import { crearLogger } from "./lib/logger.js";

const log = crearLogger("pakal");

const { errores, avisos } = validar(config);
avisos.forEach((a) => log.warn(a));
if (errores.length) {
    errores.forEach((e) => log.error(e));
    log.error("Configuración incompleta. Copia .env.example a .env y llénalo (ver README).");
    process.exit(1);
}

iniciarFirebase(config);

const correo = new ServicioCorreo(config.correo, config.datos);
const analizador = crearAnalizador(config.ia);
const directorio = crearDirectorio({ db, auth });

const pipeline = crearPipelineAnalisis({
    analizador, correo, directorio, config,
    guardar: async (doc) => (await db().collection("analisis").add({ ...doc, creado: FieldValue.serverTimestamp() })).id
});

const revisor = crearRevisor(config.ia);
const pipelineDocumentos = crearPipelineDocumentos({
    revisor, correo, directorio, config,
    guardar: async (doc) => (await db().collection("revisiones").add({ ...doc, creado: FieldValue.serverTimestamp() })).id
});

let vigilante = null;
if (config.drive.activo) {
    vigilante = new VigilanteDrive({
        cliente: crearClienteDrive(config.drive.cuentaDeServicio),
        carpetas: config.drive.carpetas,
        procesar: pipeline,
        // Documentos sin código (reportes, ensayos) van a la revisión de documentos.
        procesarDocumento: config.drive.revisarDocumentos ? pipelineDocumentos : null,
        dirDatos: config.datos,
        maxBytes: config.drive.maxBytes,
        analizarExistentes: config.drive.analizarExistentes
    });
}

const recordatorios = config.recordatorios.activo ? crearRecordatorios({ db, directorio, correo, config }) : null;
const registrarBloqueo = crearBloqueo({ db, FieldValue, cfg: config.bloqueo });

const app = crearApp({ config, correo, analizador, pipeline, revisor, pipelineDocumentos, vigilante, recordatorios, registrarBloqueo });

const servidor = app.listen(config.servidor.puerto, config.servidor.host, () => {
    log.info(`Mission Control en ${config.servidor.urlPublica}${config.modoDemo ? "  (MODO DEMO · emuladores)" : ""}`);
    log.info(config.correo.dryRun
        ? "Correo: DRY RUN (no envía; guarda .eml en data/outbox)"
        : `Correo: ${correo.disponibles().map((t) => t.nombre).join(" → ") || "sin transporte (todo queda en cola local)"}`);
    log.info(`IA: ${analizador.proveedores.join(" → ")} · documentos: ${revisor.proveedores.join(" → ")}`);
    log.info(vigilante
        ? `Drive: vigilando ${config.drive.carpetas.length} carpeta(s) cada ${config.drive.intervaloSeg}s`
        : "Drive: apagado (DRIVE_WATCH=false)");
});

const planificador = crearPlanificador();
planificador.cada("cola-correo", config.correo.reintentoSeg * 1000, () => correo.procesarCola());
if (vigilante) {
    // Primera vuelta a los 5 s para no competir con el arranque.
    planificador.cada("drive", config.drive.intervaloSeg * 1000, () => vigilante.revisar(), 5000);
}
if (recordatorios) planificador.cada("recordatorios", 60_000, () => recordatorios.tick());
// Borrado por plazos: a los 30 s de arrancar y luego cada 24 h.
const retencion = crearRetencion({ db, Timestamp, config });
planificador.cada("retencion", 24 * 3600_000, () => retencion.ejecutar(), 30_000);

function apagar(senal) {
    log.info(`${senal} recibido, cerrando…`);
    planificador.detener();
    servidor.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGINT", () => apagar("SIGINT"));
process.on("SIGTERM", () => apagar("SIGTERM"));
process.on("unhandledRejection", (e) => log.error("Promesa sin manejar", { error: e?.message || String(e) }));
