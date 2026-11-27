import type { OperationalLicenseInformation } from "../security/license-capacity-gate.js";

/**
 * Inherited native-parent pipe for the commercial Android host.
 * Accepts STOP, LICENSE_INFORMATION <id>, and REQUEST <json>.
 */
export class AndroidCommercialServiceControl {
  private pending = "";
  private readonly decoder = new TextDecoder("utf-8",{fatal:true});
  private sequence = 0;
  private closed = false;
  private requestBusy = false;

  constructor(
    private readonly readLicense: () => OperationalLicenseInformation,
    private readonly handleRequest: (value: unknown) => Promise<unknown>,
    private readonly reply: (value: unknown) => void,
    private readonly stop: (code: number) => void,
  ) {}

  accept(chunk: Buffer): void {
    if (this.closed) return;
    if (chunk.length > 65536 || chunk.some((byte) => byte !== 10 && byte < 32 && byte !== 9)) {
      return this.close(1);
    }
    try { this.pending += this.decoder.decode(chunk,{stream:true}); } catch { return this.close(1); }
    void this.drain();
  }

  end(): void {
    this.close(0);
  }

  private async drain(): Promise<void> {
    while (!this.closed && this.pending.includes("\n") && !this.requestBusy) {
      const end = this.pending.indexOf("\n");
      if (Buffer.byteLength(this.pending.slice(0,end),"utf8") > 65536) return this.close(1);
      const line = this.pending.slice(0, end);
      this.pending = this.pending.slice(end + 1);
      if (line === "STOP") return this.close(0);
      const license = /^LICENSE_INFORMATION ([1-9][0-9]{0,8})$/.exec(line);
      if (license) {
        const id = Number(license[1]);
        if (!id || id !== this.sequence + 1) return this.close(1);
        this.sequence = id;
        this.reply({ kind: "LICENSE_INFORMATION", request: id, information: this.readLicense() });
        continue;
      }
      if (line.startsWith("REQUEST ")) {
        const idMatch = /^REQUEST ([1-9][0-9]{0,8}) (.+)$/.exec(line);
        if (!idMatch) return this.close(1);
        const id = Number(idMatch[1]);
        if (!id || id !== this.sequence + 1) return this.close(1);
        this.sequence = id;
        let payload: unknown;
        try {
          payload = JSON.parse(idMatch[2]!);
        } catch {
          return this.close(1);
        }
        this.requestBusy = true;
        try {
          const result = await this.handleRequest(payload);
          this.reply({ kind: "REQUEST_RESULT", request: id, result });
        } catch (error) {
          this.reply({
            kind: "REQUEST_RESULT",
            request: id,
            result: {
              status: "FAILED",
              result_code: "HOST_ERROR",
              error: {
                code: "HOST_ERROR",
                user_message: error instanceof Error ? error.message : "Error del servicio local",
              },
            },
          });
        } finally {
          this.requestBusy = false;
        }
        continue;
      }
      return this.close(1);
    }
    if (Buffer.byteLength(this.pending,"utf8") > 65536) this.close(1);
  }

  private close(code: number): void {
    if (this.closed) return;
    this.closed = true;
    this.pending = "";
    this.stop(code);
  }
}
