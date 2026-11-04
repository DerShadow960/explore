/**
 * Fechas en zona de CDMX. Se comparan cadenas YYYY-MM-DD en vez de
 * restar milisegundos para que cambios de horario no corran los días.
 */

export const TZ = "America/Mexico_City";

export function ymd(fecha, tz = TZ) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit"
    }).format(fecha);
}

export function diasEntre(desdeYmd, hastaYmd) {
    const [a1, a2, a3] = desdeYmd.split("-").map(Number);
    const [b1, b2, b3] = hastaYmd.split("-").map(Number);
    return Math.round((Date.UTC(b1, b2 - 1, b3) - Date.UTC(a1, a2 - 1, a3)) / 86400000);
}

export function fechaLegible(fecha, tz = TZ) {
    return new Intl.DateTimeFormat("es-MX", {
        timeZone: tz, weekday: "long", day: "numeric", month: "long"
    }).format(fecha);
}

export function fechaHoraLegible(fecha, tz = TZ) {
    return new Intl.DateTimeFormat("es-MX", {
        timeZone: tz, dateStyle: "medium", timeStyle: "short"
    }).format(fecha);
}

/** Hora (0-23) actual en la zona dada. */
export function horaLocal(fecha = new Date(), tz = TZ) {
    return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false }).format(fecha)) % 24;
}
