# Lead Agent

The production `lead.v1` provider is an injected analysis/clarification/brief adapter; deterministic behavior remains available for offline tests.

The Lead Agent is the only workflow role implemented in this milestone. It receives the original prompt, supplied-file metadata, and known answers; extracts explicit facts; separates preferences and recommendations; detects contradictions; and proposes only the clarifications needed for a safe brief.

The implementation is deterministic by default and has no network, OpenAI, MCP, or external-skill dependency. A future provider may replace the deterministic provider behind `LeadAnalysisProvider`, but it must satisfy the same strict Zod contracts and cannot approve a brief or transition workflow state.

The Lead Agent does not generate websites, write production source, create design directions, create implementation tasks, deploy, or invent business facts.
