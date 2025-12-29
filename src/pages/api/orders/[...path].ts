export const prerender = false;

export async function POST({ request, params }) {
  try {
    const path = params.path || '';

    // Forward to Netlify function
    const functionUrl = path
      ? `http://localhost:8888/.netlify/functions/orders/${path}`
      : `http://localhost:8888/.netlify/functions/orders`;

    console.log('Proxying POST to:', functionUrl);

    const body = await request.text();
    console.log('Request body:', body);

    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
    });

    const data = await response.text();
    console.log('Response status:', response.status);
    console.log('Response data:', data);

    return new Response(data, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return new Response(JSON.stringify({ error: 'Proxy failed', details: error.message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
