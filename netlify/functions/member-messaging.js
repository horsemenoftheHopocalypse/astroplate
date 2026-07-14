import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_PHONE_REGEX = /^\+[1-9]\d{6,14}$/;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token",
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

  const expectedToken = process.env.MESSAGE_ADMIN_TOKEN;
  if (!expectedToken) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "MESSAGE_ADMIN_TOKEN is not configured" }),
    };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  const tokenFromBearer =
    typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : "";
  const token = tokenFromBearer || event.headers["x-admin-token"] || event.headers["X-Admin-Token"];

  if (token !== expectedToken) {
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

      const smsType = process.env.SNS_SMS_TYPE || "Transactional";
      const senderId = (process.env.SNS_SENDER_ID || "").trim();
      const messageAttributes = {
        "AWS.SNS.SMS.SMSType": {
          DataType: "String",
          StringValue: smsType,
        },
      };

      if (senderId) {
        messageAttributes["AWS.SNS.SMS.SenderID"] = {
          DataType: "String",
          StringValue: senderId,
        };
      }

      const snsClient = new SNSClient({ region });
      await Promise.all(
        recipients.map((phoneNumber) =>
          snsClient.send(
            new PublishCommand({
              PhoneNumber: phoneNumber,
              Message: message,
              MessageAttributes: messageAttributes,
            }),
          ),
        ),
      );

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          ok: true,
          channel,
          recipients: recipients.length,
          message: `SMS sent to ${recipients.length} recipients`,
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