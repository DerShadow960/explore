/**
 * Minimización de datos personales antes de mandar texto a un proveedor de IA en la nube.
 * ============================================================
 * Los términos de la capa gratuita de Gemini piden no enviar datos personales
 * (Google puede usarlos para mejorar sus productos y revisarlos personas).
 * Aquí se quitan los identificadores que se pueden reconocer con seguridad:
 * correos, teléfonos, CURP, RFC, números de tarjeta y cuentas CLABE.
 *
 * Límite honesto: no se pueden quitar los nombres propios que aparezcan dentro
 * del texto sin borrar también contenido legítimo. Por eso el nombre del
 * autor nunca se manda, y para uso real con estudiantes se recomienda la
 * capa de pago (sin uso de datos para entrenamiento).
 *
 * El análisis local (heurístico y similitud) recibe el texto original: no sale
 * de la máquina.
 */

const PATRONES = [
    // Correos
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[correo]"],
    // CURP (18 caracteres)
    [/\b[A-Z][AEIOUX][A-Z]{2}\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[HM][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d\b/g, "[CURP]"],
    // RFC de persona física (13) o moral (12)
    [/\b[A-ZÑ&]{3,4}\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[A-Z\d]{3}\b/g, "[RFC]"],
    // CLABE (18 dígitos) y tarjetas (13 a 19 dígitos, con o sin separadores)
    [/\b\d{18}\b/g, "[cuenta]"],
    [/\b(?:\d[ -]?){12,18}\d\b/g, "[tarjeta]"],
    // Teléfonos de México: +52, 55 1234 5678, (55) 1234-5678, 5512345678
    [/(?:\+?52[\s.-]?)?(?:\(?\d{2,3}\)?[\s.-]?)\d{3,4}[\s.-]?\d{4}\b/g, "[teléfono]"]
];

/**
 * @param {string} texto
 * @returns {{texto: string, quitados: number}}
 */
export function redactarDatosPersonales(texto) {
    let out = String(texto ?? "");
    let quitados = 0;
    for (const [re, reemplazo] of PATRONES) {
        out = out.replace(re, (m) => {
            // Un número corto aislado (ej. "137600000") no es teléfono: exigir 10 dígitos reales.
            if (reemplazo === "[teléfono]" && m.replace(/\D/g, "").length < 10) return m;
            quitados++;
            return reemplazo;
        });
    }
    return { texto: out, quitados };
}
