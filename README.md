# WhatsApp bot configuration

Set `ODOO_URL` to the Odoo instance URL and `ODOO_BOT_API_KEY` to the API key created by the WhatsApp Bot Service user. Configure these as secret environment variables in the bot's hosting service. The selected WhatsApp account in Odoo supplies the Meta access token, phone number ID and webhook verify token when the bot starts. Restart the bot after changing them. Odoo service-user keys expire after at most 90 days and must be renewed.

The Meta webhook must continue to point to the bot for the bot to receive messages. Its verification token must match the value returned by Odoo. Coordinate any webhook changes before deploying, since changing the token can require re-verifying the webhook in Meta.

Other settings remain `REDIS_URL` and `PAYMENT_BASE_URL`. Run `npm start` to start, and `npm test` to check configuration handling.
