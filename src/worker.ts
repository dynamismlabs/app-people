// People runs on the Mac (the kit's Node target) only. Its records are kept
// with synchronous SQLite transactions, which Cloudflare D1 doesn't offer
// (docs/parity.md). The kit's build still bundles a Worker entry, so this one
// answers every request with that explanation instead of the app.
export default {
  fetch() {
    return new Response("People runs on your Mac, not on Cloudflare. Install it with app-builder serve --install.", { status: 501, headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};
