import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  Environment,
  LogLevel,
  OrdersController,
} from "@paypal/paypal-server-sdk";
import { readFileSync } from "fs";
import { join } from "path";
import { cwd } from "process";

console.log('=== ORDERS MODULE LOADED ===');

let membershipsData, eventsData, priceMap, client, ordersController;

function initializePayPal() {
  if (client) return; // Already initialized

  try {
    console.log('Initializing PayPal...');
    console.log('cwd:', cwd());

    // Try multiple path strategies - in Netlify deployment, files may be in dist or root
    const possiblePaths = [
      join(cwd(), "src/config/memberships.json"),
      join(cwd(), "../../src/config/memberships.json"),
    ];

    let membershipsPath;
    let eventsPath;

    // Find the correct path
    for (const path of possiblePaths) {
      try {
        readFileSync(path, "utf-8");
        membershipsPath = path;
        eventsPath = path.replace("memberships.json", "events.json");
        console.log(`Found files at: ${path}`);
        break;
      } catch (error) {
        console.log(`Path not found: ${path}`);
        continue;
      }
    }

    if (!membershipsPath) {
      throw new Error(`Could not find memberships.json. Tried paths: ${possiblePaths.join(', ')}. cwd: ${cwd()}`);
    }

    console.log('Loading memberships from:', membershipsPath);
    console.log('Loading events from:', eventsPath);

    membershipsData = JSON.parse(
      readFileSync(membershipsPath, "utf-8")
    );
    eventsData = JSON.parse(
      readFileSync(eventsPath, "utf-8")
    );

    const { PUBLIC_PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV } = process.env;

    // Validate credentials are present
    if (!PUBLIC_PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
      throw new Error('Missing PayPal credentials');
    }

    // Determine PayPal environment from PAYPAL_ENV variable
    // Defaults to Sandbox if not set (for local development)
    const isProduction = PAYPAL_ENV === 'Production';
    const paypalEnvironment = isProduction ? Environment.Production : Environment.Sandbox;
    const paypalBaseUrl = isProduction ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

    console.log(`PayPal Environment: ${PAYPAL_ENV || 'Sandbox (default)'} (${paypalBaseUrl})`);

    // Create a price lookup map
    priceMap = new Map();

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

    client = new Client({
      clientCredentialsAuthCredentials: {
        oAuthClientId: PUBLIC_PAYPAL_CLIENT_ID,
        oAuthClientSecret: PAYPAL_CLIENT_SECRET,
      },
      timeout: 0,
      environment: paypalEnvironment,
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

    ordersController = new OrdersController(client);
    console.log('PayPal initialized successfully');
  } catch (error) {
    console.error('Failed to initialize PayPal:', error);
    throw error;
  }
}

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
  const debugInfo = {
    context: process.env.CONTEXT,
    hasClientId: !!process.env.PUBLIC_PAYPAL_CLIENT_ID,
    hasSecret: !!process.env.PAYPAL_CLIENT_SECRET,
    timestamp: new Date().toISOString()
  };

  try {
    console.log('Handler invoked');

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

    // Initialize PayPal on first request
    initializePayPal();

    debugInfo.environment = process.env.PAYPAL_ENV || 'Sandbox (default)';
    debugInfo.path = event.path;

    // Check if this is a capture request: /.netlify/functions/orders/{orderID}/capture
    const pathParts = event.path.split("/").filter(p => p);
    const isCaptureRequest = pathParts[pathParts.length - 1] === "capture";

    if (isCaptureRequest) {
      // Extract orderID: path is like /.netlify/functions/orders/{orderID}/capture
      const orderID = pathParts[pathParts.length - 2];
      debugInfo.action = 'capture';
      debugInfo.orderId = orderID;

      if (!orderID || orderID === "orders") {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Order ID is required", path: event.path, debug: debugInfo }),
        };
      }

      const { jsonResponse, httpStatusCode } = await captureOrder(orderID);

      const response = typeof jsonResponse === 'object' ? { ...jsonResponse, debug: debugInfo } : { result: jsonResponse, debug: debugInfo };
      return {
        statusCode: httpStatusCode,
        headers,
        body: JSON.stringify(response),
      };
    } else {
      // Create order
      debugInfo.action = 'create';
      const { cart } = JSON.parse(event.body || "{}");
      const { jsonResponse, httpStatusCode } = await createOrder(cart);

      const response = typeof jsonResponse === 'object' ? { ...jsonResponse, debug: debugInfo } : { result: jsonResponse, debug: debugInfo };
      return {
        statusCode: httpStatusCode,
        headers,
        body: JSON.stringify(response),
      };
    }
  } catch (error) {
    debugInfo.error = error.message;
    debugInfo.errorType = error.constructor.name;

    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json",
    };

    if (error instanceof ApiError) {
      return {
        statusCode: error.statusCode || 500,
        headers,
        body: JSON.stringify({ error: error.message, debug: debugInfo }),
      };
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Failed to process PayPal request",
        message: error.message,
        type: error.constructor.name,
        debug: debugInfo
      }),
    };
  }
};
