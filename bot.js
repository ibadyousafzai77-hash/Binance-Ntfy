const https = require("https");
const http = require("http");

const SCAN_URL = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=24h";
const NTFY_TOPIC = "crypto-signals-bot-2024";

function fetchUrl(url) {
  return new Promise(function (resolve, reject) {
    const lib = url.startsWith("https") ? https : http;
    lib.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      var data = "";
      res.on("data", function (c) { data += c; });
      res.on("end", function () {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("JSON parse failed: " + url)); }
      });
    }).on("error", reject);
  });
}

function fmt(n) {
  if (!n || isNaN(n)) return "N/A";
  if (n >= 10000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 100) return n.toFixed(2);
  if (n >= 1) return n.toFixed(3);
  if (n >= 0.01) return n.toFixed(4);
  return n.toFixed(6);
}

function nowStr() { return new Date().toUTCString().slice(0, 25); }

function scoreSignal(c) {
  var change = c.price_change_percentage_24h || 0;
  var high = c.high_24h || 0;
  var low = c.low_24h || 0;
  var price = c.current_price || 0;
  var open = price / (1 + change / 100);
  var range = high - low;
  var position = range > 0 ? ((price - low) / range) * 100 : 50;
  var aboveOpen = price > open;
  var direction;
  if (position > 65 && change > 1 && aboveOpen) direction = "LONG";
  else if (position < 35 && change < -1 && !aboveOpen) direction = "SHORT";
  else if (change > 3) direction = "LONG";
  else if (change < -3) direction = "SHORT";
  else if (position > 60 && aboveOpen) direction = "LONG";
  else if (position < 40 && !aboveOpen) direction = "SHORT";
  else direction = change >= 0 ? "LONG" : "SHORT";
  var posScore = direction === "LONG" ? (position - 50) : (50 - position);
  var score = Math.abs(change) * 2 + Math.max(posScore, 0) * 0.5;
  var strength = Math.abs(change) > 5 ? "STRONG" : Math.abs(change) > 2 ? "MEDIUM" : "WEAK";
  var spread = price * 0.003;
  var entryLow = direction === "LONG" ? price - spread : price;
  var entryHigh = direction === "LONG" ? price : price + spread;
  var step = Math.max((range / (price || 1)) * 100 * 0.35, 1.2);
  var mult = direction === "LONG" ? 1 : -1;
  var tp1 = price * (1 + mult * step * 0.8 / 100);
  var tp2 = price * (1 + mult * step * 1.5 / 100);
  var tp3 = price * (1 + mult * step * 2.5 / 100);
  var sl = price * (1 - mult * step * 0.6 / 100);
  return { score, direction, strength, price, high, low, change, position: position.toFixed(0), entryLow, entryHigh, tp1, tp2, tp3, sl, symbol: (c.symbol || "").toUpperCase(), name: c.name };
}

async function getTopSignals() {
  var coins = await fetchUrl(SCAN_URL);
  if (!Array.isArray(coins)) throw new Error("Market data fetch failed");
  var scored = coins
    .filter(function (c) { return c.current_price > 0 && c.high_24h > 0 && c.low_24h > 0; })
    .map(function (c) { return Object.assign({ id: c.id }, scoreSignal(c)); })
    .sort(function (a, b) { return b.score - a.score; });
  return [scored[0], scored[1]];
}

async function getTrendingCoins() {
  try {
    var data = await fetchUrl("https://api.coingecko.com/api/v3/search/trending");
    return data.coins.slice(0, 6).map(function (c) { return { name: c.item.name, symbol: c.item.symbol.toUpperCase() }; });
  } catch (e) { return []; }
}

async function getTopMovers() {
  try {
    var all = await fetchUrl(SCAN_URL);
    if (!Array.isArray(all)) return { gainers: [], losers: [] };
    var sorted = all.slice().sort(function (a, b) { return b.price_change_percentage_24h - a.price_change_percentage_24h; });
    var gainers = sorted.slice(0, 5).map(function (c) { return { symbol: c.symbol.toUpperCase(), change: c.price_change_percentage_24h }; });
    var losers = sorted.slice(-5).reverse().map(function (c) { return { symbol: c.symbol.toUpperCase(), change: c.price_change_percentage_24h }; });
    return { gainers, losers };
  } catch (e) { return { gainers: [], losers: [] }; }
}

function buildSignalPost(sig, isSecond) {
  var dir = sig.direction;
  var emoji = dir === "LONG" ? "🟢" : "🔴";
  var chgSign = sig.change >= 0 ? "+" : "";
  var posLabel = Number(sig.position) > 70 ? "Near Day High 📈" : Number(sig.position) < 30 ? "Near Day Low 📉" : "Mid Range ➡️";
  var strengthEmoji = sig.strength === "STRONG" ? "🔥🔥" : sig.strength === "MEDIUM" ? "⚡⚡" : "💧";
  var label = isSecond ? "SIGNAL #2" : "SIGNAL #1";
  var hashtags = "#" + sig.symbol + " #" + sig.name.replace(/\s+/g, "") +
    " #" + sig.symbol + "USDT #CryptoSignals #" + dir +
    " #CryptoTrading #Binance #BinanceSquare #Futures" +
    " #Altcoins #Crypto #TradingSignals #CryptoAlert" +
    " #Bitcoin #BTC #CryptoCommunity #DYOR #Blockchain #Web3";
  return emoji + " " + sig.symbol + "USDT — " + dir + " | " + label + "\n\n" +
    "━━━━━━━━━━━━━━━━━━━\n" +
    (dir === "LONG" ? "📈" : "📉") + " Direction: " + dir + "  " + strengthEmoji + " " + sig.strength + "\n" +
    "━━━━━━━━━━━━━━━━━━━\n\n" +
    "📍 Entry Zone:\n   " + fmt(sig.entryLow) + " – " + fmt(sig.entryHigh) + "\n\n" +
    "🎯 Take Profit:\n" +
    "   TP1 ➜ " + fmt(sig.tp1) + "\n" +
    "   TP2 ➜ " + fmt(sig.tp2) + "\n" +
    "   TP3 ➜ " + fmt(sig.tp3) + "\n\n" +
    "🛑 Stop Loss: " + fmt(sig.sl) + "\n\n" +
    "⚙️ Leverage: 2x – 5x (low leverage, safe)\n\n" +
    "━━━━━━━━━━━━━━━━━━━\n" +
    "📊 " + sig.name + " Live Data\n" +
    "━━━━━━━━━━━━━━━━━━━\n" +
    "💰 Price:      " + fmt(sig.price) + " USDT\n" +
    "📈 24h Change: " + chgSign + sig.change.toFixed(2) + "%\n" +
    "🔝 24h High:   " + fmt(sig.high) + "\n" +
    "🔻 24h Low:    " + fmt(sig.low) + "\n" +
    "📌 Day Range:  " + posLabel + " (" + sig.position + "%)\n" +
    "🏆 Signal Score: " + sig.score.toFixed(1) + "/100\n\n" +
    "⏰ " + nowStr() + " UTC\n\n" +
    "⚠️ Not financial advice. Always DYOR!\n\n" +
    hashtags;
}

var VIRAL_TEMPLATES = [
  function(trending, movers) {
    var gainLine = movers.gainers.slice(0, 4).map(function (g) { return "🟢 " + g.symbol + " +" + g.change.toFixed(2) + "%"; }).join("\n");
    var loseLine = movers.losers.slice(0, 4).map(function (l) { return "🔴 " + l.symbol + " " + l.change.toFixed(2) + "%"; }).join("\n");
    var trendLine = trending.slice(0, 6).map(function (t, i) { return ["🥇","🥈","🥉","4️⃣","5️⃣","6️⃣"][i] + " " + t.name + " ($" + t.symbol + ")"; }).join("\n");
    return "🔥 CRYPTO MARKET UPDATE 🔥\n⏰ " + nowStr() + " UTC\n\n" +
      "━━━━━━━━━━━━━━━━━━━\n🚀 TOP GAINERS TODAY\n━━━━━━━━━━━━━━━━━━━\n" + (gainLine || "Loading...") + "\n\n" +
      "━━━━━━━━━━━━━━━━━━━\n💥 BIGGEST DROPS\n━━━━━━━━━━━━━━━━━━━\n" + (loseLine || "Loading...") + "\n\n" +
      "━━━━━━━━━━━━━━━━━━━\n📈 TRENDING NOW\n━━━━━━━━━━━━━━━━━━━\n" + (trendLine || "Loading...") + "\n\n" +
      "💡 Market Insight:\n• BTC dominance drops = Altseason near\n• Volume spike + breakout = Best entry\n• Watch trending coins for early moves\n\n" +
      "🧠 Trade smart. Protect your capital.\n⚠️ DYOR. Not financial advice.\n\n" +
      "#CryptoMarket #Altcoins #Bitcoin #BTC #Ethereum #ETH #CryptoSignals #Trending #Binance #BinanceSquare #Crypto #Altseason #DYOR #CryptoCommunity #Web3 #DeFi #Blockchain #MarketUpdate #TradingSignals #CryptoAlert";
  },
  function(trending, movers) {
    var trendLine = trending.slice(0, 6).map(function (t, i) { return (i+1) + ". " + t.name + " ($" + t.symbol + ") 🔥"; }).join("\n");
    var top3gain = movers.gainers.slice(0, 3).map(function (g) { return "✅ " + g.symbol + " is up " + g.change.toFixed(1) + "% today!"; }).join("\n");
    return "🌐 WHAT'S HOT IN CRYPTO RIGHT NOW?\n\n" +
      "━━━━━━━━━━━━━━━━━━━\n🔥 MOST SEARCHED COINS\n━━━━━━━━━━━━━━━━━━━\n" + (trendLine || "Loading...") + "\n\n" +
      "━━━━━━━━━━━━━━━━━━━\n💚 PUMPING HARD\n━━━━━━━━━━━━━━━━━━━\n" + (top3gain || "Loading...") + "\n\n" +
      "━━━━━━━━━━━━━━━━━━━\n📌 STRATEGY OF THE DAY\n━━━━━━━━━━━━━━━━━━━\n" +
      "1️⃣ Wait for BTC direction first\n2️⃣ Enter alts when BTC stabilizes\n3️⃣ Always set Stop Loss before entry\n4️⃣ Take partial profits at TP1\n5️⃣ Never invest more than you can lose\n\n" +
      "💎 Diamond hands win long term.\n🧠 Smart traders follow the data.\n\n" +
      "⏰ " + nowStr() + " UTC\n⚠️ DYOR. Not financial advice.\n\n" +
      "#CryptoStrategy #Bitcoin #BTC #Altcoins #CryptoTips #Binance #BinanceSquare #Trending #CryptoCommunity #DYOR #Web3 #Blockchain #DeFi #CryptoTrading #Hodl #BullMarket #Crypto #CryptoSignals #TradingTips #CryptoNews";
  }
];

function getImageUrl(type, symbol, direction) {
  var prompt;
  if (type === "signal") {
    var mood = direction === "LONG" ? "bullish green upward" : "bearish red downward";
    prompt = symbol + " cryptocurrency " + mood + " trading chart signal professional dark background golden yellow neon glow";
  } else if (type === "viral1") {
    prompt = "cryptocurrency market update bitcoin ethereum trending coins golden bull dark background professional crypto trading";
  } else {
    prompt = "crypto trading strategy bitcoin altcoins portfolio management professional dark neon glow digital art";
  }
  return "https://image.pollinations.ai/prompt/" + encodeURIComponent(prompt) + "?width=800&height=450&seed=" + Math.floor(Date.now()/60000) + "&nologo=true";
}

function sendNtfy(title, message, imageUrl) {
  return new Promise(function (resolve, reject) {
    var body = Buffer.from(message, "utf8");
    var safeTitle = Buffer.from(title).toString("base64");
    var headers = {
      "Title": "base64," + safeTitle,
      "Priority": "high",
      "Tags": "chart_increasing,bell",
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": body.length,
    };
    if (imageUrl) {
      var safeAttach = imageUrl.replace(/[^\x20-\x7E]/g, "");
      headers["Attach"] = safeAttach;
    }
    var options = {
      hostname: "ntfy.sh",
      path: "/" + NTFY_TOPIC,
      method: "POST",
      headers: headers,
    };
    var req = https.request(options, function (res) {
      var data = "";
      res.on("data", function (c) { data += c; });
      res.on("end", function () {
        console.log("ntfy response:", res.statusCode, data.slice(0, 100));
        resolve(data);
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log("=== Crypto Signal Bot ===");
  console.log("Time:", new Date().toISOString());

  // Cycle of 4: Signal1, Signal2, Viral1, Viral2 — har 15 min
  var runNum = Math.floor(Date.now() / (15 * 60 * 1000));
  var slot = runNum % 4;
  var slotName = ["Signal 1", "Signal 2", "Viral Post 1", "Viral Post 2"][slot];
  console.log("Run #" + runNum + " | Slot " + slot + ": " + slotName);

  var content, title, imageUrl;

  if (slot === 0 || slot === 1) {
    console.log("Scanning top 100 coins for strongest signals...");
    var topSignals = await getTopSignals();
    var sig = topSignals[slot];
    if (!sig) throw new Error("No signal found");
    console.log("Best signal:", sig.symbol, sig.direction, sig.strength, "Score:", sig.score.toFixed(1));
    content = buildSignalPost(sig, slot === 1);
    title = (sig.direction === "LONG" ? "🟢" : "🔴") + " " + sig.symbol + " " + sig.direction + " | " + sig.strength + " — Copy & Post!";
    imageUrl = getImageUrl("signal", sig.symbol, sig.direction);
  } else {
    console.log("Building viral post #" + (slot - 1) + "...");
    var fetched = await Promise.all([getTrendingCoins(), getTopMovers()]);
    var templateIdx = slot - 2;
    content = VIRAL_TEMPLATES[templateIdx](fetched[0], fetched[1]);
    title = slot === 2 ? "🔥 Market Update Ready — Copy & Post!" : "🌐 Crypto Trending Post — Copy & Post!";
    imageUrl = getImageUrl(slot === 2 ? "viral1" : "viral2", "", "");
  }

  console.log("Sending ntfy notification with AI image...");
  await sendNtfy(title, content, imageUrl);
  console.log("✅ Done! Notification sent to phone.");
  console.log("\n--- CONTENT PREVIEW ---");
  console.log(content.slice(0, 300) + "...");
}

main().catch(function (err) {
  console.error("❌ ERROR:", err.message);
  process.exit(1);
});
