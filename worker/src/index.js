// Reading Mate's upload/download/delete gatekeeper in front of a private
// Backblaze B2 bucket. See the plan doc's §1 for why this exists and how
// the three routes fit together; comments here cover implementation
// details only.
//
// Every request is verified against a Firebase ID token (for /o/* writes)
// or a Worker-issued HMAC download token (for /download/* reads) — see
// verifyFirebaseIdToken() and hmacToken()/timingSafeEqual() below.

import { importX509, jwtVerify } from 'jose';

const FIREBASE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
// Confirmed current (Aug 2026) against Firebase's own docs
// (firebase.google.com/docs/auth/admin/verify-id-tokens, "Verify ID
// tokens using a third-party JWT library" section) — this is the URL
// Firebase currently points to for the public certs used to verify ID
// token signatures. It returns X.509 PEM certs keyed by `kid`, NOT a
// standard JWKS — that's why this uses jose's importX509() per-key below
// rather than createRemoteJWKSet(), which expects JWK format and won't
// parse this response correctly.

const B2_API_VERSION = 'v3';
// Confirmed current (Aug 2026) against backblaze.com/apidocs and
// backblaze.com/docs/cloud-storage-call-the-native-api — v3 is still the
// current native API version, and b2_authorize_account's response is
// still nested under `apiInfo.storageApi.{apiUrl,downloadUrl}` (not a
// flat top-level shape, which only older v1/v2 examples online show).
// getB2Auth() below assumes this nested shape. If B2 moves again, update
// B2_API_VERSION and the field path in getB2Auth() together.

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // keep in sync with uploads.js's MAX_UPLOAD_BYTES

// ---------------------------------------------------------------------------
// Firebase ID token verification
// ---------------------------------------------------------------------------

// Module-scope cache: persists across requests handled by the same
// Workers isolate, cleared whenever the isolate is recycled (Workers give
// no guarantee of durability here — that's fine, everything below falls
// back to re-fetching on a cache miss).
let certCache = null; // { raw: {kid: pem}, imported: {kid: CryptoKey}, expiresAt }

async function getFirebaseCert(kid) {
  const now = Date.now();
  if (!certCache || certCache.expiresAt < now) {
    const res = await fetch(FIREBASE_CERTS_URL);
    if (!res.ok) throw new Error(`Could not fetch Firebase certs: ${res.status}`);
    const raw = await res.json();
    const cacheControl = res.headers.get('cache-control') || '';
    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
    // Google's response tells us via Cache-Control how long these certs
    // are good for — respect that instead of a guessed TTL.
    const maxAgeMs = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) * 1000 : 60 * 60 * 1000;
    certCache = { raw, imported: {}, expiresAt: now + maxAgeMs };
  }
  if (!certCache.raw[kid]) return null;
  if (!certCache.imported[kid]) {
    certCache.imported[kid] = await importX509(certCache.raw[kid], 'RS256');
  }
  return certCache.imported[kid];
}

// Returns the verified uid (the token's `sub` claim), or throws.
async function verifyFirebaseIdToken(idToken, projectId) {
  const { payload } = await jwtVerify(
    idToken,
    async (header) => {
      const key = await getFirebaseCert(header.kid);
      if (!key) throw new Error('Unknown signing key (kid not found in Firebase certs).');
      return key;
    },
    {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ['RS256'],
    }
  );
  if (!payload.sub) throw new Error('Token missing sub claim.');
  return payload.sub;
}

// ---------------------------------------------------------------------------
// Backblaze B2 native API
// ---------------------------------------------------------------------------

let b2AuthCache = null; // { authorizationToken, apiUrl, downloadUrl, expiresAt }

async function getB2Auth(env) {
  const now = Date.now();
  if (b2AuthCache && b2AuthCache.expiresAt > now) return b2AuthCache;

  const credentials = btoa(`${env.B2_KEY_ID}:${env.B2_APPLICATION_KEY}`);
  const res = await fetch(`https://api.backblazeb2.com/b2api/${B2_API_VERSION}/b2_authorize_account`, {
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (!res.ok) throw new Error(`B2 authorize failed: ${res.status}`);
  const data = await res.json();

  // See the B2_API_VERSION comment above — this nested path is the
  // current (v3) shape. If B2's docs show a flat apiUrl/downloadUrl at
  // the top level instead when you check, use that instead.
  const { apiUrl, downloadUrl } = data.apiInfo.storageApi;

  b2AuthCache = {
    authorizationToken: data.authorizationToken,
    apiUrl,
    downloadUrl,
    // Real token is valid up to 24h; refresh a bit early to be safe.
    expiresAt: now + 23 * 60 * 60 * 1000,
  };
  return b2AuthCache;
}

async function b2Post(env, apiUrl, authToken, endpoint, body) {
  const res = await fetch(`${apiUrl}/b2api/${B2_API_VERSION}/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: authToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res;
}

// ---------------------------------------------------------------------------
// Download token (permanent, HMAC-based — see plan doc §1 for why this
// exists instead of B2's own, week-capped b2_get_download_authorization)
// ---------------------------------------------------------------------------

async function hmacToken(env, path) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.DOWNLOAD_TOKEN_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(path));
  return base64UrlEncode(new Uint8Array(sig));
}

function base64UrlEncode(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Manual constant-time compare — Web Crypto has no standard
// timingSafeEqual, and this avoids pulling in a dependency for one small
// loop. Not a critical defense at this app's scale, just good practice.
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

// Reconstructs the canonical "users/uid/sessions/.../file.ext" path from a
// request's URL pathname — the inverse of uploads.js's encodePathSegments().
// Percent-encoding is a wire-transfer detail only; everywhere in this file
// that treats "path" as an identity (the uid-prefix check, the HMAC input,
// the B2 filename) uses this canonical, decoded, literal-'/' form.
function pathFromPathname(pathname, routePrefix) {
  return pathname
    .slice(routePrefix.length)
    .split('/')
    .map(decodeURIComponent)
    .join('/');
}

// B2's filenames are a flat namespace — "/" is cosmetic (it just enables
// B2's virtual-folder UI), and B2 does not resolve ".." the way a real
// filesystem would. So a plain string prefix check here is safe: nothing
// in a crafted path can make B2 "escape" out of the caller's own
// users/{uid}/ prefix, because there's no path resolution step to abuse.
function pathBelongsToUser(path, uid) {
  return path.startsWith(`users/${uid}/`);
}

function encodeB2FileName(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function sha1Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    // 'Range' covers the preflight for handleDownload's byte-range
    // passthrough below — any cross-origin caller sending a Range header
    // triggers a preflight OPTIONS that checks this list.
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
    // Content-Range/Accept-Ranges aren't on the fetch spec's
    // cross-origin-safelisted response headers, so a caller on a
    // different origin than this Worker (e.g. a future web reader) can't
    // read them back off the Response without this — same reasoning as
    // Allow-Headers above, just for the response side of a ranged fetch.
    'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
  };
}

function jsonError(status, code, message) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function jsonOk(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function requireUid(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const idToken = authHeader.replace(/^Bearer\s+/i, '');
  if (!idToken) throw jsonError(401, 'storage/unauthorized', 'Missing Authorization header.');
  try {
    return await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID);
  } catch (err) {
    throw jsonError(401, 'storage/unauthorized', 'Invalid or expired sign-in — please try again.');
  }
}

async function handleUpload(request, env, path) {
  let uid;
  try {
    uid = await requireUid(request, env);
  } catch (errResponse) {
    return errResponse;
  }
  if (!pathBelongsToUser(path, uid)) {
    return jsonError(403, 'storage/unauthorized', 'You cannot write to that path.');
  }

  // uploads.js's uploadSessionMedia sends one of two body shapes:
  //   - raw bytes, Content-Type is the file's own mime type (photos, and
  //     any document upload where the caller already had the bytes in JS
  //     for another reason)
  //   - multipart/form-data, with a 'file' part (the picked file, handed
  //     to RN as a { uri, name, type } FormData part so RN's networking
  //     layer reads it straight off the device instead of the app ever
  //     reading it into JS) and a 'type' text field carrying the real
  //     mime type, since the multipart request's own top-level
  //     Content-Type is `multipart/form-data; boundary=...`, not the
  //     file's type.
  const requestContentType = request.headers.get('Content-Type') || 'application/octet-stream';
  let bytes;
  let contentType;
  if (requestContentType.startsWith('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') {
      return jsonError(400, 'storage/unknown', 'Missing file in upload.');
    }
    contentType = (form.get('type') || file.type || 'application/octet-stream').toString();
    bytes = new Uint8Array(await file.arrayBuffer());
  } else {
    contentType = requestContentType;
    bytes = new Uint8Array(await request.arrayBuffer());
  }

  const isAllowedType = contentType.startsWith('image/') || contentType === 'application/pdf';
  if (!isAllowedType) {
    return jsonError(415, 'storage/unauthorized', 'Only images and PDFs are supported.');
  }

  if (bytes.byteLength === 0) return jsonError(400, 'storage/unknown', 'Empty upload.');
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return jsonError(413, 'storage/unauthorized', 'File is too large.');
  }

  let b2;
  try {
    b2 = await getB2Auth(env);
  } catch (err) {
    return jsonError(502, 'storage/unknown', 'Could not reach the storage backend.');
  }

  const uploadUrlRes = await b2Post(env, b2.apiUrl, b2.authorizationToken, 'b2_get_upload_url', {
    bucketId: env.B2_BUCKET_ID,
  });
  if (!uploadUrlRes.ok) return jsonError(502, 'storage/unknown', 'Could not prepare upload.');
  const { uploadUrl, authorizationToken: uploadAuthToken } = await uploadUrlRes.json();

  const contentSha1 = await sha1Hex(bytes);

  const putRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: uploadAuthToken,
      'X-Bz-File-Name': encodeB2FileName(path),
      'Content-Type': contentType,
      'X-Bz-Content-Sha1': contentSha1,
      'Content-Length': String(bytes.byteLength),
    },
    body: bytes,
  });
  if (!putRes.ok) {
    return jsonError(502, 'storage/unknown', 'Upload to the storage backend failed.');
  }

  const downloadToken = await hmacToken(env, path);
  return jsonOk({ downloadToken });
}

async function handleDownload(request, env, path, token) {
  if (!token) return jsonError(401, 'storage/unauthorized', 'Missing token.');
  const expected = await hmacToken(env, path);
  if (!timingSafeEqual(token, expected)) {
    return jsonError(403, 'storage/unauthorized', 'Invalid token.');
  }

  let b2;
  try {
    b2 = await getB2Auth(env);
  } catch (err) {
    return jsonError(502, 'storage/unknown', 'Could not reach the storage backend.');
  }

  const fileUrl = `${b2.downloadUrl}/file/${env.B2_BUCKET_NAME}/${encodeB2FileName(path)}`;

  // Forward an incoming Range header straight through to B2 (B2's native
  // download endpoint supports byte-range requests). This matters for
  // PdfReader.js's WebView specifically: PDF.js's own networking layer
  // probes for byte-range support before deciding how to stream a
  // document, and this route used to always answer 200 with the entire
  // body no matter what — undercutting that probe and its subsequent
  // range requests alike. Passing Range through and mirroring back
  // whatever status/headers B2 answers with (206 + Content-Range, or 200)
  // is what makes this endpoint behave like a normal range-capable file
  // server instead of silently forcing whole-file downloads.
  const rangeHeader = request.headers.get('Range');
  const b2Headers = { Authorization: b2.authorizationToken };
  if (rangeHeader) b2Headers.Range = rangeHeader;

  const b2Res = await fetch(fileUrl, { headers: b2Headers });
  if (!b2Res.ok && b2Res.status !== 206) {
    return jsonError(b2Res.status === 404 ? 404 : 502, 'storage/unknown', 'Could not fetch that file.');
  }

  const headers = new Headers(corsHeaders());
  headers.set('Content-Type', b2Res.headers.get('Content-Type') || 'application/octet-stream');
  headers.set('Accept-Ranges', 'bytes');
  const contentLength = b2Res.headers.get('Content-Length');
  if (contentLength) headers.set('Content-Length', contentLength);
  const contentRange = b2Res.headers.get('Content-Range');
  if (contentRange) headers.set('Content-Range', contentRange);
  // Safe to cache aggressively — every path is unique per message and is
  // never overwritten once uploaded.
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  return new Response(b2Res.body, { status: b2Res.status, headers });
}

async function handleDelete(request, env, path) {
  let uid;
  try {
    uid = await requireUid(request, env);
  } catch (errResponse) {
    return errResponse;
  }
  if (!pathBelongsToUser(path, uid)) {
    return jsonError(403, 'storage/unauthorized', 'You cannot delete that path.');
  }

  let b2;
  try {
    b2 = await getB2Auth(env);
  } catch (err) {
    return jsonError(502, 'storage/unknown', 'Could not reach the storage backend.');
  }

  const listRes = await b2Post(env, b2.apiUrl, b2.authorizationToken, 'b2_list_file_names', {
    bucketId: env.B2_BUCKET_ID,
    startFileName: path,
    maxFileCount: 1,
  });
  if (!listRes.ok) return jsonError(502, 'storage/unknown', 'Could not reach the storage backend.');
  const { files } = await listRes.json();
  const match = files.find((f) => f.fileName === path);
  if (!match) return jsonOk({ deleted: false }); // already gone — not an error

  await b2Post(env, b2.apiUrl, b2.authorizationToken, 'b2_delete_file_version', {
    fileName: path,
    fileId: match.fileId,
  });
  return jsonOk({ deleted: true });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      if (url.pathname.startsWith('/o/') && request.method === 'PUT') {
        return await handleUpload(request, env, pathFromPathname(url.pathname, '/o/'));
      }
      if (url.pathname.startsWith('/o/') && request.method === 'DELETE') {
        return await handleDelete(request, env, pathFromPathname(url.pathname, '/o/'));
      }
      if (url.pathname.startsWith('/download/') && request.method === 'GET') {
        return await handleDownload(
          request,
          env,
          pathFromPathname(url.pathname, '/download/'),
          url.searchParams.get('token')
        );
      }
      return jsonError(404, 'storage/unknown', 'No such route.');
    } catch (err) {
      console.error(err);
      return jsonError(500, 'storage/unknown', 'Unexpected server error.');
    }
  },
};
