// routes/docente.js — endpoints exclusivos del docente
//
// Todos requieren: autenticar + soloDocente
//
// ALUMNOS
//   POST   /api/docente/alumnos/importar   → subir CSV/Excel
//   GET    /api/docente/alumnos            → listar alumnos del docente
//   DELETE /api/docente/alumnos            → eliminar lista actual
//
// SESIONES
//   POST   /api/docente/sesiones           → crear sesión
//   GET    /api/docente/sesiones           → listar sesiones del docente
//   GET    /api/docente/sesiones/:id       → detalle de una sesión
//   PATCH  /api/docente/sesiones/:id/estado → abrir o cerrar sesión

const express  = require('express')
const multer   = require('multer')
const { parse } = require('csv-parse/sync')
const supabase  = require('../db')
const { autenticar, soloDocente } = require('../auth')

const router  = express.Router()
const upload  = multer({ storage: multer.memoryStorage() }) // archivo en RAM, sin guardar en disco

// Todos los endpoints de este módulo requieren ser docente
router.use(autenticar, soloDocente)


// ══════════════════════════════════════════════════════════
// ALUMNOS
// ══════════════════════════════════════════════════════════

// POST /api/docente/alumnos/importar
// Recibe un archivo CSV o Excel con columnas: aula, apellidos_nombres, correo
// Reemplaza la lista actual del docente
router.post('/alumnos/importar', upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo' })
    }

    const contenido = req.file.buffer.toString('utf-8')
    let filas

    // Parsear CSV
    try {
      filas = parse(contenido, {
        columns: true,           // primera fila como encabezados
        skip_empty_lines: true,
        trim: true,
      })
    } catch (e) {
      return res.status(400).json({ error: 'Formato de archivo inválido. Usa CSV con columnas: aula, apellidos_nombres, correo' })
    }

    // Validar columnas requeridas
    const requeridas = ['aula', 'apellidos_nombres', 'correo']
    const columnas   = Object.keys(filas[0] || {})
    const faltantes  = requeridas.filter(c => !columnas.includes(c))
    if (faltantes.length > 0) {
      return res.status(400).json({
        error: `Faltan columnas: ${faltantes.join(', ')}`,
        columnas_recibidas: columnas,
      })
    }

    const dominio = process.env.DOMINIO_INSTITUCIONAL

    // Separar filas válidas e inválidas
    const validos   = []
    const invalidos = []

    for (const fila of filas) {
      const correo = (fila.correo || '').trim().toLowerCase()
      const nombre = (fila.apellidos_nombres || '').trim()
      const aula   = (fila.aula || '').trim()

      if (!correo || !nombre || !aula) {
        invalidos.push({ fila, error: 'Campo vacío' })
        continue
      }

      if (!correo.endsWith(`@${dominio}`)) {
        invalidos.push({ fila, error: `Dominio de correo inválido (se esperaba @${dominio})` })
        continue
      }

      validos.push({ correo, nombre, aula, docente_id: req.usuario.id })
    }

    // Eliminar alumnos anteriores del docente e insertar nuevos
    await supabase
      .from('alumnos')
      .delete()
      .eq('docente_id', req.usuario.id)

    if (validos.length > 0) {
      const { error } = await supabase.from('alumnos').insert(validos)
      if (error) throw error
    }

    res.json({
      importados: validos.length,
      con_errores: invalidos.length,
      errores: invalidos.slice(0, 20),  // máximo 20 errores en la respuesta
    })

  } catch (err) {
    console.error('Error importando alumnos:', err)
    res.status(500).json({ error: 'Error al importar alumnos' })
  }
})


// GET /api/docente/alumnos
// Lista todos los alumnos del docente, con filtro opcional por aula
router.get('/alumnos', async (req, res) => {
  try {
    let query = supabase
      .from('alumnos')
      .select('id, nombre, correo, aula, creado_en')
      .eq('docente_id', req.usuario.id)
      .order('aula')
      .order('nombre')

    if (req.query.aula) {
      query = query.eq('aula', req.query.aula)
    }

    const { data, error } = await query
    if (error) throw error

    // Agrupar por aula para facilitar el render en el frontend
    const porAula = {}
    for (const a of data) {
      if (!porAula[a.aula]) porAula[a.aula] = []
      porAula[a.aula].push(a)
    }

    res.json({ total: data.length, por_aula: porAula })

  } catch (err) {
    console.error('Error listando alumnos:', err)
    res.status(500).json({ error: 'Error al obtener alumnos' })
  }
})


// DELETE /api/docente/alumnos
// Elimina toda la lista de alumnos del docente
router.delete('/alumnos', async (req, res) => {
  try {
    const { error } = await supabase
      .from('alumnos')
      .delete()
      .eq('docente_id', req.usuario.id)

    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    console.error('Error eliminando alumnos:', err)
    res.status(500).json({ error: 'Error al eliminar alumnos' })
  }
})


// ══════════════════════════════════════════════════════════
// SESIONES
// ══════════════════════════════════════════════════════════

// POST /api/docente/sesiones
// Crea una nueva sesión de evaluación
// Body: { nombre, aulas, criterios, max_grupo, con_autoevaluacion, anonima, cierra_en }
router.post('/sesiones', async (req, res) => {
  try {
    const {
      nombre,
      aulas            = [],
      criterios        = [],
      max_grupo        = 4,
      con_autoevaluacion = true,
      anonima          = true,
      cierra_en,
    } = req.body

    // Validaciones básicas
    if (!nombre?.trim()) {
      return res.status(400).json({ error: 'El nombre de la sesión es requerido' })
    }
    if (aulas.length === 0) {
      return res.status(400).json({ error: 'Debes incluir al menos un aula' })
    }
    if (criterios.length === 0) {
      return res.status(400).json({ error: 'Debes definir al menos un criterio' })
    }
    if (max_grupo < 1 || max_grupo > 10) {
      return res.status(400).json({ error: 'El tamaño máximo de grupo debe estar entre 1 y 10' })
    }

    const { data, error } = await supabase
      .from('sesiones')
      .insert({
        docente_id: req.usuario.id,
        nombre:     nombre.trim(),
        aulas,
        criterios,
        max_grupo,
        con_autoevaluacion,
        anonima,
        cierra_en:  cierra_en || null,
        estado:     'abierta',
      })
      .select()
      .single()

    if (error) throw error
    res.status(201).json({ sesion: data })

  } catch (err) {
    console.error('Error creando sesión:', err)
    res.status(500).json({ error: 'Error al crear la sesión' })
  }
})


// GET /api/docente/sesiones
// Lista todas las sesiones del docente (activas e historial)
router.get('/sesiones', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sesiones')
      .select('id, nombre, aulas, criterios, max_grupo, estado, abierta_en, cierra_en')
      .eq('docente_id', req.usuario.id)
      .order('creado_en', { ascending: false })

    if (error) throw error
    res.json({ sesiones: data })

  } catch (err) {
    console.error('Error listando sesiones:', err)
    res.status(500).json({ error: 'Error al obtener sesiones' })
  }
})


// GET /api/docente/sesiones/:id
// Detalle de una sesión con progreso por aula
router.get('/sesiones/:id', async (req, res) => {
  try {
    // Verificar que la sesión pertenece al docente
    const { data: sesion, error: errSesion } = await supabase
      .from('sesiones')
      .select('*')
      .eq('id', req.params.id)
      .eq('docente_id', req.usuario.id)
      .single()

    if (errSesion || !sesion) {
      return res.status(404).json({ error: 'Sesión no encontrada' })
    }

    // Obtener progreso por aula desde la vista
    const { data: progreso } = await supabase
      .from('v_progreso_por_aula')
      .select('*')
      .eq('sesion_id', req.params.id)

    res.json({ sesion, progreso: progreso || [] })

  } catch (err) {
    console.error('Error obteniendo sesión:', err)
    res.status(500).json({ error: 'Error al obtener la sesión' })
  }
})


// PATCH /api/docente/sesiones/:id/estado
// Abre o cierra una sesión
// Body: { estado: 'abierta' | 'cerrada' }
router.patch('/sesiones/:id/estado', async (req, res) => {
  try {
    const { estado } = req.body
    if (!['abierta', 'cerrada'].includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido. Usa "abierta" o "cerrada"' })
    }

    // Verificar propiedad de la sesión
    const { data: sesion } = await supabase
      .from('sesiones')
      .select('id')
      .eq('id', req.params.id)
      .eq('docente_id', req.usuario.id)
      .single()

    if (!sesion) {
      return res.status(404).json({ error: 'Sesión no encontrada' })
    }

    const { data, error } = await supabase
      .from('sesiones')
      .update({ estado })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json({ sesion: data })

  } catch (err) {
    console.error('Error actualizando estado:', err)
    res.status(500).json({ error: 'Error al actualizar el estado' })
  }
})

// DELETE /api/docente/sesiones/:id
// Elimina una sesión y todos sus datos (grupos, miembros, evaluaciones)
// Las tablas tienen ON DELETE CASCADE así que basta con borrar la sesión
router.delete('/sesiones/:id', async (req, res) => {
  try {
    // Verificar propiedad
    const { data: sesion } = await supabase
      .from('sesiones')
      .select('id, nombre')
      .eq('id', req.params.id)
      .eq('docente_id', req.usuario.id)
      .single()

    if (!sesion) {
      return res.status(404).json({ error: 'Sesión no encontrada' })
    }

    const { error } = await supabase
      .from('sesiones')
      .delete()
      .eq('id', req.params.id)

    if (error) throw error
    res.json({ ok: true, eliminado: sesion.nombre })

  } catch (err) {
    console.error('Error eliminando sesión:', err)
    res.status(500).json({ error: 'Error al eliminar la sesión' })
  }
})


// ══════════════════════════════════════════════════════════
// GET /api/docente/grupos/:sesion_id
// Lista todos los grupos de una sesión con sus miembros
// ══════════════════════════════════════════════════════════

router.get('/grupos/:sesion_id', async (req, res) => {
  try {
    const { data: sesion } = await supabase
      .from('sesiones')
      .select('id, max_grupo')
      .eq('id', req.params.sesion_id)
      .eq('docente_id', req.usuario.id)
      .single()

    if (!sesion) return res.status(404).json({ error: 'Sesión no encontrada' })

    const { data: grupos } = await supabase
      .from('grupos')
      .select('id, creado_en, creado_por')
      .eq('sesion_id', req.params.sesion_id)
      .order('creado_en')

    if (!grupos || grupos.length === 0) return res.json({ grupos: [] })

    const grupoIds = grupos.map(g => g.id)

    const { data: miembros } = await supabase
      .from('grupo_miembros')
      .select('grupo_id, alumno_id, alumnos(id, nombre, correo, aula)')
      .in('grupo_id', grupoIds)

    // Verificar cuáles tienen evaluaciones enviadas (no se pueden editar)
    const { data: evals } = await supabase
      .from('evaluaciones')
      .select('evaluador_id, grupo_id')
      .eq('sesion_id', req.params.sesion_id)

    const gruposConEvals = new Set((evals || []).map(e => e.grupo_id))
    const alumnosQueEvaluaron = new Set((evals || []).map(e => e.evaluador_id))

    const resultado = grupos.map(g => ({
      id:           g.id,
      creado_en:    g.creado_en,
      tiene_evaluaciones: gruposConEvals.has(g.id),
      miembros:     (miembros || [])
        .filter(m => m.grupo_id === g.id)
        .map(m => ({
          ...m.alumnos,
          ya_evaluo: alumnosQueEvaluaron.has(m.alumnos?.id),
        })),
    }))

    res.json({ grupos: resultado, max_grupo: sesion.max_grupo })

  } catch (err) {
    console.error('Error obteniendo grupos:', err)
    res.status(500).json({ error: 'Error al obtener grupos' })
  }
})


// ══════════════════════════════════════════════════════════
// PATCH /api/docente/grupos/:grupo_id/miembros
// Reemplaza los miembros de un grupo
// Body: { miembro_ids: [uuid, ...] }
// No se puede editar si algún miembro ya envió evaluaciones
// ══════════════════════════════════════════════════════════

router.patch('/grupos/:grupo_id/miembros', async (req, res) => {
  try {
    const { miembro_ids = [] } = req.body

    if (miembro_ids.length === 0) {
      return res.status(400).json({ error: 'El grupo debe tener al menos un miembro' })
    }

    // Verificar que el grupo pertenece a una sesión del docente
    const { data: grupo } = await supabase
      .from('grupos')
      .select('id, sesion_id, sesiones!inner(id, docente_id, max_grupo)')
      .eq('id', req.params.grupo_id)
      .eq('sesiones.docente_id', req.usuario.id)
      .single()

    if (!grupo) return res.status(404).json({ error: 'Grupo no encontrado' })

    const max_grupo = grupo.sesiones.max_grupo
    if (miembro_ids.length > max_grupo) {
      return res.status(400).json({ error: `El grupo no puede tener más de ${max_grupo} miembros` })
    }

    // Verificar que ningún miembro ya envió evaluaciones
    const { data: evals } = await supabase
      .from('evaluaciones')
      .select('evaluador_id, alumnos!inner(nombre)')
      .eq('sesion_id', grupo.sesion_id)
      .eq('grupo_id', req.params.grupo_id)

    if (evals && evals.length > 0) {
      const nombres = [...new Set(evals.map(e => e.alumnos?.nombre))].join(', ')
      return res.status(409).json({
        error: `No se puede editar: los siguientes miembros ya enviaron su evaluación: ${nombres}`,
      })
    }

    // Reemplazar miembros: borrar los actuales e insertar los nuevos
    await supabase.from('grupo_miembros').delete().eq('grupo_id', req.params.grupo_id)

    const { error } = await supabase
      .from('grupo_miembros')
      .insert(miembro_ids.map(alumno_id => ({ grupo_id: req.params.grupo_id, alumno_id })))

    if (error) throw error
    res.json({ ok: true, miembros: miembro_ids })

  } catch (err) {
    console.error('Error editando grupo:', err)
    res.status(500).json({ error: 'Error al editar el grupo' })
  }
})

module.exports = router
