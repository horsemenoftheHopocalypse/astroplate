# Twilio SMS Channel — Design

Date: 2026-08-04
Branch: main

## Context

Member messaging (`src/pages/member-messaging.astro` + `netlify/functions/member-messaging.js`) currently sends SMS through AWS End User Messaging (`@aws-sdk/client-pinpoint-sms-voice-v2`). AWS has declined to grant Production access or raise the account's spend limit above $1, which caps real usage.

Goal: add Twilio as a second SMS-sending path so a trial Twilio account can be used to gauge whether the feature is worth paying for, without committing to it as a permanent replacement. Twilio approval (A2P 10DLC registration) is in progress; credentials aren't available yet, so this pass builds the path ready to configure once they land.

`member-messaging.js` also carries two pieces of dead code unrelated to Twilio but touched by this restructure: an unused `SESv2Client`/`SendEmailCommand` import (no email branch exists; `@aws-sdk/client-sesv2` isn't referenced anywhere else in the repo) and an unused `chunk()` helper. Both are removed as part of this work.

## Provider selection

Server-side switch, not a UI control: `resolveSmsProvider()` in `netlify/functions/lib/message-config.js` reads `process.env.SMS_PROVIDER`, defaulting to `"aws"` when unset or unrecognized. Production behavior is unchanged until `SMS_PROVIDER=twilio` is set deliberately in Netlify once the Twilio account clears approval. `member-messaging.astro` needs no changes — it still posts `channel: "sms"`; the backend decides which provider handles it.

## Provider abstraction

Extract the AWS EUM send logic currently inline in `member-messaging.js`'s `sms` branch into `netlify/functions/lib/sms-providers/aws-eum.js`, and add a parallel `netlify/functions/lib/sms-providers/twilio.js`. Both export the same shape:

```js
async function sendSms({ recipients, message, context }) {
  // returns { sentCount, failedCount, firstError }
}
```

`member-messaging.js`'s `sms` branch shrinks to: validate/normalize recipients (unchanged), resolve the provider module via `resolveSmsProvider()`, call `sendSms(...)`, format the response — same shape as today's.

This was chosen over two alternatives: keeping one big if/else inline in the handler (duplicates the Promise.allSettled/outcome-counting logic per provider, and the file grows unbounded as providers change), and a heavier plugin-registry abstraction (unnecessary for two statically-known providers — YAGNI).

### `lib/sms-providers/twilio.js`

Uses the official `twilio` npm package (new dependency) rather than hand-rolled REST calls, since it handles Basic Auth and error parsing, and Twilio's errors (e.g. the trial-account "unverified number" error, code 21608) already flow through the existing `error.message` surfacing in `member-messaging.js`'s catch block with no extra code needed.

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

  const failedCount = outcomes.filter((o) => o.status === "rejected").length;
  const sentCount = recipients.length - failedCount;
  const firstError = outcomes.find((o) => o.status === "rejected")?.reason;

  return { sentCount, failedCount, firstError };
}
```

**Context/correlation gap:** AWS EUM's `Context` field (`sentBy`, `batchId`) is what `message-logs.js` reads back out of CloudWatch. Twilio has no equivalent passthrough without setting up status callbacks. Since logging is explicitly out of scope for this pass (see below), the Twilio path simply drops `context` — this is a known gap for future logging work, not solved here.

### `lib/sms-providers/aws-eum.js`

Straight extraction of the existing inline `PinpointSMSVoiceV2Client`/`SendTextMessageCommand`/`Context` logic from `member-messaging.js`, reshaped to the same `{ sentCount, failedCount, firstError }` return. No behavior change.

## Config & env vars

New in `message-config.js`:
- `resolveSmsProvider()` → `process.env.SMS_PROVIDER || "aws"`.

New Twilio env vars (plain names — Twilio isn't AWS/Lambda, so none of the `EUM_`-prefix reserved-namespace workarounds used for the AWS credentials in `message-config.js` apply here):
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`

Set in `.env.local` for local dev, as regular (non-reserved) Netlify site env vars in production.

## Dependency & bundling changes

- `package.json`: add `twilio`; remove `@aws-sdk/client-sesv2` (dead — see Context).
- `netlify.toml`'s `[functions] external_node_modules`: add `"twilio"`, remove `"@aws-sdk/client-sesv2"`.

## Error handling

- Missing Twilio config while `SMS_PROVIDER=twilio`: `sendSms` throws `"Twilio is not configured"`, caught by the existing handler catch block, returned as the same 500 shape AWS's missing-region case already uses. No new error-handling path needed in `member-messaging.js` itself.
- Per-recipient send failures: same `Promise.allSettled` pattern as today — partial failures return `sent`/`failed` counts; total failure re-throws the first error.

## Testing plan

No automated tests exist for the Netlify functions in this repo (`test.mjs` is an ad-hoc env/SDK diagnostic endpoint, not a test suite), and Twilio credentials aren't available yet (approval pending), so a live end-to-end Twilio send isn't possible in this pass. Verification here:
1. `netlify dev` builds and serves both functions cleanly after the extraction (confirms import/module wiring).
2. Manually exercise the `aws` path (default, unchanged) to confirm the extraction didn't regress the current working AWS flow.
3. Before flipping `SMS_PROVIDER=twilio` in production: do one real manual send once the Twilio account/number clears approval, to a verified trial number, and confirm `sentCount`/`failedCount` in the response match reality.

## Out of scope

- Extending `message-logs.js` / the `/message-log` page to include Twilio sends. Tracked as explicit future work — Twilio's Message Resource API would need to be queried and merged with the CloudWatch-backed AWS history, and delivery-status correlation (`Context`-equivalent) would need Twilio status callbacks set up first.
- Per-message provider selection in the UI (a dropdown letting the sender choose AWS vs. Twilio) — the server-side env-var switch was chosen instead; revisit if side-by-side comparison becomes useful later.
- Automatic failover between providers.
- Any changes to `message-auth.js` / the per-person access-code auth model — unaffected by provider choice.
