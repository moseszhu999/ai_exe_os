# TrainingOS Course Design Capability Pilot v1

Status: compile-only cross-repository contract pilot

## Purpose

Prove that the newly merged `capability.knowledge.manifest.v1` compiler can consume real, already-merged TrainingOS AgentSkill identities and a currently proven TrainingOS MCP read tool without inventing runtime capability.

This is the first concrete bridge:

```text
TrainingOS ProfessionalRole / Job context
+ merged AgentSkills
+ current TrainingOS MCP read surface
+ source/freshness policy
→ ai_exe_os Capability Knowledge Compiler
→ immutable CapabilityVersion metadata
```

It deliberately stops before installation, Agent grant, Human Gate execution, MCP reachability testing, or business action.

## Current truth used by v1

TrainingOS already merged these AgentSkills:

```text
training-learning-outcomes@1.0.0
training-course-alignment@1.0.0
training-assessment-plan@1.0.0
```

TrainingOS current canonical Chat Exercise MCP main advertises:

```text
get_class_learning_structure
serverInfo.version = 0.5.1
```

Therefore the pilot manifest declares only:

```text
mcp: trainingos.mcp >= 0.5.1
observe: get_class_learning_structure
```

It does **not** declare `get_course_design_context`, because that bounded tool is still owned by TrainingOS PR #589 and has not yet entered TrainingOS main.

A PR, branch, Skill document, architecture note, or planned tool name is not runtime availability evidence.

## Draft, not install-ready

The immutable CapabilityVersion produced by this pilot has:

```text
status = draft
humanGatePolicy = never
tool grants = observe only
internalWrite = []
externalAction = []
```

`draft` is deliberate. It prevents this compile-only pilot from being represented as an install-ready capability before cross-repository runtime binding and MCP availability are proven.

## Identity boundary

```text
ProfessionalRole / Job != LearningSkill != AgentSkill
```

The manifest uses `agentSkillRefs` only.

It does not use TrainingOS `competencies.id` values as AgentSkill identities, does not read or mutate Student-Skill mastery state, and does not introduce an ambiguous `skillRefs` field.

## Knowledge boundary

The pilot uses repository-owned source references:

```text
trainingos-agent-skill-pilot-v1
trainingos-industry-role-pack-foundation-v1
```

with `review-release` freshness and `blockWhenReviewRequired=true`.

The compiler may therefore reject compilation when those declared knowledge sources are not execution-ready, without granting or revoking runtime Agent authority.

## Evidence contract

The draft version requires future evidence identifiers for:

```text
trainingos-learning-structure-snapshot
agent-skill-trace
source-provenance
```

These are evidence requirements, not proof that evidence already exists.

## Fail-closed pending-tool test

The pilot test deliberately mutates a copy of the manifest to add:

```text
get_course_design_context
```

while the supplied current-main MCP catalog contains only:

```text
get_class_learning_structure
```

Compilation must fail with the undeclared/unavailable MCP-tool boundary.

When TrainingOS #589 eventually merges and a later exact runtime check proves the new tool is advertised under the canonical MCP server, a future manifest version may explicitly add it. That must be a versioned capability change, not a silent catalog mutation.

## No execution authority

This pilot adds none of:

```text
CapabilityInstallation
AgentCapabilityGrant
Workspace binding
Task start
Human Gate approval
provider target
allowedTargets
scheduler decision
MCP network call
canonical TrainingOS write
Production execution
```

The compiler remains metadata/policy compilation over the existing AI Execution OS authority model.

## Acceptance

The pilot is accepted only when tests prove:

1. the real manifest compiles through the merged compiler;
2. output remains `status=draft`;
3. all three versioned AgentSkill refs are preserved;
4. `recommendedGrantActions` contains only the current read tool;
5. no draft/internalWrite/externalAction MCP grant exists;
6. pending `get_course_design_context` fails against the current MCP catalog;
7. review-required knowledge blocks compilation;
8. no provider contract or UI resource is claimed.

## Next version

After TrainingOS Course Design MCP Read v1 enters main and exact runtime discovery proves `get_course_design_context` is actually advertised and authorized, prepare a new capability version rather than editing v1 in place.

That later version may expand the observe set, but it must still remain read/draft-only until a separately reviewed proposal-write contract maps onto TrainingOS Content Factory revision/teacher-review/freeze semantics.
