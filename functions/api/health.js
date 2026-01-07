export async function onRequest(context) {
  return new Response(
    JSON.stringify({ 
      status: 'ok', 
      message: 'Server is running and healthy.' 
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    }
  );
}
