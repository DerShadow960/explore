# PAKAL Mission Control — Explore UP

Plataforma de gestión y comunicaciones para el proyecto CubeSat 3U de Explore UP.

## Estructura

```
.
├── index.html         # HTML principal
├── index.css          # Estilos
├── app.js             # Lógica (módulo ES6)
├── package.json       # Metadata
├── vercel.json        # Configuración de Vercel
├── .gitignore         # Archivos ignorados en git
└── assets/            # Imágenes (LogoUP.png, etc)
```

## Requisitos

- Cuenta GitHub
- Cuenta Vercel (conectada a GitHub)
- Firebase proyecto ya configurado con:
  - Authentication (email/password)
  - Firestore Database
  - Reglas de seguridad (`firestore.rules`)

## Despliegue rápido

### 1. Preparar localmente

```bash
# Crea carpeta del proyecto
mkdir pakal-mission-control
cd pakal-mission-control

# Copia archivos: index.html, index.css, app.js, package.json, 
# vercel.json, .gitignore y tu carpeta de assets/

git init
git add .
git commit -m "Initial commit"
```

### 2. Subir a GitHub

```bash
# En GitHub: crea repo nuevo "pakal-mission-control"
git remote add origin https://github.com/TU-USUARIO/pakal-mission-control.git
git branch -M main
git push -u origin main
```

### 3. Deploy a Vercel

**Opción A: Desde CLI**
```bash
npm install -g vercel
vercel
# Sigue prompts, selecciona tu repo
```

**Opción B: Desde vercel.com**
1. Ve a https://vercel.com
2. Conecta tu cuenta GitHub
3. Importa el repo `pakal-mission-control`
4. Vercel detecta `vercel.json` automáticamente
5. Deploy hecho

### 4. Dominio personalizado (opcional)

En Vercel → Settings → Domains:
- Agrega tu dominio
- Actualiza DNS en tu registrador

## Variables de entorno

Firebase config ya está en `app.js` (no necesita .env para proyectos estáticos).

**Pero si quieres mover la config a un lugar más seguro**, cambiarías a un build Next.js. Por ahora, esta es la forma estándar.

## Seguridad

- ✅ Firebase Auth (contraseñas hasheadas en Google, nunca en tu BD)
- ✅ Firestore Rules (control de acceso por equipo)
- ✅ XSS Protection (textContent en lugar de innerHTML)
- ⚠️ API Key en público (diseño normal de Firebase, protegido por Firestore Rules)

Ver `SEGURIDAD-LEEME.md` para más detalles.

## Troubleshooting

**"404 en rutas que no son /index.html"**
- Vercel.json ya lo soluciona con `"routes"`

**"Firebase Auth dice credenciales inválidas"**
- Verifica que el usuario existe en Firebase Console → Authentication
- Verifica que tiene un documento en `usuarios/{uid}` en Firestore

**"Chat o tareas no cargan"**
- Abre DevTools (F12) → Console, busca errores de Firebase
- Verifica Firestore Rules en Firebase Console

## Deploy automático

Cada `git push` a `main` dispara un redeploy en Vercel automáticamente.

---

**Equipo:** Explore UP - Universidad Panamericana  
**Proyecto:** PAKAL CubeSat 3U
