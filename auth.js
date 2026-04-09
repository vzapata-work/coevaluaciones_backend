// auth.js — middleware de autenticación
//
// El frontend manda el token de Google en el header:
//   Authorization: Bearer <google_id_token>
//
// Este middleware verifica el token con Google, identifica
// si el correo pertenece a un docente o alumno, y adjunta
// el usuario a req.usuario para que los endpoints lo usen.

const { OAuth2Client } = require('google-auth-library')
const supabase = require('./db')

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)

// ── Verificar token de Google ──────────────────────────────

async function verificarTokenGoogle(token) {
  const ticket = await googleClient.verifyIdToken({
    idToken: token,
    audience: process.env.GOOGLE_CLIENT_ID,
  })
  const payload = ticket.getPayload()
  return {
    correo: payload.email,
    nombre: payload.name,
    emailVerified: payload.email_verified,
  }
}

// ── Middleware principal ───────────────────────────────────

async function autenticar(req, res, next) {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token no proporcionado' })
    }

    const token = authHeader.split(' ')[1]

    // 1. Verificar token con Google
    const googleUser = await verificarTokenGoogle(token)

    if (!googleUser.emailVerified) {
      return res.status(401).json({ error: 'Correo no verificado por Google' })
    }

    // 2. Verificar dominio institucional
    const dominio = googleUser.correo.split('@')[1]
    if (dominio !== process.env.DOMINIO_INSTITUCIONAL) {
      return res.status(403).json({
        error: 'Correo no institucional',
        detalle: `Solo se aceptan correos @${process.env.DOMINIO_INSTITUCIONAL}`,
      })
    }

    // 3. Buscar en tabla docentes
    const { data: docente } = await supabase
      .from('docentes')
      .select('id, nombre, correo')
      .eq('correo', googleUser.correo)
      .single()

    if (docente) {
      req.usuario = { ...docente, rol: 'docente' }
      return next()
    }

    // 4. Buscar en tabla alumnos
    const { data: alumno } = await supabase
      .from('alumnos')
      .select('id, nombre, correo, aula, docente_id')
      .eq('correo', googleUser.correo)
      .single()

    if (alumno) {
      req.usuario = { ...alumno, rol: 'alumno' }
      return next()
    }

    // 5. Correo no registrado en ninguna tabla
    return res.status(403).json({
      error: 'Correo no registrado',
      detalle: 'Tu cuenta institucional no está registrada en el sistema. Consulta a tu docente.',
    })

  } catch (err) {
    console.error('Error en autenticación:', err.message)
    return res.status(401).json({ error: 'Token inválido o expirado' })
  }
}

// ── Middleware de rol ──────────────────────────────────────
// Uso: router.get('/ruta', autenticar, soloDocente, handler)

function soloDocente(req, res, next) {
  if (req.usuario?.rol !== 'docente') {
    return res.status(403).json({ error: 'Acceso solo para docentes' })
  }
  next()
}

function soloAlumno(req, res, next) {
  if (req.usuario?.rol !== 'alumno') {
    return res.status(403).json({ error: 'Acceso solo para alumnos' })
  }
  next()
}

module.exports = { autenticar, soloDocente, soloAlumno }
