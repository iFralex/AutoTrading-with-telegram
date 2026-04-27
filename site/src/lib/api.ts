/**
 * Client HTTP per le API del server VPS.
 * URL base configurabile via NEXT_PUBLIC_API_URL.
 */

// In production (HTTPS) use relative URLs so the Next.js rewrite proxy is used,
// avoiding mixed-content blocks. In development fall back to the direct VPS URL.
const BASE_URL =
  typeof window !== "undefined" && window.location.protocol === "https:"
    ? ""
    : (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "")

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
  management_strategy?: string
  deletion_strategy?: string
  extraction_instructions?: string
  range_entry_pct?: number
  entry_if_favorable?: boolean
  min_confidence?: number
  trading_hours_enabled?: boolean
  trading_hours_start?: number
  trading_hours_end?: number
  trading_hours_days?: string[]
  eco_calendar_enabled?: boolean
  eco_calendar_window?: number
  eco_calendar_strategy?: string
  community_visible?: boolean
}

export interface SetupSession {
  exists: true
  /** true se l'utente ha già completato il setup ed è presente nel database utenti */
  setup_complete?: boolean
  phone?: string
  api_id?: number | null
  api_hash?: string | null
  login_key?: string | null
  user_id?: string | null
  group_id?: string | null
  group_name?: string | null
  mt5_login?: number | null
  has_mt5_password?: boolean
  mt5_server?: string | null
  sizing_strategy?: string | null
  management_strategy?: string | null
  deletion_strategy?: string | null
  extraction_instructions?: string | null
  range_entry_pct?: number | null
  entry_if_favorable?: boolean | null
  min_confidence?: number | null
  trading_hours_enabled?: boolean | null
  trading_hours_start?: number | null
  trading_hours_end?: number | null
  trading_hours_days?: string[] | null
  eco_calendar_enabled?: boolean | null
  eco_calendar_window?: number | null
  eco_calendar_strategy?: string | null
  community_visible?: boolean | null
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
  management_strategy?: string
  deletion_strategy?: string
  extraction_instructions?: string
  range_entry_pct?: number
  entry_if_favorable?: boolean
  min_confidence?: number
  trading_hours_enabled?: boolean
  trading_hours_start?: number
  trading_hours_end?: number
  trading_hours_days?: string[]
  eco_calendar_enabled?: boolean
  eco_calendar_window?: number
  eco_calendar_strategy?: string
  community_visible?: boolean
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

export interface UserGroup {
  id: number
  user_id: string
  group_id: number
  group_name: string
  sizing_strategy: string | null
  management_strategy: string | null
  range_entry_pct: number
  entry_if_favorable: boolean
  deletion_strategy: string | null
  extraction_instructions: string | null
  trading_hours_enabled: boolean
  trading_hours_start: number | null
  trading_hours_end: number | null
  trading_hours_days: string[] | null
  min_confidence: number
  eco_calendar_enabled:   boolean
  eco_calendar_window:    number
  eco_calendar_strategy:  string | null
  active: boolean
  created_at: string
}

export interface TrustScoreBreakdown {
  win_rate_pts:          number
  profit_factor_pts:     number
  volume_pts:            number
  exec_rate_pts:         number
  streak_pts:            number
}

export interface TrustScore {
  group_id:               number
  group_name:             string
  score:                  number | null
  label:                  string
  trade_count:            number
  win_rate:               number | null
  profit_factor:          number | null
  max_consecutive_losses: number | null
  breakdown:              TrustScoreBreakdown | null
}

export interface DashboardUser {
  user_id: string
  api_id: number
  api_hash: string
  phone: string
  /** @deprecated usa groups[0].group_id */
  group_id: number
  /** @deprecated usa groups[0].group_name */
  group_name: string
  mt5_login: number | null
  mt5_server: string | null
  active: boolean
  created_at: string
  drawdown_alert_pct:   number | null
  drawdown_period:      "daily" | "weekly" | "monthly" | "custom"
  drawdown_period_days: number
  drawdown_strategy:    string | null
  groups: UserGroup[]
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

export interface SimulateMessageResponse {
  flash_raw:        "YES" | "NO" | null
  is_signal:        boolean
  signals:          TradeSignalLog[]
  sizing_strategy:  string | null
  error_step:       string | null
  error:            string | null
}

// ── Dashboard Stats types ─────────────────────────────────────────────────────

export interface DailyStats {
  day:         string
  messages:    number
  signals:     number
  orders_sent: number
}

export interface WeeklyStats {
  week:     string
  messages: number
  signals:  number
  orders:   number
}

export interface HourlyStats {
  hour:     number
  messages: number
  signals:  number
}

export interface SymbolStats {
  symbol:       string
  total:        number
  successful:   number
  failed:       number
  buy:          number
  sell:         number
  avg_lot:      number | null
  success_rate: number
}

export interface BalanceTrendPoint {
  ts:      string
  balance: number | null
  equity:  number | null
}

export interface ErrorStepCount {
  error_step: string
  count:      number
}

export interface SenderCount {
  sender_name: string
  count:       number
}

export interface DashboardStats {
  total_messages:         number
  total_signals:          number
  signal_rate:            number
  total_order_executions: number
  successful_orders:      number
  failed_orders:          number
  execution_success_rate: number
  total_errors:           number
  errors_by_step:         ErrorStepCount[]
  daily_stats:            DailyStats[]
  weekly_stats:           WeeklyStats[]
  hourly_distribution:    HourlyStats[]
  top_senders:            SenderCount[]
  by_symbol:              SymbolStats[]
  by_order_type:          { BUY: number; SELL: number }
  by_order_mode:          Record<string, number>
  avg_lot_size:           number | null
  min_lot_size:           number | null
  max_lot_size:           number | null
  balance_trend:          BalanceTrendPoint[]
}

export interface SavedReport {
  id:           number
  user_id:      string
  year:         number
  month:        number
  generated_at: string
  size_bytes:   number
}

// ── Community Groups (Elite) ──────────────────────────────────────────────────

export interface CommunityGroup {
  token:                  string
  alias:                  string
  score:                  number | null
  label:                  string
  is_following:           boolean
  trade_count:            number
  win_rate:               number | null
  total_profit:           number
  profit_factor:          number | null
  max_consecutive_losses: number
  breakdown:              Record<string, number>
}

export interface CommunityGroupDetail extends CommunityGroup {
  is_following:  boolean
  trade_stats:   TradeStats
  equity_curve:  { day: string; daily_pnl: number; cumulative_pnl: number }[]
  recent_trades: ClosedTrade[]
}

export interface CommunityFollow {
  token:        string
  alias:        string
  score:        number | null
  label:        string
  trade_count:  number
  win_rate:     number | null
  total_profit: number | null
  followed_at:  string
  my_settings:  Partial<UserGroup>
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
  verifyMt5(login: number, password: string, server: string, phone?: string) {
    return call<{ valid: true; account: MT5Account }>(
      "POST",
      "/api/setup/mt5/verify",
      { login, password, server, ...(phone ? { phone } : {}) }
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

  /** Signal Simulator — ultimi messaggi dal gruppo selezionato (usa sessione pendente). */
  getRecentMessages(loginKey: string, groupId: string, limit = 15) {
    return call<{ messages: { id: number; text: string; date: string | null }[] }>(
      "GET",
      `/api/setup/telegram/recent-messages?login_key=${encodeURIComponent(loginKey)}&group_id=${encodeURIComponent(groupId)}&limit=${limit}`
    )
  },

  /** Signal Simulator — estrae il segnale e, se fornito price_path, simula gli eventi. */
  simulateSignal(payload: {
    message: string
    sizing_strategy?: string
    extraction_instructions?: string
    management_strategy?: string
    deletion_strategy?: string
    price_path?: { t: number; price: number }[]
    timeline_events?: { t: number; type: string }[]
    lot_size?: number
    symbol_specs?: Record<string, number>  // symbol → contract_size override
  }) {
    return call<{
      is_signal: boolean
      extracted: Array<{
        symbol: string
        order_type: string
        entry_price: number | [number, number] | null
        stop_loss: number | null
        take_profit: number | null
        lot_size: number | null
        order_mode: string
        confidence: number | null
      }>
      simulation: {
        per_signal: Array<{
          signal_index: number
          symbol: string
          order_type: string
          entry: number | null
          sl: number | null
          tp: number | null
          events: Array<{ t: number; type: string; price: number; pnl?: number; description: string }>
          state: string
        }>
        total_pnl: number
      } | null
    }>("POST", "/api/setup/simulate-signal", payload)
  },

  /**
   * Full stateful pipeline simulation: extract → pretrade AI → walk-forward with auto AI events.
   * Returns pretrade decisions and simulation events with embedded AI results.
   */
  simulateFull(payload: {
    message: string
    sizing_strategy?: string
    extraction_instructions?: string
    management_strategy?: string
    deletion_strategy?: string
    price_path: { t: number; price: number }[]
    timeline_events?: { t: number; type: string }[]
    lot_size?: number
    symbol_specs?: Record<string, number>
    mock_state?: {
      balance?: number; equity?: number; free_margin?: number; leverage?: number
      currency?: string; server?: string
      daily_pnl?: number; weekly_pnl?: number; monthly_pnl?: number
      open_positions?: unknown[]; pending_orders?: unknown[]
      prices?: Record<string, unknown>
    }
  }) {
    return call<{
      is_signal: boolean
      extracted: Array<{
        symbol: string; order_type: string
        entry_price: number | [number, number] | null
        stop_loss: number | null; take_profit: number | null
        lot_size: number | null; order_mode: string; confidence: number | null
      }>
      pretrade: {
        event_type: string
        decisions: Array<{
          signal_index: number; approved: boolean; reason: string
          modified_lots?: number | null; modified_sl?: number | null; modified_tp?: number | null
        }>
        tool_calls: Array<{ name: string; args: Record<string, unknown>; result: Record<string, unknown> }>
        actions: Array<{ tool: string; [key: string]: unknown }>
        final_response: string
      } | null
      simulation: {
        per_signal: Array<{
          signal_index: number; symbol: string; order_type: string
          entry: number | null; sl: number | null; tp: number | null
          events: Array<{
            t: number; type: string; price: number; pnl?: number; description: string
            ai_result?: {
              tool_calls: Array<{ name: string; args: Record<string, unknown>; result: Record<string, unknown> }>
              actions: Array<{ tool: string; [key: string]: unknown }>
              final_response: string
            }
          }>
          state: string
        }>
        total_pnl: number
      } | null
    }>("POST", "/api/setup/simulate-full", payload)
  },

  /** Mock AI pre_trade / on_event simulation — real Gemini agent with mocked MT5 tools. */
  simulatePretrade(payload: {
    signals: Array<{
      symbol: string; order_type: string; entry_price: number | [number, number] | null
      stop_loss: number | null; take_profit: number | null; lot_size: number | null
      order_mode: string; confidence: number | null
    }>
    message?: string
    management_strategy?: string
    deletion_strategy?: string
    sizing_strategy?: string
    event_type?: string
    event_data?: Record<string, unknown>
    mock_state?: {
      balance?: number; equity?: number; free_margin?: number; leverage?: number
      currency?: string; server?: string
      daily_pnl?: number; weekly_pnl?: number; monthly_pnl?: number
      open_positions?: unknown[]; pending_orders?: unknown[]
      prices?: Record<string, unknown>
    }
  }) {
    return call<{
      event_type: string
      decisions: Array<{
        signal_index: number
        approved: boolean
        reason: string
        modified_lots?: number | null
        modified_sl?: number | null
        modified_tp?: number | null
      }>
      tool_calls: Array<{ name: string; args: Record<string, unknown>; result: Record<string, unknown> }>
      actions: Array<{ tool: string; [key: string]: unknown }>
      final_response: string
    }>("POST", "/api/setup/simulate-pretrade", payload)
  },

  // ── Dashboard ─────────────────────────────────────────────────────────────

  /** Recupera profilo utente + ultimi 50 log segnali per numero di telefono. */
  getDashboardUser(phone: string) {
    return call<DashboardUserResponse>(
      "GET",
      `/api/dashboard/user?phone=${encodeURIComponent(phone)}`
    )
  },

  /** Carica ulteriori log segnali (paginazione, opzionalmente filtrata per gruppo). */
  getDashboardLogs(userId: string, limit = 50, offset = 0, groupId?: number) {
    const gq = groupId != null ? `&group_id=${groupId}` : ""
    return call<DashboardLogsResponse>(
      "GET",
      `/api/dashboard/logs?user_id=${encodeURIComponent(userId)}&limit=${limit}&offset=${offset}${gq}`
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

  /** Simula la pipeline Flash+Pro su un messaggio senza eseguire ordini MT5. */
  simulateMessage(userId: string, message: string) {
    return call<SimulateMessageResponse>("POST", "/api/dashboard/simulate-message", {
      user_id: userId,
      message,
    })
  },

  /** Aggiorna la management strategy dell'utente. */
  updateManagementStrategy(userId: string, managementStrategy: string | null) {
    return call<{ ok: boolean }>(
      "PATCH",
      `/api/dashboard/user/${encodeURIComponent(userId)}/management-strategy`,
      { management_strategy: managementStrategy || null }
    )
  },

  /** Aggiorna la sizing strategy dell'utente. */
  updateSizingStrategy(userId: string, sizingStrategy: string | null) {
    return call<{ ok: boolean }>(
      "PATCH",
      `/api/dashboard/user/${encodeURIComponent(userId)}/sizing-strategy`,
      { sizing_strategy: sizingStrategy || null }
    )
  },

  /** Aggiorna la percentuale di posizionamento nel range di ingresso (0–100). */
  updateRangeEntryPct(userId: string, rangeEntryPct: number) {
    return call<{ ok: boolean }>(
      "PATCH",
      `/api/dashboard/user/${encodeURIComponent(userId)}/range-entry-pct`,
      { range_entry_pct: rangeEntryPct }
    )
  },

  /** Aggiorna la strategia da eseguire quando un messaggio segnale viene eliminato. */
  updateDeletionStrategy(userId: string, deletionStrategy: string | null) {
    return call<{ ok: boolean }>(
      "PATCH",
      `/api/dashboard/user/${encodeURIComponent(userId)}/deletion-strategy`,
      { deletion_strategy: deletionStrategy || null }
    )
  },

  /** Aggiorna le istruzioni custom per il prompt di estrazione Pro. */
  updateExtractionInstructions(userId: string, extractionInstructions: string | null) {
    return call<{ ok: boolean }>(
      "PATCH",
      `/api/dashboard/user/${encodeURIComponent(userId)}/extraction-instructions`,
      { extraction_instructions: extractionInstructions || null }
    )
  },

  /** Azzera tutte le statistiche dell'utente (log segnali, AI, trade chiusi). */
  resetUserStats(userId: string) {
    return call<{ ok: boolean; deleted_signal_logs: number; deleted_ai_logs: number; deleted_trades: number }>(
      "DELETE",
      `/api/dashboard/user/${encodeURIComponent(userId)}/stats`
    )
  },

  /** Elimina l'account utente e tutti i dati associati (Telegram, MT5, log, backtest, sessione). */
  deleteUser(userId: string) {
    return call<{ ok: boolean }>(
      "DELETE",
      `/api/dashboard/user/${encodeURIComponent(userId)}`
    )
  },

  // ── Gestione gruppi multi-canale ──────────────────────────────────────────

  /** Ritorna i gruppi/canali Telegram disponibili (non ancora configurati) per un utente. */
  getAvailableGroups(userId: string) {
    return call<{ groups: Group[] }>(
      "GET",
      `/api/dashboard/user/${encodeURIComponent(userId)}/available-groups`
    )
  },

  /** Ritorna tutti i gruppi/canali configurati per un utente. */
  getUserGroups(userId: string) {
    return call<{ groups: UserGroup[] }>(
      "GET",
      `/api/dashboard/user/${encodeURIComponent(userId)}/groups`
    )
  },

  /** Aggiunge un nuovo gruppo/canale e riavvia il listener. */
  addUserGroup(userId: string, groupId: number, groupName: string) {
    return call<{ ok: boolean }>(
      "POST",
      `/api/dashboard/user/${encodeURIComponent(userId)}/groups`,
      { group_id: groupId, group_name: groupName }
    )
  },

  /** Aggiorna le impostazioni di un gruppo specifico. */
  updateUserGroup(
    userId: string,
    groupId: number,
    settings: Partial<Pick<UserGroup,
      "group_name" | "sizing_strategy" | "management_strategy" |
      "range_entry_pct" | "entry_if_favorable" |
      "deletion_strategy" | "extraction_instructions" |
      "trading_hours_enabled" | "trading_hours_start" | "trading_hours_end" | "trading_hours_days" |
      "min_confidence" | "eco_calendar_enabled" | "eco_calendar_window" | "eco_calendar_strategy"
    >>
  ) {
    return call<{ ok: boolean }>(
      "PATCH",
      `/api/dashboard/user/${encodeURIComponent(userId)}/groups/${groupId}`,
      settings
    )
  },

  /** Rimuove un gruppo/canale e riavvia il listener. */
  removeUserGroup(userId: string, groupId: number) {
    return call<{ ok: boolean }>(
      "DELETE",
      `/api/dashboard/user/${encodeURIComponent(userId)}/groups/${groupId}`
    )
  },

  /** Aggiorna la modalità di ingresso quando il prezzo è già favorevole. */
  updateEntryIfFavorable(userId: string, entryIfFavorable: boolean) {
    return call<{ ok: boolean }>(
      "PATCH",
      `/api/dashboard/user/${encodeURIComponent(userId)}/entry-if-favorable`,
      { entry_if_favorable: entryIfFavorable }
    )
  },

  /** Statistiche aggregate complete per un utente (opzionalmente filtrate per gruppo). */
  getDashboardStats(userId: string, groupId?: number) {
    const gq = groupId != null ? `&group_id=${groupId}` : ""
    return call<DashboardStats>(
      "GET",
      `/api/dashboard/stats?user_id=${encodeURIComponent(userId)}${gq}`
    )
  },

  /** Statistiche di performance sulle operazioni chiuse (P&L, win rate, ecc.). */
  getTradeStats(userId: string) {
    return call<TradeStats>(
      "GET",
      `/api/dashboard/trade-stats?user_id=${encodeURIComponent(userId)}`
    )
  },

  /** Ultimi N log di chiamate AI per un utente. */
  getAILogs(userId: string, limit = 50, offset = 0) {
    return call<{ logs: AILog[]; total: number }>(
      "GET",
      `/api/dashboard/ai-logs?user_id=${encodeURIComponent(userId)}&limit=${limit}&offset=${offset}`
    )
  },

  /** Statistiche aggregate sull'utilizzo AI per un utente. */
  getAIStats(userId: string) {
    return call<AIStats>(
      "GET",
      `/api/dashboard/ai-stats?user_id=${encodeURIComponent(userId)}`
    )
  },

  /** Ultime N posizioni chiuse con tutti i dati (per diagnostica). */
  getRecentTrades(userId: string, limit = 5) {
    return call<{ trades: ClosedTrade[] }>(
      "GET",
      `/api/dashboard/recent-trades?user_id=${encodeURIComponent(userId)}&limit=${limit}`
    )
  },

  // ── Trust Score (Feature 4) ───────────────────────────────────────────────

  /** Trust Score per ogni gruppo: win rate, volume e exec rate aggregati. */
  getTrustScores(userId: string) {
    return call<{ scores: TrustScore[] }>(
      "GET",
      `/api/dashboard/trust-scores?user_id=${encodeURIComponent(userId)}`
    )
  },

  // ── Drawdown alert (Feature 6) ────────────────────────────────────────────

  /** Stato drawdown: se il trading è sospeso, la soglia e le impostazioni periodo/strategia. */
  getDrawdownStatus(userId: string) {
    return call<{
      paused:       boolean
      threshold:    number | null
      period:       "daily" | "weekly" | "monthly" | "custom"
      period_days:  number
      strategy:     string | null
    }>(
      "GET",
      `/api/dashboard/user/${encodeURIComponent(userId)}/drawdown-status`
    )
  },

  /** Aggiorna le impostazioni drawdown complete (soglia, periodo, giorni custom, strategia). */
  updateDrawdownSettings(
    userId: string,
    settings: {
      drawdown_alert_pct?:   number | null
      drawdown_period?:      "daily" | "weekly" | "monthly" | "custom"
      drawdown_period_days?: number
      drawdown_strategy?:    string | null
    }
  ) {
    return call<{ ok: boolean }>(
      "PATCH",
      `/api/dashboard/user/${encodeURIComponent(userId)}/drawdown-settings`,
      settings
    )
  },

  /** Riprende il trading dopo una sospensione per drawdown. */
  resumeDrawdown(userId: string) {
    return call<{ ok: boolean }>(
      "POST",
      `/api/dashboard/user/${encodeURIComponent(userId)}/resume-drawdown`
    )
  },

  // ── Report on-demand (Feature 8) ─────────────────────────────────────────

  /**
   * Genera un PDF per gli ultimi `days` giorni e lo scarica nel browser.
   * Invia anche via Telegram se send_telegram=true (default).
   */
  async generateReport(userId: string, days = 30, sendTelegram = true): Promise<void> {
    const url =
      `${BASE_URL}/api/dashboard/user/${encodeURIComponent(userId)}/generate-report` +
      `?days=${days}&send_telegram=${sendTelegram}`
    const res = await fetch(url, { method: "POST" })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error((body as { detail?: string }).detail ?? `HTTP ${res.status}`)
    }
    const blob = await res.blob()
    const objUrl = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = objUrl
    a.download = `report_${days}d_${new Date().toISOString().slice(0, 10)}.pdf`
    a.click()
    URL.revokeObjectURL(objUrl)
  },

  // ── Saved monthly reports (Feature 8) ────────────────────────────────────

  /** Returns metadata list (no PDF bytes) for all saved monthly reports of a user. */
  listReports(userId: string) {
    return call<{ reports: SavedReport[] }>(
      "GET",
      `/api/dashboard/user/${encodeURIComponent(userId)}/reports`
    )
  },

  /**
   * Downloads a saved monthly PDF report and triggers a browser save dialog.
   */
  async downloadSavedReport(userId: string, year: number, month: number): Promise<void> {
    const url = `${BASE_URL}/api/dashboard/user/${encodeURIComponent(userId)}/reports/${year}/${month}`
    const res = await fetch(url)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error((body as { detail?: string }).detail ?? `HTTP ${res.status}`)
    }
    const blob = await res.blob()
    const objUrl = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = objUrl
    a.download = `report_${year}_${String(month).padStart(2, "0")}.pdf`
    a.click()
    URL.revokeObjectURL(objUrl)
  },

  // ── Community Groups (Elite) ──────────────────────────────────────────────

  /** List all public community groups sorted by trust score. When userId is provided, is_following is populated per group. */
  listCommunityGroups(userId?: string) {
    const q = userId ? `?user_id=${encodeURIComponent(userId)}` : ""
    return call<{ groups: CommunityGroup[] }>("GET", `/api/dashboard/community/groups${q}`)
  },

  /** Detailed stats for a community group (equity curve, recent trades, score). */
  getCommunityGroup(token: string, userId?: string) {
    const q = userId ? `?user_id=${encodeURIComponent(userId)}` : ""
    return call<CommunityGroupDetail>(
      "GET",
      `/api/dashboard/community/groups/${encodeURIComponent(token)}${q}`
    )
  },

  /** Follow a community group (creates shadow settings entry). */
  followCommunityGroup(token: string, followerUserId: string) {
    return call<{ ok: boolean; already_following: boolean }>(
      "POST",
      `/api/dashboard/community/groups/${encodeURIComponent(token)}/follow`,
      { follower_user_id: followerUserId }
    )
  },

  /** Unfollow a community group (optionally closes open positions). */
  unfollowCommunityGroup(token: string, userId: string, closePositions = true) {
    return call<{ ok: boolean }>(
      "DELETE",
      `/api/dashboard/community/groups/${encodeURIComponent(token)}/follow` +
        `?user_id=${encodeURIComponent(userId)}&close_positions=${closePositions}`
    )
  },

  /** List community groups the user is currently following. */
  listCommunityFollows(userId: string) {
    return call<{ following: CommunityFollow[] }>(
      "GET",
      `/api/dashboard/user/${encodeURIComponent(userId)}/community-follows`
    )
  },

  /** Update personal strategies for a followed community group. */
  updateCommunityFollowSettings(
    userId: string,
    token: string,
    settings: Partial<Pick<UserGroup,
      "sizing_strategy" | "management_strategy" | "range_entry_pct" |
      "entry_if_favorable" | "deletion_strategy" | "extraction_instructions"
    >>
  ) {
    return call<{ ok: boolean }>(
      "PATCH",
      `/api/dashboard/user/${encodeURIComponent(userId)}/community-follows/${encodeURIComponent(token)}`,
      settings
    )
  },

  // ── Backtest ──────────────────────────────────────────────────────────────

  /** Avvia un nuovo run di backtest in background. */
  startBacktest(payload: BacktestRunRequest) {
    return call<{ run_id: string; status: string }>("POST", "/api/backtest/run", payload)
  },

  /** Stato + risultati aggregati di un run (polling). */
  getBacktest(runId: string) {
    return call<BacktestRun>("GET", `/api/backtest/${encodeURIComponent(runId)}`)
  },

  /** Trade simulati di un run. */
  getBacktestTrades(runId: string) {
    return call<{ run_id: string; trades: BacktestTrade[]; total: number }>(
      "GET",
      `/api/backtest/${encodeURIComponent(runId)}/trades`
    )
  },

  /** Lista di tutti i run dell'utente. */
  listBacktests(userId: string) {
    return call<{ runs: BacktestRun[]; total: number }>(
      "GET",
      `/api/backtest/list?user_id=${encodeURIComponent(userId)}`
    )
  },

  /** Elimina un run e i suoi trade. */
  deleteBacktest(runId: string, userId: string) {
    return call<{ deleted: string }>(
      "DELETE",
      `/api/backtest/${encodeURIComponent(runId)}?user_id=${encodeURIComponent(userId)}`
    )
  },

  /** Interrompe un backtest in corso. */
  cancelBacktest(runId: string, userId: string) {
    return call<{ cancelled: string }>(
      "POST",
      `/api/backtest/${encodeURIComponent(runId)}/cancel?user_id=${encodeURIComponent(userId)}`
    )
  },
}

// ── AI Logs types ─────────────────────────────────────────────────────────────

export interface AILog {
  id:                number
  user_id:           string | null
  ts:                string
  call_type:         "flash_detect" | "pro_extract" | "strategy_pretrade" | "strategy_event"
  model:             string
  prompt_tokens:     number | null
  completion_tokens: number | null
  total_tokens:      number | null
  cost_usd:          number | null
  latency_ms:        number | null
  error:             string | null
  context:           Record<string, unknown> | null
}

export interface AICallTypeStats {
  call_type:         string
  calls:             number
  prompt_tokens:     number
  completion_tokens: number
  total_tokens:      number
  cost_usd:          number
  avg_latency_ms:    number
  errors:            number
}

export interface AIModelStats {
  model:             string
  calls:             number
  prompt_tokens:     number
  completion_tokens: number
  total_tokens:      number
  cost_usd:          number
  avg_latency_ms:    number
}

export interface AIDaily {
  day:          string
  calls:        number
  total_tokens: number
  cost_usd:     number
}

export interface AIStats {
  total_calls:             number
  total_prompt_tokens:     number
  total_completion_tokens: number
  total_tokens:            number
  total_cost_usd:          number
  avg_latency_ms:          number
  total_errors:            number
  by_call_type:            AICallTypeStats[]
  by_model:                AIModelStats[]
  daily:                   AIDaily[]
}

// ── Trade Stats types ─────────────────────────────────────────────────────────

export interface ReasonStats {
  reason:       string
  count:        number
  total_profit: number
  avg_profit:   number
}

export interface DailyPnl {
  day:    string
  trades: number
  pnl:    number
  wins:   number
  losses: number
}

export interface WeeklyPnl {
  week:   string
  trades: number
  pnl:    number
  wins:   number
  losses: number
}

export interface SymbolTradeStats {
  symbol:       string
  total:        number
  wins:         number
  losses:       number
  win_rate:     number
  avg_profit:   number
  total_profit: number
  best_trade:   number
  worst_trade:  number
  tp_count:     number
  sl_count:     number
}

export interface CumulativePnlPoint {
  index:      number
  ts:         string
  profit:     number
  cumulative: number
}

export interface ClosedTrade {
  ticket:          number
  symbol:          string
  order_type:      string
  lots:            number | null
  entry_price:     number | null
  close_price:     number | null
  sl:              number | null
  tp:              number | null
  profit:          number | null
  reason:          string | null
  open_time:       string | null
  close_time:      string
  signal_group_id: string | null
}

export interface TradeStats {
  total_trades:            number
  wins:                    number
  losses:                  number
  win_rate:                number
  avg_profit:              number
  median_profit:           number
  total_profit:            number
  gross_profit:            number
  gross_loss:              number
  profit_factor:           number | null
  best_trade:              number
  worst_trade:             number
  avg_win:                 number
  avg_loss:                number
  avg_tp_profit:           number
  avg_sl_loss:             number
  max_consecutive_wins:    number
  max_consecutive_losses:  number
  avg_trades_per_day:      number
  active_trading_days:     number
  by_reason:               ReasonStats[]
  daily_pnl:               DailyPnl[]
  weekly_pnl:              WeeklyPnl[]
  by_symbol:               SymbolTradeStats[]
  cumulative_pnl:          CumulativePnlPoint[]
}

// ── Backtest types ─────────────────────────────────────────────────────────────

export interface BacktestRunRequest {
  user_id:               string
  group_id:              string
  group_name?:           string | null
  mode:                  "date_limit" | "message_count"
  limit_value:           string
  use_ai:                boolean
  sizing_strategy?:      string | null
  management_strategy?:  string | null
  starting_balance_usd?: number
}

export interface BacktestSymbolStat {
  symbol:      string
  trades:      number
  wins:        number
  losses:      number
  win_rate:    number
  pnl_pips:    number
  avg_pips:    number
  best_pips:   number
  worst_pips:  number
}

export interface BacktestSenderStat {
  sender_name: string
  messages:    number
  signals:     number
  trades:      number
  wins:        number
  losses:      number
  win_rate:    number
  pnl_pips:    number
}

export interface BacktestEquityPoint {
  ts:    string
  trade: number
  cumul: number
}

export interface BacktestRun {
  id:                      string
  user_id:                 string
  group_id:                string
  group_name:              string | null
  started_at:              string
  completed_at:            string | null
  status:                  string
  error_msg:               string | null

  mode:                    string
  limit_value:             string
  use_ai:                  boolean
  starting_balance_usd:    number

  total_messages:          number | null
  period_from:             string | null
  period_to:               string | null

  flash_calls:             number
  flash_tokens_in:         number
  flash_tokens_out:        number
  flash_cost_usd:          number
  flash_time_seconds:      number
  pro_calls:               number
  pro_tokens_in:           number
  pro_tokens_out:          number
  pro_cost_usd:            number
  pro_time_seconds:        number
  pretrade_calls:          number
  pretrade_tokens_in:      number
  pretrade_tokens_out:     number
  pretrade_cost_usd:       number
  total_ai_cost_usd:       number
  total_ai_seconds:        number

  total_pnl_usd:           number | null
  avg_pnl_usd:             number | null
  best_trade_usd:          number | null
  worst_trade_usd:         number | null
  max_drawdown_usd:        number | null
  final_balance_usd:       number | null

  signals_detected:        number
  signal_detection_rate:   number
  signals_extracted:       number

  total_trades:            number
  trades_filled:           number
  trades_not_filled:       number
  trades_open_at_end:      number
  winning_trades:          number
  losing_trades:           number
  win_rate:                number
  total_pnl_pips:          number
  avg_pnl_pips:            number
  best_trade_pips:         number
  worst_trade_pips:        number
  profit_factor:           number | null
  max_drawdown_pips:       number
  sharpe_ratio:            number | null
  avg_trade_duration_min:  number
  avg_rr_ratio:            number | null

  ai_approved:             number
  ai_rejected:             number
  ai_modified:             number

  symbol_stats_json:       BacktestSymbolStat[] | null
  sender_stats_json:       BacktestSenderStat[] | null
  time_stats_json:         { by_hour: Record<string, { trades: number; wins: number; pnl_pips: number }>; by_weekday: Record<string, { trades: number; wins: number; pnl_pips: number }> } | null
  bars_coverage_json:      Record<string, { timeframe: string; count: number; period_from: string; period_to: string }> | null
  equity_curve_json:       BacktestEquityPoint[] | null
}

export interface BacktestTrade {
  id:               number
  run_id:           string
  msg_id:           number | null
  msg_ts:           string | null
  sender_name:      string | null
  message_text:     string | null
  symbol:           string | null
  order_type:       string | null
  order_mode:       string | null
  entry_price_raw:  string | null
  stop_loss:        number | null
  take_profit:      number | null
  lot_size:         number | null
  actual_entry:     number | null
  actual_entry_ts:  string | null
  exit_price:       number | null
  exit_ts:          string | null
  outcome:          string | null
  pnl_pips:         number | null
  pnl_usd:          number | null
  duration_min:     number | null
  ai_approved:      number | null
  ai_reason:        string | null
  chart_bars_json:  { time: number; open: number; high: number; low: number; close: number }[] | null
}
