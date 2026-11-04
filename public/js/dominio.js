/**
 * Dominio compartido — PAKAL Mission Control
 * ============================================================
 * ÚNICA fuente de verdad de campus, áreas, estados y límites.
 * Lo importan el navegador (public/js/*) y el servidor (server/*),
 * así que este archivo NO puede tocar `window`, `document` ni Node.
 *
 * Si cambias algo aquí, revisa también firestore.rules: las reglas
 * no pueden importar JS y repiten estas listas a mano.
 */

export const CAMPUS = Object.freeze(["Mixcoac", "CDUP"]);
export const CAMPUS_COORDINACION = "General";          // ve todos los campus

export const EQUIPOS_POR_CAMPUS = Object.freeze({
    Mixcoac: Object.freeze(["Telecomunicaciones", "Control", "Operaciones"]),
    CDUP: Object.freeze(["Telecomunicaciones"])
});

export const EQUIPOS = Object.freeze(["Telecomunicaciones", "Control", "Operaciones"]);

/** No es un área: solo habilita la bitácora de accesos y el panel de IA global. */
export const EQUIPO_AUDITORIA = "Auditoria";

export const CANAL_GLOBAL = "General";
export const DOMINIO_PERMITIDO = "up.edu.mx";

export const ESTADOS = Object.freeze(["No empezado", "En proceso", "Completado"]);

export const LIMITES = Object.freeze({
    titulo: 199,
    responsable: 99,
    mensaje: 999,
    navegador: 199
});

export const INFO_EQUIPOS = Object.freeze({
    Telecomunicaciones: {
        titulo: "Telecomunicaciones",
        img: "/assets/IMAGEN_TELECOM.jpg",
        drive: "https://drive.google.com/drive/folders/1KQGeEaQ7SW6kmWfgUdt4HZteyOwkOltx"
    },
    Control: {
        titulo: "Sistemas de Control",
        img: "/assets/IMAGEN_CONTROL.jpg",
        drive: "https://drive.google.com/drive/folders/1zCVAajjlZ3BLmskyQUjuXxSkY7AUs6Do"
    },
    Operaciones: {
        titulo: "Dirección de Operaciones",
        img: "/assets/atlanta2.png",
        drive: "https://drive.google.com/drive/folders/1K1ToaZ3pDK-QLPp8l4OQcxXzUKo7kpE9"
    }
});

export function tituloEquipo(equipo) {
    return INFO_EQUIPOS[equipo]?.titulo || equipo;
}

export function equiposDelCampus(campus) {
    return EQUIPOS_POR_CAMPUS[campus] || [];
}

// ------------------------------------------------------------
// Permisos (puros: reciben el perfil, no leen estado global).
// Son ESPEJO de firestore.rules: deciden qué se muestra; la
// seguridad real la imponen las reglas en el servidor.
// ------------------------------------------------------------
export function equiposDe(perfil) {
    return perfil && Array.isArray(perfil.equipos) ? perfil.equipos : [];
}

export function puedeEntrarACampus(perfil, campus) {
    if (!perfil || !campus) return false;
    return perfil.campus === CAMPUS_COORDINACION || perfil.campus === campus;
}

export function puedeEditar(perfil, equipo, campus) {
    return equiposDe(perfil).includes(equipo)
        && equiposDelCampus(campus).includes(equipo)
        && puedeEntrarACampus(perfil, campus);
}

export function esAuditor(perfil) {
    return equiposDe(perfil).includes(EQUIPO_AUDITORIA);
}

export function esCoordinacion(perfil) {
    return !!perfil && perfil.campus === CAMPUS_COORDINACION;
}

export function perfilValido(perfil) {
    return !!perfil
        && (CAMPUS.includes(perfil.campus) || perfil.campus === CAMPUS_COORDINACION)
        && Array.isArray(perfil.equipos)
        && typeof perfil.nombre === "string" && perfil.nombre.length > 0;
}
