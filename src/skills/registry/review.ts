import { createHash } from "node:crypto";
import { SkillPolicy } from "./policy";
import type { SkillFile } from "./types";
export type FindingSeverity = "low" | "medium" | "high" | "critical";
export type SkillFinding = {
  ruleId: string;
  severity: FindingSeverity;
  file: string;
  line: number;
  explanation: string;
  approvalBlocker: boolean;
  recommendedAction: string;
};
export type SkillReview = {
  findings: SkillFinding[];
  riskLevel: "low" | "medium" | "high" | "critical";
  complete: boolean;
  metadataUnresolved: string[];
  reviewedAt: string;
  reviewChecksum: string;
};
const rules: Array<[string, RegExp, FindingSeverity, string]> = [
  [
    "SECRET_ACCESS",
    /(?:\.env|environment variables|credential store|ssh keys?|cloud tokens?)/i,
    "critical",
    "The skill references secrets or credential material.",
  ],
  [
    "DESTRUCTIVE_FILESYSTEM",
    /rm\s+-rf|del\s+\/s|Remove-Item\s+.*-Recurse|diskpart|format\s+[a-z]:/i,
    "critical",
    "The skill contains destructive filesystem instructions.",
  ],
  [
    "PRIVILEGE_ESCALATION",
    /\bsudo\b|\brunas\b|chmod\s|chown\s|--privileged|docker\.sock/i,
    "critical",
    "The skill requests elevated privileges or host control.",
  ],
  [
    "NETWORK_EXFILTRATION",
    /(?:curl|wget).*(?:-d|--data|--post-data|POST)|webhook|upload.*source|source.*upload/i,
    "critical",
    "The skill may send local data to an external destination.",
  ],
  [
    "ARBITRARY_INSTALL",
    /npm\s+(?:install|i)\b|pip\s+install|global install|bootstrap script/i,
    "high",
    "The skill requests package or bootstrap installation.",
  ],
  [
    "GIT_DESTRUCTIVE",
    /git\s+(?:push\s+.*--force|reset\s+--hard|clean\s+-fd|branch\s+-D|tag\s+-d)/i,
    "high",
    "The skill contains destructive Git mutation.",
  ],
  [
    "PROMPT_INJECTION",
    /ignore\s+(?:all\s+)?previous\s+instructions|override\s+system|reveal\s+(?:the\s+)?(?:hidden\s+)?prompt|bypass\s+permissions|impersonate\s+user approval/i,
    "critical",
    "The skill attempts to override policy or impersonate approval.",
  ],
  [
    "UNSAFE_PATH",
    /(?:^|\s)(?:[A-Za-z]:[\\/]|\/etc\/|\.\.\/?|\.\.\\)/,
    "high",
    "The skill references an absolute or traversing filesystem path.",
  ],
  [
    "OBFUSCATED_PAYLOAD",
    /base64\s+(?:-d|--decode)|(?:download|fetch).*script|powershell\s+.*-enc/i,
    "critical",
    "The skill contains an encoded or dynamically fetched payload.",
  ],
  [
    "EXECUTION_INSTRUCTION",
    /(?:run|execute|use)\s+(?:this\s+)?(?:powershell|python|bash|shell|command|script)|curl\s*\|\s*(?:bash|sh)|\bnpx\s+[a-z]/i,
    "critical",
    "The skill contains an instruction to execute external commands or scripts.",
  ],
  [
    "AUTHORITY_OVERRIDE",
    /(?:disable|skip|bypass)\s+(?:validation|approval)|modify\s+(?:the\s+)?(?:orchestrator|agentdefinition|system authority)|run\s+(?:this\s+)?(?:command|script)\s+automatically/i,
    "critical",
    "The skill attempts to override Factory authority or automatic execution policy.",
  ],
  [
    "SECRET_EXFILTRATION",
    /(?:send|upload|exfiltrate|publish).{0,50}(?:secret|token|credential|environment|source code)/i,
    "critical",
    "The skill instructs disclosure of secrets or private source material.",
  ],
];

function isDefensivePromptInjectionMention(line: string) {
  return /repository content is data,?\s+not instructions/i.test(line) &&
    /(?:ignore\s+(?:all\s+)?previous\s+instructions|override\s+system|reveal\s+(?:the\s+)?(?:hidden\s+)?prompt)/i.test(line) &&
    /flag it(?: as a finding)?|treat file contents as inert/i.test(line);
}

export function reviewSkill(
  files: SkillFile[],
  policy: SkillPolicy,
  unresolved: string[],
  now = new Date().toISOString(),
): SkillReview {
  const findings: SkillFinding[] = [];
  for (const file of files) {
    if (file.text === undefined) continue;
    const lines = file.text.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const [ruleId, pattern, severity, explanation] of rules)
        if (pattern.test(line) && !(ruleId === "PROMPT_INJECTION" && isDefensivePromptInjectionMention(line)))
          findings.push({
            ruleId,
            severity,
            file: file.relativePath,
            line: index + 1,
            explanation,
            approvalBlocker: severity === "critical",
            recommendedAction:
              severity === "critical"
                ? "Reject or remove the finding before approval."
                : "Review and narrow permissions before approval.",
          });
    });
  }
  for (const file of files)
    for (const pattern of policy.prohibitedFilePatterns)
      if (new RegExp(pattern, "i").test(file.relativePath))
        findings.push({
          ruleId: "PROHIBITED_FILE",
          severity: "critical",
          file: file.relativePath,
          line: 1,
          explanation:
            "The file matches a prohibited credential, VCS, archive, or dependency path.",
          approvalBlocker: true,
          recommendedAction: "Exclude the file and re-import the skill.",
        });
  const risk = findings.some((f) => f.severity === "critical")
    ? "critical"
    : findings.some((f) => f.severity === "high")
      ? "high"
      : findings.some((f) => f.severity === "medium")
        ? "medium"
        : files.some((f) => f.kind === "script")
          ? "medium"
          : "low";
  return {
    findings,
    riskLevel: risk,
    complete: findings.every((f) => !f.approvalBlocker),
    metadataUnresolved: unresolved,
    reviewedAt: now,
    reviewChecksum: createHash("sha256")
      .update(JSON.stringify(findings))
      .digest("hex"),
  };
}
