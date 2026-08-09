# AI as a Management Layer: Research Note for AIEXE

Date: 2026-08-09  
Scope: AIEXE as the software management/control layer for a one-person AI-native portfolio company  
Decision posture: research-backed, bounded autonomy, human-on-the-loop, domain truth remains external

## Executive conclusion

AI can credibly become a **management layer**, but the evidence does not support treating an LLM as an unconstrained digital CEO. The strongest current research supports a narrower and more useful model: a **Manager Agent / governance layer** that structures work, allocates workers, monitors execution, adapts plans, communicates exceptions, and enforces policy around a team of human and AI workers.

For AIEXE, this means the target is not "AI replaces management". The target is:

> **AIEXE becomes the Group Management Plane that observes portfolio state, proposes and executes policy-bounded management actions, delegates through explicit authority envelopes, and produces evidence for every consequential transition.**

The human owner remains responsible for strategic objectives, capital/time allocation, irreversible commitments, and exceptions outside approved policy.

## 1. What the recent research actually says

### 1.1 Manager Agent is now an explicit research problem

Masters et al. (2025), *Orchestrating Human-AI Teams: The Manager Agent as a Unifying Research Challenge* (arXiv:2510.02557), define an autonomous manager agent around five responsibilities:

1. structure ambiguous goals into task graphs;
2. allocate human and AI workers;
3. monitor progress and coordination;
4. adapt plans as constraints change;
5. maintain transparent stakeholder communication.

They explicitly frame the desired operating model as **human-on-the-loop** rather than human-in-every-step. However, their GPT-5-based evaluations show that manager agents still struggle to optimize goal completion, constraint adherence, and workflow runtime at the same time. This is an important design warning: AIEXE must represent those objectives separately and test them separately rather than assuming one scalar "success" score.

### 1.2 Company-style hierarchy can outperform flat agent collaboration

Wang et al. (2026), *OrgAgent: Organize Your Multi-Agent System like a Company* (arXiv:2604.01020), separates multi-agent work into **governance, execution, and compliance** layers. Their experiments report that hierarchical organization can outperform flatter arrangements and, in tested settings, reduce token use when tasks benefit from stable skill assignment, controlled information flow, and layered verification.

This maps unusually well to AIEXE:

- Governance -> portfolio goals, priorities, policies, authority boundaries;
- Execution -> current scheduling, workers, capability invocation and delegation;
- Compliance -> HumanGate, policy enforcement, evidence/receipts and audit.

The implication is architectural: AIEXE should add a management/governance plane **above** existing execution primitives, not replace them.

### 1.3 AI can recreate part of the value of human teamwork, but not all of it

Dell'Acqua et al. (2025/2026), *The Cybernetic Teammate* (NBER Working Paper 33641; later Organization Science), ran a pre-registered field experiment with 776 professionals at Procter & Gamble. Individuals using AI reached performance comparable to human teams without AI on the studied product innovation tasks, showing that AI can substitute for some coordination and expertise-sharing benefits.

Ju and Aral (2025), *Collaborating with AI Agents* (arXiv:2503.18238), likewise report productivity and workflow changes in human-AI teams, but performance varied by modality and team composition. The management implication is not "automate every role"; it is to route tasks according to comparative advantage and preserve explicit task/worker fit.

### 1.4 Delegation requires an accountability boundary

Ulloa et al. (2025), *Product Manager Practices for Delegating Work to Generative AI* (arXiv:2510.02504), study 885 Microsoft product managers plus telemetry and interviews. Their framing emphasizes that delegation decisions are contextual and that accountability cannot simply be transferred to a non-human actor.

For AIEXE, this argues for two distinct records:

- **management proposal / machine decision record**;
- **authority / accountability record** identifying who or what was allowed to bind the organization.

A model may generate or recommend a decision without owning the legal or organizational accountability for it.

### 1.5 Governance must be runtime infrastructure, not a policy PDF

Koch (2026), *From Governance Norms to Enforceable Controls* (arXiv:2604.05229), distinguishes governance objectives, design-time constraints, runtime mediation, and assurance feedback. The important operational point is that only observable and time-sensitive rules should become runtime guardrails; broader governance goals still need architecture, escalation and audit.

Tallam (2026), *Authorization Propagation in Multi-Agent AI Systems* (arXiv:2605.05440), argues that authorization must be treated as workflow-level infrastructure because delegation creates transitive, temporal and aggregation risks. Authorization should be evaluated at interaction boundaries before orchestration scales.

This strongly validates AIEXE's existing direction around destination-local authority, bounded delegation, HumanGate and receipts.

## 2. Professor-level synthesis: what "management" decomposes into

Management is not a single cognitive act. For an AI-native organization it should be decomposed into separate, testable functions:

| Management function | AI suitability now | AIEXE target |
|---|---|---|
| Observe state | High | Automated, evidence-backed |
| Summarize / diagnose | High with evidence constraints | Automated, uncertainty visible |
| Decompose goals into work | Medium-high | Automated proposals, graph validation |
| Allocate AI workers | Medium-high | Automated within approved capability/resource policy |
| Allocate humans | Medium | Recommend/request, do not create obligations silently |
| Monitor progress | High | Automated |
| Re-plan bounded workflows | Medium-high | Automated inside policy; escalate outside it |
| Set strategic goals | Low as final authority | Human-owned, AI-assisted |
| Change capital/time priorities across businesses | Medium as recommendation | Proposal + owner approval until proven |
| Merge/deploy/pay/delete/commit externally | Context-dependent/high consequence | Explicit authority/HumanGate |
| Resolve ambiguous ethical/legal conflict | Low as final authority | Escalation + evidence package |

The architecture therefore needs **graduated authority**, not a binary autonomous/non-autonomous switch.

## 3. Product-director synthesis: the AIEXE product thesis

### Product thesis

AIEXE should become a **Group Operating Control Plane** for a one-person company running multiple AI-native business systems.

### Primary user

The portfolio owner who currently acts as the manual coordination bus across projects.

### User problem

The bottleneck is no longer raw implementation capacity. The bottleneck is attention and management bandwidth:

- knowing the true state of every project;
- detecting duplicate work and owner conflicts;
- selecting the next bounded action;
- routing tasks to the right agent/capability;
- knowing when not to proceed;
- preserving evidence for why a management action occurred.

### Product promise

AIEXE should reduce management load from "inspect every window" to an **attention queue** containing only decisions that exceed pre-approved policy or carry meaningful uncertainty/consequence.

## 4. Target three-layer model

### Governance / Management layer

Owns:

- portfolio registry;
- project observations;
- goals, priorities and policy envelopes;
- management proposals;
- attention queue;
- resource/capability allocation policy;
- management evaluation metrics.

Does not own domain truth.

### Execution layer

Reuses AIEXE's existing primitives:

- task/execution graphs;
- workers;
- scheduling/resource locks;
- capability packages;
- delegation;
- destination-local execution authority.

### Compliance / Assurance layer

Reuses and extends:

- HumanGate;
- authorization checks and propagation;
- immutable or append-only evidence events;
- execution/delegation receipts;
- audit views and policy violation signals.

## 5. Authority model

Recommended authority classes:

### A0 — Observe

Read state, build snapshots, summarize, detect explicit inconsistencies. No external effects.

### A1 — Propose

Generate management proposals such as continue, pause, reprioritize, escalate. Proposals are non-binding.

### A2 — Execute bounded

Take reversible actions already authorized by a narrow policy envelope: schedule approved work, invoke approved capability versions, request status, run tests, collect evidence.

### A3 — Human-gated consequence

Merge, deploy, payment, destructive mutation, material external communication, new credential grants, policy widening, or domain-truth changes require an explicit authority transition.

The initial management-plane implementation should begin at A0/A1. A2 should reuse S8 delegation rather than invent a second execution channel.

## 6. Evaluation model

Do not use a single "AI manager score". Track at least:

- goal completion;
- hard-constraint adherence;
- evidence completeness;
- latency/time-to-milestone;
- resource/token/tool cost;
- avoidable human interruptions;
- false escalation rate;
- missed escalation rate;
- stale-state decisions;
- unauthorized-effect count (target: zero).

The last four are especially important for a one-person company: an AI manager is only valuable if it reduces attention load without silently increasing risk.

## 7. Research-backed design decisions for AIEXE

1. **Use hierarchy, not a flat swarm.** Domain controllers remain specialized; AIEXE coordinates them.
2. **Separate governance, execution and compliance.** Do not hide policy inside prompts.
3. **Treat project state as observed evidence, not AI-owned truth.** Each Domain OS keeps canonical ownership.
4. **Make management decisions explicit records.** A proposal needs rationale, evidence and authority state.
5. **Propagate authority with delegation.** No transitive "manager said so" privilege.
6. **Keep strategic accountability human-owned.** Human-on-the-loop is the target, not no-human governance.
7. **Evaluate management as a multi-objective system.** Completion alone is insufficient.
8. **Start read-only.** Management-plane autonomy should expand only after observed accuracy and policy performance justify it.

## 8. Sources

- Masters et al. (2025), *Orchestrating Human-AI Teams: The Manager Agent as a Unifying Research Challenge*, arXiv:2510.02557.
- Wang et al. (2026), *OrgAgent: Organize Your Multi-Agent System like a Company*, arXiv:2604.01020.
- Dell'Acqua et al. (2025), *The Cybernetic Teammate: A Field Experiment on Generative AI Reshaping Teamwork and Expertise*, NBER Working Paper 33641; Organization Science online publication 2026.
- Ju & Aral (2025), *Collaborating with AI Agents: Field Experiments on Teamwork, Productivity, and Performance*, arXiv:2503.18238.
- Ulloa et al. (2025), *Product Manager Practices for Delegating Work to Generative AI*, arXiv:2510.02504.
- Koch (2026), *From Governance Norms to Enforceable Controls*, arXiv:2604.05229.
- Tallam (2026), *Authorization Propagation in Multi-Agent AI Systems*, arXiv:2605.05440.
- Doshi & Moore (2025/2026), *Toward a Human-AI Task Tensor*, SSRN 5134721 / Handbook of Artificial Intelligence and Strategy.

## 9. Bounded conclusion

The research supports **AI management as an orchestrated control layer**, not unrestricted machine authority. AIEXE already contains many of the difficult execution and governance primitives. The missing layer is a portfolio/management model that turns those primitives into an explicit management system.
