import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  index("routes/workspace.tsx"),
  layout("routes/library.tsx", [
    route("books/:id", "routes/book.tsx"),
    route("books/:id/details", "routes/book-details.tsx"),
  ]),
  route("settings", "routes/settings.tsx"),
  route("api/standard-ebooks/search", "routes/api.standard-ebooks.search.ts"),
  route(
    "api/standard-ebooks/new-releases",
    "routes/api.standard-ebooks.new-releases.ts",
  ),
  route(
    "api/standard-ebooks/download",
    "routes/api.standard-ebooks.download.ts",
  ),
  route("api/chat", "routes/api.chat.ts"),
] satisfies RouteConfig;
