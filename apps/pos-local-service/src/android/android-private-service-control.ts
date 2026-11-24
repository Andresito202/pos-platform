import type { OperationalLicenseInformation } from "../security/license-capacity-gate.js";

/** Inherited native-parent pipe only. No sockets, caller scope, provisioning,
 * signing, payment or authority-changing operations are accepted. */
export class AndroidPrivateServiceControl {
  private pending = "";
  private sequence = 0;
  private closed = false;
  constructor(private readonly read: () => OperationalLicenseInformation,
    private readonly reply: (value: unknown) => void, private readonly stop: (code: number) => void) {}
  accept(chunk: Buffer): void {
    if (this.closed) return;
    if (chunk.length>4096||chunk.some(byte => byte !== 10 && (byte < 32 || byte > 126))) return this.close(1);
    this.pending += chunk.toString("ascii");
    // A bounded command is processed before the next one, including coalesced writes.
    while (this.pending.includes("\n")) {
      const end = this.pending.indexOf("\n");
      if (end > 80) return this.close(1);
      const line = this.pending.slice(0, end); this.pending = this.pending.slice(end + 1);
      if (line === "STOP") return this.close(0);
      const match = /^LICENSE_INFORMATION ([1-9][0-9]{0,8})$/.exec(line);
      const id = match ? Number(match[1]) : 0;
      if (!id || id !== this.sequence + 1) return this.close(1);
      this.sequence = id;
      this.reply({ kind: "LICENSE_INFORMATION", request: id, information: this.read() });
    }
    if (this.pending.length > 80) this.close(1);
  }
  end(): void { this.close(0); }
  private close(code: number): void {
    if (this.closed) return;
    this.closed = true; this.pending = ""; this.stop(code);
  }
}
