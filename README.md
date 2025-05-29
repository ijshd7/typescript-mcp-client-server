# MCP Weather Client & Server Example

This is a tutorial project demonstrating the use of the [Model Context Protocol (MCP)](https://modelcontextprotocol.io) with Anthropic's Claude models. The app includes a simple CLI-based client and a weather tools server, which communicates via MCP over stdio.

## Features

- 🔌 MCP-compliant server exposing tools like `get-alerts` and `get-forecast`
- 🤖 CLI client using Anthropic Claude (via the `@anthropic-ai/sdk`) to call tools
- 🛠️ Written in TypeScript for the client and server
- 🌦️ Example tools provide weather alert and forecast info
- 🔐 Supports `.env` configuration with `ANTHROPIC_API_KEY`

---

## Getting Started

### Prerequisites

- Node.js v20+
- An [Anthropic API key](https://console.anthropic.com/settings/keys)
- NOTE: You will need credits added

### Running
- In `client`: `npm install && npm run build`
- In `server`: `npm install && npm run build`
- In `client`: `node build/index.js ../server/build/index.js` 
