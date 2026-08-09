# Structured output

Each adapter supplies an existing strict Zod schema to the OpenAI structured-output helper and parses the result again at the domain boundary. Refusals, truncation, malformed JSON, unknown fields, and schema mismatches are rejected with stable `AI_*` errors. At most one format-correction attempt is made.
