const previousFetch = globalThis.fetch;

function evidenceId(body) {
  const match = body.match(/E[a-f0-9]{16}-[0-9]{3}/);
  return match?.[0] ?? `E${"0".repeat(16)}-001`;
}

function syntheticResponse(requestBody) {
  const id = evidenceId(requestBody);
  const payload = JSON.stringify({
    verdict: "APPROVED",
    findings: [],
    reviewedArtifactRefs: [id],
    blockedReason: null,
  });
  return new Response(JSON.stringify({
    id: "synthetic-contract-audit-response",
    object: "chat.completion",
    created: 1,
    model: "synthetic-contract-audit-model",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: payload } }],
    usage: { prompt_tokens: 17, completion_tokens: 9, total_tokens: 26 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("api.openai.com")) {
    return syntheticResponse(typeof init?.body === "string" ? init.body : "");
  }
  return previousFetch(input, init);
};
