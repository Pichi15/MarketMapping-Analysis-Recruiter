import { verifyTurnstileToken, checkRateLimit, rateLimitResponse } from '../_utils.js';

const MODEL = 'gpt-5.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, CF-Turnstile-Token',
};

export async function onRequest(context) {
  const { request, env } = context;

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // Check rate limit first
    const rateLimitResult = await checkRateLimit(request, env);
    if (!rateLimitResult.allowed) {
      return rateLimitResponse(rateLimitResult, corsHeaders);
    }

    // Verify Turnstile token
    const turnstileToken = request.headers.get('CF-Turnstile-Token');
    const verification = await verifyTurnstileToken(turnstileToken, env);
    
    if (!verification.success) {
      return new Response(JSON.stringify({ error: verification.error || 'Security verification failed' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json();
    const { query } = body;

    if (!query) {
      return new Response(JSON.stringify({ error: 'Query is required.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const systemPrompt = `You are a specialized Market Intelligence Assistant for the Malaysian tech talent landscape. Your knowledge base includes real-time salary trends, competitor hiring activities, and talent pool analysis. Your primary user is a recruiter from Deriv. Answer queries with concise, actionable, and data-driven insights. If you don't have the exact data, provide a well-reasoned estimate or suggest where to find it.`;

    const response = await fetch(`${env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query }
        ],
        max_completion_tokens: 1500,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json();

    return new Response(JSON.stringify({ chatResponse: data.choices[0].message.content }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error calling OpenAI API for chat:', error);
    return new Response(JSON.stringify({ error: 'Failed to get market intelligence. ' + (error.message || '') }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
