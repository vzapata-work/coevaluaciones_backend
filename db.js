// db.js — conexión a Supabase
// Exporta el cliente listo para usar en cualquier módulo

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service_role: acceso total, sin RLS
)

module.exports = supabase
