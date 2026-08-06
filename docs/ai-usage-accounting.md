# Usage accounting

Provider usage records input, cached input, output, total, request, retry, and correction counts plus provider/model/role/prompt version. The sink is injectable and compatible with the existing `CostRecord` boundary. Pricing is intentionally not guessed; usage and estimated cost remain separate concerns.
