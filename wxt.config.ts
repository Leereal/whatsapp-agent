import { defineConfig } from "wxt";
import { loadEnv } from "vite";
import tailwindcss from "@tailwindcss/vite";

/**
 * Public half of the extension key. It pins the extension id to
 * fllcakgdcehlnnjjheomhiffhnbgdchm on every machine and build, which the
 * backend's CORS allow-list (WHATSAPP_EXTENSION_ORIGINS) relies on. The
 * private half stays in .keys/ (gitignored) and is only needed to sign a .crx.
 */
const EXTENSION_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzFbQmh/FndoxAagsg08o3tijKI8yo8XBMxzpgQcpLWU8H2rT26djGTgM94wnGZ4UZ6doIXY9/B96d9bS5M+BeHkbFc2ZI+h1JuQdPinwYYBl78Dk3YJYcMqR7N8ERtTVG10W6PG401ACQih73mYZYo21Ck20IIGjuC69Jp78H7tkZzTI9V6LuFO0qd2WE7YGiZpFovg2ZXQhoGLL3QB0ZLHJIdupRxo3OyeOYTSn5AR26qKKKzPgFER00MEhL+wkSBtDkML+2BsdH9r8YZOzK/WayBvWJAMsLlRaneslcBtgJy55vCxE8dCken7s+iS8Ad9yMeBL5JP6QFqo0rgKIwIDAQAB";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: ({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "WXT_");
    const apiOrigin = new URL(env.WXT_API_BASE_URL || "http://localhost:5000/api/v1").origin;

    return {
      name: mode === "production" ? "CareerCVPro WhatsApp Assistant" : "CareerCVPro WhatsApp (dev)",
      description: "Pricing replies, reply drafts and order tracking for WhatsApp Web.",
      key: EXTENSION_KEY,
      // Later phases add downloads (CV capture) and notifications (payment proof)
      permissions: ["storage", "sidePanel", "alarms"],
      host_permissions: ["https://web.whatsapp.com/*", `${apiOrigin}/*`],
      action: { default_title: "Open the WhatsApp assistant" },
    };
  },
});
