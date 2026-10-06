# Directory website

A static HTML table and source details are generated from sources/*.json. The page has search, a category filter, anchor links to each entry, official/repository links and request/correction links. Core content works without JavaScript.

## Local review

Run npm run build with Node.js 22 or newer, then open dist/index.html in a browser. Review narrow and wide screens, keyboard navigation, no-JavaScript rendering, search/category filtering, empty results and source anchors. This setup does not require a server or dependencies.

## GitHub Pages

1. Merge the reviewed draft.
2. In repository Settings → Pages, select GitHub Actions as the source.
3. Confirm that your GitHub account supports Pages for this private repository, or explicitly choose public visibility if appropriate.
4. Run the manual Deploy directory workflow on main.
5. Inspect the deployed site and links.

Deployment is manual. CI builds pull requests and pushes but does not publish. The repository starts private; the website is not yet public. Repository links and issue forms require repository access, and submitting issues requires a GitHub account. To support public visitors, make an explicit hosting/visibility choice before launch.

No repository settings, visibility changes or deployment have been performed by this implementation.
