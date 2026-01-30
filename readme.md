---

# 🛡️ Telegram 全能群管机器人 (Cloudflare Workers 版)

这是一个基于 **Cloudflare Workers** 的无服务器 (Serverless) Telegram 群组管理机器人。它利用 **GitHub** 作为“数据库”存储配置，利用 **Cloudflare Workers AI** 进行智能垃圾信息拦截。

**✨ 特点：永久免费、无需服务器、响应速度快、功能全能。**

## 🚀 功能特性

### 🛡️ 自动防御系统

* **进群验证 (Captcha)**: 新人进群自动禁言，需在 60 秒内点击按钮验证“我是人类”。
* **关键词拦截**: 自动检测并删除包含敏感词的消息，并对发送者禁言（支持从 GitHub 动态更新词库）。
* **AI 智能鉴别**: 集成 Cloudflare Workers AI，智能识别广告、诈骗、博彩等违规内容。
* **黑名单机制**: 恶意用户自动踢出并永久拦截。

### 👮 群组管理

* **基础执法**: 禁言 (`/ban`)、解封 (`/unban`)、踢出 (`/kick`)、警告 (`/warn`)。
* **永久封禁**: 一键永久拉黑并踢出 (`/sb`)。
* **召唤管理**: 一键通知群内所有管理员 (`/alladmin`)。

### ⚙️ 动态配置 (无需改代码)

* **热更新**: 通过群内指令 (`/addword`, `/block`) 直接修改 GitHub 上的配置文件。
* **配置同步**: 机器人会自动拉取和推送 GitHub 仓库更新。

### 🎁 抽奖系统

* **完整流程**: 创建抽奖、查看列表、手动开奖、删除抽奖。
* **公平公正**: 随机抽取群内点击参与的真实用户。

### 🛠️ 实用工具

* **信息查询**: 获取用户 ID、群组 ID、用户信息卡片。
* **开发调试**: 查看消息的原始 JSON 数据。

---

## 🛠️ 部署指南

### 第一步：准备工作

1. **Telegram Bot**: 找 [@BotFather](https://t.me/BotFather) 申请一个机器人，获取 `Token`。
2. **GitHub 账号**:
* 创建一个**私有仓库** (例如命名为 `telegram-bot-config`)。
* 申请一个 **Personal Access Token (Classic)**，勾选 `repo` 权限。


3. **Cloudflare 账号**: 开通 Workers 功能（免费版即可）。

### 第二步：初始化配置文件

在你的 GitHub 仓库中，创建一个名为 `config.json` 的文件，内容如下：

```json
{
  "bad_words": [],
  "blocked_users": [],
  "lotteries": []
}

```

### 第三步：部署 Cloudflare Worker

1. 在 Cloudflare 后台创建一个新的 Worker。
2. 将 `worker.js` 的完整代码复制进去。
3. **绑定 AI 模型**:
* 进入 Worker 设置 -> **Settings** -> **Bindings**。
* 点击 **Add** -> **Workers AI**。
* Variable name 填写: `AI` (必须大写)。
* Model 选择: `@cf/qwen/qwen1.5-7b-chat-awq` (或其他你喜欢的文本生成模型)。



### 第四步：设置环境变量

在 Worker 的 **Settings** -> **Variables** 中添加以下变量：

| 变量名 | 说明 | 示例值 |
| --- | --- | --- |
| `TG_TOKEN` | 机器人的 Token | `123456:ABC-DEF...` |
| `GITHUB_TOKEN` | GitHub 访问令牌 | `ghp_xoP...` |
| `GITHUB_OWNER` | GitHub 用户名 | `yourname` |
| `GITHUB_REPO` | 存放配置的仓库名 | `telegram-bot-config` |

### 第五步：绑定 Webhook (激活机器人)

在浏览器中访问以下链接（替换为你自己的信息）：

```
https://api.telegram.org/bot<你的TG_TOKEN>/setWebhook?url=<你的Worker域名>

```

*如果返回 `{"ok":true, ...}` 则表示成功。*
*<>要删掉*

---

## 📝 指令列表

请将以下内容发送给 [@BotFather](https://t.me/BotFather) 的 `/setcommands` 以设置菜单：

```text
id - 获取你的ID
json - 获取消息JSON
show - 查看用户信息
alladmin - 召唤管理员
addword - 添加敏感词 (Admin)
delword - 删除敏感词 (Admin)
block - 拉黑回复的人 (Admin)
unblock - 解封ID (Admin)
ban - 禁言 (Admin)
unban - 解封 (Admin)
kick - 踢出 (Admin)
warn - 警告 (Admin)
sb - 永久拉黑 (Admin)
create - 创建抽奖 (Admin)
draw - 手动开奖 (Admin)
listlottery - 抽奖列表 (Admin)
deletelottery - 删除抽奖 (Admin)

```

### 💡 指令使用技巧

* **添加敏感词**:
* 方法1: `/addword 兼职`
* 方法2: 回复那条广告消息，发送 `/addword`


* **拉黑用户**:
* 回复那个人的消息，发送 `/block` 或 `/sb`。


* **创建抽奖**:
* `/create 88元红包`



---

## ⚠️ 注意事项

1. **缓存机制**: 为了防止频繁请求 GitHub API 导致被限流，机器人对配置文件有 **60秒的缓存**。当你使用指令修改配置后，可能会有短暂延迟才会在所有节点生效。
2. **权限要求**: 机器人必须是群组的 **管理员 (Administrator)**，且拥有“删除消息”和“封禁用户”的权限。
3. **抽奖延迟**: 由于数据存储在 GitHub，点击“参与抽奖”按钮时可能会有 1-2 秒的延迟，这是正常的。

---

## 🤝 贡献与支持

如果你觉得这个项目好用，请给 GitHub 仓库点个 Star ⭐！
