/**
 * Proceso aislado para extraer texto de PDF y Word (ver extraerTexto en extractor.js).
 * Corre con su propio tope de memoria: un archivo malicioso solo puede tumbar este proceso.
 */
import { extraerTextoDirecto, MAX_TEXTO } from "./extractor.js";

process.once("message", async ({ buf, tipo }) => {
    try {
        const texto = await extraerTextoDirecto(Buffer.from(buf), tipo);
        process.send({ ok: true, texto: texto.slice(0, MAX_TEXTO) }, () => process.exit(0));
    } catch (e) {
        const msg = e.message.startsWith("El archivo parece binario") ? e.message : "No se pudo leer el archivo.";
        process.send({ ok: false, error: msg }, () => process.exit(0));
    }
});
