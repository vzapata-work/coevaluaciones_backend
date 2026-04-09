# Backend — Evaluación Grupal

API REST construida con Node.js + Express. Se despliega en Railway.

---

## Instalación local

```bash
# 1. Instalar dependencias
npm install

# 2. Copiar el archivo de variables de entorno
cp .env.example .env

# 3. Completar .env con tus credenciales de Supabase y Google
#    (ver sección Variables de entorno)

# 4. Iniciar en modo desarrollo
npm run dev

# El servidor corre en http://localhost:3001
```

---

## Variables de entorno

| Variable | Descripción |
|---|---|
| `SUPABASE_URL` | URL de tu proyecto Supabase |
| `SUPABASE_SERVICE_KEY` | service_role key (con acceso total a la BD) |
| `GOOGLE_CLIENT_ID` | Client ID de Google Cloud Console |
| `DOMINIO_INSTITUCIONAL` | Dominio de correos permitidos (ej. `universidad.edu.pe`) |
| `PORT` | Puerto del servidor (default: 3001) |
| `NODE_ENV` | `development` o `production` |

---

## Endpoints

### Autenticación
Todos los endpoints protegidos requieren el header:
```
Authorization: Bearer <google_id_token>
```

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/login` | Identifica rol del usuario (docente o alumno) |
| GET  | `/api/auth/me` | Datos del usuario autenticado |

### Docente — Alumnos
| Método | Ruta | Descripción |
|---|---|---|
| POST   | `/api/docente/alumnos/importar` | Subir CSV con alumnos |
| GET    | `/api/docente/alumnos` | Listar alumnos (filtro por `?aula=`) |
| DELETE | `/api/docente/alumnos` | Eliminar lista actual |

### Docente — Sesiones
| Método | Ruta | Descripción |
|---|---|---|
| POST  | `/api/docente/sesiones` | Crear sesión |
| GET   | `/api/docente/sesiones` | Listar sesiones |
| GET   | `/api/docente/sesiones/:id` | Detalle + progreso por aula |
| PATCH | `/api/docente/sesiones/:id/estado` | Abrir o cerrar sesión |

### Alumno
| Método | Ruta | Descripción |
|---|---|---|
| GET  | `/api/alumno/sesion-activa` | Sesión abierta + historial |
| GET  | `/api/alumno/grupo?sesion_id=` | Grupo del alumno en la sesión |
| POST | `/api/alumno/grupo` | Crear grupo |
| GET  | `/api/alumno/companeros?sesion_id=` | Compañeros de su aula |
| GET  | `/api/alumno/companeros/aula/:aula?sesion_id=` | Alumnos de otra aula |
| POST | `/api/alumno/evaluaciones` | Enviar todas las evaluaciones |

### Resultados (Docente)
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/resultados/:sesion_id` | Todos los resultados |
| GET | `/api/resultados/:sesion_id/aula/:aula` | Resultados por aula |
| GET | `/api/resultados/:sesion_id/exportar` | Descargar Excel |

---

## Despliegue en Railway

1. Crear cuenta en [railway.app](https://railway.app)
2. New Project → Deploy from GitHub repo
3. Seleccionar el repositorio del backend
4. En Variables, agregar todas las del `.env`
5. Railway detecta Node.js automáticamente y corre `npm start`

El servidor queda en una URL tipo `https://tu-app.up.railway.app`

---

## Formato del CSV de alumnos

```csv
aula,apellidos_nombres,correo
Laboratorio 110,García Rodríguez Ana,a.garcia@universidad.edu.pe
Laboratorio 110,Mendoza Torres Luis,l.mendoza@universidad.edu.pe
Laboratorio 112,Rojas Vega Karla,k.rojas@universidad.edu.pe
```

- La primera fila debe ser exactamente el encabezado mostrado
- El correo debe tener el dominio institucional configurado
- Filas con errores se reportan pero no detienen la importación
