import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

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

  let payload: { email?: unknown; password?: unknown }
  try {
    payload = await req.json()
  } catch {
    return json(400, { error: "Ungültige Anfrage." }, origin)
  }

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : ""
  const password = typeof payload.password === "string" ? payload.password : ""

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return json(400, { error: "Bitte eine gültige E-Mail-Adresse eingeben." }, origin)
  }
  if (password.length < 8 || password.length > 128) {
    return json(400, { error: "Das Passwort muss zwischen 8 und 128 Zeichen lang sein." }, origin)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: "Registrierung ist derzeit nicht verfügbar." }, origin)

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })

  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  const clientIp = forwarded || req.headers.get("cf-connecting-ip") || "unknown"

  const { data: rateAllowed, error: rateError } = await admin.rpc("check_registration_rate_limit", {
    p_email: email,
    p_ip: clientIp,
  })

  if (rateError) {
    console.error("registration rate limit check failed", rateError)
    return json(500, { error: "Registrierung ist derzeit nicht verfügbar." }, origin)
  }
  if (!rateAllowed) {
    return json(429, { error: "Zu viele Registrierungsversuche. Bitte versuche es später erneut." }, origin)
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (error) {
    console.error("admin.createUser failed", { code: error.code, status: error.status })
    const duplicate = error.code === "email_exists" || error.code === "user_already_exists" || error.status === 422
    return json(duplicate ? 409 : 400, {
      error: duplicate
        ? "Für diese E-Mail-Adresse existiert bereits ein Account. Bitte nutze den Login oder ‚Passwort vergessen‘."
        : "Der Account konnte nicht angelegt werden. Bitte prüfe deine Eingaben.",
    }, origin)
  }

  return json(201, {
    ok: true,
    userId: data.user?.id ?? null,
    message: "Account angelegt. Die Freischaltung durch den Ersteller/Admin steht noch aus.",
  }, origin)
})
