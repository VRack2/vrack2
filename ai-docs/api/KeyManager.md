# vrack2.KeyManager

API key management (persisted to `keys.json`). A key has an access level (1 = admin ... 1000 = public) and optionally an asymmetric P-256 keypair for the encrypted Guard channel.

## apiKeyList
- params: none
- returns: `[{ id, name, key, level }]` — safe metadata only, never key material

## apiKeyAdd
- params: `level` number (required), `name` string (required), `description` string, `cipher` boolean (required) — generate a P-256 keypair
- returns: key record `{ id, name, description, level, key, public }` plus `private` — the one-time client private key (PEM). It is returned once and NOT stored on the server: the client must keep it.
- note: `key` (auth token) and `id` are generated; `public` (PEM) is stored and used for auth + ECDH

## apiKeyUpdate
- params: `id` (required), `name` (required), `description`
- returns: `'success'`

## apiKeyDelete
- params: `id` (required)
- returns: `'success'`

- errors: AKEYM_KEY_NOT_FOUND
- internal: `apiKey {key}` (level 0) — used by Guard to resolve a key, hidden from the public catalog
