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
