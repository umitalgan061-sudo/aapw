# NextGen Networking Rules

Authoritative simulation owns gameplay state; clients may predict presentation but never authoritatively mutate remote state. Snapshot ordering is by tick and entity id, deltas require their declared base tick, and interpolation remains bounded by a finite sample history.

Reject malformed or stale packets before they enter gameplay. Network budget pressure should shed optional traffic before simulation correctness, persistence integrity or security validation is weakened.
