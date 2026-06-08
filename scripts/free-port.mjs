// Mata qualquer processo escutando na porta informada (default 3000) antes de
// subir o Nest. Cross-platform (Windows/macOS/Linux). Nunca falha: sempre sai 0,
// igual ao comportamento do script PowerShell antigo.
import { execSync } from "node:child_process";

const port = process.argv[2] || "3000";

function run(cmd) {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

try {
  const pids = new Set();

  if (process.platform === "win32") {
    const out = run("netstat -ano -p tcp");
    for (const line of out.split(/\r?\n/)) {
      if (line.includes(`:${port}`) && /LISTENING/i.test(line)) {
        const pid = line.trim().split(/\s+/).pop();
        if (pid && pid !== "0") pids.add(pid);
      }
    }
    for (const pid of pids) run(`taskkill /F /PID ${pid}`);
  } else {
    const out = run(`lsof -ti tcp:${port} -s TCP:LISTEN`);
    for (const pid of out.split(/\s+/).filter(Boolean)) pids.add(pid);
    for (const pid of pids) run(`kill -9 ${pid}`);
  }

  if (pids.size > 0) {
    console.log(`Porta ${port} liberada (PIDs: ${[...pids].join(", ")}).`);
  }
} catch {
  // Ignora qualquer erro: liberar a porta é best-effort.
}

process.exit(0);
