const express = require('express');
const crypto = require('crypto');
const paddle = require('../paddle');
const { supabase } = require('../db');

// Diagnostic: the SDK's unmarshal() returns a generic error for both wrong
// secret and stale timestamp (>5s). When verification fails, log which one
// it actually was so misconfigured deploys are obvious in Railway logs.
function diagnoseSignatureFailure(rawBody, signatureHeader, secret) {
  try {
    if (!signatureHeader) return 'no paddle-signature header';
    const parts = {};
    for (const p of signatureHeader.split(';')) {
      const [k, v] = p.split('=');
      if (k && v) parts[k] = v;
    }
    if (!parts.ts || !parts.h1) return `malformed header (${signatureHeader.slice(0, 40)}...)`;

    const ts = parseInt(parts.ts, 10);
    const ageSeconds = Math.floor(Date.now() / 1000) - ts;
    const expected = crypto.createHmac('sha256', secret || '').update(`${ts}:${rawBody}`).digest('hex');
    const hmacMatches = expected === parts.h1;

    const secretInfo = secret ? `set (len=${secret.length}, prefix=${secret.slice(0, 10)})` : 'MISSING';
    return (
      `secret=${secretInfo} bodyLen=${rawBody.length} ts=${ts} ageSeconds=${ageSeconds} ` +
      `hmacMatches=${hmacMatches}` +
      (hmacMatches ? ' — SDK rejected due to >5s clock skew' : ' — secret/body mismatch')
    );
  } catch (err) {
    return `diagnose error: ${err.message}`;
  }
}

const router = express.Router();

// ── Price-ID → plan lookup ───────────────────────────────────────────────────
// Built once at module load from env vars. A missing/undefined env var just
// means that tier/cycle isn't set up yet — we still want the lookup to work
// for whichever are defined. Anything that isn't recognized falls back to
// 'unknown' so we log a row rather than swallowing.
const PRICE_LOOKUP = Object.freeze({
  [process.env.PADDLE_PRICE_SUBACCOUNT_MONTHLY]: { planTier: 'subaccount', billingCycle: 'monthly' },
  [process.env.PADDLE_PRICE_SUBACCOUNT_YEARLY]:  { planTier: 'subaccount', billingCycle: 'yearly'  },
  [process.env.PADDLE_PRICE_AGENCY_MONTHLY]:     { planTier: 'agency',     billingCycle: 'monthly' },
  [process.env.PADDLE_PRICE_AGENCY_YEARLY]:      { planTier: 'agency',     billingCycle: 'yearly'  },
});

function mapPriceToPlan(priceId) {
  if (priceId && PRICE_LOOKUP[priceId]) return PRICE_LOOKUP[priceId];
  return { planTier: 'unknown', billingCycle: 'unknown' };
}

// ── Resolve GHL install scope from Paddle customer/customData ────────────────
// customData is the preferred path — checkout sessions will embed
// { location_id } or { company_id }. Fallback: look up an existing
// subscription row keyed on paddle_customer_id (handles subsequent
// events for a subscription we've already seen).
async function resolveScope(paddleCustomerId, customData) {
  if (customData && typeof customData === 'object') {
    if (customData.location_id) {
      return { locationId: String(customData.location_id), companyId: null };
    }
    if (customData.company_id) {
      return { locationId: null, companyId: String(customData.company_id) };
    }
  }

  if (paddleCustomerId) {
    const { data } = await supabase
      .from('subscriptions')
      .select('location_id, company_id')
      .eq('paddle_customer_id', paddleCustomerId)
      .limit(1)
      .maybeSingle();
    if (data && (data.location_id || data.company_id)) {
      return { locationId: data.location_id, companyId: data.company_id };
    }
  }

  return { locationId: null, companyId: null };
}

// ── Event handlers ───────────────────────────────────────────────────────────

async function handleSubscriptionChange(sub) {
  const priceId = sub.items?.[0]?.price?.id || null;
  const { planTier, billingCycle } = mapPriceToPlan(priceId);
  const { locationId, companyId } = await resolveScope(sub.customerId, sub.customData);

  if (!locationId && !companyId) {
    console.warn(`[Paddle] No scope match for customer ${sub.customerId} (sub ${sub.id}) — skipping upsert. Expected for dashboard test events.`);
    return;
  }

  const now = new Date().toISOString();
  const periodStart = sub.currentBillingPeriod?.startsAt || null;
  const periodEnd = sub.currentBillingPeriod?.endsAt || null;
  const trialEndsAt = sub.status === 'trialing' ? periodEnd : null;

  const { error } = await supabase
    .from('subscriptions')
    .upsert(
      {
        location_id: locationId,
        company_id: companyId,
        paddle_customer_id: sub.customerId,
        paddle_subscription_id: sub.id,
        paddle_price_id: priceId,
        status: sub.status,
        plan_tier: planTier,
        billing_cycle: billingCycle,
        current_period_start: periodStart,
        current_period_end: periodEnd,
        trial_ends_at: trialEndsAt,
        updated_at: now,
      },
      { onConflict: 'paddle_subscription_id' },
    );
  if (error) throw new Error(`subscriptions upsert: ${error.message}`);

  // Mirror plan_tier onto the owning install row — that's the column routes
  // will gate on. Only promote active/trialing states; past_due stays on
  // whatever tier was there so the grace-period UX doesn't churn.
  if (sub.status === 'active' || sub.status === 'trialing') {
    if (locationId) {
      const { error: locErr } = await supabase
        .from('locations')
        .update({ plan_tier: planTier })
        .eq('location_id', locationId);
      if (locErr) throw new Error(`locations plan_tier: ${locErr.message}`);
    } else if (companyId) {
      const { error: coErr } = await supabase
        .from('companies')
        .update({ plan_tier: planTier })
        .eq('company_id', companyId);
      if (coErr) throw new Error(`companies plan_tier: ${coErr.message}`);
    }
  }

  console.log(`[Paddle] Subscription ${sub.status}: ${sub.id} → ${planTier}/${billingCycle} (location=${locationId || '-'} company=${companyId || '-'})`);
}

async function handleSubscriptionCanceled(sub) {
  const now = new Date().toISOString();
  const endsAt = sub.scheduledChange?.effectiveAt || sub.currentBillingPeriod?.endsAt || now;

  const { data: row, error: selErr } = await supabase
    .from('subscriptions')
    .select('location_id, company_id')
    .eq('paddle_subscription_id', sub.id)
    .maybeSingle();
  if (selErr) throw new Error(`subscriptions select: ${selErr.message}`);

  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: 'canceled',
      canceled_at: now,
      current_period_end: endsAt,
      updated_at: now,
    })
    .eq('paddle_subscription_id', sub.id);
  if (error) throw new Error(`subscriptions cancel: ${error.message}`);

  if (row?.location_id) {
    await supabase.from('locations').update({ plan_tier: 'free' }).eq('location_id', row.location_id);
  } else if (row?.company_id) {
    await supabase.from('companies').update({ plan_tier: 'free' }).eq('company_id', row.company_id);
  }

  console.log(`[Paddle] Subscription canceled: ${sub.id}`);
}

async function handleSubscriptionPastDue(sub) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('subscriptions')
    .update({ status: 'past_due', updated_at: now })
    .eq('paddle_subscription_id', sub.id);
  if (error) throw new Error(`subscriptions past_due: ${error.message}`);
  console.log(`[Paddle] Subscription past_due: ${sub.id}`);
}

function handleTransactionCompleted(txn) {
  console.log(`[Paddle] Transaction completed: ${txn.id} customer=${txn.customerId}`);
}

function handlePaymentFailed(txn) {
  console.log(`[Paddle] Payment failed: ${txn.id} customer=${txn.customerId}`);
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

async function dispatch(event) {
  switch (event.eventType) {
    case 'subscription.created':
    case 'subscription.activated':
    case 'subscription.updated':
    case 'subscription.trialing':
      return handleSubscriptionChange(event.data);
    case 'subscription.canceled':
      return handleSubscriptionCanceled(event.data);
    case 'subscription.past_due':
      return handleSubscriptionPastDue(event.data);
    case 'transaction.completed':
      return handleTransactionCompleted(event.data);
    case 'transaction.payment_failed':
      return handlePaymentFailed(event.data);
    case 'customer.created':
      return;
    default:
      console.log(`[Paddle] Unhandled event type: ${event.eventType}`);
  }
}

// ── Route ────────────────────────────────────────────────────────────────────
// express.raw is scoped to THIS route only — mount it before the global
// express.json() in src/index.js so the raw bytes reach the SDK for HMAC
// verification.
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.header('paddle-signature');
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';

  if (!signature || !secret || !rawBody) {
    console.warn('[Paddle] Webhook rejected — missing signature, secret, or body');
    return res.sendStatus(401);
  }

  let event;
  try {
    event = await paddle.webhooks.unmarshal(rawBody, secret, signature);
  } catch (err) {
    const diag = diagnoseSignatureFailure(rawBody, signature, secret);
    console.warn(`[Paddle] Signature verification failed: ${err.message} [${diag}]`);
    return res.sendStatus(401);
  }

  console.log(`[Paddle] Event received: ${event.eventType} id=${event.eventId}`);

  // Idempotency: check before logging. If we've seen this event_id, ack.
  const { data: existing } = await supabase
    .from('webhook_events')
    .select('id')
    .eq('paddle_event_id', event.eventId)
    .maybeSingle();
  if (existing) {
    console.log(`[Paddle] Duplicate event ${event.eventId} — already processed`);
    return res.sendStatus(200);
  }

  // Log the raw payload BEFORE dispatch so we have a record even if handling
  // throws. parsedPayload is the ground-truth JSON; event.data is the SDK's
  // camelCase wrapper which we don't want to persist.
  let parsedPayload;
  try {
    parsedPayload = JSON.parse(rawBody);
  } catch {
    parsedPayload = {};
  }

  const { data: logged, error: logErr } = await supabase
    .from('webhook_events')
    .insert({
      paddle_event_id: event.eventId,
      event_type: event.eventType,
      payload: parsedPayload,
    })
    .select('id')
    .single();

  if (logErr) {
    // Unique-violation → race with a concurrent delivery of the same event.
    // Treat as duplicate and ack. Any other log-insert error is real: still
    // ack (we don't want Paddle retry storms) but log loudly.
    if (logErr.code === '23505') {
      console.log(`[Paddle] Race on event ${event.eventId} — already logged`);
      return res.sendStatus(200);
    }
    console.error(`[Paddle] webhook_events insert failed: ${logErr.message}`);
    return res.sendStatus(200);
  }

  try {
    await dispatch(event);
  } catch (err) {
    console.error(`[Paddle] Handler error for ${event.eventType} (${event.eventId}):`, err.message);
    await supabase
      .from('webhook_events')
      .update({ processing_error: String(err.message || err).slice(0, 2000) })
      .eq('id', logged.id);
  }

  return res.sendStatus(200);
});

module.exports = router;
