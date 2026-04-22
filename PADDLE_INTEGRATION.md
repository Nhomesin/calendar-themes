# Paddle Billing Integration — Implementation Instructions

You are implementing Paddle (Merchant of Record) subscription billing into an existing Node.js/Express backend deployed on Railway, with Supabase as the Postgres database. This is a GoHighLevel marketplace app called Widget Skins that sells calendar/widget theming.

Complete all steps below. Do not ask clarifying questions unless something is genuinely ambiguous after reading this entire document — most decisions are already made.

---

## Context

- **Runtime**: Node.js >= 18 (native `fetch` available; do not install `node-fetch`)
- **Framework**: Express 4
- **Database**: Supabase (Postgres), accessed via `@supabase/supabase-js` using the service role key
- **Hosting**: Railway (auto-deploys on push)
- **Existing entry point**: `src/index.js`
- **Module system**: Match whatever the existing codebase uses (CommonJS `require` or ESM `import`). Inspect `src/index.js` and `package.json` (check for `"type": "module"`) before writing new files. If unclear, default to CommonJS.
- **Environment**: Sandbox first; production env vars will be swapped in Railway later without code changes.

The Paddle-related environment variables are already configured in Railway:

```
PADDLE_API_KEY
PADDLE_WEBHOOK_SECRET
PADDLE_ENVIRONMENT            # "sandbox" or "production"
PADDLE_PRICE_SUBACCOUNT_MONTHLY
PADDLE_PRICE_SUBACCOUNT_YEARLY
PADDLE_PRICE_AGENCY_MONTHLY
PADDLE_PRICE_AGENCY_YEARLY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Do not hardcode any of these. Always read from `process.env`.

---

## Step 1 — Install the Paddle SDK

Add the dependency:

```bash
npm install @paddle/paddle-node-sdk
```

Do not install any other Paddle-related packages. Verify the install by checking `package.json` after install completes.

---

## Step 2 — Create the database schema

Create a new file `sql/001_paddle_schema.sql` in the project root containing the SQL below. Then apply it to Supabase.

The user will run the SQL manually in the Supabase SQL Editor — do not attempt to execute it from the Node.js runtime. After creating the file, print a clear message instructing the user to copy/paste it into Supabase SQL Editor and run it. Tell them to confirm three tables exist before continuing: `accounts`, `subscriptions`, `webhook_events`.

```sql
-- One row per GHL install
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  ghl_location_id text unique,
  ghl_company_id text,
  ghl_access_token text not null,
  ghl_refresh_token text not null,
  ghl_token_expires_at timestamptz,
  install_type text not null,             -- 'location' or 'company'
  email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists accounts_ghl_location_idx on accounts(ghl_location_id);
create index if not exists accounts_ghl_company_idx on accounts(ghl_company_id);

-- Paddle subscription state, one per account
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  paddle_customer_id text,
  paddle_subscription_id text unique,
  paddle_price_id text,
  status text not null,                    -- trialing, active, past_due, canceled, paused
  plan_tier text,                          -- 'subaccount' or 'agency'
  billing_cycle text,                      -- 'monthly' or 'yearly'
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists subscriptions_account_idx on subscriptions(account_id);
create index if not exists subscriptions_paddle_sub_idx on subscriptions(paddle_subscription_id);
create index if not exists subscriptions_status_idx on subscriptions(status);

-- Webhook idempotency log
create table if not exists webhook_events (
  id uuid primary key default gen_random_uuid(),
  paddle_event_id text unique not null,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz default now(),
  processing_error text
);

create index if not exists webhook_events_type_idx on webhook_events(event_type);
create index if not exists webhook_events_paddle_event_idx on webhook_events(paddle_event_id);
```

---

## Step 3 — Create the Paddle client module

Create `src/paddle.js` that exports a configured Paddle SDK client:

- Imports `Paddle` and `Environment` from `@paddle/paddle-node-sdk`
- Instantiates with `process.env.PADDLE_API_KEY`
- Selects environment: `Environment.production` if `PADDLE_ENVIRONMENT === 'production'`, otherwise `Environment.sandbox`
- Exports the client as the default/module export

Match the project's existing module system (CommonJS or ESM). Inspect other files before writing.

---

## Step 4 — Create a Supabase client module

If the project does not already have a shared Supabase client, create `src/supabase.js` that:

- Imports `createClient` from `@supabase/supabase-js`
- Instantiates with `process.env.SUPABASE_URL` and `process.env.SUPABASE_SERVICE_ROLE_KEY`
- Exports the client

If the project **already** has a Supabase client module, use that instead — do not create a duplicate. Search the codebase first.

---

## Step 5 — Create the webhook handler

Create `src/routes/paddle-webhook.js`. The handler must:

### Critical requirements (non-negotiable)

1. **Use `express.raw({ type: 'application/json' })` middleware on the webhook route specifically.** Signature verification requires the exact raw bytes of the request body. If a JSON parser has already touched it, verification fails.
2. **Verify the webhook signature using the Paddle SDK's `webhooks.unmarshal(rawBody, secret, signatureHeader)` method.** The signature comes from the `paddle-signature` request header. Reject any request where verification throws.
3. **Idempotency**: Before processing, query `webhook_events` by `paddle_event_id`. If a row exists, return 200 without processing again. Paddle retries webhooks on non-2xx responses, so duplicate events are expected.
4. **Log the event to `webhook_events` BEFORE attempting business logic.** This guarantees we have a record even if processing fails.
5. **Always return 200 once the event is logged**, even if business logic throws. Record the error in `webhook_events.processing_error`. Returning 5xx causes Paddle to retry, which accumulates duplicate processing attempts and fills logs with noise. The log row is proof of receipt.

### Events to handle

Use a `switch` on `event.eventType`:

- `subscription.created`, `subscription.activated`, `subscription.updated`, `subscription.trialing` → call `handleSubscriptionChange(event.data)`
- `subscription.canceled` → call `handleSubscriptionCanceled(event.data)`
- `subscription.past_due` → call `handleSubscriptionPastDue(event.data)`
- `transaction.completed` → call `handleTransactionCompleted(event.data)` (log for now, no DB change required — `subscription.updated` fires right after with new period info)
- `transaction.payment_failed` → call `handlePaymentFailed(event.data)` (log for now)
- `customer.created` → no-op, logged via the `webhook_events` table
- `default` → log `Unhandled Paddle event type: ${eventType}` and still return 200

### Handler behavior

**`handleSubscriptionChange(sub)`**
- Extract `priceId` from `sub.items[0].price.id`
- Map price ID to `{ planTier, billingCycle }` using the four `PADDLE_PRICE_*` env vars (see Step 6 helper)
- Resolve `account_id` using `resolveAccountFromCustomer(sub.customerId, sub.customData)` (see Step 6)
- If no account found, log a warning and return — do not throw. This is expected for webhook test events fired from the Paddle dashboard.
- Upsert a row in `subscriptions` keyed on `paddle_subscription_id` (use `{ onConflict: 'paddle_subscription_id' }` with Supabase). Fields to set:
  - `account_id`, `paddle_customer_id`, `paddle_subscription_id`, `paddle_price_id`
  - `status` from `sub.status`
  - `plan_tier`, `billing_cycle` from the price mapping
  - `current_period_start` from `sub.currentBillingPeriod?.startsAt`
  - `current_period_end` from `sub.currentBillingPeriod?.endsAt`
  - `trial_ends_at`: `sub.currentBillingPeriod?.endsAt` if `status === 'trialing'`, else `null`
  - `updated_at`: current ISO timestamp

**`handleSubscriptionCanceled(sub)`**
- Update the subscription row by `paddle_subscription_id`
- Set `status = 'canceled'`, `canceled_at = now`, `current_period_end = sub.scheduledChange?.effectiveAt ?? sub.currentBillingPeriod?.endsAt`, `updated_at = now`

**`handleSubscriptionPastDue(sub)`**
- Update the subscription row: `status = 'past_due'`, `updated_at = now`

**`handleTransactionCompleted(txn)` and `handlePaymentFailed(txn)`**
- `console.log` the transaction id and customer id. No DB changes in this iteration.

---

## Step 6 — Helpers inside `paddle-webhook.js`

### `mapPriceToPlan(priceId)`

Returns `{ planTier, billingCycle }`. Build a lookup object from the four env vars:

```
PADDLE_PRICE_SUBACCOUNT_MONTHLY → { planTier: 'subaccount', billingCycle: 'monthly' }
PADDLE_PRICE_SUBACCOUNT_YEARLY  → { planTier: 'subaccount', billingCycle: 'yearly'  }
PADDLE_PRICE_AGENCY_MONTHLY     → { planTier: 'agency',     billingCycle: 'monthly' }
PADDLE_PRICE_AGENCY_YEARLY      → { planTier: 'agency',     billingCycle: 'yearly'  }
```

Fallback: `{ planTier: 'unknown', billingCycle: 'unknown' }`.

### `resolveAccountFromCustomer(paddleCustomerId, customData)`

Returns a `uuid` or `null`.

1. If `customData?.account_id` exists, return it. This is the preferred path — checkout sessions (implemented in a future step) will pass `account_id` as custom data.
2. Otherwise, look up an existing `subscriptions` row matching `paddle_customer_id` and return its `account_id`.
3. If neither, return `null`.

---

## Step 7 — Mount the router in `src/index.js`

Modify the existing `src/index.js`:

1. Require/import the Paddle webhook router.
2. **Mount the webhook router BEFORE any global `express.json()` / body-parser middleware.** This is critical. The raw body must reach the webhook route unmodified.
3. After mounting the webhook router, `app.use(express.json())` can run for all other routes.

The correct order:

```
const app = express();

// 1. Paddle webhook router FIRST (uses express.raw internally)
app.use('/', paddleWebhookRouter);

// 2. Then the global JSON parser for everything else
app.use(express.json());

// 3. Then all other routes
```

If `express.json()` is already mounted earlier in the file, move it to come after the webhook mount. Do not duplicate middleware.

The webhook route itself is `POST /webhooks/paddle`.

---

## Step 8 — Verify locally (optional but recommended)

If the user runs `npm run dev`, the server should start without errors. Do a smoke test:

- `GET /` or whatever root route exists should still work
- `POST /webhooks/paddle` with a bogus body should return 401 (signature verification fails — this is correct)

Do not attempt to send real Paddle events locally unless ngrok or a similar tunnel is configured. The user will test via Railway after deploy.

---

## Step 9 — Final output

When all files are created and the router is wired up, print a summary with exactly:

1. List of files created or modified, with full paths
2. A clear instruction to the user:
   > "Now do these three things:
   > 1. Run `sql/001_paddle_schema.sql` in the Supabase SQL Editor and confirm the three tables exist.
   > 2. Commit and push — Railway will auto-deploy.
   > 3. In the Paddle sandbox dashboard, go to Notifications, edit the webhook destination to point at `https://<your-railway-domain>/webhooks/paddle`, then click 'Send test event' with type `subscription.created`. Check Railway logs and the Supabase `webhook_events` table — you should see one row logged."
3. A note that the account-to-subscription linking will appear empty for dashboard test events — that's expected and gets resolved in the next step when checkout sessions are created with `customData.account_id`.

---

## What NOT to do

- Do not install any unrelated packages. No TypeScript, no linters, no testing frameworks unless already present.
- Do not modify `package.json` fields other than adding the one Paddle dependency.
- Do not create frontend code, checkout UI, or GHL OAuth flow code. Those are separate future steps.
- Do not implement email sending, Slack notifications, or any side effects beyond the database writes specified.
- Do not add retry logic, queues, or background jobs. The handler is synchronous and idempotent by design.
- Do not hand-roll signature verification with crypto primitives. Use the SDK's `webhooks.unmarshal` exclusively.
- Do not write tests unless the project already has a test setup.
- Do not remove `sql.js` from `package.json` even though it appears unused — leave existing dependencies alone.

---

## Acceptance criteria

The implementation is complete when:

- `@paddle/paddle-node-sdk` is installed and visible in `package.json`
- `sql/001_paddle_schema.sql` exists with the schema
- `src/paddle.js` exists and exports a configured Paddle client
- `src/supabase.js` exists (or the existing Supabase client is being used)
- `src/routes/paddle-webhook.js` exists with all handlers and helpers specified above
- `src/index.js` mounts the webhook router before `express.json()`
- The server starts without errors when run with existing env vars set
- `POST /webhooks/paddle` returns 401 on requests with missing/invalid signatures
