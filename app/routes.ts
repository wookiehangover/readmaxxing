import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  layout("routes/library.tsx", [
    index("routes/library-index.tsx"),
    route("books/:id", "routes/book.tsx"),
  ]),
] satisfies RouteConfig;
