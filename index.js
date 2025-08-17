const Fastify = require("fastify");
const cors = require("@fastify/cors");
const WebSocket = require("ws");

const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJzdW53aW50aGFjaG9lbTEiLCJib3QiOjAsImlzTWVyY2hhbnQiOmZhbHNlLCJ2ZXJpZmllZEJhbmtBY2NvdW50Ijp0cnVlLCJwbGF5RXZlbnRMb2JieSI6ZmFsc2UsImN1c3RvbWVySWQiOjEzMDA1NTkwMCwiYWZmSWQiOiJzdW53aW4iLCJiYW5uZWQiOmZhbHNlLCJicmFuZCI6InN1bi53aW4iLCJ0aW1lc3RhbXAiOjE3NTU0MTM0ODAzNDEsImxvY2tHYW1lcyI6W10sImFtb3VudCI6MCwibG9ja0NoYXQiOmZhbHNlLCJwaG9uZVZlcmlmaWVkIjpmYWxzZSwiaXBBZGRyZXNzIjoiMjcuNzYuMTAuMjE5IiwibXV0ZSI6ZmFsc2UsImF2YXRhciI6Imh0dHBzOi8vaW1hZ2VzLnN3aW5zaG9wLm5ldC9pbWFnZXMvYXZhdGFyL2F2YXRhcl8xMS5wbmciLCJwbGF0Zm9ybUlkIjoyLCJ1c2VySWQiOiJjYjBhYTlmYS1mMjQ5LTQ2MDQtYjM1NS1lMDIwOGIxOTIwOWMiLCJyZWdUaW1lIjoxNjk3MDI0MzIyODIxLCJwaG9uZSI6IiIsImRlcG9zaXQiOnRydWUsInVzZXJuYW1lIjoiU0Nfbmd1eWVudmFudGluaG5lIn0.ia6E6gy94JAsIpJQTcC-a1luM8euri6_1gQbqyPfwQA";

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
        signature: "488F0D08F4E866F430B4E1842842C3B0A2B3918A1BCF0A3592CE34150546467606D4224042A57412503AF3090AC8CC7D062790CE467B9DF2DBC91A9847C4990F8182320B9928030F5F405FB68154191770AD169A2E53DDF45608D9B7DAA4C77D9936AD5AA539D6F6F8B6AEE3742B95F8D4ECBE380D4148A8A1EF368231BC0417",
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
