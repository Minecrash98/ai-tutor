export interface VoiceIntentGateResolution {
  readonly armed: boolean;
  readonly suppressedText: string;
}

export class VoiceIntentOutputGate {
  private armedValue = false;
  private bufferedText = "";

  get armed(): boolean {
    return this.armedValue;
  }

  get suppressedCharacterCount(): number {
    return this.bufferedText.length;
  }

  arm(): boolean {
    if (this.armedValue) return false;
    this.armedValue = true;
    this.bufferedText = "";
    return true;
  }

  captureAssistantTranscript(text: string, final: boolean): boolean {
    if (!this.armedValue) return false;
    this.bufferedText = final ? text : `${this.bufferedText}${text}`;
    return true;
  }

  resolve(): VoiceIntentGateResolution {
    const resolution = {
      armed: this.armedValue,
      suppressedText: this.bufferedText,
    } as const;
    this.reset();
    return resolution;
  }

  reset(): void {
    this.armedValue = false;
    this.bufferedText = "";
  }
}
