# vrack2.Guard

Client authentication and channel encryption. Any API client must authenticate before calling other commands. After cipher auth, all traffic on the connection is encrypted: AES-256-GCM frames, `base64url(nonce || ciphertext || tag)`, per-direction sequence numbers, AAD bound to session/client/seq/direction (replay-safe).

## apiKeyAuth
Step 1: identify by API key.
- params: `key` string (required) — API key (see KeyManager apiKeyList/apiKeyAdd)
- returns:
  - plain key: `{ level, authorize: true, cipher: false }` — auth complete
  - cipher key: `{ cipher: true, verify, serverPub? }` — step 2 required; `serverPub` (PEM) present for asymmetric P-256 keys
- errors: GUARD_RATE_LIMITED (20 failed attempts per source per 60s)
- crypto: asymmetric keys derive the channel key via HKDF-SHA256 over ECDH(clientPub, serverPriv); legacy keys via HKDF-SHA256(private)

## apiPrivateAuth
Step 2 (only if apiKeyAuth returned `cipher: true`): prove possession of the secret.
- params: `frame` string (required) — GCM frame encrypting the `verify` nonce from step 1 (first inbound frame, req seq = 1)
- returns: `{ level, authorize: true, cipher: true }` — channel encrypted from now on
- errors: GUARD_DECIPHER_FAILED, GUARD_PRIVATE_VERIFICATION_FAILED, GUARD_RATE_LIMITED
