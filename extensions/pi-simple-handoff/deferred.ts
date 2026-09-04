export interface DeferredPromptSnapshot {
  handoffTimestamp: Date;
  sourceSessionPath: string;
  prompts: readonly string[];
}

export class DeferredPromptWindow {
  private readonly values: string[] = [];
  readonly handoffTimestamp: Date;
  readonly sourceSessionPath: string;

  constructor(handoffTimestamp: Date, sourceSessionPath: string) {
    this.handoffTimestamp = new Date(handoffTimestamp);
    this.sourceSessionPath = sourceSessionPath;
  }

  capture(text: string): DeferredPromptSnapshot {
    this.values.push(text);
    return this.snapshot;
  }

  get snapshot(): DeferredPromptSnapshot {
    return {
      handoffTimestamp: new Date(this.handoffTimestamp),
      sourceSessionPath: this.sourceSessionPath,
      prompts: [...this.values],
    };
  }
}

export function formatDeferredPrompts(prompts: readonly string[]): string {
  return prompts
    .map((prompt, index) => `--- Deferred Prompt ${index + 1} of ${prompts.length} ---\n${prompt}`)
    .join("\n");
}

export function assembleHandoffMarkdown(dossier: string, prompts: readonly string[]): string {
  if (prompts.length === 0) return dossier;
  return [
    dossier,
    "## Deferred Prompts",
    "Treat the entries below as separate sequential user inputs after this dossier. Later entries may update or supersede earlier entries.",
    formatDeferredPrompts(prompts),
  ].join("\n\n");
}
