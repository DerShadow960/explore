// Pruebas de la lógica de fechas de los recordatorios.
// No tocan Firestore ni mandan correos: node recordatorios.test.mjs
import { ymd, diasEntre, construirHtml } from "./recordatorios.mjs";

let pass = 0, fail = 0;
function comprobar(nombre, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    console.log(ok ? "  ✅" : "  ❌", nombre, ok ? "" : `→ obtuve ${JSON.stringify(real)}, esperaba ${JSON.stringify(esperado)}`);
    ok ? pass++ : fail++;
}

console.log("\n=== ymd() usa la zona horaria de CDMX, no UTC ===");
// 2026-09-02 02:00 UTC = 2026-09-01 20:00 en CDMX (UTC-6)
comprobar("02:00 UTC cuenta como el día anterior en CDMX",
    ymd(new Date("2026-09-02T02:00:00Z")), "2026-09-01");
comprobar("18:00 UTC es el mismo día en CDMX",
    ymd(new Date("2026-09-01T18:00:00Z")), "2026-09-01");
// La tarea se guarda a las 23:59:59 hora local = 05:59:59 UTC del día siguiente
comprobar("límite 23:59 local no se corre al día siguiente",
    ymd(new Date("2026-09-02T05:59:59Z")), "2026-09-01");

console.log("\n=== diasEntre() ===");
comprobar("mismo día = 0",        diasEntre("2026-09-01", "2026-09-01"), 0);
comprobar("mañana = 1",           diasEntre("2026-09-01", "2026-09-02"), 1);
comprobar("en 3 días",            diasEntre("2026-09-01", "2026-09-04"), 3);
comprobar("en 7 días",            diasEntre("2026-09-01", "2026-09-08"), 7);
comprobar("cruzando fin de mes",  diasEntre("2026-08-30", "2026-09-06"), 7);
comprobar("cruzando fin de año",  diasEntre("2026-12-28", "2027-01-04"), 7);
comprobar("año bisiesto",         diasEntre("2028-02-25", "2028-03-03"), 7);
comprobar("vencida = negativo",   diasEntre("2026-09-10", "2026-09-08"), -2);

console.log("\n=== disparo de avisos (7, 3, 1) ===");
const AVISOS = [7, 3, 1];
const casos = [[7, true], [6, false], [5, false], [4, false], [3, true], [2, false], [1, true], [0, false], [-1, false]];
casos.forEach(([dias, esperado]) =>
    comprobar(`${dias} días → ${esperado ? "avisa" : "calla"}`, AVISOS.includes(dias), esperado));

console.log("\n=== plantilla HTML ===");
const html = construirHtml("Rafael Perez", [
    { titulo: "Instalar antena QFH", equipo: "Telecomunicaciones", responsable: "Rafa", dias: 1, fechaTexto: "martes 1 de septiembre" }
]);
comprobar("incluye el nombre",     html.includes("Rafael Perez"), true);
comprobar("incluye el título",     html.includes("Instalar antena QFH"), true);
comprobar("dice 'mañana' si dias=1", html.includes("Vence mañana"), true);

const htmlXss = construirHtml("<script>alert(1)</script>", [
    { titulo: "<img src=x onerror=alert(1)>", equipo: "Control", responsable: "X", dias: 3, fechaTexto: "hoy" }
]);
comprobar("escapa el nombre",  htmlXss.includes("<script>alert(1)</script>"), false);
comprobar("escapa el título",  htmlXss.includes("<img src=x"), false);

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
