export class InMemoryNetworkPortR31 {
  readonly #inbound: Uint8Array[] = [];
  readonly #peer: InMemoryNetworkPortR31 | null;
  #connected = false;
  #sent = 0;
  #received = 0;
  #bytesSent = 0;
  #bytesReceived = 0;

  constructor(peer: InMemoryNetworkPortR31 | null = null) {
    this.#peer = peer;
  }

  connect(): void { this.#connected = true; }
  connected(): boolean { return this.#connected && Boolean(this.#peer); }

  send(bytes: Uint8Array): void {
    if (!this.connected()) throw new Error('network-disconnected');
    this.#peer!.#inbound.push(bytes.slice());
    this.#sent++;
    this.#bytesSent += bytes.byteLength;
  }

  receive(bytes: Uint8Array): void {
    this.#inbound.push(bytes.slice());
    this.#received++;
    this.#bytesReceived += bytes.byteLength;
  }

  drain(): readonly Uint8Array[] {
    return Object.freeze(this.#inbound.splice(0));
  }

  close(): void {
    this.#connected = false;
    this.#inbound.length = 0;
  }

  diagnostics(): Readonly<{
    connected: boolean;
    pending: number;
    sent: number;
    received: number;
    bytesSent: number;
    bytesReceived: number;
  }> {
    return Object.freeze({
      connected: this.#connected,
      pending: this.#inbound.length,
      sent: this.#sent,
      received: this.#received,
      bytesSent: this.#bytesSent,
      bytesReceived: this.#bytesReceived,
    });
  }
}

export function createNetworkPairR31(): readonly [InMemoryNetworkPortR31, InMemoryNetworkPortR31] {
  const left = new InMemoryNetworkPortR31();
  const right = new InMemoryNetworkPortR31();
  Object.defineProperties(left, { _peer: { value: right } });
  Object.defineProperties(right, { _peer: { value: left } });
  return Object.freeze([left, right]);
}
