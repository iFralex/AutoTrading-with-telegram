/**
 * Client HTTP per le API del server VPS.
 * URL base configurabile via NEXT_PUBLIC_API_URL.
 */

const BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "")

// ── Tipi risposta ─────────────────────────────────────────────────────────────

export interface RequestCodeResponse {
  login_key: string
}

export interface VerifyCodeResponse {
  user_id: string
  first_name: string
  phone: string
  login_key: string
}

export interface TwoFARequiredResponse {
  error: "2fa_required"
  login_key: string
}

export interface Group {
  id: string
  name: string
  type: "channel" | "group"
  members: number
}

export interface MT5Account {
  name: string
  server: string
  balance: number
  currency: string
}

export interface CompleteSetupPayload {
  login_key: string
  user_id: string
  api_id: number
  api_hash: string
  phone: string
  group_id: string
  group_name: string
  mt5_login?: number
  mt5_password?: string
  mt5_server?: string
}

// ── Errore tipizzato ──────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = "ApiError"
  }
}

// ── Helper fetch ──────────────────────────────────────────────────────────────

async function call<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(
      "Impossibile contattare il server. Controlla la connessione.",
      0
    )
  }

  if (!res.ok) {
    let detail = `Errore ${res.status}`
    try {
      const json = await res.json()
      if (typeof json.detail === "string") detail = json.detail
      else if (Array.isArray(json.detail)) detail = json.detail.map((e: {msg: string}) => e.msg).join(", ")
    } catch {}
    throw new ApiError(detail, res.status)
  }

  return res.json() as Promise<T>
}

// ── API ───────────────────────────────────────────────────────────────────────

export const api = {
  /**
   * Step 2a — invia il codice OTP al numero di telefono.
   * Ritorna il login_key da passare ai passi successivi.
   */
  requestCode(apiId: number, apiHash: string, phone: string) {
    return call<RequestCodeResponse>("POST", "/api/setup/telegram/request-code", {
      api_id: apiId,
      api_hash: apiHash,
      phone,
    })
  },

  /**
   * Step 2b — verifica il codice OTP.
   * Può ritornare un normale VerifyCodeResponse oppure TwoFARequiredResponse
   * se l'account ha la verifica in due passaggi attiva.
   */
  verifyCode(loginKey: string, code: string) {
    return call<VerifyCodeResponse | TwoFARequiredResponse>(
      "POST",
      "/api/setup/telegram/verify-code",
      { login_key: loginKey, code }
    )
  },

  /** Step 2b 2FA — completa il login con la password cloud Telegram. */
  verifyPassword(loginKey: string, password: string) {
    return call<VerifyCodeResponse>(
      "POST",
      "/api/setup/telegram/verify-password",
      { login_key: loginKey, password }
    )
  },

  /** Step 3 — lista gruppi e canali dell'utente autenticato. */
  getGroups(loginKey: string) {
    return call<{ groups: Group[] }>(
      "GET",
      `/api/setup/telegram/groups?login_key=${encodeURIComponent(loginKey)}`
    )
  },

  /**
   * Step 4 — tenta il login MT5 con le credenziali fornite.
   * Ritorna le info del conto se il login ha successo.
   * Lancia ApiError (503) se MT5 non è disponibile sul server.
   */
  verifyMt5(login: number, password: string, server: string) {
    return call<{ valid: true; account: MT5Account }>(
      "POST",
      "/api/setup/mt5/verify",
      { login, password, server }
    )
  },

  /** Step 5 — salva la configurazione e avvia il listener Telegram. */
  completeSetup(payload: CompleteSetupPayload) {
    return call<{ status: string; user_id: string }>(
      "POST",
      "/api/setup/complete",
      payload
    )
  },
}
