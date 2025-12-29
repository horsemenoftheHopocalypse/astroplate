export const handler = async (event) => {
  console.log('Test function called');

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: 'Test function works',
      context: process.env.CONTEXT,
      hasPayPalId: !!process.env.PUBLIC_PAYPAL_CLIENT_ID
    }),
  };
};
