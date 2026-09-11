/** Project only mutation-facing fields; SQL ownership/internal columns never enter comparison data. */
export function canonicalData(
  entity: string,
  record: Record<string, unknown>,
): Record<string, unknown> {
  if (entity === "settings") return record.settings as Record<string, unknown>;
  const fields: Record<string, string[]> = {
    book: ["id", "title", "author", "format", "file_hash", "file_blob_url", "cover_blob_url"],
    notebook: ["book_id", "content"],
    position: ["book_id", "cfi"],
    highlight: [
      "id",
      "book_id",
      "cfi_range",
      "text",
      "color",
      "page_number",
      "text_offset",
      "text_length",
      "text_anchor",
      "note",
    ],
    bookmark: ["id", "book_id", "cfi", "label", "page_number", "display_page"],
    chat_session: ["id", "book_id", "title"],
    chat_message: ["id", "session_id", "role", "content", "parts"],
  };
  const names: Record<string, string> = {
    file_blob_url: "remoteFileUrl",
    cover_blob_url: "remoteCoverUrl",
  };
  const data: Record<string, unknown> = {};
  for (const field of fields[entity] ?? [])
    if (field in record)
      data[
        names[field] ?? field.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
      ] = record[field];
  for (const [column, name] of [
    ["created_at", "createdAt"],
    ["deleted_at", "deletedAt"],
  ])
    if (column in record)
      data[name] = record[column] === null ? null : Date.parse(String(record[column]));
  const clock = record.mutation_at ?? record.updated_at;
  if (clock != null) data.updatedAt = Date.parse(String(clock));
  return data;
}
