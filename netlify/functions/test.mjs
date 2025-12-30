export const handler = async (event) => {
  console.log('Test function called');

  let sdkStatus = 'not tested';
  let fsStatus = 'not tested';
  let pathStatus = 'not tested';
  let paypalClientStatus = 'not tested';

  // Test SDK import (just confirms SDK is available, not which env is being used)
  try {
    const { Environment } = await import("@paypal/paypal-server-sdk");
    sdkStatus = `SDK imported successfully (enum exists but doesn't indicate active environment)`;
  } catch (error) {
    sdkStatus = `failed: ${error.message}`;
  }

  // Test actual PayPal client initialization to see which environment would be used
  try {
    const { Client, Environment } = await import("@paypal/paypal-server-sdk");
    const { PUBLIC_PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV } = process.env;

    if (!PUBLIC_PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
      paypalClientStatus = 'Missing credentials - cannot initialize';
    } else {
      const isProduction = PAYPAL_ENV === 'Production';
      const paypalEnvironment = isProduction ? Environment.Production : Environment.Sandbox;
      const baseUrl = isProduction ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

      paypalClientStatus = `Would initialize with: ${PAYPAL_ENV || 'Sandbox (default)'} → ${baseUrl}`;
    }
  } catch (error) {
    paypalClientStatus = `failed: ${error.message}`;
  }

  try {
    const { readFileSync } = await import("fs");
    const { cwd } = await import("process");
    const { join } = await import("path");

    const testPath = join(cwd(), "src/config/memberships.json");
    readFileSync(testPath, "utf-8");
    fsStatus = `success - found at ${testPath}`;
  } catch (error) {
    fsStatus = `failed: ${error.message}`;
  }

  try {
    const { cwd } = await import("process");
    pathStatus = `cwd: ${cwd()}`;
  } catch (error) {
    pathStatus = `failed: ${error.message}`;
  }

  // Determine deployment type
  const context = process.env.CONTEXT;
  let deploymentType;
  switch(context) {
    case 'production':
      deploymentType = 'Production Build';
      break;
    case 'deploy-preview':
      deploymentType = 'Deploy Preview';
      break;
    case 'branch-deploy':
      deploymentType = 'Branch Deploy';
      break;
    case 'dev':
      deploymentType = 'Local Development';
      break;
    default:
      deploymentType = context ? `Unknown (${context})` : 'Not Set';
  }

  // Get all environment variables to see what's actually available
  const allEnvVars = Object.keys(process.env).reduce((acc, key) => {
    // Mask sensitive values
    if (key.includes('SECRET') || key.includes('KEY') || key.includes('PASSWORD')) {
      acc[key] = '[MASKED]';
    } else if (key.includes('CLIENT_ID')) {
      acc[key] = process.env[key] ? `${process.env[key].substring(0, 10)}...` : '';
    } else {
      acc[key] = process.env[key];
    }
    return acc;
  }, {});

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: 'Test function works',
      deploymentType,
      note: 'CONTEXT and PAYPAL_ENV are NOT SET - netlify.toml [context.*.environment] vars are build-time only',
      solution: 'Set PAYPAL_ENV in Netlify UI: Site settings > Environment variables',
      environmentVariables: {
        CONTEXT: process.env.CONTEXT || 'NOT SET',
        PAYPAL_ENV: process.env.PAYPAL_ENV || 'NOT SET',
        NODE_VERSION: process.env.NODE_VERSION || 'NOT SET',
        NODE_ENV: process.env.NODE_ENV || 'NOT SET',
      },
      paypalCredentials: {
        hasClientId: !!process.env.PUBLIC_PAYPAL_CLIENT_ID,
        clientIdPreview: process.env.PUBLIC_PAYPAL_CLIENT_ID ?
          `${process.env.PUBLIC_PAYPAL_CLIENT_ID.substring(0, 10)}...` : 'NOT SET',
        hasSecret: !!process.env.PAYPAL_CLIENT_SECRET,
      },
      diagnostics: {
        sdkStatus,
        paypalClientStatus,
        fsStatus,
        pathStatus
      },
      allAvailableEnvVars: allEnvVars
    }, null, 2),
  };
};
