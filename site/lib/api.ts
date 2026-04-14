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
  sizing_strategy?: string
}

export interface SetupSession {
  exists: true
  phone: string
  api_id: number | null
  api_hash: string | null
  login_key: string | null
  user_id: string | null
  group_id: string | null
  group_name: string | null
  mt5_login: number | null
  has_mt5_password: boolean
  mt5_server: string | null
  sizing_strategy: string | null
}

export type SessionResponse = SetupSession | { exists: false }

export interface SaveSessionPayload {
  phone: string
  api_id?: number
  api_hash?: string
  login_key?: string
  user_id?: string
  group_id?: string
  group_name?: string
  mt5_login?: number
  mt5_password?: string
  mt5_server?: string
  sizing_strategy?: string
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

// ── Dashboard types ───────────────────────────────────────────────────────────

export interface DashboardUser {
  user_id: string
  api_id: number
  api_hash: string
  phone: string
  group_id: number
  group_name: string
  mt5_login: number | null
  mt5_server: string | null
  sizing_strategy: string | null
  active: boolean
  created_at: string
}

export interface TradeSignalLog {
  symbol: string
  order_type: "BUY" | "SELL"
  entry_price: number | [number, number] | null
  stop_loss: number | null
  take_profit: number | null
  lot_size: number | null
  order_mode: "MARKET" | "LIMIT" | "STOP"
}

export interface TradeResultLog {
  success: boolean
  order_id: number | null
  error: string | null
  signal: TradeSignalLog | null
}

export interface AccountInfoLog {
  balance: number
  equity: number
  free_margin: number
  currency: string
  leverage: number
}

export interface SignalLog {
  id: number
  user_id: string
  ts: string
  sender_name: string | null
  message_text: string
  is_signal: boolean
  flash_raw: string | null
  has_mt5_creds: boolean
  sizing_strategy: string | null
  account_info: AccountInfoLog | null
  signals_json: TradeSignalLog[] | null
  results_json: TradeResultLog[] | null
  error_step: string | null
  error_msg: string | null
}

export interface DashboardUserResponse {
  user: DashboardUser
  logs: SignalLog[]
  total_logs: number
}

export interface DashboardLogsResponse {
  logs: SignalLog[]
  total: number
}

/** Stesso schema accettato da POST /api/dashboard/test-order */
export interface TestSignalInput {
  symbol:      string
  order_type:  "BUY" | "SELL"
  entry_price: number | [number, number] | null
  stop_loss:   number | null
  take_profit: number | null
  lot_size:    number | null
  order_mode:  "MARKET" | "LIMIT" | "STOP"
}

export interface TestOrderResponse {
  results: TradeResultLog[]
}

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

  // ── Session ───────────────────────────────────────────────────────────────

  /** Recupera la sessione di setup esistente per un numero di telefono. */
  getSession(phone: string) {
    return call<SessionResponse>(
      "GET",
      `/api/setup/session?phone=${encodeURIComponent(phone)}`
    )
  },

  /** Salva/aggiorna campi della sessione di setup. */
  saveSession(payload: SaveSessionPayload) {
    return call<{ ok: boolean }>("POST", "/api/setup/session", payload)
  },

  /**
   * Cancella campi specifici della sessione (usato dal pulsante Indietro).
   * Accepted field names: api_id, api_hash, login_key, user_id, group_id,
   * group_name, mt5_login, mt5_password, mt5_server, sizing_strategy
   */
  clearSessionFields(phone: string, fields: string[]) {
    return call<{ ok: boolean }>("DELETE", "/api/setup/session/fields", { phone, fields })
  },

  /** Elimina la sessione di setup (usato da "Ricomincia da capo"). */
  deleteSession(phone: string) {
    return call<{ ok: boolean }>(
      "DELETE",
      `/api/setup/session?phone=${encodeURIComponent(phone)}`
    )
  },

  // ── Dashboard ─────────────────────────────────────────────────────────────

  /** Recupera profilo utente + ultimi 50 log segnali per numero di telefono. */
  getDashboardUser(phone: string) {
    return call<DashboardUserResponse>(
      "GET",
      `/api/dashboard/user?phone=${encodeURIComponent(phone)}`
    )
  },

  /** Carica ulteriori log segnali (paginazione). */
  getDashboardLogs(userId: string, limit = 50, offset = 0) {
    return call<DashboardLogsResponse>(
      "GET",
      `/api/dashboard/logs?user_id=${encodeURIComponent(userId)}&limit=${limit}&offset=${offset}`
    )
  },

  /**
   * Esegue direttamente un array di segnali (formato JSON AI) su MT5
   * per l'utente indicato e ritorna i TradeResult.
   */
  testOrder(userId: string, signals: TestSignalInput[]) {
    return call<TestOrderResponse>("POST", "/api/dashboard/test-order", {
      user_id: userId,
      signals,
    })
  },
}
