import fetch from "node-fetch";

export async function getMetaConfig({ url = process.env.ODOO_URL, apiKey = process.env.ODOO_BOT_API_KEY, request = fetch } = {}) {
  if (!url || !apiKey) throw new Error("ODOO_URL and ODOO_BOT_API_KEY are required");
  const endpoint = new URL("/json/2/res.company/get_meta_config", url);
  if (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost" && endpoint.hostname !== "127.0.0.1") {
    throw new Error("ODOO_URL must use HTTPS");
  }
  const response = await request(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error(`Odoo configuration request failed (HTTP ${response.status}); check the bot key and selected WhatsApp account`);
  const config = await response.json();
  for (const field of ["access_token", "phone_number_id", "verify_token"]) {
    if (typeof config?.[field] !== "string" || !config[field].trim()) throw new Error(`Odoo configuration is missing ${field}`);
  }
  return config;
}
