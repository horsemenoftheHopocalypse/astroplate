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
