const { Paddle, Environment } = require('@paddle/paddle-node-sdk');

const environment = process.env.PADDLE_ENVIRONMENT === 'production'
  ? Environment.production
  : Environment.sandbox;

if (!process.env.PADDLE_API_KEY) {
  console.warn('[Paddle] PADDLE_API_KEY is not set — SDK calls will fail at runtime.');
}

const paddle = new Paddle(process.env.PADDLE_API_KEY || '', { environment });

module.exports = paddle;
