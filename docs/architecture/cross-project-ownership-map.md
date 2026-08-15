# AI Execution OS Cross-Project Ownership Map

AI Execution OS (AIEXE) is execution-control infrastructure. This file is a repository-local sibling-project index; current truth must still be re-fetched from each repository's `main`, accepted contracts and owner scopes.

| Project | Repository | Owns | AIEXE relationship |
|---|---|---|---|
| AI Execution OS (AIEXE) | `moseszhu999/ai_exe_os` | Long-lived/scheduled execution workers, allowed browser/session orchestration, GitHub-native execution/evidence workflows, provider-surface compliance gates | This repository |
| AI Native Platform | `moseszhu999/ai-native-platform` | Shared Workspace, generic Case/Conversation, Plugin/App composition, Agent Router/Agent Runtime abstraction, Capability Router, MCP Gateway, host/channel integration | AIEXE may be an executor/infrastructure provider; it does not replace the Platform Workspace or Platform's stable Agent Runtime contract |
| TrainingOS | `moseszhu999/training-learning-rails` | Education/training truth, schedule, OJT, assessment, evidence interpretation, capability/credential semantics and education-domain authority | AIEXE may execute bounded tasks for TrainingOS but cannot mint TrainingOS truth/authority |
| TradeOS / Supply Chain OS | `moseszhu999/chaintrace-app` | Trade/sourcing/supplier/RFQ/quotation/evidence/review truth and trade-domain authority | AIEXE may expose/execute bounded TradeOS capabilities but cannot become trade/supplier authority |
| PMAI / ProjectOS | `moseszhu999/pmai` | Project/task state, schedule/recovery, execution graph, proposals, HumanCheckpoint and project-change authority | PMAI may delegate bounded execution to AIEXE; AIEXE returns execution evidence but does not mutate project truth on its own |
| Video Operation / ToolRadar / Shared Media | `moseszhu999/global-tool-radar` | Tool discovery/content operations and product-neutral media render/TTS/timeline/artifact-evidence infrastructure where explicitly shared | AIEXE may orchestrate allowed media/content tasks but does not own media result truth or social publishing decisions |

## AIEXE vs Agent Harness

AI Native Platform may embed a stable Agent Harness runtime abstraction for conversational/business Agents inside Workspace. AIEXE is a sibling execution-control system for scheduled/long-lived workers, browser/session orchestration and delivery evidence.

These can integrate, but neither should silently duplicate the other:

```text
AI Native Workspace
→ Platform Agent Runtime / Capability Router
→ optional AIEXE execution provider for bounded long-running work
→ Domain Runtime / external authorized surface
→ evidence / receipt back to the owning system
```

PMAI / ProjectOS can be one owner that requests long-running execution from AIEXE and then decides how returned evidence changes project/task state.

## Rules

- Execution success is not Domain truth. TrainingOS/TradeOS/PMAI/Shared Media must validate and own their canonical result semantics.
- Provider/browser availability is not permission; every automated surface must pass current provider/compliance gates.
- AIEXE must not become a hidden second Workspace, second Domain database, or second business authority owner.
- Platform MCP/Agent Runtime and AIEXE execution contracts should meet at explicit adapters, not copied routing/business logic.
- For cross-repository changes, read the sibling repository's `AGENTS.md` / `CLAUDE.md`, current main/open PRs and owner scope before writing.
