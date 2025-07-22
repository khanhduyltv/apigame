const Fastify = require("fastify");
const cors = require("@fastify/cors");
const WebSocket = require("ws");

const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsImdlbmRlciI6MCwiZGlzcGxheU5hbWUiOiJzdW53aW50aGFjaG9lbTEiLCJwaG9uZVZlcmlmaWVkIjpmYWxzZSwiYm90IjowLCJhdmF0YXIiOiJodHRwczovL2ltYWdlcy5zd2luc2hvcC5uZXQvaW1hZ2VzL2F2YXRhci9hdmF0YXJfMTEucG5nIiwidXNlcklkIjoiY2IwYWE5ZmEtZjI0OS00NjA0LWIzNTUtZTAyMDhiMTkyMDljIiwicmVnVGltZSI6MTY5NzAyNDMyMjgyMSwicGhvbmUiOiIiLCJjdXN0b21lcklkIjoxMzAwNTU5MDAsImJyYW5kIjoic3VuLndpbiIsInVzZXJuYW1lIjoiU0Nfbmd1eWVudmFudGluaG5lIiwidGltZXN0YW1wIjoxNzUzMTExNTI1ODYzfQ.oZKPkFMbTDOQpLluz6fibx0VvKC1V7G00YjJAVbWBwI";

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
      "SC_nguyenvantinhne",
      "tinhbip",
      {
        info: JSON.stringify({
          ipAddress: "2001:ee0:514e:1a90:2404:2fe0:31b0:5450",
          wsToken: TOKEN,
          userId: "cb0aa9fa-f249-4604-b355-e0208b19209c",
          username: "SC_nguyenvantinhne",
          timestamp: 1753111525863
        }),
        signature: "6868180BD7F4452FA60FFA2B0F9A729633F4D2AFA3B531820CD24EDC99A5D1BD8CF7CD2E3E52342628E37C5C2D43D8D96A38638D7AA72D5A9A9083244FF34B7E6FA75AA516CB05F6A03258555EC6510BD32E24C6C593D71DAD89B29C33DC07DFA22D4E0F7C949AB3383CDF1BBDA7AF5D0BB998D0F3848FBFCFD74E814C71001C",
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

fastify.get("/api/sunwin", async () => {
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
