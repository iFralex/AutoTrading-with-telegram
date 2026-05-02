"""
Billing routes — integrazione Stripe Checkout.

GET  /api/billing/validate-coupon          → valida codice sconto
POST /api/billing/create-checkout-session  → crea sessione Stripe Checkout (setup iniziale)
GET  /api/billing/verify-payment           → verifica che il pagamento sia andato a buon fine
POST /api/billing/customer-portal          → crea sessione Stripe Customer Portal
POST /api/billing/cancel-subscription      → cancella l'abbonamento a fine periodo
GET  /api/billing/subscription             → stato abbonamento corrente
POST /api/billing/webhook                  → webhook Stripe
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from vps.api.deps import get_current_user
from vps.services.setup_session_store import SetupSessionStore
from vps.services.telegram_manager import TelegramManager
from vps.services.user_store import UserStore

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/billing", tags=["billing"])

# ── Configurazione piani ──────────────────────────────────────────────────────

PLAN_PRICES: dict[str, str] = {
    "core":  os.environ.get("STRIPE_PRICE_CORE",  ""),
    "pro":   os.environ.get("STRIPE_PRICE_PRO",   ""),
    "elite": os.environ.get("STRIPE_PRICE_ELITE", ""),
}

PLAN_LABELS: dict[str, str] = {
    "core":  "Core",
    "pro":   "Pro",
    "elite": "Elite",
}

# ── Codici sconto hardcoded ───────────────────────────────────────────────────
# percent_off=100 → salta Stripe completamente
# percent_off=50  → applica coupon Stripe al 50%

_COUPONS: dict[str, dict] = {
    "free":        {"percent_off": 100, "label": "Accesso gratuito"},
    "beta_tester": {"percent_off": 50,  "label": "Beta Tester — 50% di sconto"},
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _stripe_client() -> stripe.StripeClient:
    key = os.environ.get("STRIPE_SECRET_KEY", "")
    if not key:
        raise HTTPException(503, "STRIPE_SECRET_KEY non configurata")
    return stripe.StripeClient(key)


def _base_url() -> str:
    return os.environ.get("NEXT_PUBLIC_BASE_URL", "http://localhost:3000").rstrip("/")


def _get_session_store(request: Request) -> SetupSessionStore:
    return request.app.state.setup_session_store


def _get_store(request: Request) -> UserStore:
    return request.app.state.user_store

def _get_tm(request: Request) -> TelegramManager:
    return request.app.state.telegram_manager


# ── GET /validate-coupon ──────────────────────────────────────────────────────

@router.get("/validate-coupon")
async def validate_coupon(code: str) -> dict:
    """Valida un codice sconto e restituisce il tipo di sconto."""
    info = _COUPONS.get(code.strip().lower())
    if not info:
        return {"valid": False}
    return {
        "valid": True,
        "percent_off": info["percent_off"],
        "label": info["label"],
    }


# ── POST /create-checkout-session ────────────────────────────────────────────

class CreateCheckoutBody(BaseModel):
    phone: str
    plan: str          # "core" | "pro" | "elite"
    coupon_code: str | None = None


@router.post("/create-checkout-session")
async def create_checkout_session(
    body: CreateCheckoutBody,
    request: Request,
) -> dict:
    if body.plan not in PLAN_PRICES:
        raise HTTPException(400, f"Piano non valido: {body.plan}")

    ss: SetupSessionStore = _get_session_store(request)

    # ── Valida codice sconto (se presente) ────────────────────────────────────
    coupon_info: dict | None = None
    if body.coupon_code:
        coupon_info = _COUPONS.get(body.coupon_code.strip().lower())
        if not coupon_info:
            raise HTTPException(400, "Codice sconto non valido")

    # ── 100% di sconto → salta Stripe ─────────────────────────────────────────
    if coupon_info and coupon_info["percent_off"] == 100:
        await ss.upsert(body.phone, {
            "plan": body.plan,
            "stripe_session_id": f"FREE_{body.coupon_code.strip().lower()}",
        })
        return {"skip_payment": True, "plan": body.plan}

    # ── Pagamento via Stripe ──────────────────────────────────────────────────
    price_id = PLAN_PRICES[body.plan]
    if not price_id:
        raise HTTPException(503, f"STRIPE_PRICE_{body.plan.upper()} non configurata")

    client = _stripe_client()
    base = _base_url()

    session_params: dict = {
        "mode": "subscription",
        "line_items": [{"price": price_id, "quantity": 1}],
        "success_url": (
            f"{base}/setup"
            f"?payment_success=1"
            f"&phone={body.phone}"
            f"&stripe_session_id={{CHECKOUT_SESSION_ID}}"
        ),
        "cancel_url": f"{base}/setup?payment_cancelled=1&phone={body.phone}",
        "metadata": {"phone": body.phone, "plan": body.plan},
    }

    # ── 50% di sconto → crea coupon Stripe one-time ───────────────────────────
    if coupon_info:
        try:
            coupon = client.coupons.create(params={
                "percent_off": coupon_info["percent_off"],
                "duration": "once",
                "name": coupon_info["label"],
            })
            session_params["discounts"] = [{"coupon": coupon.id}]
        except stripe.StripeError as exc:
            logger.error("Stripe coupon creation: %s", exc)
            raise HTTPException(502, f"Errore Stripe: {getattr(exc, 'user_message', None) or str(exc)}")

    try:
        session = client.checkout.sessions.create(params=session_params)
    except stripe.StripeError as exc:
        logger.error("Stripe create_checkout_session: %s", exc)
        raise HTTPException(502, f"Errore Stripe: {getattr(exc, 'user_message', None) or str(exc)}")

    await ss.upsert(body.phone, {"plan": body.plan, "stripe_session_id": session.id})

    return {"checkout_url": session.url, "skip_payment": False}


# ── GET /verify-payment ───────────────────────────────────────────────────────

@router.get("/verify-payment")
async def verify_payment(
    stripe_session_id: str,
    phone: str,
    request: Request,
) -> dict:
    # Sessione FREE (codice 100%) — pagamento già verificato lato backend
    if stripe_session_id.startswith("FREE_"):
        ss: SetupSessionStore = _get_session_store(request)
        sess = await ss.get(phone)
        plan = (sess or {}).get("plan")
        return {"paid": True, "plan": plan, "stripe_session_id": stripe_session_id}

    client = _stripe_client()
    try:
        session = client.checkout.sessions.retrieve(stripe_session_id)
    except stripe.StripeError as exc:
        logger.error("Stripe retrieve session: %s", exc)
        raise HTTPException(502, f"Errore Stripe: {getattr(exc, 'user_message', None) or str(exc)}")

    paid = session.payment_status == "paid" and session.status == "complete"

    if paid:
        plan = session.metadata.get("plan") if session.metadata else None
        if not plan:
            ss = _get_session_store(request)
            sess = await ss.get(phone)
            plan = (sess or {}).get("plan")
        return {"paid": True, "plan": plan, "stripe_session_id": stripe_session_id}

    return {"paid": False}


# ── GET /subscription ─────────────────────────────────────────────────────────

@router.get("/subscription")
async def get_subscription(
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
) -> dict:
    plan = current_user.get("plan")
    sub_id = current_user.get("stripe_subscription_id")
    customer_id = current_user.get("stripe_customer_id")

    result: dict = {
        "plan": plan,
        "stripe_subscription_id": sub_id,
        "stripe_customer_id": customer_id,
        "cancel_at_period_end": False,
        "current_period_end": None,
        "status": None,
    }

    if sub_id and not sub_id.startswith("FREE_"):
        try:
            client = _stripe_client()
            sub = client.subscriptions.retrieve(sub_id)
            result["cancel_at_period_end"] = sub.cancel_at_period_end
            result["current_period_end"] = sub.current_period_end
            result["status"] = sub.status
        except Exception as exc:
            logger.warning("Stripe subscription retrieve failed: %s", exc)

    return result


# ── POST /customer-portal ─────────────────────────────────────────────────────

@router.post("/customer-portal")
async def customer_portal(
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
) -> dict:
    customer_id = current_user.get("stripe_customer_id")
    if not customer_id:
        raise HTTPException(400, "Nessun cliente Stripe associato a questo account. Contatta il supporto.")

    client = _stripe_client()
    base = _base_url()

    try:
        portal = client.billing_portal.sessions.create(params={
            "customer": customer_id,
            "return_url": f"{base}/dashboard",
        })
    except stripe.StripeError as exc:
        logger.error("Stripe customer portal: %s", exc)
        raise HTTPException(502, f"Errore Stripe: {getattr(exc, 'user_message', None) or str(exc)}")

    return {"portal_url": portal.url}


# ── POST /cancel-subscription ─────────────────────────────────────────────────

@router.post("/cancel-subscription")
async def cancel_subscription(
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
) -> dict:
    sub_id = current_user.get("stripe_subscription_id")
    if not sub_id or sub_id.startswith("FREE_"):
        raise HTTPException(400, "Nessun abbonamento Stripe attivo trovato.")

    client = _stripe_client()
    try:
        sub = client.subscriptions.update(sub_id, params={"cancel_at_period_end": True})
    except stripe.StripeError as exc:
        logger.error("Stripe cancel subscription: %s", exc)
        raise HTTPException(502, f"Errore Stripe: {getattr(exc, 'user_message', None) or str(exc)}")

    return {
        "status": "cancellation_scheduled",
        "current_period_end": sub.current_period_end,
    }


# ── POST /webhook ─────────────────────────────────────────────────────────────

@router.post("/webhook")
async def stripe_webhook(request: Request) -> dict:
    webhook_secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")

    try:
        if webhook_secret:
            event = stripe.Webhook.construct_event(payload, sig, webhook_secret)
        else:
            import json
            event = stripe.Event.construct_from(json.loads(payload), stripe.api_key)
    except Exception as exc:
        logger.warning("Stripe webhook error: %s", exc)
        raise HTTPException(400, str(exc))

    store: UserStore = _get_store(request)
    event_type = event["type"]

    if event_type == "checkout.session.completed":
        sess = event["data"]["object"]
        phone = (sess.get("metadata") or {}).get("phone")
        plan  = (sess.get("metadata") or {}).get("plan")
        customer_id     = sess.get("customer")
        subscription_id = sess.get("subscription")

        if phone and plan:
            user = await store.get_user_by_phone(phone)
            if user:
                await store.update_billing_info(
                    user["user_id"],
                    plan=plan,
                    stripe_customer_id=customer_id or None,
                    stripe_subscription_id=subscription_id or None,
                )
                logger.info(
                    "checkout.session.completed: user %s plan=%s customer=%s sub=%s",
                    user["user_id"], plan, customer_id, subscription_id,
                )

    elif event_type == "customer.subscription.updated":
        sub = event["data"]["object"]
        customer_id = sub.get("customer")
        new_plan = None
        items = (sub.get("items") or {}).get("data") or []
        if items:
            price_id = items[0].get("price", {}).get("id", "")
            for plan_name, pid in PLAN_PRICES.items():
                if pid and pid == price_id:
                    new_plan = plan_name
                    break
        if customer_id and new_plan:
            user = await store.get_user_by_stripe_customer(customer_id)
            if user:
                await store.update_billing_info(
                    user["user_id"],
                    plan=new_plan,
                    stripe_subscription_id=sub.get("id"),
                )
                logger.info(
                    "subscription.updated: user %s new_plan=%s", user["user_id"], new_plan
                )

    elif event_type == "customer.subscription.deleted":
        sub = event["data"]["object"]
        customer_id = sub.get("customer")
        if customer_id:
            user = await store.get_user_by_stripe_customer(customer_id)
            if user:
                user_id  = user["user_id"]
                now_iso  = datetime.now(timezone.utc).isoformat()
                tm       = _get_tm(request)

                # 1. Notify the user while the session is still open
                _pause_msg = (
                    "⛔ Your subscription has ended.\n\n"
                    "Your bot has been paused. Resubscribe within 30 days to reactivate it — "
                    "after that your account and all data will be permanently deleted."
                )
                try:
                    await tm.send_to_user(user_id, _pause_msg)
                except Exception as _exc:
                    logger.warning("subscription.deleted notify %s: %s", user_id, _exc)

                # 2. Stop the Telegram listener
                try:
                    tm.remove_user(user_id)
                except Exception as _exc:
                    logger.warning("subscription.deleted remove_user %s: %s", user_id, _exc)

                # 3. Mark as inactive and record end timestamp
                await store.set_active(user_id, False)
                await store.set_subscription_ended(user_id, now_iso)
                await store.update_billing_info(user_id, stripe_subscription_id=None)
                logger.info("subscription.deleted: user %s paused, ended_at=%s", user_id, now_iso)

    return {"received": True}
