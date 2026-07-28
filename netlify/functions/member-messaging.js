import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { PinpointSMSVoiceV2Client, SendTextMessageCommand } from "@aws-sdk/client-pinpoint-sms-voice-v2";
import { randomUUID } from "node:crypto";
import { authenticate } from "./lib/message-auth.js";
import {
  CONFIGURATION_SET_NAME,
  resolveAwsCredentials,
} from "./lib/message-config.js";

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
