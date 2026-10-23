const TOKEN_LIFETIME_MS = 50 * 60 * 1000;

export type ApnsCredentials = {
  readonly keyId: string;
  readonly teamId: string;
  readonly privateKeyPem: string;
};

function base64Url(bytes: Uint8Array | string): string {
  return Buffer.from(bytes).toString("base64url");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(Buffer.from(body, "base64")).buffer;
}

export async function signApnsToken(credentials: ApnsCredentials, issuedAtSeconds: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(credentials.privateKeyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: credentials.keyId }));
  const claims = base64Url(JSON.stringify({ iss: credentials.teamId, iat: issuedAtSeconds }));
  const signingInput = `${header}.${claims}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

export function createTokenCache(credentials: ApnsCredentials, now: () => number = Date.now): () => Promise<string> {
  let cached: { readonly token: string; readonly expiresAt: number } | null = null;
  return async () => {
    const at = now();
    if (cached && cached.expiresAt > at) {
      return cached.token;
    }
    const token = await signApnsToken(credentials, Math.floor(at / 1000));
    cached = { token, expiresAt: at + TOKEN_LIFETIME_MS };
    return token;
  };
}
