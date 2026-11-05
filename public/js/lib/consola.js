/**
 * Disuasión de la consola del navegador.
 * ============================================================
 * OJO: esto NO es seguridad. Cualquiera puede abrir DevTools desde el menú
 * del navegador, con otro navegador o con curl. Lo que protege los datos son
 * las reglas de Firestore y el servidor. Esto solo:
 *   1) avisa en la consola (contra el "pega este código aquí" / self-XSS),
 *   2) bloquea los atajos de teclado y el clic derecho → Inspeccionar,
 *   3) fuera del modo demo, calla console.log/info/debug para no dar pistas.
 */

const ATAJOS = new Set(["I", "J", "C", "K"]);

function esAtajoDevTools(e) {
    const tecla = (e.key || "").toUpperCase();
    if (e.key === "F12") return true;
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && ATAJOS.has(tecla)) return true;   // Ctrl+Shift+I/J/C/K
    if (e.metaKey && e.altKey && ATAJOS.has(tecla)) return true;                    // ⌘⌥I/J/C en Mac
    if ((e.ctrlKey || e.metaKey) && tecla === "U") return true;                     // ver código fuente
    return false;
}

const esCampoDeTexto = (el) => el?.closest?.("input, textarea, [contenteditable='true']");

export function protegerConsola({ demo = false } = {}) {
    // 1) Aviso visible para quien abra la consola.
    const titulo = "color:#d93025;font-size:32px;font-weight:bold;";
    const cuerpo = "font-size:15px;";
    console.log("%c¡Alto!", titulo);
    console.log("%cEsta consola es para desarrolladores. Si alguien te pidió pegar algo aquí, " +
        "es un intento de robarte la cuenta de PAKAL Mission Control. Ciérrala.", cuerpo);

    // 2) Atajos y menú contextual (en campos de texto se deja el clic derecho para pegar).
    document.addEventListener("keydown", (e) => {
        if (esAtajoDevTools(e)) { e.preventDefault(); e.stopPropagation(); }
    }, { capture: true });
    document.addEventListener("contextmenu", (e) => {
        if (!esCampoDeTexto(e.target)) e.preventDefault();
    }, { capture: true });

    // 3) En el servidor real, sin logs informativos (warn y error se quedan para depurar).
    if (!demo) {
        const nada = () => {};
        console.log = nada;
        console.info = nada;
        console.debug = nada;
    }
}

// Exportado para pruebas.
export const _interno = { esAtajoDevTools };
