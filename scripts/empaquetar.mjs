#!/usr/bin/env node
/**
 * Genera pakal-mission-control.zip SIN secretos ni datos locales:
 * excluye node_modules, data/, .env y cualquier JSON de cuenta de servicio.
 * Requiere `zip` en el sistema (pacman -S zip).
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { RAIZ } from "../server/config.js";

// Nunca empaquetar credenciales: .env.example tiene que ir con los secretos vacíos.
const ejemplo = fs.readFileSync(path.join(RAIZ, ".env.example"), "utf8");
const conValor = ["GEMINI_API_KEY", "GMAIL_APP_PASSWORD", "RESEND_API_KEY", "SMTP_PASS", "ANTHROPIC_API_KEY"]
    .filter((k) => new RegExp(`^${k}=\\S`, "m").test(ejemplo));
if (conValor.length) {
    console.error(`✖ .env.example tiene credenciales (${conValor.join(", ")}). Déjalas vacías antes de empaquetar.`);
    process.exit(1);
}

const salida = path.resolve(RAIZ, "..", "pakal-mission-control.zip");
if (fs.existsSync(salida)) fs.rmSync(salida);

const nombre = path.basename(RAIZ);
execFileSync("zip", [
    "-r", "-q", salida, nombre,
    "-x", `${nombre}/node_modules/*`, `${nombre}/data/*`, `${nombre}/.env`, `${nombre}/.env.*.local`,
    `${nombre}/secrets/*.json`, `${nombre}/*serviceAccount*.json`, `${nombre}/*-firebase-adminsdk-*.json`,
    `${nombre}/*.log`, `${nombre}/.git/*`
], { cwd: path.dirname(RAIZ), stdio: "inherit" });

console.log(`✅ ${salida} (${(fs.statSync(salida).size / 1024 / 1024).toFixed(1)} MB)`);
