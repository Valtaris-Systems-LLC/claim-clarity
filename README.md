DualPay

A deterministic, auditable claim adjudication kernel built for multi-payer healthcare environments where every rule, calculation, and payment decision must be explainable.

⸻

Why DualPay Exists

Most claim systems can tell you what happened.

Few can tell you why it happened.

When a claim is denied, repriced, coordinated across multiple payers, or recalculated after a retroactive adjustment, operations teams often rely on screenshots, PDFs, institutional knowledge, and manual investigation to reconstruct the decision.

DualPay was designed to solve that problem.

Every adjudication produces a structured audit artifact that records:

* Inputs used
* Rules fired
* Calculation steps
* COB determinations
* Accumulator impacts
* Financial outcomes

The objective is not simply claim processing.

The objective is explainable claim processing.

⸻

What DualPay Is

DualPay is a deterministic claim adjudication engine with an operational review surface built around traceability, coordination of benefits, and auditability.

The platform combines:

* A pure-function adjudication kernel
* Multi-payer COB logic
* Structured trace generation
* Case linking and retro-recalculation workflows
* Adjudication review tooling
* Persistent audit artifacts

Every adjudication run produces both:

1. A financial outcome
2. A complete explanation of how that outcome was produced

⸻

Core Capabilities

Capability	Description	Status
Adjudication Engine	Allowed amount, deductible, copay, coinsurance, COB adjustments, OOP protection	Stable
Coordination of Benefits	Birthday rule, custodial rule, gender rule, secondary allocation strategies	Stable
Trace Generation	Structured rule firings, math steps, version pins, audit metadata	Stable
Explainability	Human-readable adjudication review and inspection workflows	Stable
State Machine	Explicit workflow transitions with guard enforcement	Stable
Case Management	Multi-claim linkage, accumulator rollups, retro-recalculation support	Stable
Persistence Layer	Claims, traces, runs, events, accumulators, cases stored in Postgres	Beta
Audit Exports	Exportable adjudication artifacts and trace data	Beta
Coverage Graph	Coverage relationship modeling and dependency visualization	Planned
Migration Cockpit	Legacy vs DualPay adjudication comparison tooling	Planned
EDI Integration	837 / 835 / 270 / 271 workflows	Planned

⸻

Key Design Principles

Deterministic Adjudication

Financial calculations are performed in integer cents.

The same claim inputs produce the same adjudication outcome and calculation path.

No floating-point drift.

No hidden calculations.

No side effects.

⸻

Structured Traceability

Traditional systems emit logs.

DualPay emits structured trace objects.

Each trace contains:

* Rule execution history
* Calculation steps
* Version metadata
* Input fingerprints
* Explanation fragments

This allows adjudication outcomes to be inspected, compared, and audited.

⸻

Pure Business Logic

The adjudication kernel contains no persistence concerns.

Business logic executes independently from storage and infrastructure layers.

Benefits:

* Easier testing
* Greater reproducibility
* Simpler audits
* Lower operational complexity

⸻

Explainability First

Every financial outcome should be explainable.

If a human reviewer cannot determine why a decision occurred, the system is incomplete.

DualPay prioritizes:

* Visibility
* Auditability
* Operational confidence

over automation that cannot be justified.

⸻

Architecture

Claim
  │
  ▼
Calculation Engine
  │
  ├── Pricing
  ├── COB Rules
  ├── Deductible Logic
  ├── Coinsurance Logic
  ├── OOP Protection
  │
  ▼
Adjudication Run
  │
  ▼
Trace Object
  │
  ├── Rule Firings
  ├── Math Steps
  ├── Version Pins
  └── Audit Metadata
  │
  ▼
Case Management
  │
  ▼
Persistence Layer

⸻

Technology Stack

Layer	Technology
Frontend	React 18
Language	TypeScript 5
Styling	Tailwind CSS + shadcn/ui
Build System	Vite
Database	PostgreSQL
Security	Row-Level Security (RLS)
Testing	Vitest
Hosting	Lovable Cloud

⸻

Current State

DualPay is not a full core-administration platform.

It is an adjudication-focused system centered on transparency, explainability, and coordination-of-benefits workflows.

Current strengths include:

* Deterministic adjudication
* COB processing
* Structured trace generation
* Audit-oriented review workflows
* Case linkage and retro-recalculation
* Multi-tenant persistence architecture

Areas still under active development include:

* Replay infrastructure
* EDI integrations
* Expanded compliance tooling
* Coverage graph modeling
* Migration tooling
* Advanced operational workflows

⸻

Testing

npm run test

The adjudication kernel includes automated tests covering:

* Fee schedule pricing
* Deductible application
* Coinsurance calculations
* Coordination of Benefits
* OOP protection
* Trace generation
* Deterministic hashing

⸻

Roadmap

Phase 1

* Authentication and authorization hardening
* Expanded audit exports
* Coverage graph modeling
* Migration cockpit

Phase 2

* EDI integrations
* Pricing and contract expansion
* NCCI and MUE support
* Prior payer normalization

Phase 3

* Workflow orchestration
* Work queues
* SLA management
* Payment processing support

Phase 4

* Member and provider experiences
* Observability platform
* Compliance hardening
* Replay infrastructure

⸻

System Philosophy

DualPay prioritizes:

* Deterministic workflows over opaque automation
* Explainability over black-box decisions
* Traceability over assumptions
* Operational visibility over hidden state
* Auditability over convenience

Every claim decision should be understandable, reproducible, and defensible.