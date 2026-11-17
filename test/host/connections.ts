// Copied from the kit (tests/connections.ts at kit main 1713f6a): an assistant's whole OAuth
// connection to a running app, made the way a host makes one: register, approve on the consent
// screen with a chosen access, exchange the code with PKCE.
export async function approveInBrowser(authorizationURL: string, options: {
  access?: { sources?: string[] | null; write?: boolean };
  cookie?: string;
  fetch?: (request: Request) => Promise<Response>;
} = {}) {
  const send = options.fetch ?? ((request: Request) => fetch(request));
  const jar = new Map<string, string>();
  for (const pair of options.cookie?.split("; ").filter(Boolean) ?? []) jar.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
  const cookie = () => [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
  const remember = (response: Response) => {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      jar.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
    }
  };
  let url = new URL(authorizationURL);
  for (let hop = 0; hop < 6; hop++) {
    const response = await send(new Request(url, { redirect: "manual", headers: { cookie: cookie() } }));
    remember(response);
    const location = response.headers.get("location");
    if (!location) throw new Error(`Authorization stopped at ${url.pathname} with ${response.status}: ${await response.text()}`);
    url = new URL(location, url);
    if (url.pathname !== "/oauth/consent") continue;
    const origin = url.origin;
    const consent = await send(new Request(origin + "/api/connections/consent?consent_code=" + url.searchParams.get("consent_code"), { headers: { cookie: cookie() } }));
    const offered = await consent.json() as { client: { name: string; returnsTo: string }; sources: { label: string; items: { id: string; name: string }[] } | null };
    if (!consent.ok) throw new Error(JSON.stringify(offered));
    const answer = await send(new Request(origin + "/api/auth/oauth2/consent", {
      method: "POST", headers: { "content-type": "application/json", origin, cookie: cookie() },
      body: JSON.stringify({ accept: true, consent_code: url.searchParams.get("consent_code"), access: { sources: null, write: true, ...options.access } }),
    }));
    const body = await answer.json() as { redirectURI?: string; message?: string };
    if (!answer.ok || !body.redirectURI) throw new Error(body.message ?? `Consent failed with ${answer.status}`);
    return { offered, redirectURI: body.redirectURI, cookie: cookie() };
  }
  throw new Error("Authorization never reached the consent screen.");
}

/** A whole OAuth connection to a running app, the way an assistant makes one: register, approve, exchange. */
export async function oauthToken(origin: string, options: { name?: string; access?: { sources?: string[] | null; write?: boolean }; cookie?: string } = {}) {
  const redirect = "http://127.0.0.1:8877/callback";
  const metadata = await (await fetch(origin + "/.well-known/oauth-authorization-server")).json() as { registration_endpoint: string; authorization_endpoint: string; token_endpoint: string };
  const client = await (await fetch(metadata.registration_endpoint, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: options.name ?? "Test host", redirect_uris: [redirect], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
  })).json() as { client_id: string };
  const verifier = crypto.randomUUID() + crypto.randomUUID();
  const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url");
  const authorize = new URL(metadata.authorization_endpoint);
  authorize.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirect, response_type: "code", scope: "openid profile offline_access", state: "s", code_challenge: challenge, code_challenge_method: "S256" }).toString();
  const { redirectURI } = await approveInBrowser(authorize.href, { access: options.access, cookie: options.cookie });
  const exchanged = await fetch(metadata.token_endpoint, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: client.client_id, redirect_uri: redirect, code: new URL(redirectURI).searchParams.get("code")!, code_verifier: verifier }),
  });
  if (!exchanged.ok) throw new Error(`Token exchange failed with ${exchanged.status}`);
  return (await exchanged.json() as { access_token: string }).access_token;
}
