import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const CREATOR_EMAIL = "turnier.admin@gmx.de"
const allowedOrigins = new Set([
  "https://furfural0405.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
])

function corsHeaders(origin: string | null) {
  const allowedOrigin = origin && allowedOrigins.has(origin) ? origin : "https://furfural0405.github.io"
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  }
}

function json(status: number, body: Record<string, unknown>, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  })
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin")

  if (req.method === "OPTIONS") {
    if (!origin || !allowedOrigins.has(origin)) return json(403, { error: "Origin not allowed" }, origin)
    return new Response("ok", { headers: corsHeaders(origin) })
  }

  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, origin)
  if (!origin || !allowedOrigins.has(origin)) return json(403, { error: "Origin not allowed" }, origin)

  const authHeader = req.headers.get("Authorization") ?? ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""
  if (!token) return json(401, { error: "Nicht angemeldet." }, origin)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: "Accountverwaltung ist derzeit nicht verfügbar." }, origin)

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })

  const { data: userData, error: userError } = await admin.auth.getUser(token)
  const caller = userData.user
  if (userError || !caller) return json(401, { error: "Sitzung konnte nicht bestätigt werden." }, origin)

  const { data: callerProfile, error: callerProfileError } = await admin
    .from("profiles")
    .select("id,email,approved,role,is_creator")
    .eq("id", caller.id)
    .maybeSingle()

  if (callerProfileError) return json(500, { error: "Berechtigung konnte nicht geprüft werden." }, origin)

  const isCreator = Boolean(
    callerProfile?.approved === true &&
    callerProfile?.role === "admin" &&
    callerProfile?.is_creator === true &&
    typeof callerProfile?.email === "string" &&
    callerProfile.email.toLowerCase() === CREATOR_EMAIL,
  )

  if (!isCreator) return json(403, { error: "Nur der Ersteller/Admin darf abgelehnte Anfragen entfernen." }, origin)

  let payload: { userId?: unknown }
  try {
    payload = await req.json()
  } catch {
    return json(400, { error: "Ungültige Anfrage." }, origin)
  }

  const userId = typeof payload.userId === "string" ? payload.userId.trim() : ""
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return json(400, { error: "Ungültige Benutzer-ID." }, origin)
  }
  if (userId === caller.id) return json(403, { error: "Der Ersteller-Account kann nicht entfernt werden." }, origin)

  const { data: target, error: targetError } = await admin
    .from("profiles")
    .select("id,email,approved,role,is_creator,access_status")
    .eq("id", userId)
    .maybeSingle()

  if (targetError) return json(500, { error: "Anfrage konnte nicht geprüft werden." }, origin)
  if (!target) return json(404, { error: "Die Anfrage existiert nicht mehr." }, origin)
  if (target.is_creator) return json(403, { error: "Der Ersteller-Account kann nicht entfernt werden." }, origin)
  if (target.access_status !== "rejected" || target.approved === true || target.role !== "viewer") {
    return json(409, { error: "Nur bereits abgelehnte Zugriffsanfragen können endgültig entfernt werden." }, origin)
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId)
  if (deleteError) {
    console.error("deleteUser failed", { code: deleteError.code, status: deleteError.status })
    return json(500, { error: "Der abgelehnte Account konnte nicht entfernt werden." }, origin)
  }

  return json(200, {
    ok: true,
    removedUserId: userId,
    message: "Abgelehnte Anfrage und zugehöriger Login-Account wurden entfernt.",
  }, origin)
})
