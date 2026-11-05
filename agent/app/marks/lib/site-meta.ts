/** The line under the page title in search results and link previews. */
export const SITE_DESCRIPTION =
  "Perpetual futures, tokenized shares and capped calls on NEAR, with an agent beside the desk. Borrow against a position, and send a share or a position to a friend as a link.";

/** Title plus the description, for the tab and for Open Graph and Twitter cards. */
export function marksMeta(title: string, description = SITE_DESCRIPTION) {
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:site_name", content: "Marks" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  ];
}
