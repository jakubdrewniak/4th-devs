import { Hono } from 'hono';
import { chat } from './chat.js';
const routes = new Hono();
routes.route('/chat', chat);
export { routes };
