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
