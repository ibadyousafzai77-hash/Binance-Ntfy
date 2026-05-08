const https = require("https");

// Sabse strong signal dhundne ke liye top 100 coins scan karega
const SCAN_URL = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=24h";

function fetchUrl(url) {
  return new Promise(function (resolve, reject) {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, function (res) {
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

// Har coin ka signal score calculate karo
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

  // Score: change ka absolute value + range position ki clarity
  var posScore = direction === "LONG" ? (position - 50) : (50 - position);
  var score = Math.abs(change) * 2 + Math.max(posScore, 0) * 0.5;

  var strength;
  if (Math.abs(change) > 5) strength = "STRONG";
  else if (Math.abs(change) > 2) strength = "MEDIUM";
  else strength = "WEAK";

  var spread = price * 0.003;
  var entryLow = direction === "LONG" ? price - spread : price;
  var entryHigh = direction === "LONG" ? price : price + spread;
  var step = Math.max((range / (price || 1)) * 100 * 0.35, 1.2);
  var mult = direction === "LONG" ? 1 : -1;
  var tp1 = price * (1 + mult * step * 0.8 / 100);
  var tp2 = price * (1 + mult * step * 1.5 / 100);
  var tp3 = price * (1 + mult * step * 2.5 / 100);
  var sl = price * (1 - mult * step * 0.6 / 100);

  return {
    score, direction, strength, price, high, low, change,
    position: position.toFixed(0), entryLow, entryHigh,
    tp1, tp2, tp3, sl,
    symbol: (c.symbol || "").toUpperCase(),
    name: c.name,
    image: c.image || ""
  };
}

async function getTopSignals() {
  var coins = await fetchUrl(SCAN_URL);
  if (!Array.isArray(coins)) throw new Error("Market data fetch failed");

  // Har coin ka score nikalo
  var scored = coins
    .filter(function (c) { return c.current_price > 0 && c.high_24h > 0 && c.low_24h > 0; })
    .map(function (c) { return Object.assign({ id: c.id }, scoreSignal(c)); })
    .sort(function (a, b) { return b.score - a.score; });

  // Top 2 strongest signals
  return [scored[0], scored[1]];
}

async function getTrendingCoins() {
  try {
    var data = await fetchUrl("https://api.coingecko.com/api/v3/search/trending");
    return data.coins.slice(0, 6).map(function (c) {
      return { name: c.item.name, symbol: c.item.symbol.toUpperCase() };
    });
  } catch (e) { return []; }
}

async function getTopMovers() {
  try {
    var all = await fetchUrl(SCAN_URL);
    if (!Array.isArray(all)) return { gainers: [], losers: [] };
    var sorted = all.slice().sort(function (a, b) {
      return b.price_change_percentage_24h - a.price_change_percentage_24h;
    });
    var gainers = sorted.slice(0, 5).map(function (c) {
      return { symbol: c.symbol.toUpperCase(), change: c.price_change_percentage_24h };
    });
    var losers = sorted.slice(-5).reverse().map(function (c) {
      return { symbol: c.symbol.toUpperCase(), change: c.price_change_percentage_24h };
    });
    return { gainers, losers };
  } catch (e) { return { gainers: [], losers: [] }; }
}

function buildSignalPost(sig, isSecond) {
  var dir = sig.direction;
  var emoji = dir === "LONG" ? "🟢" : "🔴";
  var chgSign = sig.change >= 0 ? "+" : "";
  var posLabel = Number(sig.position) > 70 ? "Near Day High 📈" : Number(sig.position) < 30 ? "Near Day Low 📉" : "Mid Range ➡️";
  var strengthEmoji = sig.strength === "STRONG" ? "🔥🔥" : sig.strength === "MEDIUM" ? "⚡⚡" : "💧";
  var dirEmoji = dir === "LONG" ? "📈" : "📉";
  var label = isSecond ? "SIGNAL #2" : "SIGNAL #1";

  // Viral trending hashtags
  var hashtags = "#" + sig.symbol + " #" + sig.name.replace(/\s+/g, "") + " #" + sig.symbol + "USDT " +
    "#CryptoSignals #" + dir + " #CryptoTrading #Binance #BinanceSquare " +
    "#Futures #Altcoins #Crypto #TradingSignals #CryptoAlert " +
    "#" + (sig.strength === "STRONG" ? "StrongSignal" : sig.strength === "MEDIUM" ? "MediumSignal" : "WeakSignal") + " " +
    "#Bitcoin #BTC #CryptoCommunity #DYOR";

  return emoji + " " + sig.symbol + "USDT — " + dir + " | " + label + "\n\n" +
    "━━━━━━━━━━━━━━━━━━━\n" +
    dirEmoji + " Direction: " + dir + "  " + strengthEmoji + " " + sig.strength + " SIGNAL\n" +
    "━━━━━━━━━━━━━━━━━━━\n\n" +
    "📍 Entry Zone:\n" +
    "   " + fmt(sig.entryLow) + " – " + fmt(sig.entryHigh) + "\n\n" +
    "🎯 Take Profit Targets:\n" +
    "   TP1 ➜ " + fmt(sig.tp1) + "\n" +
    "   TP2 ➜ " + fmt(sig.tp2) + "\n" +
    "   TP3 ➜ " + fmt(sig.tp3) + "\n\n" +
    "🛑 Stop Loss: " + fmt(sig.sl) + "\n\n" +
    "⚙️ Suggested Leverage: 2x – 5x\n" +
    "(Low leverage = Lower risk)\n\n" +
    "━━━━━━━━━━━━━━━━━━━\n" +
    "📊 Live Market Data — " + sig.name + "\n" +
    "━━━━━━━━━━━━━━━━━━━\n" +
    "💰 Price:       " + fmt(sig.price) + " USDT\n" +
    "📈 24h Change:  " + chgSign + sig.change.toFixed(2) + "%\n" +
    "🔝 24h High:    " + fmt(sig.high) + "\n" +
    "🔻 24h Low:     " + fmt(sig.low) + "\n" +
    "📌 Day Range:   " + posLabel + " (" + sig.position + "%)\n" +
    "🏆 Signal Score: " + sig.score.toFixed(1) + "/100\n\n" +
    "⏰ Time: " + nowStr() + " UTC\n\n" +
    "━━━━━━━━━━━━━━━━━━━\n" +
    "⚠️ Not financial advice. Always DYOR.\n" +
    "Manage your risk carefully!\n" +
    "━━━━━━━━━━━━━━━━━━━\n\n" +
    hashtags;
}

async function buildViralPost(trending, movers) {
  var gainLine = movers.gainers.slice(0, 4).map(function (g) {
    return "🟢 " + g.symbol + " +" + g.change.toFixed(2) + "%";
  }).join("\n");
  var loseLine = movers.losers.slice(0, 4).map(function (l) {
    return "🔴 " + l.symbol + " " + l.change.toFixed(2) + "%";
  }).join("\n");
  var trendLine = trending.slice(0, 6).map(function (t, i) {
    var medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣"];
    return medals[i] + " " + t.name + " ($" + t.symbol + ")";
  }).join("\n");

  return "🔥 CRYPTO MARKET UPDATE 🔥\n" +
    "⏰ " + nowStr() + " UTC\n\n" +
    "━━━━━━━━━━━━━━━━━━━\n" +
    "🚀 TODAY'S TOP GAINERS\n" +
    "━━━━━━━━━━━━━━━━━━━\n" +
    (gainLine || "Data loading...") + "\n\n" +
    "━━━━━━━━━━━━━━━━━━━\n" +
    "💥 TODAY'S BIGGEST DROPS\n" +
    "━━━━━━━━━━━━━━━━━━━\n" +
    (loseLine || "Data loading...") + "\n\n" +
    "━━━━━━━━━━━━━━━━━━━\n" +
    "📈 TRENDING NOW (CoinGecko)\n" +
    "━━━━━━━━━━━━━━━━━━━\n" +
    (trendLine || "Data loading...") + "\n\n" +
    "━━━━━━━━━━━━━━━━━━━\n" +
    "💡 MARKET INSIGHT\n" +
    "━━━━━━━━━━━━━━━━━━━\n" +
    "📌 When BTC dominance drops → Altseason incoming\n" +
    "📌 Volume spike + breakout = Best entry signal\n" +
    "📌 Watch trending coins for early opportunities\n" +
    "📌 Always wait for confirmation before entering\n\n" +
    "🧠 Trade smart. Stay patient. Protect capital.\n\n" +
    "━━━━━━━━━━━━━━━━━━━\n" +
    "⚠️ DYOR. Not financial advice.\n" +
    "━━━━━━━━━━━━━━━━━━━\n\n" +
    "#CryptoMarket #Altcoins #Bitcoin #BTC #Ethereum #ETH " +
    "#CryptoSignals #Trending #Binance #BinanceSquare " +
    "#Crypto #CryptoTrading #Altseason #DYOR " +
    "#CryptoCommunity #Web3 #Blockchain #DeFi " +
    "#CryptoAlert #MarketUpdate #TradingSignals " +
    "#TopGainers #CryptoNews #BullMarket #Hodl";
}

function postToSquare(content) {
  return new Promise(function (resolve, reject) {
    var apiKey = process.env.BINANCE_SQUARE_API_KEY;
    if (!apiKey) { reject(new Error("BINANCE_SQUARE_API_KEY not set")); return; }
    var body = JSON.stringify({ bodyTextOnly: content });
    var options = {
      hostname: "www.binance.com",
      path: "/bapi/composite/v1/public/pgc/openApi/content/add",
      method: "POST",
      headers: {
        "X-Square-OpenAPI-Key": apiKey,
        "Content-Type": "application/json",
        "clienttype": "binanceSkill",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    var req = https.request(options, function (res) {
      var data = "";
      res.on("data", function (c) { data += c; });
      res.on("end", function () {
        try {
          var parsed = JSON.parse(data);
          if (parsed.code === "000000" && parsed.data && parsed.data.id) {
            resolve("https://www.binance.com/square/post/" + parsed.data.id);
          } else {
            reject(new Error("Binance error: " + parsed.code + " — " + (parsed.message || "unknown")));
          }
        } catch (e) { reject(new Error("Bad response from Binance")); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log("=== Binance Square Bot ===");
  console.log("Time:", new Date().toISOString());

  // Cycle: 0=Signal1, 1=Signal2, 2=Viral — har 15 min baad
  var runNum = Math.floor(Date.now() / (30 * 60 * 1000));
  var slot = runNum % 3;
  console.log("Run #" + runNum + " | Slot:", slot, slot === 0 ? "(Signal 1)" : slot === 1 ? "(Signal 2)" : "(Viral Update)");

  var content;

  if (slot === 0 || slot === 1) {
    console.log("Scanning top 100 coins for strongest signals...");
    var topSignals = await getTopSignals();
    var sig = topSignals[slot];
    if (!sig) throw new Error("No signal found");
    console.log("Best signal:", sig.symbol, sig.direction, sig.strength, "Score:", sig.score.toFixed(1));
    content = buildSignalPost(sig, slot === 1);
  } else {
    console.log("Building viral market update...");
    var [trending, movers] = await Promise.all([getTrendingCoins(), getTopMovers()]);
    content = await buildViralPost(trending, movers);
  }

  var url = await postToSquare(content);
  console.log("✅ SUCCESS! Post live at:", url);
}

main().catch(function (err) {
  console.error("❌ FAILED:", err.message);
  process.exit(1);
});
