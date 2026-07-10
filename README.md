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
3. En Source elige GitHub Actions.
4. Guarda y espera a que el workflow publique la app.
5. La URL quedará disponible en la sección Pages del repositorio.

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

## Correos automáticos de cumpleaños

La función `sendBirthdayEmails` revisa todos los días a las 9:00 a. m. (America/Chicago) los pacientes que:

- tienen fecha de nacimiento y correo electrónico;
- autorizaron la felicitación automática;
- cumplen años ese día.

El correo se genera en Español o Inglés y solo se crea una vez por paciente y año.

Para activar la entrega:

1. Cambia el proyecto de Firebase al plan Blaze, necesario para funciones programadas.
2. Instala las dependencias con `npm install --prefix functions`.
3. Instala en Firebase la extensión oficial **Trigger Email from Firestore**, usando `mail` como colección y configurando un proveedor SMTP.
4. Despliega la función con `firebase deploy --only functions:sendBirthdayEmails`.

Las credenciales SMTP deben configurarse en Firebase; nunca deben agregarse a `app.js` ni a `firebase-config.js`.
