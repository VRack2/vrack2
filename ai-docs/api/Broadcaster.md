# vrack2.Broadcaster

Named broadcast channels for connected provider clients. A broadcast sent to `a.b.c` is delivered to subscribers of `a.b.c`, `a.b` and `a` (hierarchical prefix subscription — subscribe high to avoid subscribing to many leaf channels).

## channelJoin
Subscribe the calling client to a channel.
- params: `channel` string (required) — dot-style path, e.g. `service.test`
- returns: `'success'`
- note: the subscription is bound to the authenticated client session, not just the channel string

## channelLeave
Unsubscribe the calling client from a channel.
- params: `channel` string (required)
- returns: `'success'`
