import { Anthropic } from "@anthropic-ai/sdk";
import {
  MessageParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages/messages.mjs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from "readline/promises";

import dotenv from "dotenv";

dotenv.config(); // load environment variables from .env

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not set");
}

class MCPClient {
  private mcp: Client;
  private anthropic: Anthropic;
  private transport: StdioClientTransport | null = null;
  private tools: Tool[] = [];

  constructor() {
    // Initialize Anthropic client and MCP client
    this.anthropic = new Anthropic({
      apiKey: ANTHROPIC_API_KEY,
    });
    this.mcp = new Client({ name: "mcp-client-cli", version: "1.0.0" });
  }

  async connectToServer(serverScriptPath: string) {
    /**
     * Connect to an MCP server
     *
     * @param serverScriptPath - Path to the server script (.py or .js)
     */
    try {
      // Determine script type and appropriate command
      const isJs = serverScriptPath.endsWith(".js");
      const isPy = serverScriptPath.endsWith(".py");
      if (!isJs && !isPy) {
        throw new Error("Server script must be a .js or .py file");
      }
      const command = isPy
        ? process.platform === "win32"
          ? "python"
          : "python3"
        : process.execPath;

      // Initialize transport and connect to server
      this.transport = new StdioClientTransport({
        command,
        args: [serverScriptPath],
      });
      await this.mcp.connect(this.transport);

      // List available tools
      const toolsResult = await this.mcp.listTools();
      this.tools = toolsResult.tools.map((tool) => {
        return {
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        };
      });
      console.log(
        "Connected to server with tools:",
        this.tools.map(({ name }) => name),
      );
    } catch (e) {
      console.log("Failed to connect to MCP server: ", e);
      throw e;
    }
  }

  async processQuery(query: string) {
    /**
     * Process a query using Claude and available tools
     *
     * @param query - The user's input query
     * @returns Processed response as a string
     */
    const messages: MessageParam[] = [
      {
        role: "user",
        content: query,
      },
    ];

    let response = await this.anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1000,
      messages,
      tools: this.tools,
    });

    // Handle tool calls in a loop
    while (response.content.some(content => content.type === "tool_use")) {
      // Add Claude's response to conversation
      messages.push({
        role: "assistant",
        content: response.content,
      });

      // Process each tool call
      const toolResults = [];
      for (const content of response.content) {
        if (content.type === "tool_use") {
          console.log(`Calling tool: ${content.name} with args:`, content.input);
          
          try {
            const result = await this.mcp.callTool({
              name: content.name,
              arguments: content.input as { [x: string]: unknown } | undefined,
            });

            toolResults.push({
              type: "tool_result" as const,
              tool_use_id: content.id,
              content: Array.isArray(result.content) 
                ? result.content.map(item => 
                    typeof item === 'object' && item !== null && 'text' in item 
                      ? item.text as string
                      : String(item)
                  ).join('\n')
                : String(result.content),
            });
          } catch (error) {
            console.error(`Error calling tool ${content.name}:`, error);
            toolResults.push({
              type: "tool_result" as const,
              tool_use_id: content.id,
              content: `Error: ${error}`,
            });
          }
        }
      }

      // Add tool results to conversation
      if (toolResults.length > 0) {
        messages.push({
          role: "user",
          content: toolResults,
        });

        // Get Claude's response to the tool results
        response = await this.anthropic.messages.create({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 1000,
          messages,
          tools: this.tools,
        });
      }
    }

    // Extract final text response
    const finalText = response.content
      .filter(content => content.type === "text")
      .map(content => content.text)
      .join("\n");

    return finalText;
  }

  async chatLoop() {
    /**
     * Run an interactive chat loop
     */
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log("\nMCP Client Started!");
      console.log("Type your queries or 'quit' to exit.");

      while (true) {
        const message = await rl.question("\nQuery: ");
        if (message.toLowerCase() === "quit") {
          break;
        }
        
        try {
          const response = await this.processQuery(message);
          console.log("\n" + response);
        } catch (error) {
          console.error("Error processing query:", error);
        }
      }
    } finally {
      rl.close();
    }
  }

  async cleanup() {
    /**
     * Clean up resources
     */
    if (this.transport) {
      await this.mcp.close();
    }
  }
}

async function main() {
  if (process.argv.length < 3) {
    console.log("Usage: node build/index.js <path_to_server_script>");
    return;
  }
  const mcpClient = new MCPClient();
  try {
    await mcpClient.connectToServer(process.argv[2]);
    await mcpClient.chatLoop();
  } finally {
    await mcpClient.cleanup();
    process.exit(0);
  }
}

main();