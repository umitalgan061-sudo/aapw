export class InMemoryNetworkPortR31 {
  readonly #inbound: Uint8Array[] = [];
  #peer: InMemoryNetworkPortR31 | null = null;
  #connected = false;
  #sent = 0;
  #received = 0;
  #bytesSent = 0;
  #bytesReceived = 0;

  attachPeer(peer: InMemoryNetworkPortR31): void {
    if (peer === this) throw new Error('network-self-peer');
    this.#peer = peer;
  }

  connect(): void { this.#connected = true; }
  connected(): boolean { return this.#connected && this.#peer?.#connected === true; }

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
  left.attachPeer(right);
  right.attachPeer(left);
  left.connect();
  right.connect();
  return Object.freeze([left, right]);
}
