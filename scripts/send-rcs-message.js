// Sends a plain-text RCS message (with automatic SMS fallback) to a list of
// phone numbers using AWS End User Messaging's SendRcsMessage API.
//
// Usage:
//   yarn send-rcs-message --file scripts/recipients.csv --message "Meeting moved to 7pm"
//   yarn send-rcs-message --file scripts/recipients.csv --message "..." --dry-run
//   yarn send-rcs-message --file scripts/recipients.csv --message "..." --yes
//
// `yarn send-rcs-message` loads env vars from .env.local automatically (via
// node --env-file). Running `node scripts/send-rcs-message.js` directly does
// NOT load any .env file — pass --env-file=.env.local (or export the vars
// yourself) if you invoke it that way.
//
// CSV format (header row required, extra columns are ignored):
//   name,phone
//   Jane Doe,+18175551234
//
// Required environment variables (already present in .env.local):
//   AWS_REGION (or AWS_DEFAULT_REGION)  - AWS region for the End User Messaging endpoint
//   RCS_ORIGINATION_IDENTITY            - RcsAgentId/Arn or PoolId/Arn, already provisioned in AWS
//
// Optional:
//   RCS_FALLBACK_ORIGINATION_IDENTITY   - SMS-capable PhoneNumber/PhoneNumberId/Arn or SenderId/Arn,
//                                          used when a recipient's device/carrier doesn't support RCS
//                                          (pool IDs/ARNs are not accepted here per the AWS API).
//                                          If unset, messages send RCS-only with no SMS fallback.
//
// AWS credentials are picked up from the standard SDK provider chain
// (AWS_PROFILE, AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, SSO, etc).
import fs from "node:fs";
import readline from "node:readline/promises";
import { parse } from "csv-parse/sync";
import { PinpointSMSVoiceV2Client, SendRcsMessageCommand } from "@aws-sdk/client-pinpoint-sms-voice-v2";

const E164_PHONE_REGEX = /^\+[1-9]\d{6,14}$/;
const THROTTLE_RETRY_DELAYS_MS = [1000, 3000, 8000];

function parseArgs(argv) {
  const args = { dryRun: false, yes: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--file":
        args.file = argv[++i];
        break;
      case "--message":
        args.message = argv[++i];
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--yes":
        args.yes = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function readRecipients(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true });

  const seen = new Set();
  const recipients = [];
  const invalid = [];

  for (const row of rows) {
    const phone = String(row.phone || "").replace(/\s+/g, "");
    if (!E164_PHONE_REGEX.test(phone)) {
      invalid.push({ name: row.name, phone: row.phone });
      continue;
    }
    if (seen.has(phone)) continue;
    seen.add(phone);
    recipients.push({ name: row.name || phone, phone });
  }

  return { recipients, invalid };
}

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    return answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  let attempt = 0;
  for (;;) {
    try {
      return await client.send(command);
    } catch (error) {
      const isThrottling = error?.name === "ThrottlingException";
      if (isThrottling && attempt < THROTTLE_RETRY_DELAYS_MS.length) {
        await sleep(THROTTLE_RETRY_DELAYS_MS[attempt]);
        attempt += 1;
        continue;
      }
      throw error;
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.file) throw new Error("--file <path-to-csv> is required");
  if (!args.message) throw new Error("--message <text> is required");

  const originationIdentity = process.env.RCS_ORIGINATION_IDENTITY;
  const fallbackOriginationIdentity = process.env.RCS_FALLBACK_ORIGINATION_IDENTITY;
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;

  if (!originationIdentity) throw new Error("RCS_ORIGINATION_IDENTITY environment variable is required");
  if (!region) throw new Error("AWS_REGION (or AWS_DEFAULT_REGION) environment variable is required");

  if (!fallbackOriginationIdentity) {
    console.log(
      "RCS_FALLBACK_ORIGINATION_IDENTITY is not set — sending RCS-only. Recipients whose device/carrier doesn't support RCS will not receive this message.",
    );
  }

  const { recipients, invalid } = readRecipients(args.file);

  if (invalid.length) {
    console.log(`Skipping ${invalid.length} row(s) with an invalid phone number (must be E.164, e.g. +18175551234):`);
    invalid.forEach((row) => console.log(`  - ${row.name || "(no name)"}: ${row.phone}`));
  }

  if (recipients.length === 0) {
    console.log("No valid recipients found. Nothing to send.");
    return;
  }

  console.log(`\nMessage:\n${args.message}\n`);
  console.log(`${recipients.length} recipient(s):`);
  recipients.forEach((r) => console.log(`  - ${r.name}: ${r.phone}`));

  if (args.dryRun) {
    console.log("\n--dry-run set: validating with AWS but not delivering to recipients.");
  }

  if (!args.dryRun && !args.yes) {
    const confirmed = await confirm(`\nSend this message to ${recipients.length} recipient(s)? Type "yes" to continue: `);
    if (!confirmed) {
      console.log("Aborted.");
      return;
    }
  }

  const client = new PinpointSMSVoiceV2Client({ region });
  const results = { sent: [], failed: [] };

  for (const recipient of recipients) {
    try {
      const response = await sendOne(
        client,
        { originationIdentity, fallbackOriginationIdentity, message: args.message, dryRun: args.dryRun },
        recipient,
      );
      results.sent.push(recipient);
      console.log(`sent -> ${recipient.name} (${recipient.phone}) messageId=${response.MessageId}`);
    } catch (error) {
      results.failed.push(recipient);
      console.log(`FAILED -> ${recipient.name} (${recipient.phone}): ${error?.name || "Error"}: ${error?.message || error}`);
    }
  }

  console.log("\n--- Summary ---");
  console.log(`${results.sent.length} sent, ${results.failed.length} failed, ${invalid.length} skipped (invalid phone).`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
