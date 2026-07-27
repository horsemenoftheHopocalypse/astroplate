# AWS Messaging Logging & Multi-User Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the club site's member-messaging feature AWS-side delivery logging and multi-user access, so several people (some technical, some not) can send messages and see send history, instead of one shared admin token with no visibility into delivery.

**Architecture:** An AWS CLI provisioning script sets up an End User Messaging Configuration Set with a CloudWatch Logs event destination (30-day retention) and an IAM group for technical officers to browse it directly. The website's Netlify functions replace the single `MESSAGE_ADMIN_TOKEN` with a small per-person token list (`MESSAGE_USERS_JSON`), tag every SMS send with `Context: { sentBy, batchId }` so it's traceable in the logs, and gain a new `/api/message-logs` endpoint (CloudWatch Logs Insights) plus a `/message-log` page for non-technical users. The website's SMS channel moves from plain Amazon SNS to AWS End User Messaging (`SendTextMessageCommand`), so every send — from the site or the existing CLI script — lands in the same log group.

**Tech Stack:** Astro (`.astro` pages), Netlify Functions (Node ESM), `@aws-sdk/client-pinpoint-sms-voice-v2` (already a dependency), `@aws-sdk/client-cloudwatch-logs` (new dependency), AWS CLI (`pinpoint-sms-voice-v2`, `logs`, `iam` — for the provisioning script only).

Design spec: `docs/superpowers/specs/2026-07-27-aws-messaging-logging-and-multiuser-access-design.md`

## Global Constraints

- CloudWatch Logs retention for the message-event log group: **30 days** (per spec).
- Event destination subscribes to `ALL` event types (covers TEXT_*, RCS_*, MEDIA_*, VOICE_*).
- Every End User Messaging send (website and CLI script) passes `ConfigurationSetName` and `Context: { sentBy: "<name>", batchId: "<uuid>" }`.
- `MESSAGE_USERS_JSON` (JSON array of `{ "name": string, "token": string }`) fully replaces `MESSAGE_ADMIN_TOKEN`. No new auth provider (Cognito/Auth0/Clerk) — per-person tokens in a Netlify env var, per spec.
- No Terraform/CloudFormation — AWS setup is a checked-in shell script run manually by a human with AWS admin credentials, per spec's "Out of scope" section. **Task 1's script must not be executed by an implementing agent** — it creates real IAM identities and billable AWS resources; only the repo user runs it.
- RCS stays CLI-only. This plan only migrates the website's *SMS* (plain text) path from SNS to End User Messaging — no RCS in the web UI (per spec's "Out of scope").
- This repo has no automated test framework (no vitest/jest, `package.json` has no test script). Per "follow existing patterns," verification steps in this plan use `node --check` (syntax), `yarn check` (Astro type-check), and manual curl/browser checks — matching how `scripts/send-rcs-message.js` is verified today (via `--dry-run`), not a new test suite.
- Client-side rendering of any server-derived string (names, counts) must use `textContent`/DOM APIs, never `innerHTML` with interpolated values — avoids reintroducing an XSS foot-gun even though current values are admin-controlled.

---

### Task 1: AWS infrastructure provisioning script

**Files:**
- Create: `scripts/aws/setup-messaging-logging.sh`

**Interfaces:**
- Produces (for later tasks, as fixed string constants, not files this script writes): Configuration Set name `horsemen-member-messaging`, log group name `/aws/eum/horsemen-member-messaging`. Tasks 3, 5, and 7 hardcode these same values as defaults in `netlify/functions/lib/message-config.js`.

**⚠️ Do not execute this script.** It creates real IAM roles/groups/policies and AWS resources under the user's account. Write it, syntax-check it, commit it, and stop — the repo owner runs it manually with their own AWS admin credentials once they're ready.

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# Provisions AWS resources for End User Messaging event logging and the
# technical-officer log-viewer IAM group. Run manually with an AWS profile
# that has IAM + End User Messaging admin permissions:
#
#   AWS_PROFILE=<admin-profile> AWS_REGION=us-east-1 ./scripts/aws/setup-messaging-logging.sh
#
# Not safe to blindly re-run: IAM/log resources that already exist will
# cause "already exists" errors. Review before running, and comment out
# steps that already succeeded if you need to re-run after a partial
# failure.
set -euo pipefail

: "${AWS_REGION:?Set AWS_REGION, e.g. us-east-1}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

CONFIG_SET_NAME="horsemen-member-messaging"
LOG_GROUP_NAME="/aws/eum/horsemen-member-messaging"
LOG_ROLE_NAME="horsemen-eum-logging-role"
VIEWER_GROUP_NAME="horsemen-messaging-viewers"
VIEWER_POLICY_NAME="horsemen-messaging-logs-readonly"

echo "== 1. CloudWatch Logs log group =="
aws logs create-log-group --log-group-name "$LOG_GROUP_NAME"
aws logs put-retention-policy --log-group-name "$LOG_GROUP_NAME" --retention-in-days 30

LOG_GROUP_ARN="arn:aws:logs:${AWS_REGION}:${ACCOUNT_ID}:log-group:${LOG_GROUP_NAME}:*"

echo "== 2. IAM role for End User Messaging to write to CloudWatch Logs =="
TRUST_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": {
    "Effect": "Allow",
    "Principal": { "Service": "sms-voice.amazonaws.com" },
    "Action": "sts:AssumeRole",
    "Condition": {
      "StringEquals": { "aws:SourceAccount": "${ACCOUNT_ID}" },
      "ArnLike": { "aws:SourceArn": "arn:aws:sms-voice:${AWS_REGION}:${ACCOUNT_ID}:configuration-set/${CONFIG_SET_NAME}" }
    }
  }
}
EOF
)

aws iam create-role \
  --role-name "$LOG_ROLE_NAME" \
  --assume-role-policy-document "$TRUST_POLICY"

PERMISSIONS_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["logs:CreateLogStream", "logs:DescribeLogStreams", "logs:PutLogEvents"],
      "Resource": ["${LOG_GROUP_ARN}"]
    }
  ]
}
EOF
)

aws iam put-role-policy \
  --role-name "$LOG_ROLE_NAME" \
  --policy-name eum-cloudwatch-logs \
  --policy-document "$PERMISSIONS_POLICY"

LOG_ROLE_ARN=$(aws iam get-role --role-name "$LOG_ROLE_NAME" --query 'Role.Arn' --output text)

echo "Waiting 10s for IAM role propagation..."
sleep 10

echo "== 3. End User Messaging configuration set + event destination =="
aws pinpoint-sms-voice-v2 create-configuration-set --configuration-set-name "$CONFIG_SET_NAME"

aws pinpoint-sms-voice-v2 create-event-destination \
  --configuration-set-name "$CONFIG_SET_NAME" \
  --event-destination-name cloudwatch-logs \
  --matching-event-types ALL \
  --cloud-watch-logs-destination "IamRoleArn=${LOG_ROLE_ARN},LogGroupArn=${LOG_GROUP_ARN}"

echo "== 4. IAM group + read-only policy for technical officers =="
VIEWER_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:FilterLogEvents",
        "logs:GetLogEvents",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
        "logs:StartQuery",
        "logs:GetQueryResults",
        "logs:StopQuery"
      ],
      "Resource": ["${LOG_GROUP_ARN}"]
    }
  ]
}
EOF
)

aws iam create-group --group-name "$VIEWER_GROUP_NAME"
VIEWER_POLICY_ARN=$(aws iam create-policy \
  --policy-name "$VIEWER_POLICY_NAME" \
  --policy-document "$VIEWER_POLICY" \
  --query 'Policy.Arn' --output text)
aws iam attach-group-policy --group-name "$VIEWER_GROUP_NAME" --policy-arn "$VIEWER_POLICY_ARN"

echo
echo "Done. Resources created:"
echo "  Log group:         $LOG_GROUP_NAME (30-day retention)"
echo "  EUM config set:     $CONFIG_SET_NAME"
echo "  Viewer IAM group:   $VIEWER_GROUP_NAME"
echo
echo "Next steps (manual):"
echo "  1. Add each technical officer as an IAM user in $VIEWER_GROUP_NAME:"
echo "       aws iam create-user --user-name <name>"
echo "       aws iam add-user-to-group --user-name <name> --group-name $VIEWER_GROUP_NAME"
echo "       aws iam create-login-profile --user-name <name> --password-reset-required"
echo "  2. Attach sms-voice:SendTextMessage plus these read-only CloudWatch Logs actions"
echo "     to whatever IAM identity your Netlify site's AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY"
echo "     belong to (needed for /api/message-logs):"
echo "       logs:StartQuery, logs:GetQueryResults, logs:DescribeLogGroups"
echo "       on resource: $LOG_GROUP_ARN"
echo "  3. Set MESSAGE_USERS_JSON in Netlify env vars (Site settings > Environment variables), e.g.:"
echo '       [{"name":"Barry","token":"<random-string>"},{"name":"Jane","token":"<random-string>"}]'
```

- [ ] **Step 2: Make it executable and syntax-check it (do not run it)**

Run: `chmod +x scripts/aws/setup-messaging-logging.sh && bash -n scripts/aws/setup-messaging-logging.sh`
Expected: no output (bash -n only checks syntax, doesn't execute).

- [ ] **Step 3: Commit**

```bash
git add scripts/aws/setup-messaging-logging.sh
git commit -m "Add AWS provisioning script for message-event logging + viewer IAM group"
```

---

### Task 2: Shared auth and config helpers for Netlify functions

**Files:**
- Create: `netlify/functions/lib/message-auth.js`
- Create: `netlify/functions/lib/message-config.js`

**Interfaces:**
- Produces: `authenticate(event) -> { name: string } | null` from `message-auth.js`. Reads `MESSAGE_USERS_JSON` env var (JSON array of `{ name, token }`), reads the token from the request's `Authorization: Bearer <token>` header or `X-Access-Code` header.
- Produces: `CONFIGURATION_SET_NAME: string` and `LOG_GROUP_NAME: string` constants from `message-config.js`.
- Consumed by: Task 3 (`member-messaging.js`), Task 5 (`message-logs.js`), Task 7 (`send-rcs-message.js`).

- [ ] **Step 1: Write `netlify/functions/lib/message-config.js`**

```js
export const CONFIGURATION_SET_NAME =
  process.env.EUM_CONFIGURATION_SET_NAME || "horsemen-member-messaging";

export const LOG_GROUP_NAME =
  process.env.EUM_LOG_GROUP_NAME || "/aws/eum/horsemen-member-messaging";
```

- [ ] **Step 2: Write `netlify/functions/lib/message-auth.js`**

```js
function parseUsers() {
  const raw = process.env.MESSAGE_USERS_JSON;
  if (!raw) return [];

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed.filter(
    (user) =>
      user &&
      typeof user.name === "string" &&
      typeof user.token === "string" &&
      user.token.length > 0,
  );
}

function extractToken(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  const tokenFromBearer =
    typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : "";

  return (
    tokenFromBearer ||
    event.headers["x-access-code"] ||
    event.headers["X-Access-Code"] ||
    ""
  );
}

// Resolves a request's per-person access code against MESSAGE_USERS_JSON.
// Returns { name } on success, or null if the token is missing, unknown,
// or MESSAGE_USERS_JSON is unset/malformed.
export function authenticate(event) {
  const token = extractToken(event);
  if (!token) return null;

  const users = parseUsers();
  const match = users.find((user) => user.token === token);
  return match ? { name: match.name } : null;
}
```

- [ ] **Step 3: Syntax-check both files**

Run: `node --check netlify/functions/lib/message-config.js && node --check netlify/functions/lib/message-auth.js`
Expected: no output (both are valid syntax).

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/lib/message-auth.js netlify/functions/lib/message-config.js
git commit -m "Add shared per-person auth and messaging config helpers"
```

---

### Task 3: Migrate `member-messaging.js` from SNS to End User Messaging + per-person auth

**Files:**
- Modify: `netlify/functions/member-messaging.js`
- Modify: `netlify.toml`
- Modify: `package.json` (via `yarn remove`)

**Interfaces:**
- Consumes: `authenticate(event)` and `CONFIGURATION_SET_NAME` from Task 2.
- Produces: on a successful `sms` send, JSON response now includes `sent`, `failed`, and `sentBy` fields in addition to the existing `ok`, `channel`, `recipients`, `message`. The `email` branch's response gains a `sentBy` field. Task 4 depends on `sentBy` being present in both.
- Env vars this file now reads: `MESSAGE_USERS_JSON` (replaces `MESSAGE_ADMIN_TOKEN`, which is no longer read), `RCS_ORIGINATION_IDENTITY` (already used by `scripts/send-rcs-message.js`, now also required for the website's `sms` channel). `SNS_SMS_TYPE`/`SNS_SENDER_ID` are no longer read.

- [ ] **Step 1: Replace `netlify/functions/member-messaging.js` in full**

```js
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { PinpointSMSVoiceV2Client, SendTextMessageCommand } from "@aws-sdk/client-pinpoint-sms-voice-v2";
import { randomUUID } from "node:crypto";
import { authenticate } from "./lib/message-auth.js";
import { CONFIGURATION_SET_NAME } from "./lib/message-config.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_PHONE_REGEX = /^\+[1-9]\d{6,14}$/;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Access-Code",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function unauthorizedResponse() {
  return {
    statusCode: 401,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: "Unauthorized" }),
  };
}

function parseRecipients(input) {
  if (Array.isArray(input)) {
    return input.map((value) => String(value).trim()).filter(Boolean);
  }

  if (typeof input !== "string") {
    return [];
  }

  return input
    .split(/[\n,;]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeEmailList(list) {
  const seen = new Set();
  const normalized = [];

  for (const email of list) {
    const normalizedEmail = email.toLowerCase();
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      throw new Error(`Invalid email address: ${email}`);
    }

    if (!seen.has(normalizedEmail)) {
      seen.add(normalizedEmail);
      normalized.push(normalizedEmail);
    }
  }

  return normalized;
}

function normalizePhoneList(list) {
  const seen = new Set();
  const normalized = [];

  for (const rawPhone of list) {
    const phone = rawPhone.replace(/\s+/g, "");
    if (!E164_PHONE_REGEX.test(phone)) {
      throw new Error(
        `Invalid phone number: ${rawPhone}. Use E.164 format like +18175551234`,
      );
    }

    if (!seen.has(phone)) {
      seen.add(phone);
      normalized.push(phone);
    }
  }

  return normalized;
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  if (!process.env.MESSAGE_USERS_JSON) {
    console.error("member-messaging: MESSAGE_USERS_JSON is not configured");
  }

  const user = authenticate(event);
  if (!user) {
    return unauthorizedResponse();
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Invalid JSON payload" }),
    };
  }

  const channel = payload.channel;
  const message = String(payload.message || "").trim();
  const useDefaultRecipients = Boolean(payload.useDefaultRecipients);

  if (!message) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Message is required" }),
    };
  }

  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!region) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "AWS_REGION is not configured" }),
    };
  }

  try {
    if (channel === "email") {
      const defaultEmails = useDefaultRecipients
        ? parseRecipients(process.env.MEMBER_EMAILS || "")
        : [];
      const suppliedEmails = parseRecipients(payload.recipients);
      const recipients = normalizeEmailList([...defaultEmails, ...suppliedEmails]);
      const subject = String(payload.subject || "").trim();
      const fromAddress = String(payload.fromAddress || process.env.SES_FROM_EMAIL || "").trim();

      if (!subject) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: "Subject is required for email" }),
        };
      }

      if (!fromAddress || !EMAIL_REGEX.test(fromAddress)) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            error: "A valid fromAddress is required or set SES_FROM_EMAIL",
          }),
        };
      }

      if (recipients.length === 0) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: "No valid email recipients provided" }),
        };
      }

      const sesClient = new SESv2Client({ region });
      const recipientChunks = chunk(recipients, 50);

      for (const recipientChunk of recipientChunks) {
        await sesClient.send(
          new SendEmailCommand({
            FromEmailAddress: fromAddress,
            Destination: { ToAddresses: recipientChunk },
            Content: {
              Simple: {
                Subject: { Data: subject, Charset: "UTF-8" },
                Body: {
                  Text: { Data: message, Charset: "UTF-8" },
                },
              },
            },
          }),
        );
      }

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          ok: true,
          channel,
          recipients: recipients.length,
          sentBy: user.name,
          message: `Email sent to ${recipients.length} recipients`,
        }),
      };
    }

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

      const smsClient = new PinpointSMSVoiceV2Client({ region });
      const batchId = randomUUID();
      const context = { sentBy: user.name, batchId };

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

    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Invalid channel. Use 'email' or 'sms'." }),
    };
  } catch (error) {
    console.error("member-messaging failure", {
      channel,
      message: error instanceof Error ? error.message : "Unknown error",
    });

    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to send message",
      }),
    };
  }
};
```

- [ ] **Step 2: Remove the now-unused SNS dependency**

Run: `yarn remove @aws-sdk/client-sns`
Expected: `package.json` and `yarn.lock` update, removing the entry.

- [ ] **Step 3: Update `netlify.toml`'s `external_node_modules`**

In `netlify.toml`, change:

```toml
external_node_modules = ["@paypal/paypal-server-sdk", "@aws-sdk/client-sesv2", "@aws-sdk/client-sns"]
```

to:

```toml
external_node_modules = ["@paypal/paypal-server-sdk", "@aws-sdk/client-sesv2", "@aws-sdk/client-pinpoint-sms-voice-v2"]
```

- [ ] **Step 4: Syntax-check the function**

Run: `node --check netlify/functions/member-messaging.js`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/member-messaging.js netlify.toml package.json yarn.lock
git commit -m "Migrate website SMS sending from SNS to End User Messaging"
```

---

### Task 4: Update `member-messaging.astro` for per-person access codes

**Files:**
- Modify: `src/pages/member-messaging.astro`

**Interfaces:**
- Consumes: `POST /api/member-messaging` response shape from Task 3, specifically the `sentBy` field.

- [ ] **Step 1: Replace `src/pages/member-messaging.astro` in full**

```astro
---
import Base from "@/layouts/Base.astro";
import PageHeader from "@/partials/PageHeader.astro";
---

<Base title="Member Messaging" meta_title="Member Messaging">
  <PageHeader title="Member Messaging" />
  <section class="section-sm">
    <div class="container max-w-4xl">
      <div class="rounded-lg border border-border bg-light p-6 dark:border-darkmode-border dark:bg-darkmode-light">
        <p class="mb-4 text-sm">
          Send a message to members using Amazon SES (email) or AWS End User Messaging (SMS).
          This page requires your personal access code.
        </p>

        <form id="member-messaging-form" class="space-y-4">
          <div>
            <label class="mb-2 block text-sm font-semibold" for="accessCode">Access Code</label>
            <input
              id="accessCode"
              name="accessCode"
              type="password"
              class="w-full rounded border border-border px-3 py-2 dark:border-darkmode-border dark:bg-darkmode-body"
              placeholder="Your personal access code"
              required
            />
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <div>
              <label class="mb-2 block text-sm font-semibold" for="channel">Channel</label>
              <select
                id="channel"
                name="channel"
                class="w-full rounded border border-border px-3 py-2 dark:border-darkmode-border dark:bg-darkmode-body"
              >
                <option value="email">Email (SES)</option>
                <option value="sms">SMS (End User Messaging)</option>
              </select>
            </div>

            <div id="fromAddressWrap">
              <label class="mb-2 block text-sm font-semibold" for="fromAddress">From Address</label>
              <input
                id="fromAddress"
                name="fromAddress"
                type="email"
                class="w-full rounded border border-border px-3 py-2 dark:border-darkmode-border dark:bg-darkmode-body"
                placeholder="optional (uses SES_FROM_EMAIL by default)"
              />
            </div>
          </div>

          <div>
            <label class="mb-2 block text-sm font-semibold" for="recipients">Recipients</label>
            <textarea
              id="recipients"
              name="recipients"
              rows="4"
              class="w-full rounded border border-border px-3 py-2 dark:border-darkmode-border dark:bg-darkmode-body"
              placeholder="Email: one per line or comma-separated\nSMS: E.164 format, e.g. +18175551234"
            ></textarea>
            <label class="mt-2 flex items-center gap-2 text-sm">
              <input id="useDefaultRecipients" name="useDefaultRecipients" type="checkbox" />
              Include server defaults (`MEMBER_EMAILS` or `MEMBER_PHONES`)
            </label>
          </div>

          <div id="subjectWrap">
            <label class="mb-2 block text-sm font-semibold" for="subject">Email Subject</label>
            <input
              id="subject"
              name="subject"
              type="text"
              class="w-full rounded border border-border px-3 py-2 dark:border-darkmode-border dark:bg-darkmode-body"
              placeholder="Monthly club update"
            />
          </div>

          <div>
            <label class="mb-2 block text-sm font-semibold" for="message">Message</label>
            <textarea
              id="message"
              name="message"
              rows="8"
              class="w-full rounded border border-border px-3 py-2 dark:border-darkmode-border dark:bg-darkmode-body"
              placeholder="Write your member announcement..."
              required
            ></textarea>
          </div>

          <div class="flex items-center gap-3">
            <button type="submit" class="btn btn-primary">Send Message</button>
            <p id="status" class="text-sm"></p>
          </div>
        </form>

        <p class="mt-4 text-sm">
          <a href="/message-log" class="underline">View message log</a>
        </p>
      </div>
    </div>
  </section>
</Base>

<script>
  // @ts-nocheck
  const form = document.querySelector("#member-messaging-form");
  const channel = document.querySelector("#channel");
  const subjectWrap = document.querySelector("#subjectWrap");
  const fromAddressWrap = document.querySelector("#fromAddressWrap");
  const status = document.querySelector("#status");

  if (
    !(form instanceof HTMLFormElement) ||
    !(channel instanceof HTMLSelectElement) ||
    !(subjectWrap instanceof HTMLElement) ||
    !(fromAddressWrap instanceof HTMLElement) ||
    !(status instanceof HTMLElement)
  ) {
    console.error("Member messaging page could not initialize: expected DOM nodes were not found.");
  } else {
    function syncChannelFields() {
      const isEmail = channel.value === "email";
      subjectWrap.style.display = isEmail ? "block" : "none";
      fromAddressWrap.style.display = isEmail ? "block" : "none";
    }

    channel.addEventListener("change", syncChannelFields);
    syncChannelFields();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      status.textContent = "Sending...";

      const formData = new FormData(form);
      const accessCode = String(formData.get("accessCode") || "").trim();

      if (!accessCode) {
        status.textContent = "Access code is required.";
        return;
      }

      const payload = {
        channel: formData.get("channel"),
        recipients: formData.get("recipients"),
        useDefaultRecipients: formData.get("useDefaultRecipients") === "on",
        subject: formData.get("subject"),
        fromAddress: formData.get("fromAddress"),
        message: formData.get("message"),
      };

      try {
        const response = await fetch("/api/member-messaging", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessCode}`,
          },
          body: JSON.stringify(payload),
        });

        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || "Failed to send message");
        }

        const signedInAs = result.sentBy ? `Signed in as ${result.sentBy}. ` : "";
        status.textContent = signedInAs + (result.message || "Message sent.");
        status.classList.remove("text-red-600");
        status.classList.add("text-green-700");
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "Failed to send message.";
        status.classList.remove("text-green-700");
        status.classList.add("text-red-600");
      }
    });
  }
</script>
```

- [ ] **Step 2: Type-check**

Run: `yarn check`
Expected: no new errors related to `member-messaging.astro`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/member-messaging.astro
git commit -m "Replace shared admin token with per-person access code on messaging form"
```

---

### Task 5: New `/api/message-logs` endpoint

**Files:**
- Create: `netlify/functions/message-logs.js`
- Modify: `netlify.toml`
- Modify: `package.json` (via `yarn add`)

**Interfaces:**
- Consumes: `authenticate(event)` and `LOG_GROUP_NAME` from Task 2.
- Produces: `GET /api/message-logs` (via the `/api/*` redirect in `netlify.toml`), auth'd the same way as `/api/member-messaging`. Success response: `{ ok: true, requestedBy: string, batches: Array<{ batchId, sentBy, timestamp, recipients, successful, failed }> }`. Pending response (query still running): HTTP 202, `{ ok: false, pending: true, message: string }`. Task 6 depends on this exact shape.

- [ ] **Step 1: Add the new AWS SDK dependency**

Run: `yarn add @aws-sdk/client-cloudwatch-logs`
Expected: `package.json` and `yarn.lock` update.

- [ ] **Step 2: Write `netlify/functions/message-logs.js`**

```js
import { CloudWatchLogsClient, StartQueryCommand, GetQueryResultsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { authenticate } from "./lib/message-auth.js";
import { LOG_GROUP_NAME } from "./lib/message-config.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Access-Code",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

const SUCCESS_EVENT_TYPES = new Set([
  "TEXT_SUCCESSFUL",
  "TEXT_DELIVERED",
  "RCS_DELIVERED",
  "RCS_SENT",
  "RCS_READ",
]);

const QUERY_LOOKBACK_DAYS = 30;
const QUERY_POLL_INTERVAL_MS = 1000;
const QUERY_MAX_POLLS = 10;

function unauthorizedResponse() {
  return {
    statusCode: 401,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: "Unauthorized" }),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeRows(rows) {
  const batches = new Map();

  for (const row of rows) {
    const fields = Object.fromEntries(row.map((field) => [field.field, field.value]));
    const batchId = fields.batchId || "unknown";

    if (!batches.has(batchId)) {
      batches.set(batchId, {
        batchId,
        sentBy: fields.sentBy || "unknown",
        timestamp: fields["@timestamp"],
        recipients: 0,
        successful: 0,
        failed: 0,
      });
    }

    const batch = batches.get(batchId);
    batch.recipients += 1;

    if (SUCCESS_EVENT_TYPES.has(fields.eventType)) {
      batch.successful += 1;
    } else {
      batch.failed += 1;
    }

    if (fields["@timestamp"] && fields["@timestamp"] < batch.timestamp) {
      batch.timestamp = fields["@timestamp"];
    }
  }

  return Array.from(batches.values()).sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  if (!process.env.MESSAGE_USERS_JSON) {
    console.error("message-logs: MESSAGE_USERS_JSON is not configured");
  }

  const user = authenticate(event);
  if (!user) {
    return unauthorizedResponse();
  }

  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!region) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "AWS_REGION is not configured" }),
    };
  }

  const client = new CloudWatchLogsClient({ region });
  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - QUERY_LOOKBACK_DAYS * 24 * 60 * 60;

  try {
    const { queryId } = await client.send(
      new StartQueryCommand({
        logGroupName: LOG_GROUP_NAME,
        startTime,
        endTime,
        queryString:
          "fields @timestamp, eventType, destinationPhoneNumber, context.sentBy as sentBy, context.batchId as batchId | filter ispresent(context.batchId) | sort @timestamp desc | limit 1000",
        limit: 1000,
      }),
    );

    let queryOutput;
    for (let attempt = 0; attempt < QUERY_MAX_POLLS; attempt += 1) {
      await sleep(QUERY_POLL_INTERVAL_MS);
      queryOutput = await client.send(new GetQueryResultsCommand({ queryId }));

      if (queryOutput.status === "Complete") break;
      if (queryOutput.status === "Failed" || queryOutput.status === "Cancelled") {
        throw new Error(`CloudWatch Logs Insights query ${queryOutput.status.toLowerCase()}`);
      }
    }

    if (!queryOutput || queryOutput.status !== "Complete") {
      return {
        statusCode: 202,
        headers: CORS_HEADERS,
        body: JSON.stringify({ ok: false, pending: true, message: "Query still running, try again shortly" }),
      };
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        ok: true,
        requestedBy: user.name,
        batches: summarizeRows(queryOutput.results || []),
      }),
    };
  } catch (error) {
    console.error("message-logs failure", {
      message: error instanceof Error ? error.message : "Unknown error",
    });

    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to fetch message logs",
      }),
    };
  }
};
```

- [ ] **Step 3: Update `netlify.toml`'s `external_node_modules`**

Add `@aws-sdk/client-cloudwatch-logs` to the array from Task 3, so it reads:

```toml
external_node_modules = ["@paypal/paypal-server-sdk", "@aws-sdk/client-sesv2", "@aws-sdk/client-pinpoint-sms-voice-v2", "@aws-sdk/client-cloudwatch-logs"]
```

- [ ] **Step 4: Syntax-check the function**

Run: `node --check netlify/functions/message-logs.js`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/message-logs.js netlify.toml package.json yarn.lock
git commit -m "Add message-logs endpoint querying CloudWatch Logs Insights"
```

---

### Task 6: New `/message-log` page + nav entry

**Files:**
- Create: `src/pages/message-log.astro`
- Modify: `src/config/menu.json`

**Interfaces:**
- Consumes: `GET /api/message-logs` response shape from Task 5.

- [ ] **Step 1: Write `src/pages/message-log.astro`**

```astro
---
import Base from "@/layouts/Base.astro";
import PageHeader from "@/partials/PageHeader.astro";
---

<Base title="Message Log" meta_title="Message Log">
  <PageHeader title="Message Log" />
  <section class="section-sm">
    <div class="container max-w-4xl">
      <div class="rounded-lg border border-border bg-light p-6 dark:border-darkmode-border dark:bg-darkmode-light">
        <p class="mb-4 text-sm">
          Recent member message sends (last 30 days), from AWS End User Messaging's delivery logs.
        </p>

        <form id="message-log-form" class="mb-6 flex items-end gap-3">
          <div class="flex-1">
            <label class="mb-2 block text-sm font-semibold" for="accessCode">Access Code</label>
            <input
              id="accessCode"
              name="accessCode"
              type="password"
              class="w-full rounded border border-border px-3 py-2 dark:border-darkmode-border dark:bg-darkmode-body"
              required
            />
          </div>
          <button type="submit" class="btn btn-primary">Load Log</button>
        </form>

        <p id="status" class="mb-4 text-sm"></p>

        <div class="overflow-x-auto">
          <table id="logTable" class="hidden w-full text-left text-sm">
            <thead>
              <tr class="border-b border-border dark:border-darkmode-border">
                <th class="py-2 pr-4">Sent</th>
                <th class="py-2 pr-4">By</th>
                <th class="py-2 pr-4">Recipients</th>
                <th class="py-2 pr-4">Successful</th>
                <th class="py-2 pr-4">Failed</th>
              </tr>
            </thead>
            <tbody id="logTableBody"></tbody>
          </table>
        </div>
      </div>
    </div>
  </section>
</Base>

<script>
  // @ts-nocheck
  const form = document.querySelector("#message-log-form");
  const status = document.querySelector("#status");
  const table = document.querySelector("#logTable");
  const tableBody = document.querySelector("#logTableBody");

  if (
    !(form instanceof HTMLFormElement) ||
    !(status instanceof HTMLElement) ||
    !(table instanceof HTMLTableElement) ||
    !(tableBody instanceof HTMLElement)
  ) {
    console.error("Message log page could not initialize: expected DOM nodes were not found.");
  } else {
    async function loadLog(accessCode, attempt = 0) {
      const response = await fetch("/api/message-logs", {
        headers: { Authorization: `Bearer ${accessCode}` },
      });

      const result = await response.json();

      if (!response.ok && response.status !== 202) {
        throw new Error(result.error || "Failed to load message log");
      }

      if (result.pending) {
        if (attempt >= 3) {
          throw new Error("Log query is still running. Try again in a moment.");
        }
        status.textContent = "Query still running, retrying...";
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return loadLog(accessCode, attempt + 1);
      }

      return result;
    }

    function renderRow(batch) {
      const row = document.createElement("tr");
      row.className = "border-b border-border dark:border-darkmode-border";

      const values = [
        new Date(batch.timestamp).toLocaleString(),
        batch.sentBy,
        String(batch.recipients),
        String(batch.successful),
        String(batch.failed),
      ];

      for (const value of values) {
        const cell = document.createElement("td");
        cell.className = "py-2 pr-4";
        cell.textContent = value;
        row.appendChild(cell);
      }

      return row;
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      status.textContent = "Loading...";
      table.classList.add("hidden");

      const formData = new FormData(form);
      const accessCode = String(formData.get("accessCode") || "").trim();

      if (!accessCode) {
        status.textContent = "Access code is required.";
        return;
      }

      try {
        const result = await loadLog(accessCode);

        tableBody.innerHTML = "";
        for (const batch of result.batches) {
          tableBody.appendChild(renderRow(batch));
        }

        table.classList.remove("hidden");
        status.textContent = `Signed in as ${result.requestedBy}. ${result.batches.length} batch(es) in the last 30 days.`;
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "Failed to load message log.";
      }
    });
  }
</script>
```

- [ ] **Step 2: Add the nav entry in `src/config/menu.json`**

Find the `"Member Messaging"` entry under `"Pages" > "children"` and add a new entry immediately after it:

```json
        {
          "name": "Member Messaging",
          "url": "/member-messaging"
        },
        {
          "name": "Message Log",
          "url": "/message-log"
        },
```

- [ ] **Step 3: Type-check**

Run: `yarn check`
Expected: no new errors related to `message-log.astro`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/message-log.astro src/config/menu.json
git commit -m "Add message log viewer page and nav entry"
```

---

### Task 7: Tag CLI script sends with `ConfigurationSetName` and `Context`

**Files:**
- Modify: `scripts/send-rcs-message.js`

**Interfaces:**
- Consumes: `CONFIGURATION_SET_NAME` from Task 2's `netlify/functions/lib/message-config.js`.

- [ ] **Step 1: Add imports**

In `scripts/send-rcs-message.js`, add to the top of the import block (after the existing imports):

```js
import os from "node:os";
import { randomUUID } from "node:crypto";
import { CONFIGURATION_SET_NAME } from "../netlify/functions/lib/message-config.js";
```

- [ ] **Step 2: Generate a batch ID and pass Context/ConfigurationSetName on every send**

In `main()`, right after `const { recipients, invalid } = readRecipients(args.file);`, add:

```js
  const batchId = randomUUID();
```

Then update the `sendOne` call inside the `for (const recipient of recipients)` loop to pass the batch/context info through. Change:

```js
      const response = await sendOne(
        client,
        { originationIdentity, fallbackOriginationIdentity, message: args.message, dryRun: args.dryRun },
        recipient,
      );
```

to:

```js
      const response = await sendOne(
        client,
        {
          originationIdentity,
          fallbackOriginationIdentity,
          message: args.message,
          dryRun: args.dryRun,
          configurationSetName: CONFIGURATION_SET_NAME,
          context: { sentBy: os.userInfo().username, batchId },
        },
        recipient,
      );
```

Then update `sendOne`'s destructuring and the `SendRcsMessageCommand` construction. Change:

```js
async function sendOne(client, { originationIdentity, fallbackOriginationIdentity, message, dryRun }, recipient) {
  const command = new SendRcsMessageCommand({
    DestinationPhoneNumber: recipient.phone,
    OriginationIdentity: originationIdentity,
    RcsMessageContent: {
      Content: {
        TextMessage: { Body: message },
      },
    },
    ...(fallbackOriginationIdentity && {
      FallbackConfiguration: {
        Channel: "SMS",
        MessageBody: message,
        OriginationIdentity: fallbackOriginationIdentity,
      },
    }),
    DryRun: dryRun,
  });
```

to:

```js
async function sendOne(
  client,
  { originationIdentity, fallbackOriginationIdentity, message, dryRun, configurationSetName, context },
  recipient,
) {
  const command = new SendRcsMessageCommand({
    DestinationPhoneNumber: recipient.phone,
    OriginationIdentity: originationIdentity,
    RcsMessageContent: {
      Content: {
        TextMessage: { Body: message },
      },
    },
    ...(fallbackOriginationIdentity && {
      FallbackConfiguration: {
        Channel: "SMS",
        MessageBody: message,
        OriginationIdentity: fallbackOriginationIdentity,
      },
    }),
    ConfigurationSetName: configurationSetName,
    Context: context,
    DryRun: dryRun,
  });
```

- [ ] **Step 3: Syntax-check the script**

Run: `node --check scripts/send-rcs-message.js`
Expected: no output.

- [ ] **Step 4: Dry-run against real AWS to confirm the request shape is accepted**

This requires `RCS_ORIGINATION_IDENTITY` and AWS credentials already configured in `.env.local` (they are, per existing setup). It does **not** require Task 1's Configuration Set to exist yet if you comment out or temporarily blank `ConfigurationSetName` — but to fully validate, run it after Task 1 has been executed by the repo owner:

Run: `yarn send-rcs-message --file scripts/recipients.csv --message "test" --dry-run`
Expected: `DryRun set: validating with AWS but not delivering to recipients` followed by per-recipient `sent ->` lines (no `FAILED` lines about unknown configuration set, once Task 1's script has been run).

- [ ] **Step 5: Commit**

```bash
git add scripts/send-rcs-message.js
git commit -m "Tag CLI script sends with configuration set and batch context"
```

---

## Post-plan manual steps (not part of automated execution)

These happen after all 7 tasks are merged, done by the repo owner, not an implementing agent:

1. Run `scripts/aws/setup-messaging-logging.sh` (Task 1) under an AWS admin profile.
2. Add technical officers as IAM users in the `horsemen-messaging-viewers` group (script prints the exact commands).
3. Attach the printed CloudWatch Logs permissions to whatever IAM identity Netlify's `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` belong to, and confirm that identity also has `sms-voice:SendTextMessage`.
4. Set `MESSAGE_USERS_JSON` in Netlify's environment variables (replacing `MESSAGE_ADMIN_TOKEN`, which can then be deleted).
5. Send a real (non-dry-run) test message from `/member-messaging`, confirm it arrives, confirm a corresponding entry shows up in `/message-log` within a minute or two.
