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

## Correos automáticos gratuitos

El workflow `.github/workflows/email-reminders.yml` se ejecuta cada hora y procesa:

- felicitaciones de cumpleaños autorizadas;
- recordatorios de citas 3 días antes, 2 días antes y 3 horas antes;
- correo cuando el paciente autorizó email;
- SMS cuando el paciente autorizó mensajes y Twilio está configurado.

Los mensajes usan Español o Inglés según la preferencia del paciente. Cada envío se registra en la colección `emailLogs` para evitar duplicados.

### 1. Preparar Gmail

1. Usa una cuenta Gmail exclusiva para la clínica.
2. Activa la verificación en dos pasos.
3. Crea una contraseña de aplicación de 16 caracteres.

### 2. Crear la credencial de Firebase

1. Abre Firebase Console > Configuración del proyecto > Cuentas de servicio.
2. Pulsa **Generar nueva clave privada** y guarda el JSON fuera del repositorio.
3. En PowerShell, conviértelo a Base64 y cópialo al portapapeles:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("serviceAccountKey.json")) | Set-Clipboard
```

### 3. Crear GitHub Secrets

En GitHub abre **Settings > Secrets and variables > Actions** y crea:

- `FIREBASE_SERVICE_ACCOUNT_B64`: el valor Base64 copiado.
- `GMAIL_USER`: el correo completo de Gmail.
- `GMAIL_APP_PASSWORD`: la contraseña de aplicación, sin espacios.

Para habilitar SMS agrega también:

- `TWILIO_ACCOUNT_SID`: identificador de la cuenta Twilio.
- `TWILIO_AUTH_TOKEN`: token secreto de Twilio.
- `TWILIO_PHONE_NUMBER`: número remitente en formato internacional, por ejemplo `+17135550100`.

Sin estas tres credenciales, los correos continúan funcionando y los SMS se omiten de forma segura.

Nunca subas el archivo JSON ni escribas estas credenciales en `app.js`. El `.gitignore` impide incluir accidentalmente archivos comunes de cuentas de servicio.

### 4. Probar sin enviar

En GitHub abre **Actions > Correos automáticos > Run workflow** y deja activada la opción **Solo comprobar; no enviar correos**. Revisa el resultado del proceso.

### 5. Enviar una prueba real

Crea un paciente de prueba con tu correo, autoriza felicitaciones y configura una cita `Programada` para aproximadamente 24 horas después. Ejecuta nuevamente el workflow desactivando **Solo comprobar**.
