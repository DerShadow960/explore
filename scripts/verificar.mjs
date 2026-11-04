#!/usr/bin/env node
/**
 * Revisa que la máquina tenga todo lo necesario antes de `npm run demo`.
 *   npm run verificar
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let fallas = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const mal = (m, como) => { fallas++; console.log(`  ❌ ${m}${como ? `\n     → ${como}` : ""}`); };
const aviso = (m) => console.log(`  ⚠️  ${m}`);

console.log("\nRevisando dependencias de PAKAL Mission Control…\n");

// Node
const [ma, mi] = process.versions.node.split(".").map(Number);
if (ma > 22 || (ma === 22 && mi >= 13)) ok(`Node ${process.versions.node}`);
else mal(`Node ${process.versions.node} (se necesita 22.13 o más)`, "Instala Node 22 LTS o 24: https://nodejs.org");

// Java (java -version escribe en stderr)
{
    const r = spawnSync("java", ["-version"], { encoding: "utf8", shell: process.platform === "win32" });
    const texto = `${r.stderr || ""}${r.stdout || ""}`;
    const m = texto.match(/version "(\d+)/);
    if (r.error || !m) mal("Java no está instalado (o no está en el PATH)", "Instala un JDK 21: https://adoptium.net (en Arch: sudo pacman -S jdk21-openjdk)");
    else if (Number(m[1]) >= 21) ok(`Java ${m[1]}`);
    else mal(`Java ${m[1]} (los emuladores de Firebase piden 21 o más)`, "Instala un JDK 21: https://adoptium.net");
}

// node_modules
if (fs.existsSync(path.join(RAIZ, "node_modules", "firebase-tools"))) ok("Dependencias instaladas (node_modules)");
else mal("Faltan las dependencias", "Corre: npm install");

// .env
const env = path.join(RAIZ, ".env");
if (!fs.existsSync(env)) {
    mal("No existe .env", "Corre: cp .env.example .env   (en Windows: copy .env.example .env)");
} else {
    ok(".env existe");
    // En Linux/Mac, .env con llaves no debe ser legible por otros usuarios del equipo.
    if (process.platform !== "win32") {
        const modo = fs.statSync(env).mode & 0o077;
        if (modo) aviso("Otros usuarios de esta máquina pueden leer .env (tiene tus llaves). Corre: chmod 600 .env");
        else ok("Permisos de .env correctos (solo tú lo lees)");
    }
    const t = fs.readFileSync(env, "utf8");
    const valor = (k) => (t.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] || "").trim();
    if (valor("PAKAL_DEMO") !== "true") aviso("PAKAL_DEMO no está en true: el servidor se negará a arrancar (o tocaría producción).");
    if (!valor("GEMINI_API_KEY")) aviso("GEMINI_API_KEY vacío: el análisis será el estático (sin IA).");
    else ok("GEMINI_API_KEY puesto");
    if (!valor("GMAIL_USER") || !valor("GMAIL_APP_PASSWORD")) aviso("Sin Gmail: los correos se quedarán en la cola local (data/outbox).");
    else ok("Gmail configurado");
    if (!valor("ANALISIS_DESTINATARIOS")) mal("ANALISIS_DESTINATARIOS vacío", "Pon tu correo: ANALISIS_DESTINATARIOS=tucorreo@gmail.com");
    else ok(`Los reportes llegan a: ${valor("ANALISIS_DESTINATARIOS")}`);
}

// Puertos (la app usa PORT del .env)
let puertoApp = 8080;
try { puertoApp = Number((fs.readFileSync(env, "utf8").match(/^PORT=(\d+)/m) || [])[1]) || 8080; } catch { /* sin .env */ }
const libre = (p) => new Promise((r) => {
    const s = net.createServer().once("error", () => r(false)).once("listening", () => s.close(() => r(true)));
    s.listen(p, "127.0.0.1");
});
for (const [p, que] of [[puertoApp, "app"], [8085, "emulador Firestore"], [9099, "emulador Auth"], [4000, "UI de emuladores"]]) {
    if (await libre(p)) ok(`Puerto ${p} libre (${que})`);
    else mal(`Puerto ${p} ocupado (${que})`, `Cierra lo que lo use. Linux/Mac: lsof -i :${p} · Windows: netstat -ano | findstr :${p}`);
}

console.log(fallas ? `\n${fallas} cosa(s) por arreglar antes de arrancar.\n` : "\nTodo listo. Corre: npm run demo\n");
process.exit(fallas ? 1 : 0);
