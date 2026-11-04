/** Escapado para HTML. Todo texto que venga de usuarios, de Drive o de la IA pasa por aquí. */
export function escapar(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/** Recorta sin partir un carácter surrogate. */
export function recortar(s, max) {
    const arr = Array.from(String(s ?? ""));
    return arr.length <= max ? arr.join("") : arr.slice(0, max - 1).join("") + "…";
}
