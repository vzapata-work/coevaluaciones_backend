// routes/resultados.js — dashboard y exportación Excel
//
// Todos requieren: autenticar + soloDocente
//
//   GET  /api/resultados/:sesion_id             → resultados por alumno
//   GET  /api/resultados/:sesion_id/aula/:aula  → resultados filtrados por aula
//   GET  /api/resultados/:sesion_id/exportar    → descarga Excel

const express  = require('express')
const ExcelJS  = require('exceljs')
const supabase  = require('../db')
const { autenticar, soloDocente } = require('../auth')

const router = express.Router()
router.use(autenticar, soloDocente)

// Paleta de colores para descriptores en Excel
const COLOR_DESCRIPTOR = {
  Excelente:  { argb: 'FF1D6F42', fgARGB: 'FFE8F5E9' }, // verde
  Bueno:      { argb: 'FF185FA5', fgARGB: 'FFE3F2FD' }, // azul
  Regular:    { argb: 'FF854F0B', fgARGB: 'FFFFF8E1' }, // naranja
  Deficiente: { argb: 'FFA32D2D', fgARGB: 'FFFFEBEE' }, // rojo
}

function descriptorDesdePct(pct) {
  if (pct === null || pct === undefined) return null
  if (pct >= 100) return 'Excelente'
  if (pct >= 75)  return 'Bueno'
  if (pct >= 50)  return 'Regular'
  return 'Deficiente'
}

// ── Helper: verificar que la sesión pertenece al docente ──

async function verificarSesion(sesion_id, docente_id) {
  const { data } = await supabase
    .from('sesiones')
    .select('id, nombre, criterios, estado, aulas')
    .eq('id', sesion_id)
    .eq('docente_id', docente_id)
    .single()
  return data
}


// ══════════════════════════════════════════════════════════
// GET /api/resultados/:sesion_id
// Resultados completos de la sesión (todas las aulas)
// ══════════════════════════════════════════════════════════

router.get('/:sesion_id', async (req, res) => {
  try {
    const sesion = await verificarSesion(req.params.sesion_id, req.usuario.id)
    if (!sesion) return res.status(404).json({ error: 'Sesión no encontrada' })

    // Todos los alumnos de las aulas de la sesión (lista completa)
    const { data: todosAlumnosAula, error: errAlumnos } = await supabase
      .from('alumnos')
      .select('id, nombre, correo, aula')
      .eq('docente_id', req.usuario.id)
      .in('aula', sesion.aulas)
      .order('aula')
      .order('nombre')

    if (errAlumnos) throw errAlumnos

    // Alumnos que están en algún grupo de esta sesión
    const { data: gruposDeSesion } = await supabase
      .from('grupos')
      .select('id')
      .eq('sesion_id', req.params.sesion_id)

    const grupoIds = (gruposDeSesion || []).map(g => g.id)

    const { data: miembros } = grupoIds.length > 0
      ? await supabase
          .from('grupo_miembros')
          .select('alumno_id')
          .in('grupo_id', grupoIds)
      : { data: [] }

    const idsConGrupo = new Set((miembros || []).map(m => m.alumno_id))

    // Mapa de todos los alumnos con flag de si tienen grupo
    const alumnosMap = {}
    for (const a of (todosAlumnosAula || [])) {
      alumnosMap[a.id] = { ...a, tiene_grupo: idsConGrupo.has(a.id) }
    }

    // Resultado final por alumno (desde la vista — solo los que ya tienen evaluaciones recibidas)
    const { data: resultados } = await supabase
      .from('v_resultados_alumno')
      .select('*')
      .eq('sesion_id', req.params.sesion_id)

    // Resultado por criterio
    const { data: porCriterio } = await supabase
      .from('v_resultados_por_criterio')
      .select('*')
      .eq('sesion_id', req.params.sesion_id)

    // Progreso por aula
    const { data: progreso } = await supabase
      .from('v_progreso_por_aula')
      .select('*')
      .eq('sesion_id', req.params.sesion_id)

    // Alumnos que YA ENVIARON sus evaluaciones (evaluador_id en la tabla)
    const { data: yaEnviaron } = await supabase
      .from('evaluaciones')
      .select('evaluador_id')
      .eq('sesion_id', req.params.sesion_id)

    const idsQueEnviaron = new Set((yaEnviaron || []).map(e => e.evaluador_id))

    // Mapa de resultados recibidos por alumno_id
    const resultadosMap = {}
    for (const r of (resultados || [])) {
      resultadosMap[r.evaluado_id] = r
    }

    // Combinar: TODOS los alumnos del aula + sus resultados
    const todosAlumnos = Object.values(alumnosMap)

    const resultadosCompletos = todosAlumnos.map(alumno => {
      const r          = resultadosMap[alumno.id]
      const completado = idsQueEnviaron.has(alumno.id)
      const tiene_grupo = alumno.tiene_grupo

      const criteriosDel = r
        ? (porCriterio || [])
            .filter(c => c.evaluado_id === alumno.id)
            .sort((a, b) => a.criterio_index - b.criterio_index)
            .map(c => ({
              criterio_index: c.criterio_index,
              nombre:         sesion.criterios[c.criterio_index]?.nombre || `Criterio ${c.criterio_index + 1}`,
              pct:            c.pct_criterio,
              descriptor:     descriptorDesdePct(c.pct_criterio),
            }))
        : []

      return {
        alumno_id:    alumno.id,
        nombre:       alumno.nombre,
        aula:         alumno.aula,
        correo:       alumno.correo,
        num_evals:    r?.num_evaluaciones_recibidas || 0,
        pct_final:    r?.pct_final || null,
        descriptor:   r?.descriptor_final || null,
        por_criterio: criteriosDel,
        completado,
        tiene_grupo,
      }
    })

    res.json({
      sesion:     { id: sesion.id, nombre: sesion.nombre, estado: sesion.estado },
      progreso:   progreso || [],
      resultados: resultadosCompletos,
    })

  } catch (err) {
    console.error('Error obteniendo resultados:', err)
    res.status(500).json({ error: 'Error al obtener resultados' })
  }
})


// ══════════════════════════════════════════════════════════
// GET /api/resultados/:sesion_id/aula/:aula
// Resultados filtrados por un aula específica
// ══════════════════════════════════════════════════════════

router.get('/:sesion_id/aula/:aula', async (req, res) => {
  try {
    const sesion = await verificarSesion(req.params.sesion_id, req.usuario.id)
    if (!sesion) return res.status(404).json({ error: 'Sesión no encontrada' })

    const { data: resultados } = await supabase
      .from('v_resultados_alumno')
      .select('*')
      .eq('sesion_id', req.params.sesion_id)
      .eq('alumno_aula', req.params.aula)
      .order('alumno_nombre')

    const { data: porCriterio } = await supabase
      .from('v_resultados_por_criterio')
      .select('*')
      .eq('sesion_id', req.params.sesion_id)
      .in('evaluado_id', (resultados || []).map(r => r.evaluado_id))

    const resultadosCompletos = (resultados || []).map(r => {
      const criteriosDel = (porCriterio || [])
        .filter(c => c.evaluado_id === r.evaluado_id)
        .sort((a, b) => a.criterio_index - b.criterio_index)
        .map(c => ({
          criterio_index: c.criterio_index,
          nombre:         sesion.criterios[c.criterio_index]?.nombre,
          pct:            c.pct_criterio,
          descriptor:     descriptorDesdePct(c.pct_criterio),
        }))

      return {
        alumno_id:    r.evaluado_id,
        nombre:       r.alumno_nombre,
        aula:         r.alumno_aula,
        correo:       r.alumno_correo,
        pct_final:    r.pct_final,
        descriptor:   r.descriptor_final,
        por_criterio: criteriosDel,
      }
    })

    res.json({ sesion: { id: sesion.id, nombre: sesion.nombre }, resultados: resultadosCompletos })

  } catch (err) {
    console.error('Error obteniendo resultados por aula:', err)
    res.status(500).json({ error: 'Error al obtener resultados' })
  }
})


// ══════════════════════════════════════════════════════════
// GET /api/resultados/:sesion_id/exportar
// Genera y descarga el archivo Excel
// ══════════════════════════════════════════════════════════

router.get('/:sesion_id/exportar', async (req, res) => {
  try {
    const sesion = await verificarSesion(req.params.sesion_id, req.usuario.id)
    if (!sesion) return res.status(404).json({ error: 'Sesión no encontrada' })

    // Obtener todos los alumnos de las aulas de la sesión
    const { data: todosAlumnos } = await supabase
      .from('alumnos')
      .select('id, nombre, correo, aula')
      .eq('docente_id', req.usuario.id)
      .in('aula', sesion.aulas)
      .order('aula')
      .order('nombre')

    // Resultados calculados
    const { data: resultados } = await supabase
      .from('v_resultados_alumno')
      .select('evaluado_id, pct_final, descriptor_final')
      .eq('sesion_id', req.params.sesion_id)

    const mapaResultados = {}
    for (const r of (resultados || [])) {
      mapaResultados[r.evaluado_id] = r
    }

    // ── Crear Excel ──────────────────────────────────────

    const workbook  = new ExcelJS.Workbook()
    workbook.creator = 'Evaluación Grupal'
    workbook.created = new Date()

    const sheet = workbook.addWorksheet('Resultados', {
      pageSetup: { paperSize: 9, orientation: 'landscape' },
    })

    // Encabezados
    sheet.columns = [
      { header: 'Aula',                 key: 'aula',       width: 20 },
      { header: 'Correo institucional', key: 'correo',     width: 36 },
      { header: '% Final',              key: 'pct_final',  width: 12 },
      { header: 'Descriptor',           key: 'descriptor', width: 14 },
    ]

    // Estilo del encabezado
    const headerRow = sheet.getRow(1)
    headerRow.font  = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    headerRow.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D6F42' } }
    headerRow.height = 20
    headerRow.alignment = { vertical: 'middle' }

    // Filas de datos
    let filaActual = 2
    let aulaActual = null

    for (const alumno of (todosAlumnos || [])) {
      const res = mapaResultados[alumno.id]
      const pct  = res?.pct_final     ?? null
      const desc = res?.descriptor_final ?? null

      // Línea separadora entre aulas
      if (aulaActual && aulaActual !== alumno.aula) {
        sheet.getRow(filaActual).height = 6
        filaActual++
      }
      aulaActual = alumno.aula

      const row = sheet.addRow({
        aula:       alumno.aula,
        correo:     alumno.correo,
        pct_final:  pct !== null ? parseFloat(pct) : '',
        descriptor: desc || '',
      })

      // Alternar fondo de filas
      const bgARGB = filaActual % 2 === 0 ? 'FFF5F5F5' : 'FFFFFFFF'
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgARGB } }
      row.alignment = { vertical: 'middle' }
      row.height = 18

      // Colorear la celda de descriptor según resultado
      if (desc && COLOR_DESCRIPTOR[desc]) {
        const celdaDesc = row.getCell('descriptor')
        const celdaPct  = row.getCell('pct_final')
        const colores   = COLOR_DESCRIPTOR[desc]

        celdaDesc.font = { color: { argb: colores.argb }, bold: true }
        celdaDesc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colores.fgARGB } }
        celdaPct.font  = { color: { argb: colores.argb }, bold: true }
      }

      // Celda de % con formato numérico
      row.getCell('pct_final').numFmt = '0.00"%"'

      filaActual++
    }

    // Bordes a toda la tabla
    const totalFilas = sheet.rowCount
    for (let i = 1; i <= totalFilas; i++) {
      sheet.getRow(i).eachCell({ includeEmpty: true }, cell => {
        cell.border = {
          top:    { style: 'thin', color: { argb: 'FFE0E0E0' } },
          left:   { style: 'thin', color: { argb: 'FFE0E0E0' } },
          bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          right:  { style: 'thin', color: { argb: 'FFE0E0E0' } },
        }
      })
    }

    // ── Enviar archivo ───────────────────────────────────

    const fecha     = new Date().toISOString().split('T')[0]
    const nombreArchivo = `evaluacion-grupal_${fecha}.xlsx`
      .replace(/[^a-z0-9._-]/gi, '-')

    res.setHeader('Content-Type',        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`)

    await workbook.xlsx.write(res)
    res.end()

  } catch (err) {
    console.error('Error exportando Excel:', err)
    res.status(500).json({ error: 'Error al generar el archivo Excel' })
  }
})


// ══════════════════════════════════════════════════════════
// GET /api/resultados/:sesion_id/alumno/:alumno_id
// Detalle de evaluaciones recibidas por un alumno especifico
// Solo accesible por el docente dueno de la sesion
// ══════════════════════════════════════════════════════════

router.get('/:sesion_id/alumno/:alumno_id', async (req, res) => {
  try {
    const sesion = await verificarSesion(req.params.sesion_id, req.usuario.id)
    if (!sesion) return res.status(404).json({ error: 'Sesion no encontrada' })

    // Datos del alumno
    const { data: alumno } = await supabase
      .from('alumnos')
      .select('id, nombre, correo, aula')
      .eq('id', req.params.alumno_id)
      .single()

    if (!alumno) return res.status(404).json({ error: 'Alumno no encontrado' })

    // Evaluaciones recibidas por el alumno en esta sesion
    const { data: evaluaciones, error } = await supabase
      .from('evaluaciones')
      .select('evaluador_id, respuestas, enviado_en')
      .eq('sesion_id', req.params.sesion_id)
      .eq('evaluado_id', req.params.alumno_id)

    if (error) throw error

    // Obtener nombres de los evaluadores (el docente puede verlos)
    const evaluadorIds = [...new Set((evaluaciones || []).map(e => e.evaluador_id))]
    const { data: evaluadores } = evaluadorIds.length > 0
      ? await supabase.from('alumnos').select('id, nombre').in('id', evaluadorIds)
      : { data: [] }
    const evaluadoresMap = {}
    for (const e of (evaluadores || [])) evaluadoresMap[e.id] = e.nombre

    // Construir detalle con nombre del evaluador visible para el docente
    const detalle = (evaluaciones || []).map((ev, idx) => {
      const esAutoeval = ev.evaluador_id === req.params.alumno_id
      return {
        numero:            esAutoeval ? 0 : idx + 1,
        es_autoevaluacion: esAutoeval,
        etiqueta:          esAutoeval ? 'Autoevaluacion' : ('Evaluador ' + (idx + 1)),
        evaluador_nombre:  evaluadoresMap[ev.evaluador_id] || null,
        enviado_en:        ev.enviado_en,
        respuestas:        (ev.respuestas || []).map(r => ({
          criterio_index:  r.criterio_index,
          criterio_nombre: sesion.criterios[r.criterio_index]?.nombre || ('Criterio ' + (r.criterio_index + 1)),
          descriptor:      r.descriptor,
          valor_pct:       r.valor_pct,
        })),
      }
    })

    // Ordenar: autoevaluacion primero
    detalle.sort((a, b) => a.es_autoevaluacion ? -1 : b.es_autoevaluacion ? 1 : 0)

    // Promedio por criterio
    const numCriterios = sesion.criterios.length
    const promediosPorCriterio = sesion.criterios.map((c, i) => {
      const vals = detalle.map(ev => {
        const r = ev.respuestas.find(r => r.criterio_index === i)
        return r ? r.valor_pct : null
      }).filter(v => v !== null)
      const prom = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null
      return {
        criterio_index: i,
        criterio_nombre: c.nombre,
        promedio_pct: prom ? Math.round(prom * 100) / 100 : null,
        descriptor: prom !== null
          ? prom >= 100 ? 'Excelente' : prom >= 75 ? 'Bueno' : prom >= 50 ? 'Regular' : 'Deficiente'
          : null,
      }
    })

    const pctFinal = promediosPorCriterio.every(p => p.promedio_pct !== null)
      ? Math.round(
          promediosPorCriterio.reduce((s, p) => s + p.promedio_pct, 0) / numCriterios * 100
        ) / 100
      : null

    res.json({
      alumno,
      sesion: { id: sesion.id, nombre: sesion.nombre, anonima: sesion.anonima },
      total_evaluaciones: detalle.length,
      pct_final: pctFinal,
      descriptor_final: pctFinal !== null
        ? pctFinal >= 100 ? 'Excelente' : pctFinal >= 75 ? 'Bueno' : pctFinal >= 50 ? 'Regular' : 'Deficiente'
        : null,
      por_criterio: promediosPorCriterio,
      evaluaciones: detalle,
    })

  } catch (err) {
    console.error('Error obteniendo detalle alumno:', err)
    res.status(500).json({ error: 'Error al obtener el detalle' })
  }
})

module.exports = router
