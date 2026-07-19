# ADR-0008 — `XListApi` is mutation-only; discovery stays separate

Status: Accepted · 2026-07-18

## Context

`XListApi` mixed two different jobs: adding or removing an Author, and loading an Owner's Lists. The three backends could not implement discovery with equal fidelity: REST had an Owner endpoint, DOM inferred names from a mutation dialog, and GraphQL threw. That shallow interface let a backend choice change picker behavior.

## Decision

`XListApi` exposes only `addMember` and `removeMember`. Each method acts on a supplied List and Author. `GraphqlXListApi` resolves a missing Author id privately as part of its mutation.

`lists-provider` discovers the active Owner's Lists. `ListCache` keeps the Owner-qualified catalog. The picker reads that catalog; it never asks the mutation backend for Lists.

## Consequences

- The shared contract proves add, already-member, and remove across REST, DOM, and GraphQL.
- Changing a mutation backend cannot change list discovery or cross-account visibility.
- New mutation backends implement two methods; discovery work stays in its own module.
