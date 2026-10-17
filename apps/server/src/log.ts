type Sink = (line: string) => void;

let sink: Sink = (line) => void process.stderr.write(`${line}\n`);

export function setLogSink(next: Sink): void {
  sink = next;
}

export function log(message: string): void {
  sink(`${new Date().toISOString()} ${message}`);
}
