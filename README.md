# Clinic Control

Aplicación web para gestionar pacientes, consultas, cobros y reportes de una clínica.

## Qué incluye

- Dashboard moderno
- Directorio de pacientes
- Registro de consultas
- Seguimiento de cobros y deudas
- Reporte del día imprimible
- Ajustes de la clínica
- Exportación de respaldo en JSON
- Persistencia con Firebase Firestore

## Requisitos

- Un proyecto en Firebase
- Firestore habilitado
- Authentication habilitado con acceso anónimo

## Configuración

1. Abre [firebase-config.js](firebase-config.js).
2. Reemplaza los valores con las credenciales de tu proyecto de Firebase.
3. En Firebase Console habilita:
   - Firestore Database
   - Authentication > Anonymous

## Cómo abrir localmente

1. Abre la carpeta del proyecto en Visual Studio Code.
2. Ejecuta la app con Live Server o abre [index.html](index.html) en tu navegador.

## Publicar en GitHub Pages

1. Sube el proyecto a GitHub.
2. Entra al repositorio y ve a Settings > Pages.
3. En Source elige Deploy from a branch.
4. Selecciona la rama principal y la carpeta /root.
5. Guarda y espera a que GitHub genere la URL.

## Nota

Para pruebas rápidas puedes usar estas reglas en Firestore:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```
