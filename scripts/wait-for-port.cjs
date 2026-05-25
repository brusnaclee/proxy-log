const net = require("net");

const port = Number(process.argv[2] || 3000);
const timeoutMs = Number(process.argv[3] || 60000);
const start = Date.now();

function check() {
  const socket = new net.Socket();
  socket.setTimeout(1500);

  socket
    .once("connect", () => {
      socket.destroy();
      process.stdout.write(`Proxy is ready on port ${port}\n`);
      process.exit(0);
    })
    .once("timeout", () => {
      socket.destroy();
      retry();
    })
    .once("error", () => {
      socket.destroy();
      retry();
    })
    .connect(port, "127.0.0.1");
}

function retry() {
  if (Date.now() - start > timeoutMs) {
    process.stderr.write(`Timeout waiting for port ${port}\n`);
    process.exit(1);
  }
  setTimeout(check, 1000);
}

check();
