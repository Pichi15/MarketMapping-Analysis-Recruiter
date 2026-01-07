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

async function scrapeUrl(profileUrl) {
  // Validate URL format
  let parsedUrl;
  try {
    parsedUrl = new URL(profileUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Invalid URL protocol. Use http or https.');
    }
  } catch (e) {
    throw new Error('Invalid URL format.');
  }

  const response = await fetch(profileUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL. Status: ${response.status}`);
  }

  const html = await response.text();

  // Basic text extraction from HTML
  const textContent = html
    .replace(/<style[^>]*>.*?<\/style>/gs, '')
    .replace(/<script[^>]*>.*?<\/script>/gs, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s\s+/g, ' ')
    .trim();

  if (textContent.length < 100) {
    throw new Error('Could not extract meaningful content from URL. The page may require authentication or block scraping.');
  }

  return textContent.substring(0, 10000); // Limit content length
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
    const { profileUrl } = body;

    if (!profileUrl) {
      return new Response(JSON.stringify({ error: 'Profile URL is required.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const textContent = await scrapeUrl(profileUrl);
    const message = await generateOutreach(textContent, env);

    return new Response(JSON.stringify({ outreachMessage: message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in URL outreach:', error);
    return new Response(JSON.stringify({ error: 'Failed to generate message from URL. ' + (error.message || '') }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
