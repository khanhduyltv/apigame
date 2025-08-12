const Fastify = require("fastify");
const cors = require("@fastify/cors");
const WebSocket = require("ws");

const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJzdW53aW50aGFjaG9lbTEiLCJib3QiOjAsImlzTWVyY2hhbnQiOmZhbHNlLCJ2ZXJpZmllZEJhbmtBY2NvdW50Ijp0cnVlLCJwbGF5RXZlbnRMb2JieSI6ZmFsc2UsImN1c3RvbWVySWQiOjEzMDA1NTkwMCwiYWZmSWQiOiJjYjBhYTlmYS1mMjQ5LTQ2MDQtYjM1NS1lMDIwOGIxOTIwOWMiLCJiYW5uZWQiOmZhbHNlLCJicmFuZCI6InN1bi53aW4iLCJ0aW1lc3RhbXAiOjE3NTM0MDg4MjkyOTMsImxvY2tHYW1lcyI6W10sImFtb3VudCI6MCwibG9ja0NoYXQiOmZhbHNlLCJwaG9uZVZlcmlmaWVkIjpmYWxzZSwiaXBBZGRyZXNzIjoiMTE2Ljk5LjI1My41NyIsIm11dGUiOmZhbHNlLCJhdmF0YXIiOiJodHRwczovL2ltYWdlcy5zd2luc2hvcC5uZXQvaW1hZ2VzL2F2YXRhci9hdmF0YXJfMTEucG5nIiwicGxhdGZvcm1JZCI6MiwidXNlcklkIjoiY2IwYWE5ZmEtZjI0OS00NjA0LWIzNTUtZTAyMDhiMTkyMDljIiwicmVnVGltZSI6MTY5NzAyNDMyMjgyMSwicGhvbmUiOiIiLCJkZXBvc2l0Ijp0cnVlLCJ1c2VybmFtZSI6IlNDX25ndXllbnZhbnRpbmhuZSJ9.Pl_ypuqq5pLvcU8vu7IeNajz0c9OKL2o6qwnyxTMLXI";

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
        signature: "6EC050742F7741E2048E5FA2618A92E8B91185B105B0AF60BD17CE2E4EA6F7E21D755C49257F6D8C6E8942AD7A42678121DB543DC4453EB2944AC23A05E78B3319D0C2572C88ABDD8B8E4DBEB6C84AB68899BA35FFD28723D3AC1D28B82AF7BE3756705989DA14B5F77D2EC3932B8D5451F7DCF3E7B2DF3FDC5B55A92E50699C",
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
