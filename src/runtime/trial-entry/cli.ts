import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { Readable } from "node:stream";
import {
  MAX_INITIAL_PROJECT_REQUEST_BYTES,
  normalizeInitialProjectRequestText,
} from "@/domain/project/initial-request";
import type { TrialEntryAnswer, TrialEntryQuestion } from "./service";

const MAX_ANSWER_FILE_BYTES = 128 * 1024;

export type NewCliOptions = { promptFile?: string; stdin: boolean; json: boolean };
export type RespondCliOptions = { projectId: string; answersFile?: string; json: boolean };
export type StatusCliOptions = { projectId: string; json: boolean };

function optionValue(args: string[], index: number, option: string) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`TRIAL_ENTRY_OPTION_VALUE_MISSING:${option}`);
  return value;
}

export function parseNewArgs(args: string[]): NewCliOptions {
  const result: NewCliOptions = { stdin: false, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--prompt-file") { result.promptFile = optionValue(args, index++, arg); continue; }
    if (arg === "--stdin") { result.stdin = true; continue; }
    if (arg === "--json") { result.json = true; continue; }
    throw new Error(`TRIAL_ENTRY_OPTION_UNKNOWN:${arg}`);
  }
  if (result.promptFile && result.stdin) throw new Error("TRIAL_ENTRY_INPUT_MODE_CONFLICT");
  return result;
}

export function parseRespondArgs(args: string[]): RespondCliOptions {
  let projectId: string | undefined;
  let answersFile: string | undefined;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--project") { projectId = optionValue(args, index++, arg); continue; }
    if (arg === "--answers-file") { answersFile = optionValue(args, index++, arg); continue; }
    if (arg === "--json") { json = true; continue; }
    throw new Error(`TRIAL_ENTRY_OPTION_UNKNOWN:${arg}`);
  }
  if (!projectId) throw new Error("TRIAL_ENTRY_PROJECT_REQUIRED");
  if (answersFile && !answersFile.trim()) throw new Error("TRIAL_ENTRY_ANSWERS_FILE_INVALID");
  return { projectId, ...(answersFile ? { answersFile } : {}), json };
}

export function parseStatusArgs(args: string[]): StatusCliOptions {
  let projectId: string | undefined;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--project") { projectId = optionValue(args, index++, arg); continue; }
    if (arg === "--json") { json = true; continue; }
    throw new Error(`TRIAL_ENTRY_OPTION_UNKNOWN:${arg}`);
  }
  if (!projectId) throw new Error("TRIAL_ENTRY_PROJECT_REQUIRED");
  return { projectId, json };
}

async function readBoundedFile(filePath: string, maximumBytes: number) {
  const resolved = path.resolve(filePath);
  const name = path.basename(resolved).toLowerCase();
  if (name === ".env" || name.startsWith(".env.")) throw new Error("TRIAL_ENTRY_PROMPT_FILE_SECRET_LIKE");
  const info = await lstat(resolved);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("TRIAL_ENTRY_PROMPT_FILE_UNSAFE");
  if (info.size > maximumBytes) throw new Error("TRIAL_ENTRY_PROMPT_FILE_TOO_LARGE");
  const value = await readFile(resolved, "utf8");
  if (Buffer.byteLength(value, "utf8") > maximumBytes) throw new Error("TRIAL_ENTRY_PROMPT_FILE_TOO_LARGE");
  return value;
}

export async function readInitialRequest(options: NewCliOptions, inputStream = input) {
  if (options.promptFile) return normalizeInitialProjectRequestText(await readBoundedFile(options.promptFile, MAX_INITIAL_PROJECT_REQUEST_BYTES));
  if (options.stdin) {
    if (isTTY(inputStream)) throw new Error("TRIAL_ENTRY_STDIN_REQUIRES_REDIRECTED_INPUT");
    return normalizeInitialProjectRequestText(await readStream(inputStream, MAX_INITIAL_PROJECT_REQUEST_BYTES));
  }
  if (!isTTY(inputStream)) return normalizeInitialProjectRequestText(await readStream(inputStream, MAX_INITIAL_PROJECT_REQUEST_BYTES));
  const terminal = readline.createInterface({ input: inputStream, output });
  try {
    output.write("AI Website Factory\n-------------------\nPaste your project request. Finish with a line containing END.\n> ");
    const lines: string[] = [];
    for await (const line of terminal) {
      if (line === "END") break;
      lines.push(line);
      output.write("> ");
    }
    const text = normalizeInitialProjectRequestText(lines.join("\n"));
    const confirmation = await terminal.question("Confirm submission? [y/N] ");
    if (!/^y(?:es)?$/i.test(confirmation.trim())) throw new Error("TRIAL_ENTRY_SUBMISSION_CANCELLED");
    return text;
  } finally {
    terminal.close();
  }
}

const isTTY = (stream: NodeJS.ReadableStream) => "isTTY" in stream && Boolean((stream as NodeJS.ReadStream).isTTY);

async function readStream(stream: Readable, maximumBytes: number) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
    bytes += buffer.byteLength;
    if (bytes > maximumBytes) throw new Error("TRIAL_ENTRY_REQUEST_TOO_LARGE");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readAnswers(options: RespondCliOptions, questions: TrialEntryQuestion[], inputStream = input) {
  if (options.answersFile) {
    const raw = await readBoundedFile(options.answersFile, MAX_ANSWER_FILE_BYTES);
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error("TRIAL_ENTRY_ANSWERS_FILE_JSON_INVALID"); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("TRIAL_ENTRY_ANSWERS_FILE_SHAPE_INVALID");
    return Object.entries(parsed as Record<string, unknown>).map(([questionId, answer]) => {
      if (typeof answer !== "string" || !answer.trim()) throw new Error("TRIAL_ENTRY_ANSWER_INVALID");
      return { questionId, answer: answer.trim(), status: "answered" as const } satisfies TrialEntryAnswer;
    });
  }
  if (!isTTY(inputStream)) throw new Error("TRIAL_ENTRY_ANSWERS_FILE_OR_INTERACTIVE_REQUIRED");
  const terminal = readline.createInterface({ input: inputStream, output });
  try {
    const answers: TrialEntryAnswer[] = [];
    for (const question of questions.filter((candidate) => candidate.answerStatus === "unresolved")) {
      const answer = await terminal.question(`${question.id} — ${question.question}\nAnswer: `);
      if (!answer.trim()) throw new Error("TRIAL_ENTRY_ANSWER_EMPTY");
      answers.push({ questionId: question.id, answer: answer.trim(), status: "answered" });
    }
    return answers;
  } finally {
    terminal.close();
  }
}

export function renderNewResult(result: Awaited<ReturnType<import("./service").TrialEntryService["createProject"]>>) {
  const lines = [
    "Project created:",
    `  ${result.project.slug}`,
    `Project ID: ${result.project.projectId}`,
    `Current stage: ${result.workflowState}`,
    `Lead semantic owner: ${result.lead.firstSemanticOwner}`,
  ];
  const questions = result.lead.clarificationQuestions.filter((question) => question.answerStatus === "unresolved");
  if (questions.length) {
    lines.push(`Lead needs ${questions.length} answer${questions.length === 1 ? "" : "s"}:`);
    questions.forEach((question, index) => lines.push(`${index + 1}. [${question.id}] ${question.question}`));
    lines.push(`Next: npm run factory:respond -- --project ${result.project.projectId}`);
  } else if (result.brief) {
    lines.push(`Brief stage: ${result.brief.readyForApproval ? "AWAITING_BRIEF_APPROVAL" : "CLARIFYING"}`);
    lines.push(`Brief checksum: ${result.brief.checksum}`);
  }
  return lines.join("\n");
}

export function renderWorkflowResult(result: Awaited<ReturnType<import("./service").TrialEntryService["respond"]>>) {
  const lines = [
    "Clarification response recorded:",
    `Project: ${result.project.slug}`,
    `Project ID: ${result.project.projectId}`,
    `Current stage: ${result.workflowState}`,
    `Lead semantic owner: ${result.lead.firstSemanticOwner}`,
  ];
  const questions = result.lead.clarificationQuestions.filter((question) => question.answerStatus === "unresolved");
  if (questions.length) {
    lines.push(`Lead still needs ${questions.length} answer${questions.length === 1 ? "" : "s"}:`);
    questions.forEach((question, index) => lines.push(`${index + 1}. [${question.id}] ${question.question}`));
  } else if (result.brief) {
    lines.push(`Brief stage: ${result.brief.readyForApproval ? "AWAITING_BRIEF_APPROVAL" : "CLARIFYING"}`);
    lines.push(`Brief checksum: ${result.brief.checksum}`);
  }
  return lines.join("\n");
}

export function renderStatus(result: Awaited<ReturnType<import("./service").TrialEntryService["status"]>>) {
  return [
    `Project: ${result.slug}`,
    `Project ID: ${result.projectId}`,
    `Current stage: ${result.workflowState}`,
    `Current revision: ${result.projectVersion} (row ${result.rowVersion})`,
    `Pending user action: ${result.pendingUserAction}`,
    `Blocking reasons: ${result.blockingReasons.length ? result.blockingReasons.join(", ") : "none"}`,
    `Next allowed actions: ${result.nextAllowedActions.length ? result.nextAllowedActions.join(", ") : "none"}`,
  ].join("\n");
}
