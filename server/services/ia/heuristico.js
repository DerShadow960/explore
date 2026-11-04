/**
 * Analizador estático de respaldo.
 * ============================================================
 * Se usa cuando no hay IA disponible (sin API key, sin internet, Ollama
 * apagado). No sustituye a un revisor, pero garantiza que todo archivo
 * subido reciba un reporte útil y su correo: secretos expuestos, código
 * peligroso, deuda técnica y problemas típicos de Arduino.
 */

const LENGUAJES = {
    py: "Python", ipynb: "Python (Jupyter)", js: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
    ts: "TypeScript", tsx: "TypeScript", jsx: "JavaScript", c: "C", h: "C/C++", cpp: "C++", hpp: "C++",
    cc: "C++", ino: "Arduino (C++)", java: "Java", go: "Go", rs: "Rust", m: "MATLAB", sh: "Shell",
    bash: "Shell", ps1: "PowerShell", html: "HTML", css: "CSS", sql: "SQL", json: "JSON", yaml: "YAML",
    yml: "YAML", grc: "GNU Radio", vhd: "VHDL", v: "Verilog", kt: "Kotlin", cs: "C#", php: "PHP", rb: "Ruby", r: "R"
};

/** [regex, severidad, tipo, descripcion, sugerencia, lenguajes|null] */
const REGLAS = [
    [/(?:api[_-]?key|secret|token|password|passwd|contrase(?:ñ|n)a)\s*[:=]\s*["'][^"'\s]{6,}["']/i,
        "critica", "seguridad", "Credencial escrita directamente en el código.",
        "Muévela a una variable de entorno o archivo .env fuera de Drive y rota la credencial expuesta.", null],
    [/AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{10,}/,
        "critica", "seguridad", "Parece una API key real (AWS/Google/OpenAI/GitHub/Slack).",
        "Revócala hoy mismo en el proveedor y usa variables de entorno.", null],
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
        "critica", "seguridad", "Llave privada incluida en el archivo.",
        "Elimínala de Drive, genera un par nuevo y nunca compartas la privada.", null],
    [/\b(?:eval|exec)\s*\(/, "alta", "seguridad", "Uso de eval/exec: ejecuta texto como código.",
        "Reemplázalo por un parser o un diccionario de funciones permitidas.", ["Python", "JavaScript", "TypeScript"]],
    [/subprocess\.[a-zA-Z_]+\([^)]*shell\s*=\s*True/, "alta", "seguridad", "subprocess con shell=True permite inyección de comandos.",
        "Pasa los argumentos como lista y quita shell=True.", ["Python"]],
    [/os\.system\s*\(/, "media", "seguridad", "os.system ejecuta en shell sin escapar argumentos.",
        "Usa subprocess.run([...], check=True).", ["Python"]],
    [/pickle\.loads?\s*\(/, "media", "seguridad", "pickle.load con datos externos puede ejecutar código.",
        "Usa JSON o valida el origen del archivo.", ["Python"]],
    [/verify\s*=\s*False/, "media", "seguridad", "Verificación TLS desactivada.",
        "Quita verify=False o apunta a un bundle de CA.", ["Python"]],
    [/except\s*:\s*(?:#.*)?$/m, "media", "bug", "except sin tipo: atrapa también KeyboardInterrupt y errores de programación.",
        "Captura excepciones concretas (except serial.SerialException:) y regístralas.", ["Python", "Python (Jupyter)"]],
    [/except\s+Exception\s*(?:as\s+\w+)?\s*:\s*\n\s*pass\b/, "media", "bug", "Excepción silenciada con pass.",
        "Al menos registra el error; un fallo de comunicación silencioso es difícil de depurar.", ["Python", "Python (Jupyter)"]],
    [/\binnerHTML\s*=/, "media", "seguridad", "Asignación a innerHTML: riesgo de XSS si el texto viene del usuario.",
        "Usa textContent o crea nodos con createElement.", ["JavaScript", "TypeScript", "HTML"]],
    [/\bdelay\s*\(\s*\d{3,}\s*\)/, "media", "hardware", "delay() largo bloquea el loop: el rotor deja de responder a comandos seriales mientras espera.",
        "Usa millis() para temporizar sin bloquear (patrón BlinkWithoutDelay) o una librería como AccelStepper.", ["Arduino (C++)", "C++", "C/C++"]],
    [/\bString\s+\w+\s*[;=]|\bString\(/, "baja", "hardware", "Uso de la clase String en Arduino: fragmenta la RAM del microcontrolador.",
        "Prefiere arreglos char con tamaño fijo y snprintf.", ["Arduino (C++)"]],
    [/while\s*\(\s*(?:true|1)\s*\)/, "baja", "mantenibilidad", "Bucle infinito explícito.",
        "Asegúrate de que tenga condición de salida o watchdog.", null],
    [/\b(?:TODO|FIXME|HACK|XXX)\b/, "info", "mantenibilidad", "Hay pendientes marcados (TODO/FIXME).",
        "Conviértelos en tareas en Mission Control para que no se pierdan.", null]
];

function extension(nombre) {
    const m = /\.([a-z0-9]+)$/i.exec(nombre || "");
    return m ? m[1].toLowerCase() : "";
}

export function detectarLenguaje(nombre, contenido = "") {
    const ext = extension(nombre);
    if (LENGUAJES[ext]) return LENGUAJES[ext];
    // Documentos (Docs, PDF, docx): adivinar por contenido.
    if (/void\s+setup\s*\(\s*\)[\s\S]*void\s+loop\s*\(\s*\)/.test(contenido)) return "Arduino (C++)";
    if (/^\s*(?:def |import |from \S+ import )/m.test(contenido)) return "Python";
    if (/#include\s*<[^>]+>/.test(contenido)) return "C/C++";
    if (/\b(?:function|const|let)\s+\w+\s*[=(]/.test(contenido)) return "JavaScript";
    return null;
}

/** Busca la primera línea que coincide, para citarla. */
function lineaDe(lineas, re) {
    const r = new RegExp(re.source, re.flags.replace("g", "").replace("m", ""));
    for (let i = 0; i < lineas.length; i++) if (r.test(lineas[i])) return i + 1;
    return null;
}

export function analizarHeuristico({ nombre, contenido }) {
    const texto = String(contenido || "");
    const lineas = texto.split(/\r?\n/);
    const lenguaje = detectarLenguaje(nombre, texto);
    const hallazgos = [];

    if (!texto.trim()) {
        return {
            resumen: "El archivo está vacío o no se pudo extraer texto de él.",
            lenguajes: [], calificacion: null, hallazgos: [], fortalezas: [],
            siguientes_pasos: ["Si el archivo es una imagen o un PDF escaneado, sube el código fuente como texto."]
        };
    }

    for (const [re, severidad, tipo, descripcion, sugerencia, aplica] of REGLAS) {
        if (aplica && lenguaje && !aplica.includes(lenguaje)) continue;
        if (aplica && !lenguaje) continue;
        if (!re.test(texto)) continue;
        const linea = re.flags.includes("m") ? null : lineaDe(lineas, re);
        hallazgos.push({ severidad, tipo, ubicacion: linea ? `línea ${linea}` : "", descripcion, sugerencia });
    }

    const largas = lineas.filter((l) => l.length > 140).length;
    if (largas > 5) {
        hallazgos.push({ severidad: "baja", tipo: "estilo", ubicacion: "", descripcion: `${largas} líneas de más de 140 caracteres.`, sugerencia: "Parte expresiones largas; un formateador (black, prettier, clang-format) lo resuelve solo." });
    }

    const comentarios = lineas.filter((l) => /^\s*(#|\/\/|\/\*|\*)/.test(l)).length;
    const codigo = lineas.filter((l) => l.trim()).length;
    const ratio = codigo ? comentarios / codigo : 0;
    if (codigo > 60 && ratio < 0.03) {
        hallazgos.push({ severidad: "baja", tipo: "documentacion", ubicacion: "", descripcion: "Casi no hay comentarios para el tamaño del archivo.", sugerencia: "Documenta al menos el propósito de cada función y las unidades (grados, Hz, pasos)." });
    }

    const pesos = { critica: 4, alta: 2, media: 1, baja: 0.4, info: 0 };
    const castigo = hallazgos.reduce((s, h) => s + pesos[h.severidad], 0);
    const calificacion = Math.max(1, Math.min(10, Math.round(9 - castigo)));

    const fortalezas = [];
    if (ratio >= 0.1) fortalezas.push("Buen nivel de comentarios.");
    if (!hallazgos.some((h) => h.tipo === "seguridad")) fortalezas.push("No se detectaron credenciales ni patrones inseguros evidentes.");
    if (/\bdef test_|\bdescribe\(|\bit\(|unittest|pytest/.test(texto)) fortalezas.push("Incluye pruebas automatizadas.");

    return {
        resumen: `Análisis estático automático (sin IA disponible en este momento). ` +
            `${lenguaje ? `Código en ${lenguaje}, ` : ""}${codigo} líneas no vacías; ` +
            `${hallazgos.length ? `se marcaron ${hallazgos.length} puntos a revisar.` : "no se encontraron problemas con las reglas básicas."}`,
        lenguajes: lenguaje ? [lenguaje] : [],
        calificacion,
        hallazgos,
        fortalezas,
        siguientes_pasos: hallazgos.filter((h) => ["critica", "alta"].includes(h.severidad)).map((h) => h.sugerencia).slice(0, 4)
            .concat(["Configura GEMINI_API_KEY para obtener una revisión completa con IA."])
    };
}
