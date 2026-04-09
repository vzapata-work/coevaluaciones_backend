// routes/auth.js — identificación del usuario
//
// POST /api/auth/login
//   Recibe el token de Google, identifica si es docente o alumno,
//   y devuelve los datos del usuario con su rol.
//   El frontend llama a este endpoint justo después del login con Google.

const express = require('express')
const { autenticar } = require('../auth')

const router = express.Router()

// POST /api/auth/login
// Body: ninguno (el token va en el header Authorization)
// Response: { rol, id, nombre, correo, ... }
router.post('/login', autenticar, (req, res) => {
  // Si llegó hasta aquí, autenticar() ya verificó todo
  // req.usuario tiene: id, nombre, correo, rol, y según rol: aula, docente_id
  res.json({ usuario: req.usuario })
})

// GET /api/auth/me
// Útil para que el frontend refresque los datos del usuario
router.get('/me', autenticar, (req, res) => {
  res.json({ usuario: req.usuario })
})

module.exports = router
