# Capability Knowledge Manifest v1

Status: implementation contract

This contract adds a **knowledge / Agent Skill / MCP compilation layer** on top of the existing AI Execution OS capability domain. It does not create a second capability registry, installation model, Agent grant model, scheduler, or authorization system.

## Existing authority remains canonical

The existing domain already owns:

```text
CapabilityPackage
→ immutable CapabilityVersion
→ CapabilityInstallation
→ Workspace-scoped AgentCapabilityGrant
→ Task / Human Gate / execution / evidence
```

`capability.knowledge.manifest.v1` compiles into that model.

## Nomenclature: LearningSkill is not AgentSkill

Some owning products already use the word `Skill` for a domain concept. TrainingOS is the concrete example: its canonical learner Skill identity is a class-owned competency (`public.competencies.id`) with Unit mappings and Student-Skill state/history.

That domain object is a **LearningSkill** for this cross-product contract.

An Agent Skills open-standard workflow package (`SKILL.md` plus optional references/scripts/assets/evals) is an **AgentSkill**.

They are different identities:

```text
LearningSkill
= what a human learner is expected to know or do
= owned by TrainingOS/domain truth

AgentSkill
= reusable AI execution SOP / workflow package
= owned by the Agent Skills / capability layer
```

Rules:

- a LearningSkill ID must never be reused as an AgentSkill ID merely because both are called "Skill" in a UI;
- `agentSkillRefs` refers only to Agent Skills packages and versions;
- this manifest deliberately rejects the ambiguous legacy field name `skillRefs`;
- a future role/competency mapping may relate LearningSkills and AgentSkills, but relationship does not imply identity;
- Human and Agent evaluations may share a case or rubric while retaining separate subject identity and evidence state;
- this compiler never mutates TrainingOS learner competency/mastery state.

A future neutral mapping may look conceptually like:

```text
RoleCompetency
├── learningSkillRefs[]   # owning product/domain identifiers
├── agentSkillRefs[]      # portable Agent Skills versions
└── sharedEvalRefs[]      # optional common cases/rubrics
```

That mapping is knowledge/competency metadata, not runtime authority.

## Purpose

A manifest may describe:

- product/role references;
- versioned `agentSkillRefs`;
- MCP server dependencies;
- logical tools grouped by risk class;
- source-backed knowledge and freshness policy;
- Human Gate metadata;
- evidence/resource/provider requirements;
- optional review UI resources.

The manifest is a publication input. It is **not runtime authority**.

## Risk classes

```text
observe        read-only/live context
draft          proposal/draft creation only
internalWrite  bounded canonical SaaS write
externalAction external/public/irreversible action
```

An action may appear in exactly one class.

The compiler deliberately excludes `externalAction` entries from `recommendedGrantActions`. External action candidates require a separately explicit Agent grant and action-level Human Gate policy.

## Knowledge freshness

Knowledge metadata declares:

```text
sourceRefs
freshnessPolicy
blockWhenReviewRequired
```

If `blockWhenReviewRequired=true`, all referenced sources must have an execution-ready status supplied by the caller. Missing, stale, retired, or review-required source state fails closed.

Stable SOP knowledge belongs in AgentSkill references. Live business facts do not. Live facts must come from an approved MCP/domain tool.

## Agent Skills boundary

AgentSkills describe workflow, source-backed professional method, expected tool use, truth boundaries, and evaluation fixtures.

AgentSkill metadata must never grant runtime authority.

The compiler may verify that a declared `agentSkillId@version` exists in an approved AgentSkill catalog, but final tool permission still comes from:

1. Workspace capability installation;
2. Workspace-scoped AgentCapabilityGrant;
3. owning SaaS/domain authorization;
4. required Human Gate policy.

Installation is not a grant. A grant is not approval. Approval is not execution.

## MCP boundary

The compiler accepts an approved MCP catalog and verifies that every logical tool belongs to exactly one declared MCP dependency.

A normal capability manifest must not introduce generic unrestricted primitives such as:

```text
run_sql
execute_shell
generic_post
arbitrary_graph
```

unless a separately reviewed provider/domain contract explicitly defines a bounded version.

MCP is the capability/data plane. Durable Mission/Task/Recovery state remains owned by AI Execution OS or the owning SaaS.

## Compilation output

A successful compile returns:

```text
package
version
metadata
normalizedManifest
integrityDigest
recommendedGrantActions
externalActionCandidates
```

The compiler maps directly to the existing domain:

```text
manifest.package
→ createCapabilityPackage(...)

manifest.version + evidence/resource/provider requirements
+ manifest integrity digest
→ publishCapabilityVersion(...)
```

Knowledge/AgentSkill/MCP/UI metadata is retained as descriptive compilation metadata and must not override the existing package/version/install/grant authority model.

## Integrity

The compiler canonicalizes object keys recursively and computes:

```text
sha256(JSON.stringify(canonicalManifest))
```

The digest becomes the existing `CapabilityVersion.integrityDigest`.

## Current implementation scope

Implementation path:

```text
src/domain/capability-knowledge-compiler.cjs
```

Tests:

```text
tests/capability-knowledge-compiler.test.cjs
```

The current implementation is intentionally dependency-free and pure. Repository/AgentSkill filesystem discovery, Source Registry persistence, LearningSkill↔AgentSkill mapping, MCP connection management, UI rendering, installation, Agent grants, scheduling, and execution are separate owners.

## S6 non-overlap

The current S6 scheduling owner decides selection/ranking among already canonical-ready work. This compiler does not schedule, prioritize, start, retry, cancel, recover, or execute tasks and does not modify S6 scheduling files.

## Truth boundary

A successful manifest compile proves only that the manifest is structurally valid against the supplied catalogs/policies and can produce an immutable existing CapabilityVersion.

It does not prove:

- an AgentSkill is professionally correct;
- a LearningSkill has been learned by a human;
- Human and Agent proficiency are equivalent;
- an MCP server is reachable;
- an Agent has been granted the capability;
- a Human Gate has approved an action;
- a business action executed;
- a result or evidence artifact exists.
