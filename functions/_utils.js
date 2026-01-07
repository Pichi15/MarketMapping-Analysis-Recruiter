// Rate limiting configuration
const RATE_LIMIT_MAX_REQUESTS = 20;  // Maximum requests per window
const RATE_LIMIT_WINDOW_SECONDS = 60;  // Window size in seconds

// Rate limiting helper using Cloudflare KV
async function checkRateLimit(request, env) {
  // Skip rate limiting if KV is not configured
  if (!env.RATE_LIMIT_KV) {
    console.warn('RATE_LIMIT_KV not configured, skipping rate limiting');
    return { allowed: true };
  }

  // Get client IP from Cloudflare headers
  const clientIP = request.headers.get('CF-Connecting-IP') || 
                   request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
                   'unknown';
  
  const now = Math.floor(Date.now() / 1000);  // Current time in seconds
  const windowStart = now - RATE_LIMIT_WINDOW_SECONDS;
  const kvKey = `ratelimit:${clientIP}`;

  try {
    // Get existing request timestamps for this IP
    const existingData = await env.RATE_LIMIT_KV.get(kvKey, { type: 'json' });
    let timestamps = existingData?.timestamps || [];

    // Filter out expired timestamps (outside the sliding window)
    timestamps = timestamps.filter(ts => ts > windowStart);

    // Check if rate limit exceeded
    if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
      const oldestTimestamp = timestamps[0];
      const retryAfter = oldestTimestamp + RATE_LIMIT_WINDOW_SECONDS - now;
      
      return {
        allowed: false,
        error: 'Rate limit exceeded. Please try again later.',
        retryAfter: Math.max(1, retryAfter),
        remaining: 0
      };
    }

    // Add current timestamp and store
    timestamps.push(now);
    
    // Store with TTL slightly longer than window to ensure cleanup
    await env.RATE_LIMIT_KV.put(kvKey, JSON.stringify({ timestamps }), {
      expirationTtl: RATE_LIMIT_WINDOW_SECONDS + 10
    });

    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX_REQUESTS - timestamps.length,
      resetAt: now + RATE_LIMIT_WINDOW_SECONDS
    };

  } catch (error) {
    console.error('Rate limit check error:', error);
    // On error, allow the request but log the issue
    return { allowed: true, error: 'Rate limit check failed' };
  }
}

// Helper to create rate limit response
function rateLimitResponse(rateLimitResult, corsHeaders) {
  return new Response(JSON.stringify({ 
    error: rateLimitResult.error || 'Rate limit exceeded' 
  }), {
    status: 429,
    headers: { 
      ...corsHeaders, 
      'Content-Type': 'application/json',
      'Retry-After': String(rateLimitResult.retryAfter || 60)
    },
  });
}

// Turnstile token verification helper
async function verifyTurnstileToken(token, env) {
  // Skip Turnstile verification in local development
  if (env.TURNSTILE_SECRET_KEY === 'SKIP_FOR_LOCAL_DEV') {
    console.log('Skipping Turnstile verification for local development');
    return { success: true };
  }

  if (!token) {
    return { success: false, error: 'No Turnstile token provided' };
  }

  const secretKey = env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    console.error('TURNSTILE_SECRET_KEY not configured');
    return { success: false, error: 'Server configuration error' };
  }

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        secret: secretKey,
        response: token,
      }).toString(),
    });

    const data = await response.json();
    
    if (!data.success) {
      console.error('Turnstile verification failed:', data);
      return { success: false, error: 'Security verification failed' };
    }

    return { success: true };
  } catch (error) {
    console.error('Turnstile verification error:', error);
    return { success: false, error: 'Security verification error' };
  }
}

export { verifyTurnstileToken, checkRateLimit, rateLimitResponse };
