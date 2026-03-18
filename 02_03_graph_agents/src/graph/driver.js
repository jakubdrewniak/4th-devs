/**
 * Neo4j driver wrapper.
 * Creates a single driver instance and verifies connectivity at startup.
 */

import neo4j from "neo4j-driver";
import log from "../helpers/logger.js";

/**
 * @param {{ uri: string, username: string, password: string }} config
 * @returns {import("neo4j-driver").Driver}
 */
export const createDriver = ({ uri, username, password }) => {
  const driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  return driver;
};

/**
 * Verify connectivity and log server info.
 */
export const verifyConnection = async (driver) => {
  const serverInfo = await driver.getServerInfo();
  log.info(`Neo4j ${serverInfo.protocolVersion} at ${serverInfo.address}`);
  return serverInfo;
};

/**
 * Run a read transaction with automatic session management.
 */
export const readQuery = async (driver, cypher, params = {}) => {
  const session = driver.session();
  try {
    const result = await session.executeRead((tx) => tx.run(cypher, params));
    return result.records;
  } finally {
    await session.close();
  }
};

/**
 * Run a write transaction with automatic session management.
 */
export const writeQuery = async (driver, cypher, params = {}) => {
  const session = driver.session();
  try {
    const result = await session.executeWrite((tx) => tx.run(cypher, params));
    return result.records;
  } finally {
    await session.close();
  }
};

/**
 * Run multiple write statements in a single transaction.
 */
export const writeTransaction = async (driver, fn) => {
  const session = driver.session();
  try {
    return await session.executeWrite(fn);
  } finally {
    await session.close();
  }
};
