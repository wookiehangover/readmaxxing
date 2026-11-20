import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  routeDiscovery: { mode: "initial" },
  prerender: ["/", "/about"],
} satisfies Config;
