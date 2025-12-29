export const handler = async (event) => {
  console.log('Test function called');

  let sdkStatus = 'not tested';
  let fsStatus = 'not tested';
  let pathStatus = 'not tested';

  try {
    const { Environment } = await import("@paypal/paypal-server-sdk");
    sdkStatus = `imported - has Production: ${!!Environment.Production}`;
  } catch (error) {
    sdkStatus = `failed: ${error.message}`;
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

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: 'Test function works',
      context: process.env.CONTEXT,
      hasPayPalId: !!process.env.PUBLIC_PAYPAL_CLIENT_ID,
      PayPalId: process.env.PUBLIC_PAYPAL_CLIENT_ID,
      PayPalSecred: process.env.PAYPAL_CLIENT_SECRET,
      sdkStatus,
      fsStatus,
      pathStatus
    }, null, 2),
  };
};
