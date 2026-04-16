import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  index("routes/workspace.tsx"),
  layout("routes/library.tsx", [
    route("books/:id", "routes/book.tsx"),
    route("books/:id/details", "routes/book-details.tsx"),
  ]),
  route("login", "routes/login.tsx"),
  route("settings", "routes/settings.tsx"),
  route("api/standard-ebooks/search", "routes/api.standard-ebooks.search.ts"),
  route("api/standard-ebooks/new-releases", "routes/api.standard-ebooks.new-releases.ts"),
  route("api/standard-ebooks/download", "routes/api.standard-ebooks.download.ts"),
  route("api/chat", "routes/api.chat.ts"),
  route("api/chat-title", "routes/api.chat-title.ts"),
  route("api/auth/register-options", "routes/api.auth.register-options.ts"),
  route("api/auth/register-verify", "routes/api.auth.register-verify.ts"),
  route("api/auth/login-options", "routes/api.auth.login-options.ts"),
  route("api/auth/login-verify", "routes/api.auth.login-verify.ts"),
  route("api/auth/logout", "routes/api.auth.logout.ts"),
  route("api/auth/session", "routes/api.auth.session.ts"),
  route("api/sync/push", "routes/api.sync.push.ts"),
  route("api/sync/pull", "routes/api.sync.pull.ts"),
  route("api/sync/files/upload", "routes/api.sync.files.upload.ts"),
  route("api/sync/files/download", "routes/api.sync.files.download.ts"),
] satisfies RouteConfig;
