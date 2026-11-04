/**
 * Plantillas de correo (HTML con estilos en línea + versión texto).
 * Todo valor externo pasa por escapar(): nombres de archivo, texto de
 * la IA, títulos de tareas. Un reporte de IA no debe poder inyectar HTML.
 */

import { escapar } from "../lib/html.js";
import { tituloEquipo } from "../../public/js/dominio.js";

const COLOR_SEV = { critica: "#b71c1c", alta: "#d84315", media: "#ef8f00", baja: "#2e7d32", info: "#546e7a" };
const NOMBRE_SEV = { critica: "Crítica", alta: "Alta", media: "Media", baja: "Baja", info: "Info" };

function marco(titulo, subtitulo, cuerpo, urlApp, pie) {
    return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:24px;background:#f4f6f8;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" style="max-width:680px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e0e0e0;border-collapse:collapse;">
  <tr><td style="background:#0b0c10;padding:20px 24px;">
    <div style="color:#66fcf1;font-size:19px;font-weight:bold;">${escapar(titulo)}</div>
    <div style="color:#c5c6c7;font-size:13px;">${escapar(subtitulo)}</div>
  </td></tr>
  ${cuerpo}
  <tr><td style="padding:8px 24px 22px;">
    <a href="${escapar(urlApp)}" style="display:inline-block;background:#45a29e;color:#0b0c10;padding:11px 20px;border-radius:5px;text-decoration:none;font-weight:bold;font-size:14px;">Abrir Mission Control</a>
  </td></tr>
  <tr><td style="padding:14px 24px 22px;color:#999;font-size:12px;border-top:1px solid #eee;">${escapar(pie)}</td></tr>
</table></body></html>`;
}

const lista = (items) => items.length
    ? `<ul style="margin:6px 0 0;padding-left:20px;color:#333;font-size:14px;">${items.map((i) => `<li style="margin:3px 0;">${escapar(i)}</li>`).join("")}</ul>`
    : `<p style="margin:6px 0 0;color:#888;font-size:14px;">—</p>`;

export function correoAnalisis({ archivo, carpeta, analisis, urlApp }) {
    const r = analisis.resultado;
    const area = `${tituloEquipo(carpeta.equipo)} · ${carpeta.campus}`;
    const criticos = r.hallazgos.filter((h) => h.severidad === "critica" || h.severidad === "alta").length;
    const calif = r.calificacion ? `${r.calificacion}/10` : "s/c";
    const colorCalif = !r.calificacion ? "#546e7a" : r.calificacion >= 8 ? "#2e7d32" : r.calificacion >= 5 ? "#ef8f00" : "#b71c1c";

    const asunto = `${criticos ? "⚠️" : "🧠"} Análisis IA: ${archivo.name} (${calif}${criticos ? ` · ${criticos} grave${criticos > 1 ? "s" : ""}` : ""})`;

    const filas = r.hallazgos.map((h) => `
      <tr><td style="padding:10px 12px;border-bottom:1px solid #eee;vertical-align:top;">
        <span style="display:inline-block;background:${COLOR_SEV[h.severidad]};color:#fff;font-size:11px;font-weight:bold;padding:2px 7px;border-radius:3px;">${NOMBRE_SEV[h.severidad]}</span>
        <span style="color:#666;font-size:12px;margin-left:6px;">${escapar(h.tipo)}${h.ubicacion ? " · " + escapar(h.ubicacion) : ""}</span>
        <div style="color:#111;font-size:14px;margin-top:6px;">${escapar(h.descripcion)}</div>
        ${h.sugerencia ? `<div style="color:#2e5d5a;font-size:13px;margin-top:4px;">→ ${escapar(h.sugerencia)}</div>` : ""}
      </td></tr>`).join("");

    const cuerpo = `
  <tr><td style="padding:22px 24px 4px;">
    <table role="presentation" width="100%"><tr>
      <td style="vertical-align:top;">
        <div style="font-size:16px;font-weight:bold;color:#111;word-break:break-all;">${escapar(archivo.name)}</div>
        <div style="color:#666;font-size:13px;margin-top:3px;">${escapar(area)}${archivo.autor ? " · subido por " + escapar(archivo.autor) : ""}</div>
        ${r.lenguajes.length ? `<div style="color:#666;font-size:13px;">${escapar(r.lenguajes.join(", "))}</div>` : ""}
      </td>
      <td style="text-align:right;vertical-align:top;white-space:nowrap;">
        <div style="font-size:28px;font-weight:bold;color:${colorCalif};">${escapar(calif)}</div>
        <div style="color:#999;font-size:11px;">calificación</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:12px 24px;">
    <div style="background:#f0f7f7;border-left:4px solid #45a29e;padding:12px 14px;color:#222;font-size:14px;line-height:1.5;">${escapar(r.resumen)}</div>
  </td></tr>
  ${r.hallazgos.length ? `<tr><td style="padding:8px 24px 0;"><div style="font-weight:bold;color:#111;font-size:15px;">Hallazgos (${r.hallazgos.length})</div></td></tr>
  <tr><td style="padding:4px 12px 0;"><table role="presentation" width="100%" style="border-collapse:collapse;">${filas}</table></td></tr>` : ""}
  <tr><td style="padding:16px 24px 0;">
    <div style="font-weight:bold;color:#111;font-size:15px;">Lo que está bien</div>${lista(r.fortalezas)}
  </td></tr>
  <tr><td style="padding:16px 24px 8px;">
    <div style="font-weight:bold;color:#111;font-size:15px;">Siguientes pasos</div>${lista(r.siguientes_pasos)}
  </td></tr>
  ${/^https:\/\//.test(archivo.webViewLink || "") ? `<tr><td style="padding:8px 24px 0;"><a href="${escapar(archivo.webViewLink)}" style="color:#1a73e8;font-size:14px;">📄 Abrir el archivo en Drive</a></td></tr>` : ""}`;

    const pie = `Análisis automático generado por ${analisis.proveedor}${analisis.modelo ? " (" + analisis.modelo + ")" : ""}` +
        `${analisis.truncado ? " sobre una versión recortada del archivo" : ""}. Puede equivocarse: revísalo antes de actuar.`;

    const texto = [
        `Análisis IA — ${archivo.name}`,
        `${area}${archivo.autor ? " · subido por " + archivo.autor : ""}`,
        `Calificación: ${calif}`,
        "", r.resumen, "",
        ...r.hallazgos.map((h) => `[${NOMBRE_SEV[h.severidad]}] ${h.tipo}${h.ubicacion ? " (" + h.ubicacion + ")" : ""}: ${h.descripcion}${h.sugerencia ? "\n   → " + h.sugerencia : ""}`),
        "", "Siguientes pasos:", ...r.siguientes_pasos.map((s) => "- " + s),
        "", /^https:\/\//.test(archivo.webViewLink || "") ? archivo.webViewLink : "", "", pie
    ].join("\n");

    return { asunto, html: marco("PAKAL · Análisis de código", "Explore UP · CubeSat 3U", cuerpo, urlApp, pie), texto };
}

export function correoRecordatorio({ nombre, tareas, urlApp }) {
    const filas = tareas.map((t) => {
        const color = t.dias <= 1 ? "#c62828" : t.dias <= 3 ? "#ef6c00" : "#2e7d32";
        const cuando = t.dias === 1 ? "mañana" : `en ${t.dias} días`;
        return `<tr>
          <td style="padding:12px 14px;border-bottom:1px solid #e6e6e6;">
            <strong style="color:#111;">${escapar(t.titulo)}</strong><br>
            <span style="color:#666;font-size:13px;">${escapar(tituloEquipo(t.equipo))} · ${escapar(t.campus || "")} · Responsable: ${escapar(t.responsable)}</span>
          </td>
          <td style="padding:12px 14px;border-bottom:1px solid #e6e6e6;text-align:right;white-space:nowrap;">
            <span style="color:${color};font-weight:bold;">Vence ${cuando}</span><br>
            <span style="color:#666;font-size:13px;">${escapar(t.fechaTexto)}</span>
          </td></tr>`;
    }).join("");

    const cuerpo = `
  <tr><td style="padding:22px 24px 6px;">
    <p style="margin:0 0 6px;color:#111;font-size:15px;">Hola ${escapar(nombre)},</p>
    <p style="margin:0;color:#555;font-size:14px;">${tareas.length === 1 ? "Tienes una tarea próxima a vencer:" : `Tienes ${tareas.length} tareas próximas a vencer:`}</p>
  </td></tr>
  <tr><td style="padding:14px 10px 6px;"><table role="presentation" width="100%" style="border-collapse:collapse;">${filas}</table></td></tr>`;

    const urgente = Math.min(...tareas.map((t) => t.dias));
    const asunto = tareas.length === 1
        ? `⏰ "${tareas[0].titulo}" vence ${urgente === 1 ? "mañana" : `en ${urgente} días`}`
        : `⏰ ${tareas.length} tareas de PAKAL por vencer`;
    const texto = [`Hola ${nombre},`, "", ...tareas.map((t) => `- ${t.titulo} (${t.equipo}) vence ${t.dias === 1 ? "mañana" : `en ${t.dias} días`}`), "", urlApp].join("\n");

    return {
        asunto,
        html: marco("PAKAL Mission Control", "Explore UP · CubeSat 3U", cuerpo, urlApp, "Correo automático. Se envía antes de cada fecha límite."),
        texto
    };
}

export function correoPrueba({ urlApp, via }) {
    const cuerpo = `<tr><td style="padding:22px 24px;"><p style="margin:0;color:#111;font-size:15px;">✅ Si lees esto, el correo de PAKAL Mission Control funciona.</p>
      <p style="color:#666;font-size:13px;">Enviado el ${escapar(new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" }))}${via ? " · transportes: " + escapar(via) : ""}.</p></td></tr>`;
    return {
        asunto: "✅ Prueba de correo — PAKAL Mission Control",
        html: marco("PAKAL Mission Control", "Prueba de correo", cuerpo, urlApp, "Correo de prueba."),
        texto: "Si lees esto, el correo de PAKAL Mission Control funciona."
    };
}

const COLOR_NIVEL = { alta: "#b71c1c", media: "#ef8f00", baja: "#2e7d32", ninguna: "#2e7d32" };
const TEXTO_NIVEL = { alta: "Coincidencia alta", media: "Coincidencia media", baja: "Coincidencia baja", ninguna: "Sin coincidencias" };
const fechaCorta = (iso) => { try { return new Date(iso).toLocaleDateString("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "short", year: "numeric" }); } catch { return ""; } };

export function correoRevision({ archivo, carpeta, doc, urlApp }) {
    const s = doc.similitud;
    const r = doc.revision;
    const area = `${tituloEquipo(carpeta.equipo)} · ${carpeta.campus}`;
    const color = COLOR_NIVEL[s.nivel];
    const ajenas = s.coincidencias.filter((c) => !c.esVersionPropia);
    const propias = s.coincidencias.filter((c) => c.esVersionPropia);

    const asunto = `${s.nivel === "alta" ? "⚠️" : "📄"} Revisión de documento: ${archivo.name} (${s.porcentajeTotal}% coincidencia interna${r.citas_faltantes.length ? ` · ${r.citas_faltantes.length} cita(s) por revisar` : ""})`;

    const bloqueCoincidencia = (c) => `
      <tr><td style="padding:10px 12px;border-bottom:1px solid #eee;">
        <div style="font-size:14px;color:#111;"><strong>${escapar(c.nombre)}</strong>
          <span style="color:#666;font-size:12px;">· ${escapar(tituloEquipo(c.equipo))} · ${escapar(fechaCorta(c.fecha))}</span>
          <span style="float:right;font-weight:bold;color:${COLOR_NIVEL[c.esVersionPropia ? "baja" : (c.porcentaje >= 40 ? "alta" : c.porcentaje >= 15 ? "media" : "baja")]};">${escapar(c.porcentaje)}%</span></div>
        ${c.pasajes.slice(0, 3).map((p) => `<div style="margin-top:6px;padding:6px 10px;background:#fff8e1;border-left:3px solid #ef8f00;color:#333;font-size:13px;font-style:italic;">“${escapar(p)}”</div>`).join("")}
      </td></tr>`;

    const cuerpo = `
  <tr><td style="padding:22px 24px 4px;">
    <div style="font-size:16px;font-weight:bold;color:#111;word-break:break-all;">${escapar(archivo.name)}</div>
    <div style="color:#666;font-size:13px;margin-top:3px;">${escapar(area)}${archivo.autor ? " · " + escapar(archivo.autor) : ""} · ${escapar(s.palabras)} palabras</div>
  </td></tr>
  <tr><td style="padding:14px 24px 0;">
    <table role="presentation" width="100%"><tr>
      <td style="background:#f6f6f6;border-radius:8px;padding:12px 14px;">
        <div style="font-size:12px;color:#666;">Similitud con documentos ya revisados</div>
        <div style="font-size:26px;font-weight:bold;color:${color};">${escapar(s.porcentajeTotal)}%</div>
        <div style="font-size:12px;color:${color};font-weight:bold;">${TEXTO_NIVEL[s.nivel]}</div>
      </td>
      <td style="width:12px;"></td>
      <td style="background:#f6f6f6;border-radius:8px;padding:12px 14px;">
        <div style="font-size:12px;color:#666;">Calidad del documento</div>
        <div style="font-size:26px;font-weight:bold;color:#2e5d5a;">${r.calidad ? escapar(r.calidad) + "/10" : "—"}</div>
        <div style="font-size:12px;color:#666;">${escapar(r.tipo_documento)}</div>
      </td>
    </tr></table>
  </td></tr>
  ${s.yaRevisado ? `<tr><td style="padding:12px 24px 0;"><div style="background:#e3f2fd;padding:10px 12px;font-size:13px;color:#0d47a1;">Este mismo texto ya se había revisado como <strong>${escapar(s.yaRevisado.nombre)}</strong> (${escapar(fechaCorta(s.yaRevisado.fecha))}).</div></td></tr>` : ""}
  <tr><td style="padding:12px 24px;">
    <div style="background:#f0f7f7;border-left:4px solid #45a29e;padding:12px 14px;color:#222;font-size:14px;line-height:1.5;">${escapar(r.resumen)}</div>
  </td></tr>
  ${ajenas.length ? `<tr><td style="padding:4px 24px 0;"><div style="font-weight:bold;color:#111;font-size:15px;">Texto que coincide con otros documentos</div></td></tr>
  <tr><td style="padding:4px 12px 0;"><table role="presentation" width="100%" style="border-collapse:collapse;">${ajenas.map(bloqueCoincidencia).join("")}</table></td></tr>` : ""}
  ${propias.length ? `<tr><td style="padding:12px 24px 0;color:#666;font-size:13px;">Versiones anteriores del mismo archivo (no cuentan para el porcentaje): ${propias.map((c) => `${escapar(fechaCorta(c.fecha))} (${escapar(c.porcentaje)}%)`).join(", ")}</td></tr>` : ""}
  ${r.citas_faltantes.length ? `<tr><td style="padding:16px 24px 0;"><div style="font-weight:bold;color:#111;font-size:15px;">Pasajes que conviene citar</div>
    ${r.citas_faltantes.map((c) => `<div style="margin-top:8px;font-size:13px;"><div style="color:#333;font-style:italic;">“${escapar(c.pasaje)}”</div><div style="color:#2e5d5a;">→ ${escapar(c.motivo)}</div></div>`).join("")}</td></tr>` : ""}
  ${r.posibles_fuentes.length ? `<tr><td style="padding:16px 24px 0;"><div style="font-weight:bold;color:#111;font-size:15px;">Posibles fuentes (búsqueda en Google)</div>
    ${r.posibles_fuentes.map((f) => `<div style="margin-top:8px;font-size:13px;"><div style="color:#333;font-style:italic;">“${escapar(f.pasaje)}”</div><div>${f.url ? `<a href="${escapar(f.url)}" style="color:#1a73e8;">${escapar(f.fuente)}</a>` : escapar(f.fuente)}</div></div>`).join("")}</td></tr>` : ""}
  <tr><td style="padding:16px 24px 0;"><div style="font-weight:bold;color:#111;font-size:15px;">Observaciones</div>${lista(r.observaciones)}</td></tr>
  <tr><td style="padding:16px 24px 8px;"><div style="font-weight:bold;color:#111;font-size:15px;">Siguientes pasos</div>${lista(r.siguientes_pasos)}</td></tr>`;

    const pie = "Las coincidencias son texto repetido, no un dictamen: puede ser una cita legítima, una plantilla o trabajo propio. " +
        "Esta herramienta no detecta si un texto lo escribió una IA y nunca debe usarse como única prueba. Revisión generada por " +
        `${doc.proveedor}${doc.modelo ? " (" + doc.modelo + ")" : ""}${doc.conBusqueda ? " con búsqueda de Google" : ""}.`;

    const texto = [
        `Revisión de documento — ${archivo.name}`, area,
        `Similitud interna: ${s.porcentajeTotal}% (${TEXTO_NIVEL[s.nivel]})`,
        `Calidad: ${r.calidad ? r.calidad + "/10" : "—"}`, "", r.resumen, "",
        ...ajenas.map((c) => `- ${c.nombre}: ${c.porcentaje}%`),
        ...(r.citas_faltantes.length ? ["", "Pasajes que conviene citar:", ...r.citas_faltantes.map((c) => `- "${c.pasaje}" → ${c.motivo}`)] : []),
        ...(r.posibles_fuentes.length ? ["", "Posibles fuentes:", ...r.posibles_fuentes.map((f) => `- ${f.fuente}${f.url ? " " + f.url : ""}`)] : []),
        "", pie
    ].join("\n");

    return { asunto, html: marco("PAKAL · Revisión de documento", "Explore UP · CubeSat 3U", cuerpo, urlApp, pie), texto };
}
