import { verifyTurnstileToken, checkRateLimit, rateLimitResponse } from '../_utils.js';

const MODEL = 'gpt-5.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, CF-Turnstile-Token',
};

async function generateOutreach(profileText, env) {
  const prompt = `
    As a world-class recruiter at Deriv specializing in "character-first" hiring, draft a hyper-personalized, compelling outreach message based on the following candidate profile. The tone should be authentic, avoiding corporate jargon, and focus on the candidate's unique skills, potential, and cultural fit. Reference a specific detail from their profile to show you've done your research.

    Candidate Profile:
    ---
    ${profileText}
    ---

    Generate a message that is insightful, concise, and genuinely intriguing to a top-tier candidate.
  `;

  const response = await fetch(`${env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: 'You are a world-class recruiter specializing in personalized outreach messages.' },
        { role: 'user', content: prompt }
      ],
      max_completion_tokens: 1000,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

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
    const { candidateProfile } = body;

    if (!candidateProfile) {
      return new Response(JSON.stringify({ error: 'Candidate profile text is required.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const message = await generateOutreach(candidateProfile, env);

    return new Response(JSON.stringify({ outreachMessage: message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in text outreach:', error);
    return new Response(JSON.stringify({ error: 'Failed to generate outreach message from text. ' + (error.message || '') }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
