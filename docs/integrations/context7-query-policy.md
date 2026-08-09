# Context7 query policy

Queries require `Context7-read`, an approved/planned package, a resolved library identity, and a specific topic. “Everything”, “all docs”, and equivalent corpus-wide requests are rejected. Version priority is accepted DependencyPlan, generated package metadata, fixed-stack constraint, then unresolved; versions are never invented.

Planner requests are limited to framework capability, API patterns, compatibility, and architecture questions. Implementation requests must arise from the current objective and relevant package need. Context7 cannot add requirements, dependencies, designs, tools, or file scopes.
