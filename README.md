# ChatGPT Plus Trial Checker

一个可本地运行或部署到 VPS 的 ChatGPT Plus 一个月试用资格检测工具。

它可以在浏览器里从 `accessToken` 或 `https://chatgpt.com/api/auth/session` 返回的完整 JSON 提取 token，调用 ChatGPT 官方接口检测当前账号是否可用、是否拥有 `plus-1-month-free` 试用资格，并异步读取账号接口里的 `plan_type`。

## 功能

- 检测账号 token 是否可用。
- 检测账号类型。
- 检测账号是否有 Plus 一个月试用资格。
- 如果试用已经兑换过，展示兑换时间和到期时间。
- 解析 Access Token 的 JWT 摘要、Header 和 Payload。

## 环境要求

- Node.js 18 或更高版本
- npm

## 本地启动

```powershell
npm install
npm start
```

默认监听：

```text
0.0.0.0:8787
```

本机访问可以打开 `http://127.0.0.1:8787`，VPS 上可以用服务器公网 IP 加端口访问。

如需改端口：

```powershell
$env:PORT = "8788"
npm start
```

如需改回只监听本机：

```powershell
$env:HOST = "127.0.0.1"
npm start
```

如果 Node 访问 `chatgpt.com` 超时，可以通过环境变量指定代理：

```powershell
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
npm start
```

支持 `HTTPS_PROXY`、`HTTP_PROXY`、`ALL_PROXY`。

## 使用方法

1. 登录 ChatGPT。
2. 打开：

```text
https://chatgpt.com/api/auth/session
```

3. 复制页面返回的完整 JSON，或只复制其中的 `accessToken`。
4. 粘贴到工具页面。
5. 点击“检测账号”。

## 服务器部署

这个项目可以部署到自己的 VPS。基础流程：

```bash
git clone <your-repo-url>
cd chatgpt-plus-trial-checker
npm install
PORT=8787 npm start
```

默认监听 `0.0.0.0`，如果 VPS 防火墙和安全组已放行端口，可以用：

```text
http://<服务器公网 IP>:8787
```