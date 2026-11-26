import test from "node:test";
import assert from "node:assert/strict";
import { getMetaConfig } from "./odoo-config.js";

test("fetches and validates the selected Odoo account", async () => {
  const expected = { access_token: "token", phone_number_id: "123", verify_token: "verify" };
  const config = await getMetaConfig({ url: "https://odoo.example", apiKey: "key", request: async (url, options) => {
    assert.equal(url.href, "https://odoo.example/json/2/res.company/get_meta_config");
    assert.equal(options.headers.Authorization, "Bearer key");
    assert.equal(options.body, "{}");
    return { ok: true, json: async () => expected };
  } });
  assert.deepEqual(config, expected);
});

test("rejects unsuccessful or incomplete configuration without exposing response data", async () => {
  await assert.rejects(getMetaConfig({ url: "https://odoo.example", apiKey: "key", request: async () => ({ ok: false, status: 403 }) }), /HTTP 403/);
  await assert.rejects(getMetaConfig({ url: "https://odoo.example", apiKey: "key", request: async () => ({ ok: true, json: async () => ({}) }) }), /missing access_token/);
  await assert.rejects(getMetaConfig({ url: "https://odoo.example", apiKey: "" }), /required/);
});
