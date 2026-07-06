import net from "node:net";
import tls from "node:tls";

type SmtpConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
  to: string | string[];
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
};

type SocketLike = net.Socket | tls.TLSSocket;

function encodeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function dotStuff(value: string) {
  return value.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
}

function mailBody(config: SmtpConfig) {
  if (!config.html) {
    return {
      headers: ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit"],
      body: config.text,
    };
  }

  const boundary = `oriental-${Date.now().toString(36)}`;
  return {
    headers: [`Content-Type: multipart/alternative; boundary="${boundary}"`],
    body: [
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      config.text,
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      config.html,
      `--${boundary}--`,
    ].join("\r\n"),
  };
}

function recipients(config: SmtpConfig) {
  return Array.isArray(config.to) ? config.to : [config.to];
}

function recipientHeader(config: SmtpConfig) {
  return recipients(config).join(", ");
}

function readReply(socket: SocketLike) {
  return new Promise<{ code: number; text: string }>((resolve, reject) => {
    let buffer = "";

    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines.at(-1);
      if (!last) return;
      const match = /^(\d{3}) /.exec(last);
      if (!match) return;
      cleanup();
      resolve({ code: Number(match[1]), text: buffer });
    };

    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function sendCommand(socket: SocketLike, command: string, expected: number | number[]) {
  socket.write(`${command}\r\n`);
  const reply = await readReply(socket);
  const expectedCodes = Array.isArray(expected) ? expected : [expected];
  if (!expectedCodes.includes(reply.code)) {
    throw new Error(`smtp_${reply.code}`);
  }
  return reply;
}

export async function sendSmtpMail(config: SmtpConfig) {
  let socket: SocketLike = net.connect(config.port, config.host);
  socket.setTimeout(15_000);

  try {
    const greeting = await readReply(socket);
    if (greeting.code !== 220) throw new Error(`smtp_${greeting.code}`);

    await sendCommand(socket, "EHLO oriental.mereka.io", 250);
    await sendCommand(socket, "STARTTLS", 220);

    socket = tls.connect({ socket, servername: config.host });
    await new Promise<void>((resolve, reject) => {
      socket.once("secureConnect", resolve);
      socket.once("error", reject);
    });

    await sendCommand(socket, "EHLO oriental.mereka.io", 250);
    await sendCommand(socket, "AUTH LOGIN", 334);
    await sendCommand(socket, Buffer.from(config.username).toString("base64"), 334);
    await sendCommand(socket, Buffer.from(config.password).toString("base64"), 235);
    await sendCommand(socket, `MAIL FROM:<${config.from}>`, 250);
    for (const recipient of recipients(config)) {
      await sendCommand(socket, `RCPT TO:<${recipient}>`, [250, 251]);
    }
    await sendCommand(socket, "DATA", 354);

    const message = mailBody(config);
    const headers = [
      `From: ${encodeHeader(config.from)}`,
      `To: ${encodeHeader(recipientHeader(config))}`,
      config.replyTo ? `Reply-To: ${encodeHeader(config.replyTo)}` : null,
      `Subject: ${encodeHeader(config.subject)}`,
      "MIME-Version: 1.0",
      ...message.headers,
    ].filter(Boolean);

    socket.write(`${headers.join("\r\n")}\r\n\r\n${dotStuff(message.body)}\r\n.\r\n`);
    const sent = await readReply(socket);
    if (sent.code !== 250) throw new Error(`smtp_${sent.code}`);

    await sendCommand(socket, "QUIT", 221).catch(() => undefined);
  } finally {
    socket.end();
  }
}
