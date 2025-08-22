const Fastify = require("fastify");
const cors = require("@fastify/cors");
const WebSocket = require("ws");

const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJkdXlidXl4dG9vbCIsImJvdCI6MCwiaXNNZXJjaGFudCI6ZmFsc2UsInZlcmlmaWVkQmFua0FjY291bnQiOnRydWUsInBsYXlFdmVudExvYmJ5IjpmYWxzZSwiY3VzdG9tZXJJZCI6MTk0NTg4Njg3LCJhZmZJZCI6IlN1bndpbiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoic3VuLndpbiIsInRpbWVzdGFtcCI6MTc1NTg0MTg1NTIzMiwibG9ja0dhbWVzIjpbXSwiYW1vdW50IjowLCJsb2NrQ2hhdCI6ZmFsc2UsInBob25lVmVyaWZpZWQiOmZhbHNlLCJpcEFkZHJlc3MiOiIyNy42Ni4xMTkuMTA1IiwibXV0ZSI6ZmFsc2UsImF2YXRhciI6Imh0dHBzOi8vaW1hZ2VzLnN3aW5zaG9wLm5ldC9pbWFnZXMvYXZhdGFyL2F2YXRhcl8wNi5wbmciLCJwbGF0Zm9ybUlkIjo1LCJ1c2VySWQiOiIyYjZiNzdlMy02MzM3LTQyMjAtYjQxZC0yYzAwYjdmODc1NTQiLCJyZWdUaW1lIjoxNzMzOTE2Mzg2NTQzLCJwaG9uZSI6IiIsImRlcG9zaXQiOnRydWUsInVzZXJuYW1lIjoiU0NfYnV0eHRob2kxMiJ9.ZIKZubcoM_T2nOnja6hhfw-pVoO46N-dEymWM9Ok0oI";

const fastify = Fastify({ logger: false });
const PORT = process.env.PORT || 3001;

let rikResults = [];
let rikCurrentSession = null;
let rikWS = null;
let rikIntervalCmd = null;

function decodeBinaryMessage(buffer) {
  try {
    const str = buffer.toString();
    if (str.startsWith("[")) {
      return JSON.parse(str);
    }

    let position = 0;
    const result = [];

    while (position < buffer.length) {
      const type = buffer.readUInt8(position++);

      if (type === 1) {
        const length = buffer.readUInt16BE(position);
        position += 2;
        const str = buffer.toString('utf8', position, position + length);
        position += length;
        result.push(str);
      } else if (type === 2) {
        const num = buffer.readInt32BE(position);
        position += 4;
        result.push(num);
      } else if (type === 3 || type === 4) {
        const length = buffer.readUInt16BE(position);
        position += 2;
        const str = buffer.toString('utf8', position, position + length);
        position += length;
        result.push(JSON.parse(str));
      } else {
        console.warn("Unknown binary type:", type);
        break;
      }
    }

    return result.length === 1 ? result[0] : result;
  } catch (e) {
    console.error("Binary decode error:", e);
    return null;
  }
}

function getTX(d1, d2, d3) {
  const sum = d1 + d2 + d3;
  return sum >= 11 ? "T" : "X";
}

function sendRikCmd1005() {
  if (rikWS && rikWS.readyState === WebSocket.OPEN) {
    const payload = [6, "MiniGame", "taixiuPlugin", { cmd: 1005 }];
    rikWS.send(JSON.stringify(payload));
  }
}

function connectRikWebSocket() {
  console.log("🔌 Connecting to SunWin WebSocket...");
  rikWS = new WebSocket(`wss://websocket.azhkthg1.net/websocket?token=${TOKEN}`);

  rikWS.on("open", () => {
    const authPayload = [
      1,
      "MiniGame",
      "SC_butxthoi12",
      "butx12",
      {
        info: JSON.stringify({
          ipAddress: "27.76.164.129",
          wsToken: TOKEN,
          userId: "2b6b77e3-6337-4220-b41d-2c00b7f87554",
          username: "SC_butxthoi12",
          timestamp: 1755228143567
        }),
        signature: "6444950F85741EE30683905360E8E67C62B0C3AF684386680D4FC87C1CFAD6D019EA4C62C70952C1CCAC34961E19F0616F870BB95B609DB039D9FB1BB056694731CF875893E8E904B30EF851E0353FA4D4E0AEA69DB06E947571CD658F09D0ECFB3C74F29E1F420FBFE1A4AC07053E030D858EF5B677504EB783EA4897609F51",
        pid: 5,
        subi: true
      }
    ];

    rikWS.send(JSON.stringify(authPayload));
    clearInterval(rikIntervalCmd);
    rikIntervalCmd = setInterval(sendRikCmd1005, 5000);
  });

  rikWS.on("message", (data) => {
    try {
      const json = typeof data === 'string' ? JSON.parse(data) : decodeBinaryMessage(data);
      if (!json) return;

      if (Array.isArray(json) && json[3]?.res?.d1 && json[3]?.res?.sid) {
        const result = json[3].res;

        if (!rikCurrentSession || result.sid > rikCurrentSession) {
          rikCurrentSession = result.sid;

          rikResults.unshift({
            sid: result.sid,
            d1: result.d1,
            d2: result.d2,
            d3: result.d3
          });

          if (rikResults.length > 50) rikResults.pop();

          console.log(`📥 Phiên mới ${result.sid} → ${getTX(result.d1, result.d2, result.d3)}`);

          setTimeout(() => {
            if (rikWS) rikWS.close();
            connectRikWebSocket();
          }, 1000);
        }
      } else if (Array.isArray(json) && json[1]?.htr) {
        const history = json[1].htr
          .map((item) => ({
            sid: item.sid,
            d1: item.d1,
            d2: item.d2,
            d3: item.d3,
          }))
          .sort((a, b) => b.sid - a.sid);

        rikResults = history.slice(0, 50);
        console.log("📦 Đã tải lịch sử các phiên gần nhất.");
      }

    } catch (e) {
      console.error("❌ Parse error:", e.message);
    }
  });

  rikWS.on("close", () => {
    console.log("🔌 WebSocket disconnected. Reconnecting...");
    setTimeout(connectRikWebSocket, 5000);
  });

  rikWS.on("error", (err) => {
    console.error("🔌 WebSocket error:", err.message);
    rikWS.close();
  });
}

connectRikWebSocket();

fastify.register(cors);

fastify.get("/api/sunwin/2.0", async () => {
  const validResults = rikResults.filter(item => item.d1 && item.d2 && item.d3);

  if (validResults.length === 0) {
    return { Message: "Không có dữ liệu." };
  }

  const current = validResults[0];
  const sum = current.d1 + current.d2 + current.d3;
  const ket_qua = sum >= 11 ? "Tài" : "Xỉu";

  return {
    Phien: current.sid,
    Xuc_xac1: current.d1,
    Xuc_xac2: current.d2,
    Xuc_xac3: current.d3,
    Tong: sum,
    Ket_qua: ket_qua
  };
});

const start = async () => {
  try {
    const address = await fastify.listen({ port: PORT, host: "0.0.0.0" });
    console.log(`🚀 API chạy tại ${address}`);
  } catch (err) {
    console.error("❌ Server error:", err);
    process.exit(1);
  }
};

start();
