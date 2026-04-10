// routes/alumno.js — endpoints exclusivos del alumno
//
// Todos requieren: autenticar + soloAlumno
//
// SESIÓN ACTIVA
//   GET  /api/alumno/sesion-activa       → sesión abierta para el aula del alumno
//
// GRUPOS
//   GET  /api/alumno/grupo               → obtener grupo del alumno en una sesión
//   POST /api/alumno/grupo               → crear grupo (primer alumno)
//
// COMPAÑEROS
//   GET  /api/alumno/compañeros          → lista de alumnos de su aula (para formar grupo)
//   GET  /api/alumno/compañeros/aula/:aula → alumnos de otra aula (caso recuperación)
//
// EVALUACIONES
//   POST /api/alumno/evaluaciones        → enviar todas las evaluaciones del grupo

const express  = require('express')
const supabase  = require('../db')
const { autenticar, soloAlumno } = require('../auth')

const router = express.Router()
router.use(autenticar, soloAlumno)

// Valores de descriptores
const VALOR_DESCRIPTOR = {
  Excelente:  100,
  Bueno:      75,
  Regular:    50,
  Deficiente: 25,
}


// ══════════════════════════════════════════════════════════
// SESIÓN ACTIVA
// ══════════════════════════════════════════════════════════

// GET /api/alumno/sesion-activa
// Retorna la sesión abierta que incluye el aula del alumno,
// junto a su historial de sesiones anteriores
router.get('/sesion-activa', async (req, res) => {
  try {
    const { aula, docente_id } = req.usuario

    // Sesiones del docente que incluyen el aula del alumno
    const { data: sesiones, error } = await supabase
      .from('sesiones')
      .select('id, nombre, aulas, criterios, max_grupo, con_autoevaluacion, estado, abierta_en, cierra_en')
      .eq('docente_id', docente_id)
      .contains('aulas', [aula])   // aula del alumno debe estar en el array
      .order('abierta_en', { ascending: false })

    if (error) throw error

    const activa   = sesiones.find(s => s.estado === 'abierta' &&
                       (!s.cierra_en || new Date(s.cierra_en) > new Date()))
    const historial = sesiones.filter(s => s.id !== activa?.id)

    // Para cada sesión del historial, verificar si el alumno completó
    const historialConEstado = await Promise.all(
      historial.map(async (s) => {
        const { count } = await supabase
          .from('evaluaciones')
          .select('id', { count: 'exact', head: true })
          .eq('sesion_id', s.id)
          .eq('evaluador_id', req.usuario.id)

        return { ...s, alumno_completo: (count || 0) > 0 }
      })
    )

    res.json({ activa: activa || null, historial: historialConEstado })

  } catch (err) {
    console.error('Error obteniendo sesión activa:', err)
    res.status(500).json({ error: 'Error al obtener la sesión' })
  }
})


// ══════════════════════════════════════════════════════════
// COMPAÑEROS
// ══════════════════════════════════════════════════════════

// GET /api/alumno/companeros?sesion_id=xxx
// Lista los alumnos del aula del alumno para formar grupo.
// Marca cuáles ya tienen grupo en la sesión.
router.get('/companeros', async (req, res) => {
  try {
    const { sesion_id } = req.query
    if (!sesion_id) return res.status(400).json({ error: 'sesion_id requerido' })

    // Todos los alumnos del aula (mismo docente)
    const { data: alumnos, error } = await supabase
      .from('alumnos')
      .select('id, nombre, correo, aula')
      .eq('docente_id', req.usuario.docente_id)
      .eq('aula', req.usuario.aula)
      .order('nombre')

    if (error) throw error

    // Alumnos que ya tienen grupo en esta sesión
    const { data: gruposDeSesion } = await supabase
      .from('grupos')
      .select('id')
      .eq('sesion_id', sesion_id)
    const grupoIds = (gruposDeSesion || []).map(g => g.id)
    const { data: conGrupo } = grupoIds.length > 0
      ? await supabase.from('grupo_miembros').select('alumno_id').in('grupo_id', grupoIds)
      : { data: [] }
    const idsConGrupo = new Set((conGrupo || []).map(g => g.alumno_id))

    const resultado = alumnos.map(a => ({
      ...a,
      tiene_grupo: idsConGrupo.has(a.id),
      soy_yo: a.id === req.usuario.id,
    }))

    res.json({ companeros: resultado })

  } catch (err) {
    console.error('Error obteniendo compañeros:', err)
    res.status(500).json({ error: 'Error al obtener compañeros' })
  }
})


// GET /api/alumno/companeros/aula/:aula?sesion_id=xxx
// Lista alumnos de OTRA aula (caso recuperación)
router.get('/companeros/aula/:aula', async (req, res) => {
  try {
    const { sesion_id } = req.query
    const { aula }      = req.params

    if (!sesion_id) return res.status(400).json({ error: 'sesion_id requerido' })
    if (aula === req.usuario.aula) {
      return res.status(400).json({ error: 'Usa /companeros para ver tu propia aula' })
    }

    // Verificar que el aula está en la sesión
    const { data: sesion } = await supabase
      .from('sesiones')
      .select('aulas')
      .eq('id', sesion_id)
      .single()

    if (!sesion?.aulas?.includes(aula)) {
      return res.status(404).json({ error: 'Aula no incluida en esta sesión' })
    }

    const { data: alumnos, error } = await supabase
      .from('alumnos')
      .select('id, nombre, correo, aula')
      .eq('docente_id', req.usuario.docente_id)
      .eq('aula', aula)
      .order('nombre')

    if (error) throw error

    // Marcar quiénes ya tienen grupo en esta sesión
    const { data: gruposDeSesion2 } = await supabase
      .from('grupos')
      .select('id')
      .eq('sesion_id', sesion_id)
    const grupoIds2 = (gruposDeSesion2 || []).map(g => g.id)
    const { data: conGrupo } = grupoIds2.length > 0
      ? await supabase.from('grupo_miembros').select('alumno_id').in('grupo_id', grupoIds2)
      : { data: [] }

    const idsConGrupo = new Set((conGrupo || []).map(g => g.alumno_id))

    res.json({
      companeros: alumnos.map(a => ({
        ...a,
        tiene_grupo: idsConGrupo.has(a.id),
      })),
    })

  } catch (err) {
    console.error('Error obteniendo compañeros de otra aula:', err)
    res.status(500).json({ error: 'Error al obtener compañeros' })
  }
})


// ══════════════════════════════════════════════════════════
// GRUPOS
// ══════════════════════════════════════════════════════════

// GET /api/alumno/grupo?sesion_id=xxx
// Obtiene el grupo del alumno en una sesión (si ya existe)
router.get('/grupo', async (req, res) => {
  try {
    const { sesion_id } = req.query
    if (!sesion_id) return res.status(400).json({ error: 'sesion_id requerido' })

    // Buscar si el alumno ya tiene grupo en esta sesión específica
    const { data: grupoSesion } = await supabase
      .from('grupos')
      .select('id, sesion_id, creado_por, creado_en')
      .eq('sesion_id', sesion_id)
    const grupoIdsSesion = (grupoSesion || []).map(g => g.id)
    const membresiaBruta = grupoIdsSesion.length > 0
      ? await supabase
          .from('grupo_miembros')
          .select('grupo_id')
          .eq('alumno_id', req.usuario.id)
          .in('grupo_id', grupoIdsSesion)
          .maybeSingle()
      : { data: null }
    const membresiaData = membresiaBruta?.data
    const grupoInfo = membresiaData
      ? (grupoSesion || []).find(g => g.id === membresiaData.grupo_id)
      : null
    const membresia = membresiaData && grupoInfo
      ? { grupo_id: membresiaData.grupo_id, grupos: grupoInfo }
      : null

    if (!membresia) {
      return res.json({ grupo: null })
    }

    const grupo_id = membresia.grupo_id

    // Obtener todos los miembros del grupo
    const { data: miembros } = await supabase
      .from('grupo_miembros')
      .select('alumno_id, alumnos(id, nombre, correo, aula)')
      .eq('grupo_id', grupo_id)

    // Obtener quién formó el grupo
    const { data: creador } = await supabase
      .from('alumnos')
      .select('id, nombre')
      .eq('id', membresia.grupos.creado_por)
      .single()

    res.json({
      grupo: {
        id:          grupo_id,
        creado_por:  creador,
        creado_en:   membresia.grupos.creado_en,
        miembros:    miembros.map(m => m.alumnos),
      },
    })

  } catch (err) {
    console.error('Error obteniendo grupo:', err)
    res.status(500).json({ error: 'Error al obtener el grupo' })
  }
})


// POST /api/alumno/grupo
// Crea un grupo nuevo con los miembros seleccionados.
// Solo el primer alumno en registrarse puede crear el grupo.
// Body: { sesion_id, miembro_ids: [uuid, uuid, ...] }
router.post('/grupo', async (req, res) => {
  try {
    const { sesion_id, miembro_ids = [] } = req.body

    if (!sesion_id) return res.status(400).json({ error: 'sesion_id requerido' })
    if (miembro_ids.length === 0) {
      return res.status(400).json({ error: 'Debes seleccionar al menos un compañero' })
    }

    // 1. Verificar que la sesión está abierta
    const { data: sesion } = await supabase
      .from('sesiones')
      .select('id, max_grupo, estado, cierra_en')
      .eq('id', sesion_id)
      .single()

    if (!sesion) return res.status(404).json({ error: 'Sesión no encontrada' })
    if (sesion.estado !== 'abierta') {
      return res.status(403).json({ error: 'La sesión está cerrada' })
    }
    if (sesion.cierra_en && new Date(sesion.cierra_en) < new Date()) {
      return res.status(403).json({ error: 'La sesión ya superó su fecha de cierre' })
    }

    // Los miembros son: el alumno actual + los seleccionados
    const todos_ids = [...new Set([req.usuario.id, ...miembro_ids])]

    // 2. Verificar tamaño máximo
    if (todos_ids.length > sesion.max_grupo) {
      return res.status(400).json({
        error: `El grupo supera el máximo de ${sesion.max_grupo} integrantes`,
      })
    }

    // 3. Verificar que ninguno ya tiene grupo en esta sesión
    const { data: gruposSesion } = await supabase
      .from('grupos')
      .select('id')
      .eq('sesion_id', sesion_id)
    const gIds = (gruposSesion || []).map(g => g.id)
    const { data: yaConGrupo } = gIds.length > 0
      ? await supabase
          .from('grupo_miembros')
          .select('alumno_id, alumnos(nombre)')
          .in('alumno_id', todos_ids)
          .in('grupo_id', gIds)
      : { data: [] }

    if (yaConGrupo?.length > 0) {
      const nombres = yaConGrupo.map(g => g.alumnos?.nombre || g.alumno_id).join(', ')
      return res.status(409).json({
        error: `Los siguientes alumnos ya tienen grupo en esta sesión: ${nombres}`,
      })
    }

    // 4. Crear el grupo
    const { data: grupo, error: errGrupo } = await supabase
      .from('grupos')
      .insert({ sesion_id, creado_por: req.usuario.id })
      .select()
      .single()

    if (errGrupo) throw errGrupo

    // 5. Insertar miembros
    const { error: errMiembros } = await supabase
      .from('grupo_miembros')
      .insert(todos_ids.map(alumno_id => ({ grupo_id: grupo.id, alumno_id })))

    if (errMiembros) throw errMiembros

    res.status(201).json({ grupo_id: grupo.id, miembros: todos_ids })

  } catch (err) {
    console.error('Error creando grupo:', err)
    res.status(500).json({ error: 'Error al crear el grupo' })
  }
})


// ══════════════════════════════════════════════════════════
// EVALUACIONES
// ══════════════════════════════════════════════════════════

// POST /api/alumno/evaluaciones
// Envía todas las evaluaciones del alumno de una vez (al presionar "Enviar")
// Body: {
//   sesion_id,
//   grupo_id,
//   evaluaciones: [
//     {
//       evaluado_id: uuid,
//       respuestas: [
//         { criterio_index: 0, descriptor: "Excelente" },
//         { criterio_index: 1, descriptor: "Bueno" },
//         ...
//       ]
//     },
//     ...
//   ]
// }
router.post('/evaluaciones', async (req, res) => {
  try {
    const { sesion_id, grupo_id, evaluaciones = [] } = req.body

    if (!sesion_id || !grupo_id) {
      return res.status(400).json({ error: 'sesion_id y grupo_id son requeridos' })
    }
    if (evaluaciones.length === 0) {
      return res.status(400).json({ error: 'No se recibieron evaluaciones' })
    }

    // 1. Verificar que la sesión sigue abierta
    const { data: sesion } = await supabase
      .from('sesiones')
      .select('id, estado, cierra_en, criterios, con_autoevaluacion')
      .eq('id', sesion_id)
      .single()

    if (!sesion) return res.status(404).json({ error: 'Sesión no encontrada' })
    if (sesion.estado !== 'abierta') {
      return res.status(403).json({ error: 'La sesión está cerrada' })
    }
    if (sesion.cierra_en && new Date(sesion.cierra_en) < new Date()) {
      return res.status(403).json({ error: 'La sesión ya superó su fecha de cierre' })
    }

    // 2. Verificar que el alumno pertenece al grupo
    const { data: miembro } = await supabase
      .from('grupo_miembros')
      .select('id')
      .eq('grupo_id', grupo_id)
      .eq('alumno_id', req.usuario.id)
      .single()

    if (!miembro) {
      return res.status(403).json({ error: 'No perteneces a este grupo' })
    }

    // 3. Verificar que el alumno no ha enviado ya
    const { count } = await supabase
      .from('evaluaciones')
      .select('id', { count: 'exact', head: true })
      .eq('sesion_id', sesion_id)
      .eq('evaluador_id', req.usuario.id)

    if (count > 0) {
      return res.status(409).json({ error: 'Ya enviaste tu evaluación para esta sesión' })
    }

    // 4. Calcular valor_pct de cada respuesta y armar registros
    const numCriterios = sesion.criterios.length
    const registros    = []

    for (const ev of evaluaciones) {
      const { evaluado_id, respuestas = [] } = ev

      // Validar que no se evalúa a alguien fuera del grupo (seguridad)
      const { data: esDelGrupo } = await supabase
        .from('grupo_miembros')
        .select('id')
        .eq('grupo_id', grupo_id)
        .eq('alumno_id', evaluado_id)
        .single()

      if (!esDelGrupo) {
        return res.status(400).json({
          error: `El alumno ${evaluado_id} no pertenece a tu grupo`,
        })
      }

      // Enriquecer respuestas con valor_pct
      const respuestasConValor = respuestas.map(r => ({
        criterio_index: r.criterio_index,
        descriptor:     r.descriptor,
        valor_pct:      VALOR_DESCRIPTOR[r.descriptor] ?? null,
      }))

      // Verificar que se respondieron todos los criterios
      if (respuestasConValor.length !== numCriterios) {
        return res.status(400).json({
          error: `Faltan criterios en la evaluación de ${evaluado_id}. Se esperan ${numCriterios}, se recibieron ${respuestasConValor.length}`,
        })
      }

      registros.push({
        sesion_id,
        grupo_id,
        evaluador_id: req.usuario.id,
        evaluado_id,
        respuestas:   respuestasConValor,
      })
    }

    // 5. Insertar todas las evaluaciones de una vez
    const { error } = await supabase.from('evaluaciones').insert(registros)

    if (error) {
      // El unique constraint impide duplicados a nivel de BD
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Ya existe una evaluación duplicada' })
      }
      throw error
    }

    res.status(201).json({
      ok:         true,
      enviadas:   registros.length,
      enviado_en: new Date().toISOString(),
    })

  } catch (err) {
    console.error('Error enviando evaluaciones:', err)
    res.status(500).json({ error: 'Error al enviar las evaluaciones' })
  }
})

module.exports = router
