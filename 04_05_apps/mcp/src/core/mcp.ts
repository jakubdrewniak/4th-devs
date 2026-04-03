import { createMarketingMcpServer } from "./marketing-server.js";
import { config } from "../config/env.js";

export const buildServer = () => createMarketingMcpServer({
  name: config.serverName,
  version: config.serverVersion,
});
