# TrainingOS Course Design Capability v1.1

Status: compile-only immutable capability upgrade

## Purpose

Version 1.1 records a newly proven TrainingOS canonical MCP read capability without mutating the accepted v1 manifest.

```text
v1.0.0
  trainingos.mcp >= 0.5.1
  observe: get_class_learning_structure

v1.1.0
  trainingos.mcp >= 0.5.2
  observe:
    get_class_learning_structure
    get_course_design_context
```

The new tool entered TrainingOS main through the exact-validated Course Design MCP Read v1 merge. This version therefore upgrades the compile-time catalog truth only after the owning runtime repository made the tool canonical.

## Immutability rule

The v1 manifest remains unchanged.

A newly available MCP tool is represented as a new CapabilityVersion, never by silently editing the already accepted v1 file.

This makes runtime capability evolution auditable:

```text
runtime merge
→ current MCP catalog changes
→ new capability manifest version
→ new integrity digest
```

## Current TrainingOS read surface

The v1.1 manifest binds:

```text
trainingos.mcp >= 0.5.2
```

and the observe set:

```text
get_class_learning_structure
get_course_design_context
```

Both tools are read-only teacher context surfaces in the canonical TrainingOS MCP composition.

`get_course_design_context` reads bounded course-design facts such as content versions, competencies, Unit objectives/evidence mappings and readiness projection. It does not itself grade learners, mutate learner mastery, publish curriculum, infer teacher judgment, or perform a canonical write.

## Still not install-ready

Version 1.1 remains:

```text
status = draft
humanGatePolicy = never
internalWrite = []
externalAction = []
```

This compile-only upgrade does not prove:

- live cross-repository MCP reachability from AI Execution OS;
- Workspace installation;
- AgentCapabilityGrant;
- Human Gate decision;
- canonical TrainingOS mutation;
- production execution.

The absence of L2/L3 actions is why `humanGatePolicy=never` remains valid for this version. Any later internal write requires a new capability version with at least task/action Human Gate policy.

## Source freshness

v1.1 adds the owning runtime contract as source provenance:

```text
trainingos-course-design-mcp-read-v1
```

with `review-release` freshness and `blockWhenReviewRequired=true`.

If that runtime contract is marked review-required, the compiler must refuse to produce the version from the supplied catalogs.

## Evidence requirements

v1.1 adds:

```text
trainingos-course-design-context-snapshot
```

to the existing learning-structure / AgentSkill trace / source-provenance requirements.

An evidence requirement is not proof that a runtime evidence object already exists.

## Fail-closed catalog rule

Tests deliberately supply an MCP catalog that omits `get_course_design_context`. In that case v1.1 compilation must fail even though the JSON manifest names the tool.

This preserves the core invariant:

```text
manifest declaration != runtime availability
```

A tool must be present in the supplied current MCP catalog before compilation can accept it.

## Next boundary

Do not make v1.1 install-ready solely because both read tools compile.

The next cross-repository proof should be a bounded runtime discovery/connection contract that demonstrates:

```text
TrainingOS canonical MCP discovery
→ exact server/tool identity
→ tenant/workspace/teacher scope
→ Agent delegated grant
→ read-only invocation
→ evidence receipt
```

Only after that proof should a separate version consider installation state.
