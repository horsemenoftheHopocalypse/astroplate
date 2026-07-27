# AWS Messaging Logging & Multi-User Access — Design

Date: 2026-07-27
Branch: AWS-SMS

## Context

The club site can already send member messages via two paths:

- `src/pages/member-messaging.astro` + `netlify/functions/member-messaging.js` — a web form gated by a single shared `MESSAGE_ADMIN_TOKEN`, sending email via SES and SMS via plain Amazon SNS (`PublishCommand`).
- `scripts/send-rcs-message.js` — a local CLI script sending RCS-with-SMS-fallback via AWS End User Messaging (`@aws-sdk/client-pinpoint-sms-voice-v2`), run manually with AWS credentials.

Neither path has message-event logging (delivery, opt-out, failure status) wired up, and only one person can access the website form (the shared token) or the CLI script (needs local AWS credentials).

Goal: set up AWS-side logging for message events on End User Messaging, and let a mixed group of users — some comfortable with the AWS console, some not — send messages and see logs.

## Access model

Two groups, both able to send and see logs, via different surfaces:

- **Technical officers** — individual IAM identities, console access to CloudWatch Logs Insights directly.
- **Everyone else (and technical officers too, if convenient)** — the club website, gated by per-person tokens, with a simplified log view.

Scope is deliberately limited to what already exists: sending one-off blasts (no templates/scheduling/segments) and viewing send history (no new analytics).

## 1. AWS-side event logging

- Create a Configuration Set, e.g. `horsemen-member-messaging`, in End User Messaging (Pinpoint SMS Voice V2).
- Add a CloudWatch Logs event destination to it via `CreateEventDestinationCommand`, matching event type `ALL` (covers TEXT_*, RCS_*, MEDIA_*, VOICE_* in one subscription), targeting a new log group, e.g. `/aws/eum/horsemen-member-messaging`.
- Log group retention: **30 days**.
- The event destination needs a small IAM role trusting `sms-voice.amazonaws.com` with `logs:CreateLogStream`/`logs:PutLogEvents` scoped to that one log group (`CloudWatchLogsDestination.IamRoleArn`).
- Every send (from the website and the CLI script) passes:
  - `ConfigurationSetName: "horsemen-member-messaging"`
  - `Context: { sentBy: "<name>", batchId: "<uuid>" }` — so log entries can be traced back to who triggered them and which blast they belong to. Confirmed `Context` is a supported field on `SendTextMessageRequest`/`SendRcsMessageRequest` in the installed SDK (`@aws-sdk/client-pinpoint-sms-voice-v2`).

## 2. IAM for technical officers

- IAM group `horsemen-messaging-viewers`.
- One managed policy attached to the group, read-only, scoped to the log group's ARN:
  - `logs:FilterLogEvents`, `logs:GetLogEvents`, `logs:DescribeLogGroups`, `logs:DescribeLogStreams`
  - `logs:StartQuery`, `logs:GetQueryResults`, `logs:StopQuery` (CloudWatch Logs Insights, for ad-hoc querying in the console)
- Each technical officer gets their own IAM user in that group (console access, forced password reset on first login, MFA recommended). Revoking one person is a group-membership change, not a policy edit.

## 3. Website auth (replaces `MESSAGE_ADMIN_TOKEN`)

- New env var `MESSAGE_USERS_JSON`, a JSON array of `{ "name": string, "token": string }`, following the existing pattern of storing secrets in Netlify env vars (no new auth service/database).
- Both Netlify functions (send, and the new log-view endpoint below) validate the bearer token against this list and resolve a `name`, used as `Context.sentBy`.
- `member-messaging.astro`'s "Admin Token" field becomes "Your Name" + "Access Code"; on success the UI shows "Signed in as {name}".
- `MESSAGE_ADMIN_TOKEN` is removed once nothing reads it.

## 4. Migrate website SMS from SNS to End User Messaging

- In `member-messaging.js`, the `sms` channel branch replaces `SNSClient`/`PublishCommand` with `PinpointSMSVoiceV2Client`/`SendTextMessageCommand`, using the same `RCS_ORIGINATION_IDENTITY` (and optional fallback) env vars the CLI script already uses.
- Each send includes `ConfigurationSetName` and `Context: { sentBy, batchId }` as above, so website sends land in the same log group as CLI sends.
- `SNS_SMS_TYPE`/`SNS_SENDER_ID` env vars and the `@aws-sdk/client-sns` dependency are removed once unused (email/SES path is untouched).
- `netlify.toml`'s `external_node_modules` list updates accordingly (drop `@aws-sdk/client-sns`, add `@aws-sdk/client-pinpoint-sms-voice-v2`).

## 5. Simplified log view on the website

- New Netlify function, e.g. `netlify/functions/message-logs.js`, auth'd the same way as sending (bearer token from `MESSAGE_USERS_JSON`).
- Runs a CloudWatch Logs Insights query (`StartQuery` + poll `GetQueryResults` every ~1s, up to ~10s) against the log group, over roughly the last 30 days, grouped by `batchId`: timestamp, `sentBy`, recipient count, delivered/failed/pending counts derived from `eventType`.
- If the query hasn't finished within the polling window, return a "still processing, try again" response rather than blocking.
- New page `src/pages/message-log.astro`, behind the same access-code gate, rendering the result as a table.
- The Netlify functions' AWS credentials (whatever IAM identity Netlify already uses for SES/EUM sending) need `logs:StartQuery`, `logs:GetQueryResults`, `logs:DescribeLogGroups` added, scoped to the one log group.

## Error handling

- Send endpoint: unchanged per-recipient try/catch and summary response, just under the new client. Auth failures still 401.
- Log endpoint: query timeout returns a distinct "still processing" state rather than an error or an infinite wait.

## Testing plan

- `--dry-run` on the CLI script and a dry send from the site (once migrated) to confirm delivery paths work without spamming real recipients.
- Confirm a log entry appears in CloudWatch within ~1 minute of a real send.
- Confirm the site's log view surfaces that entry with the correct `sentBy`/`batchId`.
- Confirm a revoked/unknown per-person token gets 401'd on both send and log endpoints.
- Confirm an IAM user in `horsemen-messaging-viewers` can browse the log group in the console; confirm a user not in the group cannot.

## Out of scope

- Message templates, scheduling, or recipient segmentation.
- RCS support in the website UI (stays CLI-only for now — this design only migrates the website's *SMS* path onto End User Messaging).
- Any new auth provider (Cognito/Auth0/Clerk) — per-person tokens in an env var is the chosen approach.
- Infrastructure-as-code (Terraform/CloudFormation) — this repo has none today; AWS setup is done via console/CLI and documented, not codified.
