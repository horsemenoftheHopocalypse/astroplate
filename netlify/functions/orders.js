import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  Environment,
  LogLevel,
  OrdersController,
} from "@paypal/paypal-server-sdk";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Get directory paths for ES modules
const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFilePath);

const { PUBLIC_PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = process.env;

// Load authoritative prices from JSON files
const membershipsData = JSON.parse(
  readFileSync(join(currentDir, "../../src/config/memberships.json"), "utf-8")
);
const eventsData = JSON.parse(
  readFileSync(join(currentDir, "../../src/config/events.json"), "utf-8")
);

// Create a price lookup map
const priceMap = new Map();

// Add memberships to price map
membershipsData.memberships.forEach((membership) => {
  priceMap.set(membership.name, {
    price: membership.price,
    type: "membership",
    id: membership.id,
  });
});

// Add events to price map (append " Ticket" to match cart item names)
eventsData.events.forEach((event) => {
  priceMap.set(`${event.name} Ticket`, {
    price: event.price,
    type: "event",
    id: event.id,
  });
});

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
  // Validate cart items and recalculate with server-side authoritative prices
  const validatedItems = [];
  let cartTotal = 0;

  for (const item of cart) {
    const productInfo = priceMap.get(item.name);

    if (!productInfo) {
      throw new Error(`Invalid product: ${item.name}`);
    }

    // Use server-side authoritative price, not client-provided price
    const authoritativePrice = productInfo.price;
    const quantity = parseInt(item.quantity);

    if (isNaN(quantity) || quantity < 1) {
      throw new Error(`Invalid quantity for ${item.name}`);
    }

    // Log if client tried to manipulate the price
    const clientPrice = parseFloat(item.price);
    if (Math.abs(clientPrice - authoritativePrice) > 0.01) {
      console.warn(
        `Price mismatch detected for ${item.name}. Client sent: ${clientPrice}, Server price: ${authoritativePrice}`
      );
    }

    validatedItems.push({
      name: item.name,
      quantity: quantity.toString(),
      unitAmount: {
        currencyCode: "USD",
        value: authoritativePrice.toFixed(2),
      },
    });

    cartTotal += authoritativePrice * quantity;
  }

  const items = validatedItems;

  const collect = {
    body: {
      intent: CheckoutPaymentIntent.Capture,
      purchaseUnits: [
        {
          amount: {
            currencyCode: "USD",
            value: cartTotal.toFixed(2),
            breakdown: {
              itemTotal: {
                currencyCode: "USD",
                value: cartTotal.toFixed(2),
              },
            },
          },
          items: items,
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
