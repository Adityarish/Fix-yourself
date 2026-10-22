# Sync protocol

Each outbox mutation has a client-generated UUID, authenticated user, device, space, entity, operation, base version, JSON field patch, creation time, attempt count, and state. Batches are limited to 100 entries. Task creates carry the locally generated UUID, so retrying the same operation cannot create a second task.

`push_mutations(device_id, batch)` returns an ordered result per item: accepted, duplicate, forbidden, invalid, or conflict. Accepted replies include the canonical database row and version. The local acknowledgement transaction replaces that row and deletes only its matching outbox record. Permission and validation failures are kept for recovery; network errors retry after the next sync trigger.

`pull_changes(cursor, limit)` derives identity from the JWT. The server filters changes against current active membership and returns the complete accessible-space set. A client commits entity merges and the next cursor in one Dexie transaction. Realtime task and membership events only trigger this durable pull.

The RPC supports task, task-series, routine, routine-item, routine-completion, and capacity mutations. Task revisions identify fields changed after the client's base version. Disjoint patches merge; overlapping scalar fields use the accepted later patch and retain both values in `sync_conflicts`. Tombstones win over edits. Permission failures preserve a plain-text recovery draft before revoked Circle data is purged.
