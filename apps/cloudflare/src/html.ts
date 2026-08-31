import type { AuthRequest, ClientInfo, GrantSummary } from "@cloudflare/workers-oauth-provider";
import type { AuthenticatedUser } from "./security.js";

const RESPONSE_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src https://avatars.githubusercontent.com data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "Content-Type": "text/html; charset=utf-8",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
} as const;

interface ConsentPageOptions {
  client: ClientInfo;
  oauthRequest: AuthRequest;
  consentState: string;
}

interface AccountPageOptions {
  user: AuthenticatedUser;
  grants: GrantSummary[];
  csrfToken: string;
  ncbiApiKeyConfigured: boolean;
  notice?: string;
}

export function renderHome(origin: string, notice?: string): Response {
  return htmlResponse(
    page(
      "Medical Research MCP",
      `<main class="shell">
        ${notice ? `<div class="notice">${escapeHtml(notice)}</div>` : ""}
        <section class="hero card">
          <span class="eyebrow">OIT · Research infrastructure</span>
          <h1>Medical literature, connected to your AI workspace.</h1>
          <p class="lead">Search PubMed, PubMed Central, Europe PMC, Crossref, and lawful open-access sources through one read-only MCP server.</p>
          <div class="actions">
            <a class="button primary" href="/login">Manage hosted account</a>
            <a class="button secondary" href="/connect">Connection instructions</a>
          </div>
        </section>
        <section class="grid">
          <article class="card"><h2>Private by default</h2><p>Anonymous MCP access is blocked. Research queries and article text are not written to application logs.</p></article>
          <article class="card"><h2>Portable</h2><p>Run it locally over stdio or deploy an independent copy into your own Cloudflare account.</p></article>
          <article class="card"><h2>Evidence first</h2><p>Results retain identifiers, provenance, licensing, and source links. The server does not bypass paywalls.</p></article>
        </section>
        <footer><span>Endpoint: <code>${escapeHtml(`${origin}/mcp`)}</code></span><span>This service supports research; it does not provide medical advice.</span></footer>
      </main>`
    )
  );
}

export function renderConnect(origin: string): Response {
  const endpoint = `${origin}/mcp`;
  return htmlResponse(
    page(
      "Connect Medical Research MCP",
      `<main class="narrow">
        <section class="card consent">
          <span class="eyebrow">MCP connection</span>
          <h1>Connect your AI workspace</h1>
          <p class="lead">Use this protected server address in your AI client's custom connector or MCP settings.</p>
          <div class="endpoint-box">
            <strong>Server URL</strong>
            <code>${escapeHtml(endpoint)}</code>
          </div>
          <ol class="steps">
            <li>Open your AI client's custom connector or MCP settings.</li>
            <li>Enter <strong>OIT Medical Research MCP</strong> as the name.</li>
            <li>Paste the server URL shown above and start the connection.</li>
            <li>Approve the authorization request when prompted.</li>
          </ol>
          <div class="permission muted">
            <strong>Why this is not a normal webpage</strong>
            <p>The <code>/mcp</code> address is a protected machine-to-machine endpoint. MCP clients use its HTTP 401 response to discover and begin OAuth securely.</p>
          </div>
          <div class="actions"><a class="button primary" href="/">Return home</a></div>
        </section>
      </main>`
    )
  );
}

export function renderConsent(options: ConsentPageOptions): Response {
  const clientName = options.client.clientName || "An MCP client";
  const scopes = options.oauthRequest.scope.length
    ? options.oauthRequest.scope.map((scope) => `<li>${escapeHtml(scopeLabel(scope))}</li>`).join("")
    : "<li>Search and retrieve medical literature</li>";
  return htmlResponse(
    page(
      "Authorize MCP client",
      `<main class="narrow">
        <section class="card consent">
          <span class="eyebrow">Authorization request</span>
          <h1>Connect ${escapeHtml(clientName)}?</h1>
          <p class="lead">This client is asking to use Medical Research MCP on your behalf.</p>
          <div class="permission">
            <strong>It will be able to:</strong>
            <ul>${scopes}</ul>
          </div>
          <div class="permission muted">
            <strong>It will not be able to:</strong>
            <ul><li>Change records at the literature providers</li><li>Require an email, password, or GitHub account</li><li>Bypass publisher access controls</li></ul>
          </div>
          <form method="post" action="/authorize?consent_state=${encodeURIComponent(options.consentState)}" class="actions right">
            <button class="button secondary" type="submit" name="decision" value="deny">Cancel</button>
            <button class="button primary" type="submit" name="decision" value="approve">Continue</button>
          </form>
          <p class="fine">Requested redirect: <code>${escapeHtml(options.oauthRequest.redirectUri)}</code></p>
        </section>
      </main>`
    ),
    200
  );
}

export function renderAuthorizationRedirect(redirectUrl: string): Response {
  let destination: URL;
  try {
    destination = new URL(redirectUrl);
  } catch {
    return renderError(
      "Invalid authorization redirect",
      "The MCP client supplied an invalid callback address."
    );
  }
  if (destination.protocol !== "https:" && destination.protocol !== "http:") {
    return renderError(
      "Invalid authorization redirect",
      "The MCP client callback must use HTTP or HTTPS."
    );
  }

  const safeDestination = escapeHtml(destination.toString());
  return htmlResponse(
    page(
      "Connection approved",
      `<main class="narrow">
        <section class="card consent">
          <span class="eyebrow">Authorization approved</span>
          <h1>Finishing your connection</h1>
          <p class="lead">You will return to your MCP client automatically.</p>
          <div class="actions"><a class="button primary" href="${safeDestination}">Finish connection</a></div>
        </section>
      </main>`,
      `<meta http-equiv="refresh" content="0;url=${safeDestination}">`
    ),
    200,
    {
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"
    }
  );
}

export function renderGitHubContinue(githubUrl: string): Response {
  return htmlResponse(
    page(
      "Continue to GitHub",
      `<main class="narrow">
        <section class="card consent">
          <span class="eyebrow">Identity verification</span>
          <h1>Continue to GitHub</h1>
          <p class="lead">Your MCP permissions are approved. GitHub will now verify which account should own this connection.</p>
          <div class="permission muted">
            <strong>Privacy note</strong>
            <p>The server reads only your public GitHub profile and discards GitHub's temporary access token after verification.</p>
          </div>
          <div class="actions"><a class="button primary" href="${escapeHtml(githubUrl)}">Sign in with GitHub</a></div>
        </section>
      </main>`
    ),
    200
  );
}

export function renderAccount(options: AccountPageOptions): Response {
  const avatar = safeAvatarUrl(options.user.avatarUrl);
  const identityLabel =
    options.user.identityProvider === "pseudonymous" ? "Private account" : "Signed in with GitHub";
  const grantCards = options.grants.length
    ? options.grants
        .map((grant) => {
          const metadata = isRecord(grant.metadata) ? grant.metadata : {};
          const clientName =
            typeof metadata.clientName === "string" ? metadata.clientName : "MCP client";
          return `<article class="grant">
            <div><h3>${escapeHtml(clientName)}</h3><p>Authorized ${escapeHtml(formatDate(grant.createdAt))}</p><p class="fine">Scopes: ${escapeHtml(grant.scope.join(", ") || "medical research")}</p></div>
            <form method="post" action="/account/grants/revoke">
              <input type="hidden" name="grant_id" value="${escapeHtml(grant.id)}">
              <input type="hidden" name="csrf_token" value="${escapeHtml(options.csrfToken)}">
              <button class="text-button" type="submit">Revoke</button>
            </form>
          </article>`;
        })
        .join("")
    : `<div class="empty"><h3>No connected MCP clients</h3><p>When you connect this server to a compatible AI client, it will appear here.</p></div>`;

  return htmlResponse(
    page(
      "Your account",
      `<main class="shell account-shell">
        <header class="account-header">
          <a class="brand" href="/">Medical Research MCP</a>
          <form method="post" action="/logout"><input type="hidden" name="csrf_token" value="${escapeHtml(options.csrfToken)}"><button class="text-button" type="submit">Sign out</button></form>
        </header>
        ${options.notice ? `<div class="notice">${escapeHtml(options.notice)}</div>` : ""}
        <section class="profile card">
          ${avatar ? `<img src="${escapeHtml(avatar)}" alt="" width="64" height="64">` : `<div class="avatar-fallback">${escapeHtml(options.user.login.slice(0, 1).toUpperCase())}</div>`}
          <div><span class="eyebrow">${identityLabel}</span><h1>${escapeHtml(options.user.displayName)}</h1><p>@${escapeHtml(options.user.login)}</p></div>
        </section>
        <section class="card settings">
          <div class="section-heading"><div><span class="eyebrow">Access</span><h2>Connected MCP clients</h2></div><span class="count">${options.grants.length}</span></div>
          <div class="grant-list">${grantCards}</div>
        </section>
        <section class="card settings">
          <div class="section-heading"><div><span class="eyebrow">Provider settings</span><h2>Personal NCBI API key</h2></div><span class="status ${options.ncbiApiKeyConfigured ? "ready" : "neutral"}">${options.ncbiApiKeyConfigured ? "Configured" : "Optional"}</span></div>
          <p class="settings-copy">PubMed and PMC work without a personal key. Adding one can provide higher NCBI request limits. The key is encrypted before storage and is never shown again.</p>
          <form method="post" action="/account/settings/ncbi" class="provider-form">
            <input type="hidden" name="csrf_token" value="${escapeHtml(options.csrfToken)}">
            <label for="ncbi-api-key">NCBI API key</label>
            <input id="ncbi-api-key" name="api_key" type="password" minlength="8" maxlength="128" pattern="[A-Za-z0-9_-]+" autocomplete="off" placeholder="Paste a new key to replace the current one">
            <div class="actions compact">
              <button class="button primary" type="submit" name="action" value="save">Save encrypted key</button>
              ${options.ncbiApiKeyConfigured ? `<button class="button secondary" type="submit" name="action" value="clear">Remove key</button>` : ""}
            </div>
          </form>
        </section>
        <section class="grid sources">
          <article class="card"><span class="status ready">Ready</span><h2>PubMed &amp; PMC</h2><p>Available without personal credentials. A personal NCBI API key can be stored above for higher request limits.</p></article>
          <article class="card"><span class="status ready">Ready</span><h2>Europe PMC</h2><p>Search, abstracts, identifiers, citations, and lawful open full text where available.</p></article>
          <article class="card"><span class="status ready">Ready</span><h2>Crossref &amp; Unpaywall</h2><p>DOI metadata and lawful open-access resolution are enabled for every signed-in user.</p></article>
        </section>
        <section class="card danger-zone">
          <span class="eyebrow">Account data</span><h2>Delete hosted account data</h2>
          <p>This revokes every connected MCP client, removes encrypted provider settings, and signs you out. Pseudonymous usage events do not store your account name or raw account ID and expire automatically after three months.</p>
          <form method="post" action="/account/delete" class="provider-form">
            <input type="hidden" name="csrf_token" value="${escapeHtml(options.csrfToken)}">
            <label for="delete-confirmation">Type <strong>${escapeHtml(options.user.login)}</strong> to confirm</label>
            <input id="delete-confirmation" name="confirmation" type="text" autocomplete="off" required>
            <div class="actions compact"><button class="button danger" type="submit">Delete account data</button></div>
          </form>
        </section>
      </main>`
    )
  );
}

export function renderError(title: string, message: string, status = 400): Response {
  return htmlResponse(
    page(
      title,
      `<main class="narrow"><section class="card consent"><span class="eyebrow">Request could not be completed</span><h1>${escapeHtml(title)}</h1><p class="lead">${escapeHtml(message)}</p><div class="actions"><a class="button primary" href="/">Return home</a></div></section></main>`
    ),
    status
  );
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function htmlResponse(body: string, status = 200, extraHeaders?: HeadersInit): Response {
  return new Response(body, {
    status,
    headers: { ...RESPONSE_HEADERS, ...extraHeaders }
  });
}

function page(title: string, content: string, head = ""): string {
  return `<!doctype html>
  <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${head}<title>${escapeHtml(title)} · OIT</title><style>${styles}</style></head><body>${content}</body></html>`;
}

function scopeLabel(scope: string): string {
  return scope === "mcp:research" ? "Search and retrieve medical literature" : scope;
}

function safeAvatarUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "avatars.githubusercontent.com"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function formatDate(timestamp: number): string {
  const milliseconds = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(milliseconds));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const styles = `
  :root{color-scheme:light;--ink:#17231d;--muted:#647169;--paper:#f5f7f2;--card:#fff;--line:#dfe5dd;--green:#176b4d;--green-dark:#0d5139;--mint:#dff4e9;--shadow:0 18px 50px rgba(23,35,29,.08)}
  *{box-sizing:border-box} body{margin:0;background:radial-gradient(circle at top left,#e4f2e9 0,transparent 38rem),var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.55} a{color:inherit} code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.88em;overflow-wrap:anywhere}
  .shell{width:min(1120px,calc(100% - 2rem));margin:0 auto;padding:5rem 0 2rem}.narrow{width:min(680px,calc(100% - 2rem));margin:0 auto;padding:6rem 0}.card{background:rgba(255,255,255,.94);border:1px solid var(--line);border-radius:22px;box-shadow:var(--shadow)}.hero{padding:clamp(2rem,6vw,5rem);max-width:960px}.hero h1,.consent h1,.profile h1{font-family:Georgia,"Times New Roman",serif;font-weight:500;letter-spacing:-.035em;line-height:1.05;margin:.75rem 0 1.25rem}.hero h1{font-size:clamp(2.7rem,7vw,5.8rem);max-width:13ch}.lead{font-size:clamp(1.05rem,2vw,1.3rem);color:var(--muted);max-width:62ch}.eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:.74rem;font-weight:750;color:var(--green)}
  .actions{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:2rem}.actions.right{justify-content:flex-end}.button{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:.72rem 1.15rem;border-radius:999px;border:1px solid transparent;text-decoration:none;font:inherit;font-weight:700;cursor:pointer}.primary{background:var(--green);color:#fff}.primary:hover{background:var(--green-dark)}.secondary{background:#fff;border-color:var(--line);color:var(--ink)}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-top:1rem}.grid .card{padding:1.5rem}.grid h2,.settings h2{font-size:1.12rem;margin:.45rem 0}.grid p{color:var(--muted);margin:.3rem 0}footer{display:flex;justify-content:space-between;gap:1rem;color:var(--muted);font-size:.86rem;padding:1.5rem .2rem}
  .consent{padding:clamp(1.5rem,5vw,3rem)}.consent h1{font-size:clamp(2rem,6vw,3.2rem)}.permission{border:1px solid var(--line);border-radius:14px;padding:1rem 1.2rem;margin-top:1rem}.permission ul{margin:.55rem 0 0;padding-left:1.25rem}.permission.muted{background:#fafbf9;color:var(--muted)}.fine{font-size:.78rem;color:var(--muted);overflow-wrap:anywhere}
  .endpoint-box{display:grid;gap:.45rem;margin-top:1.5rem;padding:1rem 1.2rem;border:1px solid #b9dec9;border-radius:14px;background:var(--mint)}.endpoint-box code{font-size:1rem;color:var(--green-dark);user-select:all}.steps{display:grid;gap:.65rem;margin:1.5rem 0;padding-left:1.4rem}.permission p{margin:.55rem 0 0}
  .account-shell{padding-top:1.5rem}.account-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:2rem}.brand{font-weight:800;text-decoration:none}.text-button{border:0;background:transparent;color:var(--green);font:inherit;font-weight:750;cursor:pointer;padding:.4rem}.profile{display:flex;align-items:center;gap:1.25rem;padding:2rem}.profile img,.avatar-fallback{border-radius:50%;background:var(--mint)}.avatar-fallback{width:64px;height:64px;display:grid;place-items:center;font-size:1.5rem;font-weight:800}.profile h1{font-size:2.25rem;margin:.35rem 0 .1rem}.profile p{margin:0;color:var(--muted)}.settings{padding:2rem;margin-top:1rem}.section-heading{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding-bottom:1rem}.count{display:grid;place-items:center;border-radius:999px;background:var(--mint);color:var(--green);width:2rem;height:2rem;font-weight:800}.grant{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1.1rem 0;border-bottom:1px solid var(--line)}.grant:last-child{border-bottom:0}.grant h3,.grant p{margin:.15rem 0}.grant p{color:var(--muted);font-size:.9rem}.empty{padding:2.5rem 0;text-align:center;color:var(--muted)}.empty h3{color:var(--ink)}.status{display:inline-block;border-radius:999px;padding:.2rem .55rem;font-size:.72rem;font-weight:800}.status.ready{background:var(--mint);color:var(--green)}.status.neutral{background:#edf0ec;color:var(--muted)}.notice{background:var(--mint);border:1px solid #b9dec9;color:var(--green-dark);padding:.8rem 1rem;border-radius:12px;margin-bottom:1rem}.settings-copy{color:var(--muted);max-width:70ch}.provider-form{display:grid;gap:.6rem;margin-top:1.25rem;max-width:720px}.provider-form label{font-weight:700}.provider-form input[type="password"],.provider-form input[type="text"]{width:100%;border:1px solid var(--line);border-radius:12px;background:#fff;color:var(--ink);font:inherit;padding:.8rem .9rem}.actions.compact{margin-top:.4rem}.danger-zone{padding:2rem;margin-top:1rem;border-color:#e7c9c5}.danger-zone h2{margin:.45rem 0}.danger-zone p{color:var(--muted);max-width:75ch}.button.danger{background:#9b2c24;color:#fff}.button.danger:hover{background:#7d211b}
  @media(max-width:760px){.shell{padding-top:2rem}.narrow{padding-top:2rem}.grid{grid-template-columns:1fr}footer{flex-direction:column}.hero{padding:2rem}.actions.right{justify-content:stretch}.actions.right .button{flex:1}.profile{align-items:flex-start}.grant{align-items:flex-start}.account-header{margin-bottom:1rem}}
`;
