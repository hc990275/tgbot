/**
 * Telegram 终极全能机器人 (Final Version)
 * 包含功能：
 * 1. 自动防御: 敏感词拦截(从GitHub读取)、黑名单踢人、进群验证、AI鉴别
 * 2. 群管指令: /ban, /kick, /sb, /warn, /unban
 * 3. 配置管理: /addword, /delword, /block, /unblock (自动同步GitHub)
 * 4. 抽奖系统: /create, /draw, /listlottery, /deletelottery
 * 5. 工具指令: /id, /json, /show, /alladmin
 */

const TG_API_BASE = "https://api.telegram.org/bot";
const CONFIG_FILE_PATH = "config.json"; 

// 缓存配置 (60秒刷新一次，避免频繁请求GitHub)
let CACHED_CONFIG = null;
let LAST_FETCH_TIME = 0;
const CACHE_TTL = 60 * 1000; 

export default {
  async fetch(request, env, ctx) {
    if (!env.TG_TOKEN || !env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.GITHUB_REPO) {
      return new Response("Error: Missing ENV variables", { status: 500 });
    }

    if (request.method === "POST") {
      try {
        const update = await request.json();
        
        // 📥 预加载配置 (这里包含了你的敏感词库!)
        const config = await getConfigWithCache(env);
        
        if (update.message) {
          await handleMessage(update.message, env, config);
        } else if (update.callback_query) {
          await handleCallback(update.callback_query, env);
        }
      } catch (e) {
        console.error("Runtime Error:", e);
      }
    }
    return new Response("OK");
  }
};

// ================= 核心消息处理 =================

async function handleMessage(msg, env, config) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  let text = msg.text;

  if (!text) return;

  // --- 解析指令 (移除 @后缀) ---
  const parts = text.split(" ");
  const commandRaw = parts[0].split("@")[0].toLowerCase(); 
  const args = parts.slice(1).join(" ").trim();
  const replyMsg = msg.reply_to_message;

  // ================= 1. 公共工具指令 =================

  // /id
  if (commandRaw === "/id") {
    let info = `🆔 <b>查询结果:</b>\n\n👤 <b>你的 ID:</b> <code>${userId}</code>\n📍 <b>群组 ID:</b> <code>${chatId}</code>`;
    if (replyMsg) info += `\n\n👉 <b>对方 ID:</b> <code>${replyMsg.from.id}</code>`;
    await sendMessage(env, chatId, info, "HTML");
    return;
  }

  // /json
  if (commandRaw === "/json") {
    const targetData = replyMsg || msg;
    const jsonStr = JSON.stringify(targetData, null, 2);
    const safeJson = jsonStr.length > 3000 ? jsonStr.substring(0, 3000) + "..." : jsonStr;
    await sendMessage(env, chatId, `<pre><code class="language-json">${safeJson}</code></pre>`, "HTML");
    return;
  }

  // /show
  if (commandRaw === "/show") {
    const target = replyMsg ? replyMsg.from : msg.from;
    const info = `
👤 <b>用户信息</b>
━━━━━━━━
🆔 <b>ID:</b> <code>${target.id}</code>
👤 <b>姓名:</b> ${target.first_name} ${target.last_name || ""}
🔗 <b>账号:</b> ${target.username ? "@"+target.username : "无"}
🤖 <b>机器人:</b> ${target.is_bot ? "是" : "否"}
    `;
    await sendMessage(env, chatId, info, "HTML");
    return;
  }

  // /alladmin
  if (commandRaw === "/alladmin") {
    const admins = await getChatAdministrators(env, chatId);
    if (!admins) return;
    const mentions = admins.filter(a => !a.user.is_bot).map(a => `<a href="tg://user?id=${a.user.id}">@${a.user.first_name}</a>`).join(" ");
    await sendMessage(env, chatId, `📢 <b>召唤管理员:</b>\n${mentions || "无人类管理员"}`, "HTML");
    return;
  }

  // ================= 2. 管理员指令 =================

  if (commandRaw.startsWith("/")) {
    const adminCmds = [
      "/addword", "/delword", "/block", "/unblock", "/sb",
      "/ban", "/unban", "/kick", "/warn",
      "/create", "/draw", "/listlottery", "/deletelottery"
    ];

    if (adminCmds.includes(commandRaw)) {
      const isAdmin = await checkIsAdmin(env, chatId, userId);
      
      if (isAdmin) {
        // --- 敏感词管理 (存入GitHub) ---
        if (commandRaw === "/addword") {
          let word = args;
          if (!word && replyMsg && replyMsg.text) word = replyMsg.text;
          if (word) await updateConfigCommand(env, chatId, "add_word", word);
          else await sendMessage(env, chatId, "⚠️ 用法: `/addword 关键词` 或 回复消息", "Markdown");
          return;
        }

        if (commandRaw === "/delword") {
          let word = args;
          if (!word && replyMsg && replyMsg.text) word = replyMsg.text;
          if (word) await updateConfigCommand(env, chatId, "del_word", word);
          else await sendMessage(env, chatId, "⚠️ 用法: `/delword 关键词`", "Markdown");
          return;
        }

        // --- 黑名单 ---
        if (commandRaw === "/block") {
          if (replyMsg) await updateConfigCommand(env, chatId, "block_user", replyMsg.from.id, replyMsg.from.first_name);
          else await sendMessage(env, chatId, "⚠️ 请回复要拉黑的人。");
          return;
        }
        if (commandRaw === "/unblock") {
          const targetId = parseInt(args);
          if (!isNaN(targetId)) await updateConfigCommand(env, chatId, "unblock_user", targetId);
          else await sendMessage(env, chatId, "⚠️ 用法: `/unblock 数字ID`");
          return;
        }
        if (commandRaw === "/sb" && replyMsg) {
          await updateConfigCommand(env, chatId, "block_user", replyMsg.from.id, replyMsg.from.first_name);
          await sendMessage(env, chatId, `🤡 <b>SB 已送走!</b>\n用户 ${replyMsg.from.first_name} 已永久拉黑。`, "HTML");
          return;
        }

        // --- 执法 ---
        if (commandRaw === "/ban" && replyMsg) {
          await restrictUser(env, chatId, replyMsg.from.id, false);
          await sendMessage(env, chatId, `🔇 用户 ${replyMsg.from.first_name} 已被禁言。`);
          return;
        }
        if (commandRaw === "/unban" && replyMsg) {
          await restrictUser(env, chatId, replyMsg.from.id, true);
          await sendMessage(env, chatId, `🔊 用户 ${replyMsg.from.first_name} 已解封。`);
          return;
        }
        if (commandRaw === "/kick" && replyMsg) {
          await kickUser(env, chatId, replyMsg.from.id);
          await sendMessage(env, chatId, `👢 用户 ${replyMsg.from.first_name} 已被踢出。`);
          return;
        }
        if (commandRaw === "/warn" && replyMsg) {
          await sendMessage(env, chatId, `⚠️ <b>警告</b>\n请用户 <a href="tg://user?id=${replyMsg.from.id}">${replyMsg.from.first_name}</a> 注意言行！`, "HTML");
          return;
        }

        // --- 抽奖系统 ---
        if (commandRaw === "/create") {
            if (!args) { await sendMessage(env, chatId, "⚠️ 用法: `/create 奖品名`"); return; }
            const lotId = Date.now().toString();
            await updateConfigCommand(env, chatId, "create_lottery", { id: lotId, prize: args, creator: userId });
            return;
        }
        if (commandRaw === "/listlottery") {
            if (!config.lotteries || config.lotteries.length === 0) { await sendMessage(env, chatId, "📭 暂无抽奖活动。"); return; }
            let msg = "🎁 <b>当前抽奖:</b>\n";
            config.lotteries.forEach((l, i) => msg += `${i+1}. <b>${l.prize}</b> (ID: <code>${l.id}</code>) - ${l.participants ? l.participants.length : 0}人\n`);
            await sendMessage(env, chatId, msg, "HTML");
            return;
        }
        if (commandRaw === "/draw") {
            let target = null;
            if (args) target = config.lotteries.find(l => l.id == args);
            else if (config.lotteries && config.lotteries.length === 1) target = config.lotteries[0];

            if (!target) { await sendMessage(env, chatId, "⚠️ 请输入抽奖ID: `/draw ID`", "Markdown"); return; }
            if (!target.participants || target.participants.length === 0) { await sendMessage(env, chatId, "😅 还没人参加呢！"); return; }
            
            const winnerId = target.participants[Math.floor(Math.random() * target.participants.length)];
            await sendMessage(env, chatId, `🎉 <b>开奖啦！</b>\n🎁 奖品：${target.prize}\n💎 中奖者：<a href="tg://user?id=${winnerId}">用户${winnerId}</a>`, "HTML");
            await updateConfigCommand(env, chatId, "delete_lottery", target.id);
            return;
        }
        if (commandRaw === "/deletelottery") {
            if (!args) { await sendMessage(env, chatId, "⚠️ 用法: `/deletelottery ID`"); return; }
            await updateConfigCommand(env, chatId, "delete_lottery", args);
            return;
        }
      } 
    }
  }

  // ================= 3. 自动防御系统 (敏感词在这里!) =================

  // A. 黑名单检查
  if (config.blocked_users && config.blocked_users.includes(userId)) {
    await deleteMessage(env, chatId, msg.message_id);
    await kickUser(env, chatId, userId);
    return;
  }

  // B. 进群验证
  if (msg.new_chat_members) {
    for (const member of msg.new_chat_members) {
      if (member.is_bot) continue;
      await restrictUser(env, chatId, member.id, false);
      const keyboard = { inline_keyboard: [[{ text: "🤖 点击验证", callback_data: `verify|${member.id}` }]] };
      await sendMessage(env, chatId, `欢迎 [${member.first_name}](tg://user?id=${member.id})！请在60秒内点击验证。`, "Markdown", keyboard);
    }
    await deleteMessage(env, chatId, msg.message_id);
    return;
  }

  // C. 敏感词拦截 (这里就是你找的功能！)
  // 逻辑：读取 config.bad_words 数组，看消息里有没有这些词
  if (text && config.bad_words && config.bad_words.length > 0) {
    const hitWord = config.bad_words.find(word => text.includes(word));
    if (hitWord) {
      // 1. 删消息
      await deleteMessage(env, chatId, msg.message_id);
      // 2. 禁言
      await restrictUser(env, chatId, userId, false, Math.floor(Date.now() / 1000) + 86400); 
      // 3. 警告
      await sendMessage(env, chatId, `🚫 <b>敏感词拦截</b>\n检测到 "<code>${hitWord}</code>"，已禁言。`, "HTML");
      return; 
    }
  }

  // D. AI 拦截 (可选)
  if (env.AI && text && text.length > 5 && !text.startsWith("/")) {
    try {
      const isSpam = await checkSpamWithAI(env, text);
      if (isSpam) {
        await deleteMessage(env, chatId, msg.message_id);
        await restrictUser(env, chatId, userId, false, Math.floor(Date.now() / 1000) + 86400);
        await sendMessage(env, chatId, `🤖 <b>AI拦截</b>\n识别到广告/诈骗，已处理。`, "HTML");
      }
    } catch (e) {}
  }
}

// ================= 回调处理 (验证/抽奖) =================

async function handleCallback(query, env) {
  const data = query.data;
  const userId = query.from.id;
  const msgId = query.message.message_id;
  const chatId = query.message.chat.id;

  if (data.startsWith("verify|")) {
    const targetId = parseInt(data.split("|")[1]);
    if (userId !== targetId) return await answerCallback(env, query.id, "❌ 别乱点！", true);
    await restrictUser(env, chatId, userId, true);
    await answerCallback(env, query.id, "✅ 验证通过！");
    await deleteMessage(env, chatId, msgId);
    await sendMessage(env, chatId, `🎉 欢迎新成员加入！`);
  }

  if (data.startsWith("join_lot|")) {
    const lotId = data.split("|")[1];
    try {
        const fileData = await fetchConfigFile(env);
        if (!fileData) throw new Error("Config error");
        let config = fileData.content;
        const index = config.lotteries ? config.lotteries.findIndex(l => l.id == lotId) : -1;
        
        if (index === -1) return await answerCallback(env, query.id, "❌ 抽奖已结束。", true);
        if (!config.lotteries[index].participants) config.lotteries[index].participants = [];
        if (config.lotteries[index].participants.includes(userId)) return await answerCallback(env, query.id, "⚠️ 你已经参与过了！", true);

        config.lotteries[index].participants.push(userId);
        await pushConfigFile(env, config, fileData.sha, `Join Lot ${lotId}`);
        CACHED_CONFIG = config; LAST_FETCH_TIME = Date.now();
        await answerCallback(env, query.id, "✅ 参与成功！", true);
    } catch (e) {
        await answerCallback(env, query.id, "❌ 忙碌中，请重试。", true);
    }
  }
}

// ================= 配置同步逻辑 =================

async function updateConfigCommand(env, chatId, action, value, extraName = "") {
  if (!["create_lottery", "delete_lottery"].includes(action)) await sendMessage(env, chatId, "⏳ 同步中...");
  
  try {
    const fileData = await fetchConfigFile(env);
    if (!fileData) return await sendMessage(env, chatId, "❌ GitHub 读取失败");

    let config = fileData.content;
    const sha = fileData.sha;
    let msg = "";
    if (!config.lotteries) config.lotteries = [];

    if (action === "add_word") {
      if (!config.bad_words.includes(value)) { config.bad_words.push(value); msg = `✅ 添加敏感词: <b>${value}</b>`; }
      else msg = `⚠️ 已存在`;
    } 
    else if (action === "del_word") {
      config.bad_words = config.bad_words.filter(w => w !== value); msg = `🗑️ 删除敏感词: <b>${value}</b>`;
    } 
    else if (action === "block_user") {
      if (!config.blocked_users.includes(value)) { 
        config.blocked_users.push(value); msg = `🚫 已拉黑 ID: ${value}`; await kickUser(env, chatId, value); 
      } else msg = `⚠️ 已在黑名单`;
    } 
    else if (action === "unblock_user") {
      config.blocked_users = config.blocked_users.filter(id => id !== value); msg = `✅ 已解封 ID: ${value}`;
    }
    else if (action === "create_lottery") {
        config.lotteries.push({ ...value, participants: [] });
        const kb = { inline_keyboard: [[{ text: "🎉 点击参与", callback_data: `join_lot|${value.id}` }]] };
        await sendMessage(env, chatId, `🎁 <b>新抽奖!</b>\n奖品: <b>${value.prize}</b>\n点击下方按钮参与!`, "HTML", kb);
        msg = null;
    }
    else if (action === "delete_lottery") {
        const init = config.lotteries.length;
        config.lotteries = config.lotteries.filter(l => l.id != value);
        msg = config.lotteries.length < init ? `🗑️ 抽奖已删除` : `⚠️ 找不到ID`;
    }

    if (await pushConfigFile(env, config, sha, `Update ${action}`)) {
      CACHED_CONFIG = config; LAST_FETCH_TIME = Date.now();
      if (msg) await sendMessage(env, chatId, msg, "HTML");
    } else await sendMessage(env, chatId, "❌ GitHub 写入失败");

  } catch (e) { await sendMessage(env, chatId, "❌ 错误: " + e.message); }
}

// ================= 工具函数 =================

async function fetchConfigFile(env) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${CONFIG_FILE_PATH}`;
  const resp = await fetch(url, { headers: { "Authorization": `token ${env.GITHUB_TOKEN}`, "User-Agent": "CF-Bot" }});
  if (!resp.ok) return null;
  const data = await resp.json();
  const rawContent = atob(data.content.replace(/\n/g, ''));
  return { content: JSON.parse(decodeURIComponent(escape(rawContent))), sha: data.sha };
}

async function pushConfigFile(env, contentObj, sha, commitMsg) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${CONFIG_FILE_PATH}`;
  const contentBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(contentObj, null, 2))));
  const resp = await fetch(url, {
    method: "PUT",
    headers: { "Authorization": `token ${env.GITHUB_TOKEN}`, "User-Agent": "CF-Bot", "Content-Type": "application/json" },
    body: JSON.stringify({ message: commitMsg, content: contentBase64, sha: sha })
  });
  return resp.ok;
}

async function getConfigWithCache(env) {
  const now = Date.now();
  if (CACHED_CONFIG && (now - LAST_FETCH_TIME < CACHE_TTL)) return CACHED_CONFIG;
  const data = await fetchConfigFile(env);
  if (data) { CACHED_CONFIG = data.content; LAST_FETCH_TIME = now; return data.content; }
  return CACHED_CONFIG || { bad_words: [], blocked_users: [], lotteries: [] };
}

async function checkIsAdmin(env, chatId, userId) {
  const resp = await fetch(`${TG_API_BASE}${env.TG_TOKEN}/getChatMember`, { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ chat_id: chatId, user_id: userId }) });
  if (resp.ok) { const data = await resp.json(); return ["creator", "administrator"].includes(data.result.status); }
  return false;
}

async function getChatAdministrators(env, chatId) {
  const resp = await fetch(`${TG_API_BASE}${env.TG_TOKEN}/getChatAdministrators`, { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ chat_id: chatId }) });
  if (resp.ok) { const data = await resp.json(); return data.result; }
  return null;
}

async function checkSpamWithAI(env, text) {
  const response = await env.AI.run('@cf/qwen/qwen1.5-7b-chat-awq', { messages: [{ role: 'system', content: 'Is this SPAM/AD/SCAM? Answer "SPAM" or "SAFE".' }, { role: 'user', content: text }] });
  return response.response.trim().toUpperCase().includes("SPAM");
}

async function sendMessage(env, chatId, text, parseMode = "Markdown", markup = null) {
  const body = { chat_id: chatId, text: text, parse_mode: parseMode };
  if (markup) body.reply_markup = markup;
  return await fetch(`${TG_API_BASE}${env.TG_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

async function deleteMessage(env, chatId, msgId) {
  return await fetch(`${TG_API_BASE}${env.TG_TOKEN}/deleteMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, message_id: msgId }) });
}

async function kickUser(env, chatId, userId) {
  return await fetch(`${TG_API_BASE}${env.TG_TOKEN}/banChatMember`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, user_id: userId }) });
}

async function restrictUser(env, chatId, userId, canSendMsg, untilDate = 0) {
  const permissions = canSendMsg ? { can_send_messages: true, can_send_media_messages: true } : { can_send_messages: false, can_send_media_messages: false };
  return await fetch(`${TG_API_BASE}${env.TG_TOKEN}/restrictChatMember`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, user_id: userId, permissions: permissions, until_date: untilDate }) });
}

async function answerCallback(env, callbackId, text, alert = false) {
  return await fetch(`${TG_API_BASE}${env.TG_TOKEN}/answerCallbackQuery`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ callback_query_id: callbackId, text: text, show_alert: alert }) });
}
