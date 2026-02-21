# Polymarket Autopilot

An n8n-style visual automation tool for [Polymarket](https://polymarket.com). Build event-driven trading pipelines by wiring together nodes in a directed graph — fetch data, run analysis, and execute trades automatically based on configurable decision logic.

## How it works

Users create **Blueprints** — directed acyclic graphs of nodes that produce, transform, and consume events over NATS. Each blueprint terminates in a **decision node** that evaluates inputs from upstream nodes and outputs a trading signal (buy/sell).

When a blueprint is dispatched, the system instantiates a live **Redprint** — resolving the graph, wiring up NATS subjects, and streaming events through the pipeline in real time.

## `@repo/blueprint` — Shared type system

The `packages/blueprint` package is the **single source of truth** for blueprint definitions, used by both the frontend and the API. It exports:

- **`BlueprintUtils.validate()`** — validates a blueprint definition (reference checks, cycle detection, decision node rules)
- **`BlueprintBuilder`** — fluent API for constructing blueprints: `.addNode(...).build()`
- **Type definitions** — `BlueprintDefinition`, `NodeDefinition`, `NodeRole`, `Decision`
- **Subject utilities** — deterministic NATS subject derivation

Validation runs on the frontend; the backend trusts the schema.

## Repository structure

```
apps/
  api/              Express API server — event-driven runtime over NATS
  web/              Next.js frontend — visual blueprint editor

packages/
  blueprint/        Shared blueprint types, validation, and builder (@repo/blueprint)
  backend/          Convex database and server functions (@repo/backend)
  ui/               Shared React component library (@repo/ui)
  eslint-config/    Shared ESLint configuration (@repo/eslint-config)
  typescript-config/ Shared TypeScript configuration (@repo/typescript-config)
```

## Development

```sh
pnpm install
pnpm dev          # starts all apps and packages
```

Requires Node.js 22+, pnpm, and a running NATS server for the API.
