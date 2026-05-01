/**
 * Admin API client — all requests include X-Admin-Secret header.
 * The secret is read from NEXT_PUBLIC_ADMIN_SECRET env var.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

// Secret resolution order: runtime (set via setAdminSecret) → env var → ""
let _runtimeSecret = ""

export function setAdminSecret(s: string): void {
  _runtimeSecret = s
}

export function getAdminSecret(): string {
  return _runtimeSecret || process.env.NEXT_PUBLIC_ADMIN_SECRET || ""
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AdminOverview {
  users:    { total: number; active: number }
  signals:  { total: number; signals: number; errors: number }
  trades:   { total: number; wins: number; losses: number; total_pnl: number }
  ai:       { calls: number; total_cost: number; tokens: number }
  strategy: { total: number; errors: number }
  revenue:  { monthly_usd: number; by_plan: { plan: string; cnt: number }[] }
}

export interface AdminUser {
  user_id:       string
  phone:         string
  active:        number
  plan:          string | null
  created_at:    string
  signal_count:  number
  trade_count:   number
  total_pnl:     number | null
  ai_calls:      number
  ai_cost:       number | null
}

export interface AdminUserDetail {
  user: {
    user_id: string; phone: string; active: number; plan: string | null
    created_at: string; mt5_login: number | null; mt5_server: string | null
    drawdown_alert_pct: number | null
  }
  groups: { group_id: number; group_name: string; sizing_strategy: string | null; management_strategy: string | null }[]
  trades: { total: number; wins: number; total_pnl: number; avg_pnl: number }
  ai_by_type: { call_type: string; calls: number; cost: number; tokens: number }[]
  signals: { total: number; signals: number; errors: number }
  recent_trades: { ticket: number; symbol: string; order_type: string; lots: number; profit: number; close_time: string }[]
}

export interface AiStats {
  by_type:  { call_type: string; calls: number; cost: number; tokens: number; avg_latency_ms: number; errors: number }[]
  by_model: { model: string; calls: number; cost: number; tokens: number }[]
  daily:    { day: string; calls: number; cost: number; tokens: number }[]
}

export interface AiLog {
  id: number; user_id: string | null; ts: string; call_type: string; model: string
  prompt_tokens: number | null; completion_tokens: number | null; total_tokens: number | null
  cost_usd: number | null; latency_ms: number | null; error: string | null
  context: Record<string, unknown> | null
}

export interface SignalStats {
  summary: { messages: number; signals: number; errors: number; flash_errors: number; extract_errors: number; mt5_errors: number }
  by_error: { error_step: string; cnt: number }[]
  daily: { day: string; messages: number; signals: number; errors: number }[]
}

export interface SignalLog {
  id: number; user_id: string; ts: string; sender_name: string | null
  message_text: string; is_signal: number; flash_raw: string | null
  has_mt5_creds: number; sizing_strategy: string | null
  signals: unknown[] | null; results: unknown[] | null
  error_step: string | null; error_msg: string | null; group_name: string | null
}

export interface TradeStats {
  summary: { total: number; wins: number; losses: number; total_pnl: number; avg_pnl: number; best_trade: number; worst_trade: number }
  by_symbol: { symbol: string; total: number; pnl: number; wins: number }[]
  daily: { day: string; total: number; pnl: number }[]
  by_user: { user_id: string; phone: string | null; total: number; pnl: number }[]
}

export interface StrategyLog {
  id: number; user_id: string; ts: string; event_type: string
  management_strategy: string | null; final_response: string | null
  error_msg: string | null; tool_calls: unknown[] | null
}

export interface MessageUser {
  user_id:      string
  phone:        string | null
  msg_count:    number
  bot_msg_count: number
  groups:       { group_id: number; group_name: string }[]
}

export interface BotMessage {
  id:           number
  ts:           string
  message_text: string
  message_type: string | null
}

export interface TelegramHistoryMessage {
  id:          number
  date_iso:    string
  sender_name: string
  text:        string
}

export interface Message {
  id:          number
  ts:          string
  sender_name: string | null
  message_text: string
  is_signal:   number
  group_id:    number | null
  group_name:  string | null
  error_step:  string | null
  signals:     unknown[] | null
  results:     unknown[] | null
}

export interface Revenue {
  total_mrr_usd: number
  by_plan: { plan: string | null; users: number; active_users: number; price_usd: number; mrr_usd: number }[]
  recent_subscriptions: { user_id: string; phone: string; plan: string | null; active: number; created_at: string }[]
  monthly_growth: { month: string; new_users: number }[]
}

// ── Client ────────────────────────────────────────────────────────────────────

async function call<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v))
  }
  const res = await fetch(url.toString(), {
    headers: { "x-admin-secret": getAdminSecret() },
    cache: "no-store",
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Admin API ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

export const adminApi = {
  getOverview: () =>
    call<AdminOverview>("/api/admin/overview"),

  getUsers: () =>
    call<AdminUser[]>("/api/admin/users"),

  getUserDetail: (userId: string) =>
    call<AdminUserDetail>(`/api/admin/users/${userId}`),

  getAiStats: (days = 30) =>
    call<AiStats>("/api/admin/ai", { days }),

  getAiLogs: (p: { userId?: string; callType?: string; limit?: number; offset?: number } = {}) =>
    call<{ total: number; logs: AiLog[] }>("/api/admin/ai/logs", {
      user_id: p.userId, call_type: p.callType, limit: p.limit, offset: p.offset,
    }),

  getSignalStats: (days = 30) =>
    call<SignalStats>("/api/admin/signals", { days }),

  getSignalLogs: (p: { userId?: string; isSignal?: boolean; hasError?: boolean; limit?: number; offset?: number } = {}) =>
    call<{ total: number; logs: SignalLog[] }>("/api/admin/signals/logs", {
      user_id: p.userId,
      is_signal: p.isSignal,
      has_error: p.hasError,
      limit: p.limit,
      offset: p.offset,
    }),

  getTradeStats: (days = 30) =>
    call<TradeStats>("/api/admin/trades", { days }),

  getStrategyLogs: (p: { userId?: string; eventType?: string; hasError?: boolean; limit?: number; offset?: number } = {}) =>
    call<{ total: number; logs: StrategyLog[] }>("/api/admin/strategy/logs", {
      user_id: p.userId, event_type: p.eventType, has_error: p.hasError,
      limit: p.limit, offset: p.offset,
    }),

  getRevenue: () =>
    call<Revenue>("/api/admin/revenue"),

  getMessageUsers: () =>
    call<MessageUser[]>("/api/admin/messages/users"),

  getMessages: (p: { userId: string; groupId?: number; search?: string; limit?: number; offset?: number }) =>
    call<{ total: number; messages: Message[] }>("/api/admin/messages", {
      user_id:  p.userId,
      group_id: p.groupId,
      search:   p.search,
      limit:    p.limit,
      offset:   p.offset,
    }),

  getBotMessages: (p: { userId: string; messageType?: string; search?: string; limit?: number; offset?: number }) =>
    call<{ total: number; messages: BotMessage[] }>("/api/admin/messages/bot", {
      user_id:      p.userId,
      message_type: p.messageType,
      search:       p.search,
      limit:        p.limit,
      offset:       p.offset,
    }),

  getTelegramHistory: (p: { userId: string; groupId: number; limit?: number; fromDate?: string; untilDate?: string }) =>
    call<{ total: number; messages: TelegramHistoryMessage[] }>("/api/admin/messages/telegram-history", {
      user_id:    p.userId,
      group_id:   p.groupId,
      limit:      p.limit,
      from_date:  p.fromDate,
      until_date: p.untilDate,
    }),
}
