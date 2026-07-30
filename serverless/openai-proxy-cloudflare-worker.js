export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }

    if (request.method !== "POST") {
      return json({ error: "Only POST is supported." }, 405, env);
    }

    const body = await request.text();
    const upstream = env.OPENAI_BASE_URL || "https://api.openai.com/v1/chat/completions";
    const upstreamResponse = await fetch(upstream, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`
      },
      body
    });

    const text = await upstreamResponse.text();
    return new Response(text, {
      status: upstreamResponse.status,
      headers: {
        ...corsHeaders(env),
        "Content-Type": upstreamResponse.headers.get("Content-Type") || "application/json"
      }
    });
  }
};

function json(payload, status, env) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(env),
      "Content-Type": "application/json"
    }
  });
}

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}
