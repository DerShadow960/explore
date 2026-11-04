#!/usr/bin/env node
/**
 * Prueba de correo de punta a punta.
 *
 *   npm run correo:probar -- tu@correo.com
 *
 * 1. Verifica las credenciales de cada transporte configurado.
 * 2. Manda un correo de prueba real.
 * 3. Si no sale, dice exactamente por qué y deja el .eml en data/outbox/.
 * Código de salida 0 solo si el correo SALIÓ.
 */

import { config } from "../server/config.js";
import { ServicioCorreo } from "../server/services/correo/index.js";
import { correoPrueba } from "../server/services/plantillas.js";

const para = process.argv[2] || config.analisis.destinatariosFijos[0];
if (!para) {
    console.error("Uso: npm run correo:probar -- destinatario@correo.com   (o define ANALISIS_DESTINATARIOS)");
    process.exit(2);
}

const correo = new ServicioCorreo(config.correo, config.datos);
const transportes = correo.disponibles().map((t) => t.nombre);

console.log(`\nTransportes configurados (en orden): ${transportes.join(" → ") || "NINGUNO"}`);
if (config.correo.dryRun) console.log("⚠  MAIL_DRY_RUN=true: no se enviará nada de verdad.");

console.log("\n1) Verificando credenciales…");
const verif = await correo.verificar();
for (const [nombre, r] of Object.entries(verif)) {
    console.log(`   ${r.ok ? "✅" : "❌"} ${nombre}${r.ok ? "" : ": " + r.error}`);
}

console.log(`\n2) Enviando correo de prueba a ${para}…`);
const m = correoPrueba({ urlApp: config.servidor.urlPublica, via: transportes.join(", ") });
const r = await correo.enviar({ para, asunto: m.asunto, html: m.html, texto: m.texto, etiqueta: "prueba" });

if (r.enviados.length) {
    console.log(`   ✅ ENVIADO por ${r.enviados[0].via} (id ${r.enviados[0].id}). Revisa también spam.`);
    // Si el correo ya funciona, aprovechamos para vaciar lo que estuviera en cola.
    const pendientes = correo.estado().pendientes;
    if (pendientes) {
        console.log(`\n3) Había ${pendientes} correo(s) en cola; reenviando…`);
        const c = await correo.procesarCola({ forzar: true });
        console.log(`   ${c.enviados}/${c.reintentados} reenviados.`);
    }
    process.exit(0);
}
console.log("   ❌ No salió. Quedó en la cola y se reintentará automáticamente con el servidor encendido.");
for (const e of r.encolados[0]?.errores || []) console.log(`      · ${e}`);
console.log(`
Cómo arreglarlo:
  · Gmail: activa verificación en 2 pasos y crea una "Contraseña de aplicación"
    en https://myaccount.google.com/apppasswords → GMAIL_USER y GMAIL_APP_PASSWORD.
  · Resend: con onboarding@resend.dev solo puedes mandarte a TU correo de registro;
    para otros destinatarios verifica un dominio.
  · Revisa que tu red no bloquee el puerto 465/587.`);
process.exit(1);
