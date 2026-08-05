# Twilio SMS Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Twilio as a second, server-switchable SMS provider for member messaging, alongside the existing AWS End User Messaging path, so a Twilio trial account can gauge feature interest while AWS approval is stuck.

**Architecture:** Extract the current inline AWS EUM send logic out of `netlify/functions/member-messaging.js` into `netlify/functions/lib/sms-providers/aws-eum.js`, add a parallel `netlify/functions/lib/sms-providers/twilio.js`, and have `member-messaging.js` dispatch to whichever module `resolveSmsProvider()` (new, in `lib/message-config.js`) selects based on `process.env.SMS_PROVIDER` (default `"aws"`). Both provider modules expose the same `sendSms({ recipients, message, context }) -> { sentCount, failedCount, firstError }` shape and throw on missing configuration.

**Tech Stack:** Netlify Functions (Node ESM), `@aws-sdk/client-pinpoint-sms-voice-v2` (existing), `twilio` npm package (new).

## Global Constraints

- Provider selection is server-side only (`SMS_PROVIDER` env var, default `"aws"`) — no frontend/UI changes.
- New Twilio env vars use plain names: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (no `EUM_`-style prefix — that workaround is AWS/Lambda-reserved-namespace-specific and doesn't apply to Twilio).
- Both provider modules return `{ sentCount, failedCount, firstError }` and throw `Error` for missing/invalid configuration — no other return/throw shape.
- No automated test framework exists in this repo for Netlify functions (`test.mjs` is an ad-hoc diagnostic endpoint, not a suite) — do not introduce one for this feature. Verification is via disposable Node scripts run through Bash (never committed) plus a manual `netlify dev` smoke check.
- Do not perform a real Twilio or AWS send from an automated step — both cost money and hit real phones. Any live send is an explicit manual step for the user.
- Remove dead code encountered in `member-messaging.js` while restructuring: the unused `SESv2Client`/`SendEmailCommand` import and the unused `chunk()` helper. Do not touch anything else not called for by this plan (e.g. leave the "Use 'email' or 'sms'" error string as-is — out of scope).

---

### Task 1: Dependency and bundling updates

**Files:**
- Modify: `package.json`
- Modify: `netlify.toml:7`

**Interfaces:**
- Produces: `twilio` package available for import as `import twilio from "twilio"` in later tasks.

- [ ] **Step 1: Add the `twilio` dependency and remove the dead `@aws-sdk/client-sesv2` one**

```bash
cd /Users/barryforrest/Projects/Horsemen/astro/astroplate
yarn add twilio
yarn remove @aws-sdk/client-sesv2
```

- [ ] **Step 2: Confirm `package.json` changed as expected**

Run: `grep -n '"twilio"\|client-sesv2' package.json`
Expected: a `"twilio": "^..."` line present, no `@aws-sdk/client-sesv2` line.

- [ ] **Step 3: Update `netlify.toml`'s bundler allowlist**

In `netlify.toml`, line 7 currently reads:

```toml
external_node_modules = ["@paypal/paypal-server-sdk", "@aws-sdk/client-sesv2", "@aws-sdk/client-pinpoint-sms-voice-v2", "@aws-sdk/client-cloudwatch-logs"]
```

Change to:

```toml
external_node_modules = ["@paypal/paypal-server-sdk", "twilio", "@aws-sdk/client-pinpoint-sms-voice-v2", "@aws-sdk/client-cloudwatch-logs"]
```

- [ ] **Step 4: Verify no other file references the removed dependency**

Run: `grep -rn "client-sesv2\|SESv2Client" --include="*.js" --include="*.mjs" --include="*.toml" .`
Expected: no matches (confirms it was safe to remove).

- [ ] **Step 5: Commit**

```bash
git add package.json yarn.lock netlify.toml
git commit -m "Add twilio dependency, drop unused @aws-sdk/client-sesv2"
```

---

### Task 2: `resolveSmsProvider()` in message-config.js

**Files:**
- Modify: `netlify/functions/lib/message-config.js`

**Interfaces:**
- Produces: `resolveSmsProvider(): "aws" | "twilio"` — reads `process.env.SMS_PROVIDER`, returns `"twilio"` only on exact match, `"aws"` otherwise (covers unset/typo'd/anything else).

- [ ] **Step 1: Write a disposable verification script (expected to fail — function doesn't exist yet)**

Create `/private/tmp/claude-501/-Users-barryforrest-Projects-Horsemen-astro-astroplate/4c75e6bb-b012-44e1-a85c-6cec00abc90d/scratchpad/verify-provider-resolver.mjs`:

```js
const { resolveSmsProvider } = await import(
  "/Users/barryforrest/Projects/Horsemen/astro/astroplate/netlify/functions/lib/message-config.js"
);

delete process.env.SMS_PROVIDER;
assertEqual(resolveSmsProvider(), "aws", "default with unset env var");

process.env.SMS_PROVIDER = "twilio";
assertEqual(resolveSmsProvider(), "twilio", "explicit twilio");

process.env.SMS_PROVIDER = "something-else";
assertEqual(resolveSmsProvider(), "aws", "unrecognized value falls back to aws");

console.log("PASS");

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    console.error(`FAIL (${label}): expected ${expected}, got ${actual}`);
    process.exit(1);
  }
}
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `node /private/tmp/claude-501/-Users-barryforrest-Projects-Horsemen-astro-astroplate/4c75e6bb-b012-44e1-a85c-6cec00abc90d/scratchpad/verify-provider-resolver.mjs`
Expected: throws because `resolveSmsProvider` is not exported yet (`undefined is not a function` or similar).

- [ ] **Step 3: Implement `resolveSmsProvider()`**

In `netlify/functions/lib/message-config.js`, append after `resolveAwsRegion()`:

```js

// SMS_PROVIDER picks which provider module member-messaging.js dispatches
// to. Defaults to "aws" so existing deployments are unaffected until this
// is set explicitly (e.g. once a Twilio trial account is approved).
export function resolveSmsProvider() {
  return process.env.SMS_PROVIDER === "twilio" ? "twilio" : "aws";
}
```

- [ ] **Step 4: Run the verification script again, confirm it passes**

Run: `node /private/tmp/claude-501/-Users-barryforrest-Projects-Horsemen-astro-astroplate/4c75e6bb-b012-44e1-a85c-6cec00abc90d/scratchpad/verify-provider-resolver.mjs`
Expected: prints `PASS`, exit code 0.

- [ ] **Step 5: Delete the disposable script and commit the real change**

```bash
rm /private/tmp/claude-501/-Users-barryforrest-Projects-Horsemen-astro-astroplate/4c75e6bb-b012-44e1-a85c-6cec00abc90d/scratchpad/verify-provider-resolver.mjs
cd /Users/barryforrest/Projects/Horsemen/astro/astroplate
git add netlify/functions/lib/message-config.js
git commit -m "Add resolveSmsProvider() for AWS/Twilio channel switch"
```

---

### Task 3: Extract AWS EUM provider module

**Files:**
- Create: `netlify/functions/lib/sms-providers/aws-eum.js`
- Test (disposable, not committed): scratchpad script

**Interfaces:**
- Consumes: `CONFIGURATION_SET_NAME`, `resolveAwsCredentials()`, `resolveAwsRegion()` from `../message-config.js` (existing, unchanged).
- Produces: `sendSms({ recipients: string[], message: string, context: object }): Promise<{ sentCount: number, failedCount: number, firstError: unknown }>` — throws `Error("AWS_REGION is not configured")` or `Error("RCS_ORIGINATION_IDENTITY is not configured")` if those are missing.

This is a behavior-preserving extraction of logic that already exists (and works) inline in `member-messaging.js`. The "test" here locks down its externally-visible contract (the two config-error messages) before the file exists, since those are the two paths safely exercisable without live AWS credentials.

- [ ] **Step 1: Write a disposable verification script (expected to fail — module doesn't exist yet)**

Create `/private/tmp/claude-501/-Users-barryforrest-Projects-Horsemen-astro-astroplate/4c75e6bb-b012-44e1-a85c-6cec00abc90d/scratchpad/verify-aws-eum.mjs`:

```js
delete process.env.EUM_AWS_REGION;
delete process.env.AWS_REGION;
delete process.env.AWS_DEFAULT_REGION;
delete process.env.RCS_ORIGINATION_IDENTITY;

const { sendSms } = await import(
  "/Users/barryforrest/Projects/Horsemen/astro/astroplate/netlify/functions/lib/sms-providers/aws-eum.js"
);

await assertThrows(
  () => sendSms({ recipients: ["+15555550100"], message: "hi", context: {} }),
  "AWS_REGION is not configured",
  "missing region",
);

process.env.EUM_AWS_REGION = "us-east-1";

await assertThrows(
  () => sendSms({ recipients: ["+15555550100"], message: "hi", context: {} }),
  "RCS_ORIGINATION_IDENTITY is not configured",
  "missing origination identity",
);

console.log("PASS");

async function assertThrows(fn, expectedMessage, label) {
  try {
    await fn();
  } catch (err) {
    if (err.message !== expectedMessage) {
      console.error(`FAIL (${label}): expected "${expectedMessage}", got "${err.message}"`);
      process.exit(1);
    }
    return;
  }
  console.error(`FAIL (${label}): expected throw, none occurred`);
  process.exit(1);
}
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `node /private/tmp/claude-501/-Users-barryforrest-Projects-Horsemen-astro-astroplate/4c75e6bb-b012-44e1-a85c-6cec00abc90d/scratchpad/verify-aws-eum.mjs`
Expected: fails with a module-not-found error (the file doesn't exist yet).

- [ ] **Step 3: Create `netlify/functions/lib/sms-providers/aws-eum.js`**

```js
import { PinpointSMSVoiceV2Client, SendTextMessageCommand } from "@aws-sdk/client-pinpoint-sms-voice-v2";
import {
  CONFIGURATION_SET_NAME,
  resolveAwsCredentials,
  resolveAwsRegion,
} from "../message-config.js";

export async function sendSms({ recipients, message, context }) {
  const region = resolveAwsRegion();
  if (!region) {
    throw new Error("AWS_REGION is not configured");
  }

  const originationIdentity = process.env.RCS_ORIGINATION_IDENTITY;
  if (!originationIdentity) {
    throw new Error("RCS_ORIGINATION_IDENTITY is not configured");
  }

  const credentials = resolveAwsCredentials();
  const smsClient = new PinpointSMSVoiceV2Client({
    region,
    ...(credentials && { credentials }),
  });

  const outcomes = await Promise.allSettled(
    recipients.map((phoneNumber) =>
      smsClient.send(
        new SendTextMessageCommand({
          DestinationPhoneNumber: phoneNumber,
          OriginationIdentity: originationIdentity,
          MessageBody: message,
          ConfigurationSetName: CONFIGURATION_SET_NAME,
          Context: context,
        }),
      ),
    ),
  );

  const failedCount = outcomes.filter((outcome) => outcome.status === "rejected").length;
  const sentCount = recipients.length - failedCount;
  const firstError = outcomes.find((outcome) => outcome.status === "rejected")?.reason;

  return { sentCount, failedCount, firstError };
}
```

- [ ] **Step 4: Run the verification script again, confirm it passes**

Run: `node /private/tmp/claude-501/-Users-barryforrest-Projects-Horsemen-astro-astroplate/4c75e6bb-b012-44e1-a85c-6cec00abc90d/scratchpad/verify-aws-eum.mjs`
Expected: prints `PASS`, exit code 0.

- [ ] **Step 5: Delete the disposable script and commit**

```bash
rm /private/tmp/claude-501/-Users-barryforrest-Projects-Horsemen-astro-astroplate/4c75e6bb-b012-44e1-a85c-6cec00abc90d/scratchpad/verify-aws-eum.mjs
cd /Users/barryforrest/Projects/Horsemen/astro/astroplate
git add netlify/functions/lib/sms-providers/aws-eum.js
git commit -m "Extract AWS EUM send logic into lib/sms-providers/aws-eum.js"
```

---

### Task 4: Twilio provider module

**Files:**
- Create: `netlify/functions/lib/sms-providers/twilio.js`
- Test (disposable, not committed): scratchpad script

**Interfaces:**
- Consumes: `twilio` package default export (`twilio(accountSid, authToken)` client factory), `process.env.TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER`.
- Produces: `sendSms({ recipients: string[], message: string, context: object }): Promise<{ sentCount: number, failedCount: number, firstError: unknown }>` — throws `Error("Twilio is not configured")` if any of the three env vars are missing. (`context` is accepted for interface parity with `aws-eum.js` but intentionally unused — see plan's Global Constraints / the design doc's noted logging gap.)

Only the missing-configuration path is verifiable without a live Twilio account — that's exactly the path this task tests. A real send is exercised manually in Task 6 once Twilio approval clears.

- [ ] **Step 1: Write a disposable verification script (expected to fail — module doesn't exist yet)**

Create `/private/tmp/claude-501/-Users-barryforrest-Projects-Horsemen-astro-astroplate/4c75e6bb-b012-44e1-a85c-6cec00abc90d/scratchpad/verify-twilio.mjs`:

```js
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.TWILIO_FROM_NUMBER;

const { sendSms } = await import(
  "/Users/barryforrest/Projects/Horsemen/astro/astroplate/netlify/functions/lib/sms-providers/twilio.js"
);

try {
  await sendSms({ recipients: ["+15555550100"], message: "hi", context: {} });
  console.error("FAIL: expected throw for missing Twilio config, none occurred");
  process.exit(1);
} catch (err) {
  if (err.message !== "Twilio is not configured") {
    console.error(`FAIL: expected "Twilio is not configured", got "${err.message}"`);
    process.exit(1);
  }
}

console.log("PASS");
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `node /private/tmp/claude-501/-Users-barryforrest-Projects-Horsemen-astro-astroplate/4c75e6bb-b012-44e1-a85c-6cec00abc90d/scratchpad/verify-twilio.mjs`
Expected: fails with a module-not-found error (the file doesn't exist yet).

- [ ] **Step 3: Create `netlify/functions/lib/sms-providers/twilio.js`**

```js
import twilio from "twilio";

export async function sendSms({ recipients, message }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !from) {
    throw new Error("Twilio is not configured");
  }

  const client = twilio(accountSid, authToken);

  const outcomes = await Promise.allSettled(
    recipients.map((to) => client.messages.create({ to, from, body: message })),
  );

  const failedCount = outcomes.filter((outcome) => outcome.status === "rejected").length;
  const sentCount = recipients.length - failedCount;
  const firstError = outcomes.find((outcome) => outcome.status === "rejected")?.reason;

  return { sentCount, failedCount, firstError };
}
```

- [ ] **Step 4: Run the verification script again, confirm it passes**

Run: `node /private/tmp/claude-501/-Users-barryforrest-Projects-Horsemen-astro-astroplate/4c75e6bb-b012-44e1-a85c-6cec00abc90d/scratchpad/verify-twilio.mjs`
Expected: prints `PASS`, exit code 0.

- [ ] **Step 5: Delete the disposable script and commit**

```bash
rm /private/tmp/claude-501/-Users-barryforrest-Projects-Horsemen-astro-astroplate/4c75e6bb-b012-44e1-a85c-6cec00abc90d/scratchpad/verify-twilio.mjs
cd /Users/barryforrest/Projects/Horsemen/astro/astroplate
git add netlify/functions/lib/sms-providers/twilio.js
git commit -m "Add Twilio SMS provider module"
```

---

### Task 5: Rewire member-messaging.js to dispatch by provider, drop dead code

**Files:**
- Modify: `netlify/functions/member-messaging.js`

**Interfaces:**
- Consumes: `resolveSmsProvider()` from `./lib/message-config.js` (Task 2); `sendSms()` from `./lib/sms-providers/aws-eum.js` (Task 3) and `./lib/sms-providers/twilio.js` (Task 4) — both same shape, imported under distinct local names.
- Produces: unchanged HTTP contract for `POST /api/member-messaging` — same request/response JSON shape as before this plan.

This task has no new business logic to unit-test in isolation (it's wiring); its verification is Task 6's smoke test. Read the current file in full before editing — it has changed shape from earlier extraction work in this plan only via the modules it now imports, not via any change already made to this file itself.

- [ ] **Step 1: Read the current file**

Run: `cat -n netlify/functions/member-messaging.js` (or open in your editor) to confirm line numbers below still match — this plan was written against the version with `SESv2Client`/`SendEmailCommand` imports, the unused `chunk()` helper, and the inline AWS EUM `sms` branch.

- [ ] **Step 2: Replace the import block**

Replace:

```js
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { PinpointSMSVoiceV2Client, SendTextMessageCommand } from "@aws-sdk/client-pinpoint-sms-voice-v2";
import { randomUUID } from "node:crypto";
import { authenticate } from "./lib/message-auth.js";
import {
  CONFIGURATION_SET_NAME,
  resolveAwsCredentials,
  resolveAwsRegion,
} from "./lib/message-config.js";
```

with:

```js
import { randomUUID } from "node:crypto";
import { authenticate } from "./lib/message-auth.js";
import { resolveSmsProvider } from "./lib/message-config.js";
import { sendSms as sendAwsSms } from "./lib/sms-providers/aws-eum.js";
import { sendSms as sendTwilioSms } from "./lib/sms-providers/twilio.js";

const SMS_PROVIDERS = {
  aws: sendAwsSms,
  twilio: sendTwilioSms,
};
```

- [ ] **Step 3: Delete the unused `chunk()` helper**

Remove this whole function (it has no callers anywhere in the file):

```js
function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
```

- [ ] **Step 4: Remove the handler's top-level AWS region check**

That check now lives inside `aws-eum.js` (Task 3) and only runs when the AWS provider is actually selected. Remove:

```js
  const region = resolveAwsRegion();
  if (!region) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "AWS_REGION is not configured" }),
    };
  }

```

(the blank line directly before `try {` goes with it — leave a single blank line separating the `message`/`useDefaultRecipients` block above from the `try {` below).

- [ ] **Step 5: Replace the `sms` branch body**

Replace:

```js
    if (channel === "sms") {
      const defaultPhones = useDefaultRecipients
        ? parseRecipients(process.env.MEMBER_PHONES || "")
        : [];
      const suppliedPhones = parseRecipients(payload.recipients);
      const recipients = normalizePhoneList([...defaultPhones, ...suppliedPhones]);

      if (recipients.length === 0) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: "No valid phone numbers provided" }),
        };
      }

      const originationIdentity = process.env.RCS_ORIGINATION_IDENTITY;
      if (!originationIdentity) {
        return {
          statusCode: 500,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: "RCS_ORIGINATION_IDENTITY is not configured" }),
        };
      }

      const credentials = resolveAwsCredentials();
      const smsClient = new PinpointSMSVoiceV2Client({
        region,
        ...(credentials && { credentials }),
      });
      const batchId = randomUUID();
      const context = { sentBy: user.name,  phoneNumber: user.token ,batchId,};

      const outcomes = await Promise.allSettled(
        recipients.map((phoneNumber) =>
          smsClient.send(
            new SendTextMessageCommand({
              DestinationPhoneNumber: phoneNumber,
              OriginationIdentity: originationIdentity,
              MessageBody: message,
              ConfigurationSetName: CONFIGURATION_SET_NAME,
              Context: context,
            }),
          ),
        ),
      );

      const failedCount = outcomes.filter((outcome) => outcome.status === "rejected").length;
      const sentCount = recipients.length - failedCount;

      if (sentCount === 0) {
        const firstFailure = outcomes.find((outcome) => outcome.status === "rejected");
        throw firstFailure.reason;
      }

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          ok: true,
          channel,
          recipients: recipients.length,
          sent: sentCount,
          failed: failedCount,
          sentBy: user.name,
          message: `SMS sent to ${sentCount}/${recipients.length} recipients`,
        }),
      };
    }
```

with:

```js
    if (channel === "sms") {
      const defaultPhones = useDefaultRecipients
        ? parseRecipients(process.env.MEMBER_PHONES || "")
        : [];
      const suppliedPhones = parseRecipients(payload.recipients);
      const recipients = normalizePhoneList([...defaultPhones, ...suppliedPhones]);

      if (recipients.length === 0) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: "No valid phone numbers provided" }),
        };
      }

      const batchId = randomUUID();
      const context = { sentBy: user.name, phoneNumber: user.token, batchId };
      const sendSms = SMS_PROVIDERS[resolveSmsProvider()];

      const { sentCount, failedCount, firstError } = await sendSms({
        recipients,
        message,
        context,
      });

      if (sentCount === 0) {
        throw firstError;
      }

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          ok: true,
          channel,
          recipients: recipients.length,
          sent: sentCount,
          failed: failedCount,
          sentBy: user.name,
          message: `SMS sent to ${sentCount}/${recipients.length} recipients`,
        }),
      };
    }
```

- [ ] **Step 6: Syntax-check the file**

Run: `node --check netlify/functions/member-messaging.js`
Expected: no output, exit code 0.

- [ ] **Step 7: Confirm no leftover references to removed imports**

Run: `grep -n "SESv2Client\|SendEmailCommand\|PinpointSMSVoiceV2Client\|SendTextMessageCommand\|CONFIGURATION_SET_NAME\|resolveAwsCredentials\|resolveAwsRegion\|chunk(" netlify/functions/member-messaging.js`
Expected: no matches.

- [ ] **Step 8: Commit**

```bash
cd /Users/barryforrest/Projects/Horsemen/astro/astroplate
git add netlify/functions/member-messaging.js
git commit -m "Dispatch member-messaging.js sms sends through provider abstraction"
```

---

### Task 6: Integration smoke test and manual live-send checklist

**Files:** none (verification only)

**Interfaces:** none produced — this is the plan's final verification gate.

- [ ] **Step 1: Start Netlify dev in the background**

Run this from the git worktree this plan is being implemented in (NOT the main checkout — confirm with `pwd` and `git rev-parse --abbrev-ref HEAD` first if unsure which directory you're in):

```bash
netlify dev &
```

Wait for it to report the local server URL (typically `http://localhost:8888`) before continuing.

- [ ] **Step 2: Confirm the function rejects unauthenticated requests (no live send triggered)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8888/api/member-messaging \
  -H "Content-Type: application/json" \
  -d '{"channel":"sms","message":"test","recipients":"+15555550100"}'
```

Expected: `401` (no `Authorization`/`X-Access-Code` header supplied — confirms the function loaded and auth still gates it, without needing a real access code or hitting a provider).

- [ ] **Step 3: Confirm the AWS path still activates by default and fails the same way it did before this plan (no real send, since `RCS_ORIGINATION_IDENTITY`/AWS creds are assumed unset in this dev shell)**

If you have a valid entry in `MESSAGE_USERS_JSON` locally, use its token; otherwise skip straight to Step 4 — Step 2 already confirmed the function is wired and loading.

```bash
curl -s -X POST http://localhost:8888/api/member-messaging \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your local access code>" \
  -d '{"channel":"sms","message":"test","recipients":"+15555550100"}'
```

Expected: a `500` with `{"error":"AWS_REGION is not configured"}` (or a further-along AWS error if you do have AWS env vars configured locally) — i.e., the same class of error the unmodified code would have produced, confirming the extraction didn't change behavior.

- [ ] **Step 4: Stop the dev server**

```bash
kill %1
```

- [ ] **Step 5: Record the manual follow-up (do not execute now)**

Once the Twilio account/number clears A2P 10DLC approval:
1. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` in `.env.local` (local) or Netlify site env vars (production).
2. Set `SMS_PROVIDER=twilio`.
3. Send one real message to a phone number verified in the Twilio trial console, via the `member-messaging.astro` form.
4. Confirm the response's `sent`/`failed` counts match reality and the message actually arrives (trial accounts prefix messages with "Sent from your Twilio trial account").
5. Only after that manual confirmation, treat the Twilio path as production-ready.

This step is a checklist for you to run by hand later — do not attempt a real Twilio send as part of this plan's execution.

---

## Self-Review Notes

- **Spec coverage:** provider selection (Task 2, 5), provider abstraction + both modules (Tasks 3, 4), config/env vars (Tasks 2, 4), dependency/bundling changes (Task 1), dead-code cleanup (Task 5), error handling (Tasks 3, 4, 5), testing plan / no live sends (Task 6) — all covered. Logging extension and per-message provider UI are explicitly out of scope per the design doc and not tasked here.
- **Type/shape consistency:** `sendSms({ recipients, message, context })` → `{ sentCount, failedCount, firstError }` used identically in Tasks 3, 4, and 5's consumption of both.
- **No placeholders:** every step has literal code or literal commands; no "add error handling" style steps.
