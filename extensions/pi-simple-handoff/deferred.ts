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
