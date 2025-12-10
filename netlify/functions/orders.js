import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  Environment,
  LogLevel,
  OrdersController,
} from "@paypal/paypal-server-sdk";

const { PUBLIC_PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = process.env;

const client = new Client({
  clientCredentialsAuthCredentials: {
    oAuthClientId: PUBLIC_PAYPAL_CLIENT_ID,
    oAuthClientSecret: PAYPAL_CLIENT_SECRET,
  },
  timeout: 0,
  environment: Environment.Sandbox,
  logging: {
    logLevel: LogLevel.Info,
    logRequest: {
      logBody: true,
    },
    logResponse: {
      logHeaders: true,
    },
  },
});

const ordersController = new OrdersController(client);

/**
 * Create an order to start the transaction.
 * @see https://developer.paypal.com/docs/api/orders/v2/#orders_create
 */
const createOrder = async (cart) => {
  const collect = {
    body: {
      intent: CheckoutPaymentIntent.Capture,
      purchaseUnits: [
        {
          amount: {
            currencyCode: "USD",
            value: "100.00",
          },
        },
      ],
    },
    prefer: "return=minimal",
  };

  const { body, ...httpResponse } = await ordersController.createOrder(
    collect
  );
  return {
    jsonResponse: JSON.parse(body),
    httpStatusCode: httpResponse.statusCode,
  };
};

/**
 * Capture payment for an order.
 * @see https://developer.paypal.com/docs/api/orders/v2/#orders_capture
 */
const captureOrder = async (orderID) => {
  const collect = {
    id: orderID,
    prefer: "return=minimal",
  };

  const { body, ...httpResponse } = await ordersController.captureOrder(
    collect
  );

  const responseData = typeof body === 'string' ? JSON.parse(body) : body;

  return {
    jsonResponse: responseData,
    httpStatusCode: httpResponse.statusCode,
  };
};

export const handler = async (event) => {
  // Handle CORS
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  // Handle preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers,
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    console.log("Event path:", event.path);

    // Check if this is a capture request: /.netlify/functions/orders/{orderID}/capture
    const pathParts = event.path.split("/").filter(p => p);
    const isCaptureRequest = pathParts[pathParts.length - 1] === "capture";

    if (isCaptureRequest) {
      // Extract orderID: path is like /.netlify/functions/orders/{orderID}/capture
      const orderID = pathParts[pathParts.length - 2];
      console.log("Capturing order:", orderID);

      if (!orderID || orderID === "orders") {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Order ID is required", path: event.path }),
        };
      }

      const { jsonResponse, httpStatusCode } = await captureOrder(orderID);

      return {
        statusCode: httpStatusCode,
        headers,
        body: JSON.stringify(jsonResponse),
      };
    } else {
      // Create order
      console.log("Creating order");
      const { cart } = JSON.parse(event.body || "{}");
      const { jsonResponse, httpStatusCode } = await createOrder(cart);

      return {
        statusCode: httpStatusCode,
        headers,
        body: JSON.stringify(jsonResponse),
      };
    }
  } catch (error) {
    console.error("PayPal API error:", error);

    if (error instanceof ApiError) {
      return {
        statusCode: error.statusCode || 500,
        headers,
        body: JSON.stringify({ error: error.message }),
      };
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to process PayPal request" }),
    };
  }
};
