// index.js — servidor principal
//
// Estructura simple: un archivo por módulo de rutas.
// Cada módulo se agrega aquí con app.use('/ruta', modulo)
//
// Módulos:
//   /api/auth        → identificación y datos del usuario
//   /api/docente     → gestión de alumnos y sesiones (docente)
//   /api/alumno      → grupos y evaluaciones (alumno)
//   /api/resultados  → dashboard y exportación (docente)

require('dotenv').config()
const express = require('express')
const cors    = require('cors')

const app = express()

// ── Middleware global ──────────────────────────────────────

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? 'https://tu-app.vercel.app'   // reemplazar con tu dominio en Vercel
    : 'http://localhost:3000',
  credentials: true,
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// ── Rutas ─────────────────────────────────────────────────

app.use('/api/auth',       require('./routes/auth'))
app.use('/api/docente',    require('./routes/docente'))
app.use('/api/alumno',     require('./routes/alumno'))
app.use('/api/resultados', require('./routes/resultados'))

// ── Health check ───────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() })
})

// ── Manejo de errores global ───────────────────────────────

app.use((err, req, res, next) => {
  console.error('Error no manejado:', err)
  res.status(500).json({ error: 'Error interno del servidor' })
})

// ── Inicio ─────────────────────────────────────────────────

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`)
  console.log(`Dominio institucional: ${process.env.DOMINIO_INSTITUCIONAL}`)
})
