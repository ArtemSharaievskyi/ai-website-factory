const WORKBENCH_STYLE_TOKEN = /--workbench-[a-z-]+|workbench-(?:bg|surface|border|text|accent|danger|success)/i;

/** Generated-site design inputs are project-owned; Workbench tokens are never valid input. */
export function assertWorkbenchStyleIsolation(value: unknown) {
  if (WORKBENCH_STYLE_TOKEN.test(JSON.stringify(value))) {
    throw new Error("DESIGN_INPUT_WORKBENCH_STYLE_LEAK");
  }
  return true;
}
