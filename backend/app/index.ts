import http from "http";
import {
  server as WebSocketServer,
  connection as WebSocketConnection,
  request as WebSocketRequest,
} from "websocket";
import { createClient, RedisClientType, RedisClientOptions } from "redis";

// Types and Interfaces
interface ChatMessage {
  type: "message" | "welcome" | "error";
  content?: string;
  message?: string;
}

// Environment variables with types
const APPID: string = process.env.APPID || "server1";
const PORT: number = parseInt(process.env.PORT || "8080", 10);
const REDIS_URL: string = process.env.REDIS_URL || "redis://rds:6379";

class ChatServer {
  private connections: Set<WebSocketConnection>;
  private subscriber!: RedisClientType;
  private publisher!: RedisClientType;
  private httpServer!: http.Server;
  private wsServer!: WebSocketServer;
  private isShuttingDown: boolean = false;

  constructor() {
    this.connections = new Set();
    this.setupRedisClients();
    this.setupWebSocketServer();
  }

  private async setupRedisClients(): Promise<void> {
    const redisOptions: RedisClientOptions = {
      url: REDIS_URL,
      socket: {
        // @ts-ignore
        reconnectStrategy: (retries) => {
          if (this.isShuttingDown) return undefined;
          if (retries > 20) {
            throw new Error("Redis connection retry limit exceeded");
          }
          return Math.min(retries * 100, 3000);
        },
      },
    };

    try {
      // Create Redis clients
      this.subscriber = createClient(redisOptions) as RedisClientType;
      this.publisher = createClient(redisOptions) as RedisClientType;

      // Set up error handlers
      this.subscriber.on("error", (err) =>
        this.handleRedisError("Subscriber", err)
      );
      this.publisher.on("error", (err) =>
        this.handleRedisError("Publisher", err)
      );

      // Connect both clients
      await Promise.all([this.subscriber.connect(), this.publisher.connect()]);

      // Subscribe to chat channel
      await this.subscriber.subscribe(
        "livechat",
        this.handleRedisMessage.bind(this)
      );

      console.log(
        `Server ${APPID} connected to Redis and subscribed to livechat channel`
      );
    } catch (error) {
      console.error("Failed to initialize Redis clients:", error);
      process.exit(1);
    }
  }

  private handleRedisError(client: string, error: Error): void {
    console.error(`Redis ${client} Error:`, error);
    if (!this.isShuttingDown) {
      // Implement your error recovery strategy here
      console.log(`Attempting to recover ${client} connection...`);
    }
  }

  private async handleRedisMessage(
    message: string,
    channel: string
  ): Promise<void> {
    try {
      console.log(
        `Server ${APPID} received message in channel ${channel}: ${message}`
      );
      await this.broadcastMessage(`${APPID}:${message}`);
    } catch (error) {
      console.error("Error handling Redis message:", error);
    }
  }

  private setupWebSocketServer(): void {
    this.httpServer = http.createServer();

    this.wsServer = new WebSocketServer({
      httpServer: this.httpServer,
      autoAcceptConnections: false,
      keepalive: true,
      keepaliveInterval: 30000,
    });

    this.wsServer.on("request", this.handleWebSocketRequest.bind(this));
  }

  private originIsAllowed(origin: string): boolean {
    // Implement your origin validation logic here
    // Example: return allowedOrigins.includes(origin);
    return true; // WARNING: Don't use this in production!
  }

  private async handleWebSocketRequest(
    request: WebSocketRequest
  ): Promise<void> {
    if (!this.originIsAllowed(request.origin)) {
      request.reject();
      console.log(`Connection from origin ${request.origin} rejected.`);
      return;
    }

    try {
      const connection = request.accept(null, request.origin);
      this.connections.add(connection);

      console.log(
        `New connection established. Total connections: ${this.connections.size}`
      );

      const welcomeMessage: ChatMessage = {
        type: "welcome",
        message: `Connected successfully to server ${APPID}`,
      };

      // Send welcome message
      connection.send(JSON.stringify(welcomeMessage));

      // Set up connection event handlers
      connection.on("message", async (message) => {
        await this.handleWebSocketMessage(message, connection);
      });

      connection.on("close", () => {
        this.handleWebSocketClose(connection);
      });

      connection.on("error", (error) => {
        this.handleWebSocketError(error, connection);
      });
    } catch (error) {
      console.error("Error handling WebSocket request:", error);
    }
  }

  private async handleWebSocketMessage(
    message: any,
    connection: WebSocketConnection
  ): Promise<void> {
    if (message.type === "utf8" && message.utf8Data) {
      try {
        const messageData = message.utf8Data.toString();
        console.log(`${APPID} Received message:`, messageData);

        // Publish to Redis
        await this.publisher.publish("livechat", messageData);
      } catch (error) {
        console.error("Error publishing message:", error);
        const errorMessage: ChatMessage = {
          type: "error",
          message: "Failed to process message",
        };
        connection.send(JSON.stringify(errorMessage));
      }
    }
  }

  private handleWebSocketClose(connection: WebSocketConnection): void {
    this.connections.delete(connection);
    console.log(
      `Connection closed. Remaining connections: ${this.connections.size}`
    );
  }

  private handleWebSocketError(
    error: Error,
    connection: WebSocketConnection
  ): void {
    console.error("WebSocket Error:", error);
    this.connections.delete(connection);
  }

  private async broadcastMessage(message: string): Promise<void> {
    const chatMessage: ChatMessage = {
      type: "message",
      content: message,
    };

    const messageString = JSON.stringify(chatMessage);

    const broadcastPromises = Array.from(this.connections)
      .filter((connection) => connection.connected)
      .map((connection) => {
        return new Promise<void>((resolve, reject) => {
          try {
            connection.send(messageString);
            resolve();
          } catch (error) {
            console.error("Error sending message to client:", error);
            reject(error);
          }
        });
      });

    await Promise.allSettled(broadcastPromises);
  }

  public async start(): Promise<void> {
    try {
      await new Promise<void>((resolve) => {
        this.httpServer.listen(PORT, () => {
          console.log(`WebSocket server is listening on port ${PORT}`);
          resolve();
        });
      });
    } catch (error) {
      console.error("Failed to start server:", error);
      throw error;
    }
  }

  public async cleanup(): Promise<void> {
    this.isShuttingDown = true;
    console.log("Starting cleanup process...");

    try {
      // Close all WebSocket connections
      const closePromises = Array.from(this.connections).map((connection) => {
        return new Promise<void>((resolve) => {
          connection.close();
          resolve();
        });
      });
      await Promise.all(closePromises);
      this.connections.clear();

      // Cleanup Redis connections
      await this.subscriber.unsubscribe();
      await this.subscriber.quit();
      await this.publisher.quit();

      // Close HTTP server
      await new Promise<void>((resolve, reject) => {
        this.httpServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      console.log("Cleanup completed successfully");
    } catch (error) {
      console.error("Error during cleanup:", error);
      throw error;
    }
  }
}

async function main() {
  const server = new ChatServer();

  // Handle process signals
  process.on("SIGTERM", async () => {
    console.log("Received SIGTERM signal");
    await server.cleanup();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log("Received SIGINT signal");
    await server.cleanup();
    process.exit(0);
  });

  process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
  });

  try {
    await server.start();
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

main().catch(console.error);